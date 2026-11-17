/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The free plan's BANDWIDTH HARD CAP (AGL-1967 / AGL-2070 / AGL-2155).
 *
 * Enforced from before public signups, so the cap is proven under real
 * traffic while the cohort is small and a mistake is cheap. The requirement
 * this module exists to make true: the free/hobby tier hard-caps, so that it
 * always actually stays free.
 *
 * Until this shipped, bandwidth was the ONE billable dimension with no
 * runtime refusal anywhere. Media ingress, forms, contacts, datasets, API and
 * seats all hard-stop on free; `bandwidthGb: 5` appeared only in the plan
 * table, in reporting arithmetic and in UI. A free site that went viral
 * served every page and Aglyn paid the egress with no ceiling.
 *
 * ## Why a MARKER on the org doc, and not a check
 *
 * The obvious implementation — read the page-view counter before rendering —
 * is the one thing this cap must not do. Page views are counted AFTER the
 * fact, by a client beacon into `hosts/{id}/analytics/{day}`; consulting them
 * per render would put a Firestore read on the hot path of every public page
 * on the platform, paid by every PAYING customer too, to answer a question
 * only free orgs can ever fail. That is the exact cost the whole ISR/cache
 * design exists to avoid.
 *
 * So the decision is made where the arithmetic already happens, and its
 * verdict is denormalized onto the org document as {@link OrgBandwidthCap}.
 * The serving path then reads it from `getOrgBilling`, the org doc it ALREADY
 * loads and caches for 60 seconds as "the suspension gate and every
 * entitlement input for the render". **The cap costs zero additional reads.**
 *
 * ### TWO writers, and neither is on the render path (AGL-2413)
 *
 * 1. `apps/tenant/app/api/analytics/collect` — the beacon that WRITES the
 *    page-view counter, on its existing 1-in-200 sample. It already sums this
 *    month with this query and already loads this org doc for the abuse
 *    ceiling, so the cap rides both for free.
 * 2. `api/billing/usage-alerts` — the daily sweep, which sums page views
 *    ORG-WIDE across up to 100 hosts and is therefore the backstop for any
 *    org running more than one site.
 *
 * The beacon is the one that matters, and it exists because the sweep alone
 * was not a cap at all: it skips every org with no `plan` field, and
 * `createOrganization` writes none — so for the whole never-subscribed free
 * tier the marker had never once been written. The general lesson: **a cap
 * that lives only in a scheduled sweep stops existing the moment the sweep
 * does not run.** Every other free dimension refuses at the
 * point of use; this one now does too.
 *
 * ### The latency, stated plainly
 *
 * The beacon closes the window to the sampling slop — at most
 * (200 x instances) page views past the band, against a free band of ~8,700 —
 * so on the common single-site free org the cap engages within a couple of
 * hundred views. It is still not a per-request throttle, and the honest way to
 * describe it is "a free site cannot run away", not "a free site cannot serve
 * byte 5,368,709,121". Do not close the remaining slop by adding a read to the
 * RENDER path; the place to close it is the CDN, which is Vercel configuration
 * and not a repo change.
 *
 * ### It RELEASES immediately, though
 *
 * Asymmetric on purpose, and this is why {@link bandwidthCapEngaged} re-reads
 * the plan rather than trusting the marker alone. An org that upgrades starts
 * serving again on the next org-doc TTL — about 60 seconds — without waiting
 * for any cron to run or any flag to be cleared. Making somebody who has just
 * paid wait until tomorrow morning for their site to come back is the failure
 * mode that would make this feature worse than the hole it closes.
 *
 * Nothing ever CLEARS the marker either: it names the month it was written
 * for, so a new month simply stops matching. A cap whose lift depends on a
 * write is a cap that stays engaged when the writer fails.
 */

import type { AglynOrgBilling, OrgBandwidthCap } from '../foundation'
import {
  isCustomPricedPlan,
  planMetersInfraOverage,
  resolveEffectivePlan,
  resolveOrgEntitlements,
} from './plan-entitlements'

/**
 * The month key the marker is stamped with: UTC `YYYY-MM`, the same shape as
 * `utcMonthKey` and the `orgs/{id}/usage/{month}` document id, and the
 * same key `usage-alerts` dedupes its own guards by. One month boundary
 * across the platform — a cap that reset on a different day from the counter
 * it is derived from would engage against last month's traffic.
 */
export function bandwidthCapMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/**
 * How long a crawler or uptime check is told to wait.
 *
 * NOT "until the month rolls over", which is the arithmetically correct
 * answer and can be three weeks. The site can come back at any moment — the
 * owner upgrades and the release path above restores it in about a minute —
 * so a multi-week `Retry-After` would tell Google to stop looking long after
 * the site was serving again. An hour is short enough to be wrong in the
 * recoverable direction.
 */
export const BANDWIDTH_CAP_RETRY_AFTER_SECONDS = 3600

/**
 * Is this org's serving currently refused by the free-plan bandwidth cap?
 *
 * THREE conditions, and the second and third are the ones that matter:
 *
 *  1. the marker names the CURRENT month (a stale marker is not a cap);
 *  2. the org's plan does not meter infrastructure overage — i.e. it is the
 *     free plan, or a paid plan held as a staff comp (AGL-3034), which has no
 *     subscription to bill past the band either. Paid plans BILL bandwidth
 *     past the band and are never cut off; that promise is older than this
 *     cap and this function is where it is kept. Re-derived from the CURRENT
 *     plan on every read, which is what releases an upgraded org without a
 *     write;
 *  3. the plan is not custom-priced, and its band is finite. Enterprise also
 *     answers false to `planMetersInfraOverage` — its price is negotiated —
 *     and since 2026-09-07 its band is a FINITE fallback (twice Agency's), so
 *     "unmetered and finite" would describe a contracted customer exactly as
 *     it describes a free one. Its traffic is paid for by agreement, not by
 *     invoice, and this cap is the free plan's rule alone: an enterprise org
 *     carrying a marker some future writer left behind is never refused.
 *     Belt and braces: today's writer cannot produce that marker, and this
 *     makes it impossible rather than merely unreachable.
 *
 * Fail OPEN on anything unrecognised. A missing org, a malformed marker or a
 * plan this build cannot read all serve the site: an unreadable org doc is an
 * outage, and taking a customer's website down over one is not a cap, it is
 * the incident.
 */
export function bandwidthCapEngaged(
  org: Partial<AglynOrgBilling> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!org) return false
  if (planMetersInfraOverage(org)) return false
  if (isCustomPricedPlan(resolveEffectivePlan(org))) return false
  if (!Number.isFinite(resolveOrgEntitlements(org).bandwidthGb)) return false
  const cap = org.bandwidthCap
  if (!cap || typeof cap !== 'object') return false
  if (cap.month !== bandwidthCapMonthKey(now)) return false
  // The one-time grace (AGL-4232): engaged, but not refusing until it ends.
  // Nothing writes at that moment; every reader re-derives it from the clock.
  return !(typeof cap.graceUntil === 'number' && now.getTime() < cap.graceUntil)
}

/**
 * How long the ONE-TIME grace keeps a site online past its band (AGL-4232):
 * the first time a site goes over, ever, it stays up this long so its owner
 * can upgrade before visitors are turned away.
 */
export const BANDWIDTH_CAP_GRACE_MS = 72 * 60 * 60 * 1000

/**
 * When the grace ends, while one is running for this org this month; `null`
 * when the org is not over its band, is already paused, or never had one.
 * The owner's surfaces read this to say "upgrade or your site pauses on …".
 */
export function bandwidthCapGraceUntil(
  org: Partial<AglynOrgBilling> | null | undefined,
  now: Date = new Date(),
): number | null {
  const cap = org?.bandwidthCap
  if (!cap || typeof cap !== 'object' || cap.month !== bandwidthCapMonthKey(now)) return null
  if (typeof cap.graceUntil !== 'number' || now.getTime() >= cap.graceUntil) return null
  // Only where the cap would refuse were there no grace: an upgraded org has
  // nothing to be warned about.
  const { graceUntil: _running, ...withoutGrace } = cap
  return bandwidthCapEngaged({ ...org, bandwidthCap: withoutGrace }, now) ? cap.graceUntil : null
}

/**
 * The marker a writer stamps when the cap engages (AGL-1967/2155, AGL-4232):
 * the month and its diagnostics, plus the grace window when the org's sites
 * have never had one. ONE shape for every writer, so a reader cannot tell
 * which of them stamped it.
 */
export function bandwidthCapMarker(options: {
  month: string
  nowMs: number
  pageViews: number
  includedPageViews: number
  /** When the grace this engagement carries ends; null for none. */
  graceUntil: number | null
}): OrgBandwidthCap {
  return {
    month: options.month,
    engagedAt: options.nowMs,
    pageViews: Math.round(options.pageViews),
    includedPageViews: Math.round(options.includedPageViews),
    ...(options.graceUntil !== null ? { graceUntil: options.graceUntil } : {}),
  }
}

/**
 * The grace an engagement carries, from the org's sites as read (AGL-4232):
 * a NEW one when none of them has ever had it, the one ALREADY RUNNING when
 * a site's grant is still inside its window (so a writer re-engaging from a
 * stale org doc never cuts a running grace short), else none.
 */
export function bandwidthGraceForEngagement(
  hosts: ReadonlyArray<{ bandwidthGraceUsedAt?: unknown } | null | undefined>,
  nowMs: number,
): { graceUntil: number | null; grants: boolean } {
  if (bandwidthGraceAvailable(hosts)) {
    return { graceUntil: nowMs + BANDWIDTH_CAP_GRACE_MS, grants: true }
  }
  const latest = Math.max(
    0,
    ...hosts.map((host) =>
      typeof host?.bandwidthGraceUsedAt === 'number' ? host.bandwidthGraceUsedAt : 0,
    ),
  )
  const running = latest + BANDWIDTH_CAP_GRACE_MS
  return { graceUntil: latest > 0 && nowMs < running ? running : null, grants: false }
}

/**
 * Whether an org's sites are owed the one-time grace: it has at least one
 * site, and none of them has ever had it (`AglynHost.bandwidthGraceUsedAt`).
 */
export function bandwidthGraceAvailable(
  hosts: ReadonlyArray<{ bandwidthGraceUsedAt?: unknown } | null | undefined>,
): boolean {
  return (
    hosts.length > 0 &&
    hosts.every((host) => typeof host?.bandwidthGraceUsedAt !== 'number')
  )
}

/**
 * The grace deadline as the owner reads it: an unambiguous UTC date and
 * time, e.g. "Thursday, November 19 at 3:04 PM UTC".
 */
export function formatBandwidthGraceDeadline(ms: number): string {
  const date = new Date(ms)
  const day = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  return `${day} at ${time} UTC`
}

/**
 * Should the cap be ENGAGED for this org-month? The writer's half of the
 * question, kept beside the reader's so the two cannot drift apart.
 *
 * Takes the measured figure and the band rather than reading anything, so the
 * cron passes in the very numbers it alerts on. `>` and not `>=`: an org
 * exactly at its band has used what it was given and is not over it.
 */
export function bandwidthCapShouldEngage(options: {
  org: Partial<AglynOrgBilling> | null | undefined
  usedBandwidthGb: number
  includedBandwidthGb: number
}): boolean {
  const { org, usedBandwidthGb, includedBandwidthGb } = options
  if (planMetersInfraOverage(org)) return false
  // The reader's third condition, kept in step: a custom-priced plan is paid
  // for by agreement and is never paused, whatever its band resolves to.
  if (isCustomPricedPlan(resolveEffectivePlan(org))) return false
  if (!Number.isFinite(includedBandwidthGb) || !(includedBandwidthGb > 0)) {
    return false
  }
  return usedBandwidthGb > includedBandwidthGb
}

/**
 * Could this org's traffic EVER engage the cap — is it on a plan that stops
 * at its band rather than billing past it (AGL-3474)?
 *
 * {@link bandwidthCapShouldEngage} with the usage left out, for a writer that
 * has to decide whether measuring is worth its reads at all: the media CDN
 * totals an org's month only when this is true, so a paying org's video costs
 * no read to meter. Answered by the same predicate rather than restated, so
 * the two cannot disagree about which plans the cap is for.
 */
export function bandwidthCapApplies(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  return bandwidthCapShouldEngage({
    org,
    usedBandwidthGb: Number.POSITIVE_INFINITY,
    includedBandwidthGb: resolveOrgEntitlements(org).bandwidthGb,
  })
}

/**
 * What the OWNER is told when a grace starts (AGL-4232), in the console and by
 * email: the deadline in plain words, with the way past it. `{site}` is
 * filled by the notifier from the site it reads. `used` is the writer's own
 * account of what was used (page views, or traffic including media).
 */
export function bandwidthGraceOwnerNotice(options: {
  graceUntil: number
  used: string
  resumesOn: string
}): BandwidthCapNotice {
  const deadline = formatBandwidthGraceDeadline(options.graceUntil)
  return {
    title: `Upgrade or {site} pauses on ${deadline}`,
    body:
      `{site} has used ${options.used} this month. It stays online until ` +
      `${deadline}. Upgrade in Billing before then to keep it online; if you ` +
      `don't, visitors see a "temporarily unavailable" notice from then until ` +
      `${options.resumesOn}. Nothing is charged for the extra traffic. This ` +
      'extra time is given once per site, so in a later month a site past its ' +
      'limit pauses straight away.',
  }
}

/** What a visitor sees on a capped site. */
export interface BandwidthCapNotice {
  title: string
  body: string
}

/**
 * The visitor's sentence.
 *
 * Constrained the same way the form abuse-ceiling copy is (AGL-1666), and for
 * the same reason: the person reading it is a stranger to the site, so it
 * must not disclose the owner's plan, their bill, or anything about their
 * account beyond the one fact that makes the page they asked for absent. It
 * says what happened, that it is not their fault and not permanent, and when
 * it ends — and then stops. "Upgrade your plan" belongs in the owner's
 * console and their inbox, which is where the usage alert already puts it,
 * not on a page shown to their readers.
 *
 * Deliberately NOT routed through `lockdownNotice`. A lockdown is the panic
 * button — staff-set, security or billing, "contact support" — and its copy
 * would be a lie here in both directions: nobody took this site down and
 * support cannot lift it. Reusing the RENDERING channel (the 503 notice page)
 * while keeping the WORDS separate is the split that keeps both honest.
 */
export function bandwidthCapNotice(): BandwidthCapNotice {
  // NEUTRAL (AGL-4232): nothing about limits, plans, traffic or pricing —
  // those are the owner's to read in the console, not a visitor's.
  return {
    title: 'Temporarily unavailable',
    body: 'This site is temporarily unavailable.',
  }
}

/**
 * The refusal code on the machine-readable half of the verdict, so a caller
 * can tell a capped site from a locked one. The two answer the same HTTP
 * status from the same notice page on purpose — a 503 with `Retry-After` is
 * the only status that tells a crawler "come back", where a 402 or a 403
 * risks a customer's site being de-indexed over one busy month — so the
 * status discriminates nothing and this code is the whole discriminator.
 */
export const BANDWIDTH_CAP_CODE = 'bandwidth-cap'
