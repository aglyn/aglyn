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
 * Overage protection and usage thresholds for stored bytes (AGL-1886).
 *
 * ZACH'S CONDITION, 2026-08-17, verbatim: org-library storage bills
 * immediately — "**also give overage protection and usage alerts, so
 * customers don't get a surprise bill.**" The protection is the gating half;
 * `BILL_ORG_LIBRARY_STORAGE_FROM` is only allowed to name a month once this
 * file's ceiling and the alert that precedes it are both live.
 *
 * ## HARD CAP vs SOFT CAP — the decision, and why
 *
 * AGL-1886 asks for the choice to be made explicitly and recorded. It is a
 * **soft cap with an acknowledged opt-in**, plus a spend ceiling the opt-in
 * carries. Neither pure option is right here, and the reason is specific to
 * what the org library IS rather than a general preference:
 *
 * - A **pure hard cap** is what ships today, and it is the status quo this
 *   issue is escaping. `api/media/upload-url` refuses an org-library upload
 *   the moment the scope passes `storagePerHostMb`. Nobody is surprised, and
 *   nobody is served either: the customer is stopped from storing files on a
 *   plan that meters storage, and Aglyn collects nothing for capacity it
 *   would happily sell. Keeping it would satisfy "no surprise bill" by
 *   satisfying "no bill", which is the direction that loses money.
 *
 * - A **pure soft cap** — allow, meter, invoice — is exactly the surprise
 *   bill Zach forbade. The org library is the one scope that can push an org
 *   past its metered band at all (the org-wide band is
 *   `hostLimit × storagePerHostMb`, and per-scope caps allow `hosts + 1`
 *   scopes' worth), so it is the single most likely source of a first
 *   unexpected invoice line in the whole platform.
 *
 * So the opt-in is the gate and the ceiling is the protection:
 *
 *   1. Inside the included allowance — upload, no charge, unchanged.
 *   2. Over it with NO acknowledgement — REFUSED, with the price named. This
 *      is strictly better than today's refusal, because today's says only
 *      "Storage limit reached" and offers no way through.
 *   3. Over it, acknowledged, projected month under the ceiling — allowed
 *      and billed. The customer agreed to this number before the bytes
 *      landed.
 *   4. Over the ceiling — REFUSED again. This is the "ceiling a customer
 *      cannot silently blow through" the issue asks for: an acknowledgement
 *      is consent to a bounded amount, never to an open one.
 *
 * A customer who never acknowledges cannot be billed a cent of storage
 * overage, because the bytes that would have been billed were never accepted.
 * That property is what makes "no surprise bill" structural rather than a
 * matter of how well the alerts happened to work.
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
 * The org's acknowledged storage-overage opt-in, if any.
 *
 * `acknowledgedAt` is stamped server-side when an org manager accepts metered
 * storage in Billing; `monthlyCeilingUsd` is the bound that acceptance
 * carries. An acknowledgement with no usable ceiling is treated as
 * `STORAGE_OVERAGE_DEFAULT_CEILING_USD` rather than as unbounded — the one
 * direction this must never fail in is "consent to any amount", which is what
 * a missing or corrupt ceiling would otherwise mean.
 */
export const STORAGE_OVERAGE_DEFAULT_CEILING_USD = 25

export function resolveStorageOverage(
  org: Partial<AglynOrgBilling> | null | undefined,
): { acknowledged: boolean; monthlyCeilingUsd: number } {
  const raw = (org as any)?.storageOverage
  const acknowledged = Boolean(raw?.acknowledgedAt)
  if (!acknowledged) return { acknowledged: false, monthlyCeilingUsd: 0 }
  const ceiling = Number(raw?.monthlyCeilingUsd)
  return {
    acknowledged: true,
    monthlyCeilingUsd:
      Number.isFinite(ceiling) && ceiling > 0
        ? ceiling
        : STORAGE_OVERAGE_DEFAULT_CEILING_USD,
  }
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

export interface StorageCeilingVerdict {
  allowed: boolean
  /** Machine code for the console; null when allowed. */
  code: 'overage_optin_required' | 'overage_ceiling_reached' | null
  /** Customer-facing sentence; null when allowed. */
  message: string | null
  /** Projected monthly overage charge if this upload lands. */
  projectedOverageUsd: number
  /** The ceiling in force (0 when nothing has been acknowledged). */
  ceilingUsd: number
}

/**
 * Whether one upload may land, given what the scope already holds.
 *
 * `allowanceMb` is the scope's included storage (`storagePerHostMb`), and
 * `usedMb` INCLUDES the incoming file — the same convention
 * `api/media/upload-url` already computes for its quota check, so the two
 * cannot disagree about whether a file fits.
 *
 * FAILS CLOSED on a malformed input. A non-finite allowance is not treated as
 * unlimited: an `UNLIMITED` plan is handled by its caller (which does not ask
 * at all), and anything else reaching here is a bug whose permissive reading
 * would be free unbilled storage. The one exception is a genuinely unlimited
 * plan band, which callers must screen before asking.
 */
export function checkStorageCeiling(input: {
  org: Partial<AglynOrgBilling> | null | undefined
  usedMb: number
  allowanceMb: number
}): StorageCeilingVerdict {
  const { org, usedMb, allowanceMb } = input
  const overage = resolveStorageOverage(org)
  const overageMb = Math.max(0, usedMb - allowanceMb)
  const projectedOverageUsd = storageOverageUsd(overageMb)
  if (overageMb <= 0) {
    return {
      allowed: true,
      code: null,
      message: null,
      projectedOverageUsd: 0,
      ceilingUsd: overage.monthlyCeilingUsd,
    }
  }
  if (!overage.acknowledged) {
    return {
      allowed: false,
      code: 'overage_optin_required',
      message:
        `This upload would take you past your included ${Math.round(
          allowanceMb,
        )} MB of storage. Metered storage costs about ` +
        `$${storageOveragePricePerGbUsd().toFixed(3)}/GB per month — turn it ` +
        'on in Billing to keep ' +
        'uploading, and set the monthly limit you want to stay under.',
      projectedOverageUsd,
      ceilingUsd: 0,
    }
  }
  if (projectedOverageUsd > overage.monthlyCeilingUsd) {
    return {
      allowed: false,
      code: 'overage_ceiling_reached',
      message:
        `This upload would take your storage overage to about ` +
        `$${projectedOverageUsd.toFixed(2)} this month, above the ` +
        `$${overage.monthlyCeilingUsd.toFixed(2)} limit you set. Raise the ` +
        'limit in Billing, or remove some files.',
      projectedOverageUsd,
      ceilingUsd: overage.monthlyCeilingUsd,
    }
  }
  return {
    allowed: true,
    code: null,
    message: null,
    projectedOverageUsd,
    ceilingUsd: overage.monthlyCeilingUsd,
  }
}

/**
 * The ONE storage decision every media ingress route makes (AGL-1886).
 *
 * Replaces a bare `checkQuota(org, 'storagePerHostMb', …)` in
 * `api/media/upload-url` (twice), `api/media/upload` and `api/media/replace`,
 * so the three cannot answer the same question differently — which is how a
 * customer ends up blocked on one upload path and billed on another.
 *
 * `usedMb` INCLUDES the incoming bytes, and the caller passes the same
 * `Math.ceil(usedMb) - 1` convention it always did (AGL-471's off-by-one:
 * exactly up to the integer MB cap and no further).
 *
 * WHO MAY EXCEED THE CAP. Only a plan that meters infrastructure overage.
 * Free hard-bands by design — there is no subscription to hang a metered item
 * on, and a free org allowed past its cap on an acknowledgement would be
 * unbilled storage with nothing to invoice it against. Enterprise resolves
 * `UNLIMITED` and never reaches the ceiling at all. So the soft cap opens
 * exactly for the orgs whose plan already says storage is metered, and the
 * hard cap stays exactly where it is for everyone else.
 */
export function mediaStorageGate(input: {
  org: Partial<AglynOrgBilling> | null | undefined
  /** Total scope usage including the incoming file, in MB. */
  usedMb: number
}): {
  allowed: boolean
  status: number
  error: string | null
  code: StorageCeilingVerdict['code']
  limitMb: number
  projectedOverageUsd: number
  ceilingUsd: number
} {
  const { org, usedMb } = input
  // The historical convention, kept verbatim so this is not also a rounding
  // change: `usedMb` includes the incoming file and the cap is inclusive.
  const quota = checkQuota(org as any, 'storagePerHostMb', Math.ceil(usedMb) - 1)
  if (quota.allowed) {
    return {
      allowed: true,
      status: 200,
      error: null,
      code: null,
      limitMb: quota.limit,
      projectedOverageUsd: 0,
      ceilingUsd: resolveStorageOverage(org).monthlyCeilingUsd,
    }
  }
  // An UNLIMITED band that still refused is a contradiction; refuse rather
  // than reason about it. (`checkQuota` cannot return `allowed: false` for
  // `Infinity`, so this is unreachable by construction and stays as the
  // fail-closed floor.)
  if (quota.limit === UNLIMITED || !planMetersInfraOverage(org)) {
    return {
      allowed: false,
      status: 403,
      error: `Storage limit reached (${quota.limit} MB)`,
      code: null,
      limitMb: quota.limit,
      projectedOverageUsd: 0,
      ceilingUsd: 0,
    }
  }
  const verdict = checkStorageCeiling({
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
    projectedOverageUsd: verdict.projectedOverageUsd,
    ceilingUsd: verdict.ceilingUsd,
  }
}
