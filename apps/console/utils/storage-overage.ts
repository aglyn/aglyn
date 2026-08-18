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

import {
  checkQuota,
  planMetersInfraOverage,
  UNLIMITED,
  type AglynOrgBilling,
} from '@aglyn/aglyn/server'
import { METERED_MARKUP, METERED_UNIT_RATES_USD } from './usage-metering'

/**
 * Metered storage: what bills, what warns, and what a customer may cap
 * (AGL-1886, corrected 2026-08-18).
 *
 * ## ZACH'S CORRECTION, 2026-08-18, verbatim
 *
 *   "**don't let it make us lose revenue or cost us money, it should be a
 *   control by the end user, to prevent overage or usage alerts rather, we
 *   just want to minimize churn**"
 *
 * and, on the same day, on the bottom of the range:
 *
 *   "**We also need to make sure the free/hobby tier does hard cap so it
 *   always actually stays free**"
 *
 * These supersede the shape this file shipped with. His earlier condition
 * still stands and is not in tension with them — 2026-08-17, verbatim:
 * "*also give overage protection and usage alerts, so customers don't get a
 * surprise bill*". The protection he means is **being told**, not being
 * stopped.
 *
 * ## WHAT WAS WRONG
 *
 * This file used to require an **acknowledgement before a metered org could
 * store a byte past its band** — a soft cap whose opt-in was a gate. The
 * route that writes that acknowledgement had no caller at all until AGL-1957,
 * so the gate failed closed on every org that had ever existed: no opt-in, no
 * storage, and therefore no revenue for capacity we would happily sell. It
 * satisfied "no surprise bill" by satisfying "no bill".
 *
 * That is a churn event of its own. Bill shock churns; so does a product that
 * silently stops accepting uploads. The old design traded one for the other
 * and called the trade protection.
 *
 * ## THE MODEL, corrected
 *
 * The standard metered shape, and the whole of it:
 *
 *   1. Inside the included allowance — upload, no charge. Unchanged.
 *   2. **Past it on a metered plan — ALLOWED, and billed.** No consent step
 *      stands between a paying customer and the service they are using. This
 *      is the inversion; `report-usage` was already billing stored bytes and
 *      never consulted the acknowledgement, so the ingress refusal was the
 *      only thing between a metered org and an invoice line. Now the two
 *      agree: bytes that land are bytes that bill.
 *   3. **Alerts are what prevent the surprise** — `usage-alerts` warns on
 *      approach (80%) and again at the band (100%), in-product and by the
 *      existing notification path. A warning, not a wall.
 *   4. **A cap is the customer's option, never our default.** An org that
 *      wants a hard ceiling sets one in Billing; uploads past it are refused
 *      citing *their* limit, not ours. Off unless they choose it — that is
 *      the "control by the end user" Zach describes.
 *
 * ## WHAT STILL HARD-BANDS, AND WHY IT MUST
 *
 * A plan that does **not** meter infrastructure overage has no way to bill
 * for the bytes, so accepting them is pure cost with nothing to invoice
 * against. Free/hobby therefore keeps the hard band exactly where it was, and
 * that is the point of Zach's second sentence: free "always actually stays
 * free" — no metered price, no invoice line, no cap to configure.
 *
 * The hard band here is the *braces*. The **belt** is structural and lives in
 * `plan-entitlements`: free carries `meteredInfraPassThrough: false` and a
 * `null` overage rate on every billable dimension, so
 * `estimateMonthlyUsageCost` returns `billableCostUsd: 0` and each
 * `check*Quota` returns `overageMonthlyUsd: 0` — by arithmetic, not by a
 * runtime check. A free org that somehow blew past every band would still
 * invoice exactly zero. See `specs/free-tier-never-billed.spec.ts`, which
 * decomposes that claim per dimension rather than asserting it in aggregate.
 *
 * Enterprise resolves `UNLIMITED` and never reaches a band at all.
 */

/**
 * Warn at 80% of the allowance and again at 100% (AGL-1886 item 3).
 *
 * WHY 80. It is the threshold `usage-alerts` has already used for every other
 * quota since AGL-276, so a storage warning arrives on the same schedule as
 * the email, bandwidth and dataset ones an owner already recognises — a
 * second, different percentage for storage alone would be a worse warning for
 * being unfamiliar. 80% of a monthly storage band is also days of headroom at
 * ordinary upload rates rather than minutes, which is what makes it a warning
 * rather than an announcement.
 *
 * WHY 100 AND NOT HIGHER. The cap notification fires at the allowance, not at
 * some margin past it, because at the allowance is the last moment the
 * customer can act without a charge attached — and with the ceiling above,
 * 100% is also where uploads start being refused for an org that has not
 * opted in. Warning after that would be describing an event rather than
 * preceding it.
 *
 * CONFIG, per the issue: `USAGE_ALERT_APPROACH_PCT` overrides the 80. It
 * FAILS TO THE DEFAULT — a blank, a word, a negative or anything at or above
 * 100 leaves 80 standing, because a malformed percentage that silently
 * disabled the approach warning would be an alert that cannot fire, which is
 * the exact defect this issue was opened to remove.
 */
export const USAGE_ALERT_APPROACH_PCT_DEFAULT = 80
export const USAGE_ALERT_CAP_PCT = 100

/** The approach threshold in force, as a percentage. */
export function usageAlertApproachPct(
  configured?: string | null | undefined,
): number {
  const parsed = Number(String(configured ?? '').trim())
  if (!Number.isFinite(parsed)) return USAGE_ALERT_APPROACH_PCT_DEFAULT
  // Must be a real warning: above zero, and BELOW the cap threshold. A
  // configured 100 would collapse the two notifications into one and delete
  // the warning half; a configured 0 would alert every org at all times,
  // which trains people to ignore the one that matters.
  if (parsed <= 0 || parsed >= USAGE_ALERT_CAP_PCT) {
    return USAGE_ALERT_APPROACH_PCT_DEFAULT
  }
  return parsed
}

/**
 * Which notification a usage ratio earns, or 0 for none.
 *
 * Shared by every quota in `usage-alerts` so the storage warning and the
 * bandwidth warning cannot drift apart, and so the percentages are testable
 * without standing up a cron.
 */
export function usageAlertThreshold(
  used: number,
  limit: number,
  approachPct = USAGE_ALERT_APPROACH_PCT_DEFAULT,
): 0 | typeof USAGE_ALERT_APPROACH_PCT_DEFAULT | 100 {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  if (!Number.isFinite(used) || used < 0) return 0
  const ratio = (used / limit) * 100
  if (ratio >= USAGE_ALERT_CAP_PCT) return USAGE_ALERT_CAP_PCT
  if (ratio >= approachPct) return approachPct as never
  return 0
}

/**
 * The monthly spend cap this org CHOSE, if it chose one.
 *
 * The cap is the customer's control and nothing else: it is absent by
 * default, it is never required to store or to be billed, and setting one is
 * the only thing that can make an upload refuse on a metered plan.
 *
 * `monthlyCapUsd` is `null` when no cap is set — deliberately `null` rather
 * than `Infinity`, because this value is serialised into the ingress routes'
 * JSON responses and `JSON.stringify(Infinity)` is `null` anyway. One
 * spelling for "no cap", on both sides of the wire.
 *
 * ## Two directions this must not fail in, and they pull opposite ways
 *
 * - A cap the customer SET must never read as "no cap" because the stored
 *   number was corrupt. That would bill someone who asked not to be billed.
 *   So an enabled-but-unusable cap falls back to
 *   `STORAGE_CAP_FALLBACK_USD` — low, and recoverable by editing the field.
 * - A cap the customer never set must never be invented, or the default is a
 *   block again and we are back to the design this replaced.
 *
 * ## The legacy acknowledgement
 *
 * Orgs written by the pre-2026-08-18 route carry
 * `{ acknowledgedAt, monthlyCeilingUsd }`. That ceiling was the bound on a
 * consent, and the customer typed it — so it is honoured as a cap rather than
 * discarded. Reading it as "no cap" would silently raise a limit somebody
 * chose; reading it as a cap keeps their number in force and lets them clear
 * it from the same card. (In practice the acknowledgement surface shipped
 * hours before this correction and reached no production org, so this branch
 * is defensive rather than load-bearing.)
 */
export const STORAGE_CAP_FALLBACK_USD = 25

export interface StorageCap {
  /** Whether the customer has chosen a ceiling at all. */
  capSet: boolean
  /** The ceiling in force, or `null` when uncapped. */
  monthlyCapUsd: number | null
}

export function resolveStorageCap(
  org: Partial<AglynOrgBilling> | null | undefined,
): StorageCap {
  const raw = (org as any)?.storageOverage
  // `capUsd` is the field this file's route writes now; `acknowledgedAt` +
  // `monthlyCeilingUsd` is the legacy pair. Either counts as "the customer
  // chose a ceiling"; neither being present means uncapped.
  const explicit = Number(raw?.capUsd)
  if (Number.isFinite(explicit) && explicit > 0) {
    return { capSet: true, monthlyCapUsd: explicit }
  }
  const legacy = Number(raw?.monthlyCeilingUsd)
  const hasLegacyConsent = Boolean(raw?.acknowledgedAt)
  if (hasLegacyConsent || (Number.isFinite(legacy) && legacy > 0)) {
    return {
      capSet: true,
      monthlyCapUsd:
        Number.isFinite(legacy) && legacy > 0 ? legacy : STORAGE_CAP_FALLBACK_USD,
    }
  }
  // `capUsd` present but unusable (blank, negative, NaN, Infinity) with no
  // legacy pair to fall back on: the customer asked for A cap, so give them
  // the conservative one rather than none.
  if (raw != null && 'capUsd' in raw) {
    return { capSet: true, monthlyCapUsd: STORAGE_CAP_FALLBACK_USD }
  }
  return { capSet: false, monthlyCapUsd: null }
}

/**
 * One metered GB-month at the price a customer actually pays, markup included.
 *
 * The refusal message below, the Billing card's quoted rate (AGL-1957) and the
 * invoice all have to name the SAME number — a card advertising one price
 * while the rollup bills another is the surprise bill wearing a disclosure.
 */
export function storageOveragePricePerGbUsd(): number {
  return METERED_UNIT_RATES_USD.storagePerGbMonth * METERED_MARKUP
}

/** What an upload past the allowance would cost the customer for the month. */
export function storageOverageUsd(overageMb: number): number {
  if (!Number.isFinite(overageMb) || overageMb <= 0) return 0
  return (
    (overageMb / 1024) *
    METERED_UNIT_RATES_USD.storagePerGbMonth *
    METERED_MARKUP
  )
}

export interface StorageCapVerdict {
  allowed: boolean
  /** Machine code for the console; null when allowed. */
  code: 'storage_cap_reached' | null
  /** Customer-facing sentence; null when allowed. */
  message: string | null
  /** Projected monthly overage charge if this upload lands. */
  projectedOverageUsd: number
  /** The customer's ceiling, or `null` when they have not set one. */
  monthlyCapUsd: number | null
}

/**
 * Whether one upload may land on a METERED plan, given what the scope holds.
 *
 * Callers screen for the metered case first — an unmetered plan never reaches
 * here, because there is no billable outcome for it to choose between.
 *
 * `allowanceMb` is the scope's included storage (`storagePerHostMb`), and
 * `usedMb` INCLUDES the incoming file — the same convention
 * `api/media/upload-url` already computes for its quota check, so the two
 * cannot disagree about whether a file fits.
 *
 * The ONLY refusal here is the customer's own cap. Past the included band
 * with no cap set, the answer is yes-and-billed: that is the corrected model,
 * and the assertion that fails if the opt-in gate is ever restored.
 */
export function checkStorageCap(input: {
  org: Partial<AglynOrgBilling> | null | undefined
  usedMb: number
  allowanceMb: number
}): StorageCapVerdict {
  const { org, usedMb, allowanceMb } = input
  const cap = resolveStorageCap(org)
  const overageMb = Math.max(0, usedMb - allowanceMb)
  const projectedOverageUsd = storageOverageUsd(overageMb)
  if (overageMb <= 0) {
    return {
      allowed: true,
      code: null,
      message: null,
      projectedOverageUsd: 0,
      monthlyCapUsd: cap.monthlyCapUsd,
    }
  }
  // `capSet` AND a usable number, spelled out rather than leaned on: with
  // `strictNullChecks` off the compiler will not stop `projected > null` from
  // being written, and `x > null` coerces to `x > 0` — which would refuse
  // every overage upload on the platform. The explicit `!= null` is the guard.
  if (cap.capSet && cap.monthlyCapUsd != null && projectedOverageUsd > cap.monthlyCapUsd) {
    return {
      allowed: false,
      code: 'storage_cap_reached',
      message:
        `This upload would take your storage overage to about ` +
        `$${projectedOverageUsd.toFixed(2)} this month, past the ` +
        `$${cap.monthlyCapUsd.toFixed(2)} monthly storage cap you set. ` +
        'Raise or remove the cap in Billing, or delete some files.',
      projectedOverageUsd,
      monthlyCapUsd: cap.monthlyCapUsd,
    }
  }
  return {
    allowed: true,
    code: null,
    message: null,
    projectedOverageUsd,
    monthlyCapUsd: cap.monthlyCapUsd,
  }
}

export interface MediaStorageGateResult {
  allowed: boolean
  status: number
  error: string | null
  code: StorageCapVerdict['code'] | 'plan_limit_reached'
  limitMb: number
  /**
   * TRUE when these bytes land past the included band on a metered plan — i.e.
   * when accepting them creates an invoice line.
   *
   * This is the field that makes ingress and `report-usage` tell the same
   * story: `report-usage` bills stored bytes over the band on exactly the
   * plans where `planMetersInfraOverage` is true, and this flag is that same
   * predicate evaluated at the moment the bytes are accepted. If one is ever
   * true where the other is false, that is the bug.
   */
  billed: boolean
  projectedOverageUsd: number
  /** The customer's chosen ceiling, or `null` when they have not set one. */
  monthlyCapUsd: number | null
}

/**
 * The ONE storage decision every media ingress route makes (AGL-1886,
 * inverted 2026-08-18).
 *
 * Used by `api/media/upload-url` (twice), `api/media/upload` and
 * `api/media/replace`, so the four cannot answer the same question
 * differently — which is how a customer ends up blocked on one upload path
 * and billed on another.
 *
 * `usedMb` INCLUDES the incoming bytes, and the caller passes the same
 * `Math.ceil(usedMb) - 1` convention it always did (AGL-471's off-by-one:
 * exactly up to the integer MB cap and no further).
 *
 * ## The three outcomes past the band
 *
 * - **Unmetered plan (free/hobby) → REFUSED.** There is no metered price to
 *   attach, so accepting the bytes would be cost with no invoice. This is the
 *   band Zach asked to keep so free "always actually stays free", and it is
 *   unchanged from the original design.
 * - **Metered plan, no customer cap → ALLOWED AND BILLED.** The default. No
 *   consent step, because `report-usage` bills these bytes and the customer
 *   is warned by `usage-alerts` before and at the band.
 * - **Metered plan, past the customer's own cap → REFUSED**, citing their
 *   number. The one refusal a paying org can hit, and only because it asked
 *   for it.
 *
 * Enterprise resolves `UNLIMITED` and never reaches any of the three.
 */
export function mediaStorageGate(input: {
  org: Partial<AglynOrgBilling> | null | undefined
  /** Total usage including the incoming file, in MB. */
  usedMb: number
  /**
   * The band `usedMb` is measured against, in MB (AGL-2075).
   *
   * ALWAYS the ORG-WIDE band — `resolveOrgMediaBand` computes it as
   * `hostLimit × storagePerHostMb`, the same arithmetic
   * `meteredIncludedAllowance` uses to size what the invoice subtracts. It is
   * optional only so this function keeps a defined answer for a caller that
   * has not been given a pool to measure; that fallback is the PER-SCOPE band,
   * which was the bug — `resolveMediaScope` serves a site library AND the org
   * library, each with its own counter, so a per-scope band handed a free org
   * 250 MB twice. Every ingress route passes this; nothing should rely on the
   * fallback.
   */
  allowanceMb?: number
}): MediaStorageGateResult {
  const { org, usedMb } = input
  // The historical convention, kept verbatim so this is not also a rounding
  // change: `usedMb` includes the incoming file and the cap is inclusive.
  const perScope = checkQuota(org as any, 'storagePerHostMb', Math.ceil(usedMb) - 1)
  const limit = input.allowanceMb ?? perScope.limit
  const quota = {
    limit,
    allowed: Math.ceil(usedMb) - 1 < limit,
  }
  if (quota.allowed) {
    return {
      allowed: true,
      status: 200,
      error: null,
      code: null,
      limitMb: quota.limit,
      billed: false,
      projectedOverageUsd: 0,
      monthlyCapUsd: resolveStorageCap(org).monthlyCapUsd,
    }
  }
  // An UNLIMITED band that still refused is a contradiction; refuse rather
  // than reason about it. (`checkQuota` cannot return `allowed: false` for
  // `Infinity`, so this is unreachable by construction and stays as the
  // fail-closed floor.)
  //
  // The `planMetersInfraOverage` arm is the free/hobby hard band. It is
  // deliberately the SECOND thing checked and not folded into the cap logic
  // below: an unmetered plan must never reach code that can return
  // `billed: true`, whatever a forged `storageOverage` field says.
  if (quota.limit === UNLIMITED || !planMetersInfraOverage(org)) {
    return {
      allowed: false,
      status: 403,
      // Verbatim, so the four ingress routes' fallback strings and every
      // existing client match keep working.
      error: `Storage limit reached (${quota.limit} MB)`,
      code: 'plan_limit_reached',
      limitMb: quota.limit,
      billed: false,
      projectedOverageUsd: 0,
      monthlyCapUsd: null,
    }
  }
  const verdict = checkStorageCap({
    org,
    usedMb,
    allowanceMb: quota.limit,
  })
  return {
    allowed: verdict.allowed,
    status: verdict.allowed ? 200 : 403,
    error: verdict.message,
    code: verdict.code,
    limitMb: quota.limit,
    // Allowed, metered, and past the band: an invoice line exists for this.
    billed: verdict.allowed && verdict.projectedOverageUsd > 0,
    projectedOverageUsd: verdict.projectedOverageUsd,
    monthlyCapUsd: verdict.monthlyCapUsd,
  }
}
