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

// Imported from BOTH graphs — the staff page (client) and the staff routes
// that write a contract — so it may import neither entry barrel.
import type { OrgContractRates, OrgContractTerms } from '../foundation'
import {
  CONTRACT_RATE_KEYS,
  DEFAULT_CONTRACT_USAGE_CEILING_SHARE_OF_BASE,
  contractMonth,
  defaultContractRates,
  nextContractMonth,
  resolveContractRates,
  type ResolvedContractRates,
} from './plan-entitlements'

/**
 * Staff input for a Custom contract's terms (AGL-4233), as the staff panel
 * and the provisioning door post it. Every field is optional: an absent rate
 * is the public Pro rate, an absent ceiling is the default.
 */
export interface ContractTermsInput {
  rates?: Record<string, unknown> | null
  usageBilling?: unknown
  usageCeilingMonthlyUsd?: unknown
}

/** The most any one contract rate may be set to, in USD — a typo guard. */
export const CONTRACT_RATE_MAX_USD = 100_000

/** The most a usage ceiling may be set to, in USD a month — a typo guard. */
export const CONTRACT_USAGE_CEILING_MAX_USD = 1_000_000

export type ParsedContractTerms =
  | { ok: true; terms: OrgContractTerms; rates: ResolvedContractRates; error?: undefined }
  | { ok: false; error: string; terms?: undefined; rates?: undefined }

/** The default monthly ceiling for a deal at `baseMonthlyUsd` a month. */
export function defaultContractUsageCeilingUsd(baseMonthlyUsd: number): number {
  const base = Number(baseMonthlyUsd)
  if (!Number.isFinite(base) || base <= 0) return 0
  return Math.round(base * DEFAULT_CONTRACT_USAGE_CEILING_SHARE_OF_BASE * 100) / 100
}

/**
 * Turn staff input into the stored terms (AGL-4233).
 *
 * - A rate is stored ONLY where it differs from the public Pro rate, so a
 *   deal that negotiated nothing keeps tracking the Pro price list. `null`
 *   is stored: it means "not sold on this deal".
 * - The ceiling is always stored as a figure, the default when none was
 *   given, because the org document the rollup reads does not carry the
 *   negotiated base it is derived from.
 * - Turning usage billing ON starts it the calendar month after (UTC):
 *   usage already accrued this month was never quoted as billable. Leaving
 *   it on keeps the month it started.
 * - Saving always clears a reached ceiling, so a raised ceiling bills again
 *   at once.
 */
export function parseContractTerms(
  input: ContractTermsInput | null | undefined,
  context: {
    previous?: OrgContractTerms | null
    baseMonthlyUsd?: number | null
    nowMs?: number
    setBy: string
  },
): ParsedContractTerms {
  const defaults = defaultContractRates()
  const rawRates = (input?.rates ?? {}) as Record<string, unknown>
  const stored: OrgContractRates = {}
  for (const key of CONTRACT_RATE_KEYS) {
    if (!(key in rawRates)) continue
    const raw = rawRates[key]
    if (raw === undefined || raw === '') continue
    if (raw === null) {
      stored[key] = null
      continue
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || value > CONTRACT_RATE_MAX_USD) {
      return { ok: false, error: `${key} must be a number from 0 to ${CONTRACT_RATE_MAX_USD}` }
    }
    const rounded = Math.round(value * 10_000) / 10_000
    if (rounded !== defaults[key]) stored[key] = rounded
  }
  if (typeof rawRates['meteredInfraPassThrough'] === 'boolean') {
    if (rawRates['meteredInfraPassThrough'] !== defaults.meteredInfraPassThrough) {
      stored.meteredInfraPassThrough = rawRates['meteredInfraPassThrough'] as boolean
    }
  }

  const usageBilling = input?.usageBilling === true
  let ceiling: number
  const rawCeiling = input?.usageCeilingMonthlyUsd
  if (rawCeiling === undefined || rawCeiling === null || rawCeiling === '') {
    const previous = Number(context.previous?.usageCeilingMonthlyUsd)
    ceiling =
      context.previous?.usageCeilingMonthlyUsd != null && Number.isFinite(previous)
        ? previous
        : defaultContractUsageCeilingUsd(Number(context.baseMonthlyUsd ?? 0))
  } else {
    ceiling = Number(rawCeiling)
    if (!Number.isFinite(ceiling) || ceiling < 0 || ceiling > CONTRACT_USAGE_CEILING_MAX_USD) {
      return {
        ok: false,
        error: `The monthly ceiling must be a number from 0 to ${CONTRACT_USAGE_CEILING_MAX_USD}`,
      }
    }
    ceiling = Math.round(ceiling * 100) / 100
  }
  if (usageBilling && !(ceiling > 0)) {
    return {
      ok: false,
      error: 'Set a monthly ceiling above $0 to bill usage past the contract',
    }
  }

  const nowMs = context.nowMs ?? Date.now()
  const terms: OrgContractTerms = {
    rates: stored,
    usageBilling,
    usageCeilingMonthlyUsd: ceiling,
    ceilingReachedMonth: null,
    setBy: context.setBy,
    setAtMs: nowMs,
  }
  if (usageBilling) {
    terms.usageBillingFrom =
      context.previous?.usageBilling === true && context.previous.usageBillingFrom
        ? context.previous.usageBillingFrom
        : nextContractMonth(contractMonth(nowMs))
  }
  return { ok: true, terms, rates: resolveContractRates(stored) }
}
