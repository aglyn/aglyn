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
 * ZACH, 2026-08-19, choosing between "enforce now", "enforce with a raised
 * ceiling" and "leave it off through launch": **enforce now** — "before
 * public signups arrive, so the cap is proven under real traffic while the
 * cohort is small and a mistake is cheap." His standing requirement is the
 * one this module exists to make true: *"the free/hobby tier does hard cap so
 * it always actually stays free."*
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
 * So the decision is made ONCE A DAY, where the arithmetic already happens —
 * `api/billing/usage-alerts` already sums the org's page views for the
 * current month and already writes back to the org doc — and its verdict is
 * denormalized onto the org document as {@link OrgBandwidthCap}. The serving
 * path then reads it from `getOrgBilling`, the org doc it ALREADY loads and
 * caches for 60 seconds as "the suspension gate and every entitlement input
 * for the render". **The cap costs zero additional reads.**
 *
 * ### The latency, stated plainly
 *
 * The cap therefore ENGAGES within one sweep of the daily cron — worst case
 * ~24 hours after the band is crossed, and typically less because the 80%
 * alert has already fired a day earlier. It is a real ceiling on the month,
 * not a real-time throttle, and the honest way to describe it is "a free site
 * cannot run away for a month", not "a free site cannot exceed 5 GB". Do not
 * close that window by adding a read to the render path; the place to close
 * it is the CDN, which is Vercel configuration and not a repo change.
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
  planMetersInfraOverage,
  resolveOrgEntitlements,
} from './plan-entitlements'

/**
 * The month key the marker is stamped with: UTC `YYYY-MM`, the same shape as
 * `submissionMonthKey` and the `orgs/{id}/usage/{month}` document id, and the
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
 *     free plan. Paid plans BILL bandwidth past the band and are never cut
 *     off; that promise is older than this cap and this function is where it
 *     is kept. Re-derived from the CURRENT plan on every read, which is what
 *     releases an upgraded org without a write;
 *  3. the plan's band is finite. Enterprise also answers false to
 *     `planMetersInfraOverage` — its price is negotiated and every band is
 *     `UNLIMITED` — so without this an enterprise org carrying a marker some
 *     future writer left behind would be refused by a band it does not have.
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
  if (!Number.isFinite(resolveOrgEntitlements(org).bandwidthGb)) return false
  const cap = org.bandwidthCap
  if (!cap || typeof cap !== 'object') return false
  return cap.month === bandwidthCapMonthKey(now)
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
  if (!Number.isFinite(includedBandwidthGb) || !(includedBandwidthGb > 0)) {
    return false
  }
  return usedBandwidthGb > includedBandwidthGb
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
  return {
    title: 'Over the monthly traffic limit',
    body:
      'This site has used all of the traffic included with it this month, ' +
      'so its pages are paused until the start of next month. Nothing is ' +
      'wrong with your connection, and nothing here has been removed.',
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
