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

import type { AglynOrgBilling } from '@aglyn/aglyn'
import {
  AI_ADDON_CREDITS_PER_MONTH,
  aiAddonName,
  hasAiAddon,
  resolveEffectivePlan,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

/**
 * THE STAFF ORG USAGE TABLE'S AI FIGURES (AGL-2984).
 *
 * The staff org usage table — on the staff org page and in the Organizations
 * list's Usage dialog — draws this plugin's three columns through its
 * `staffOrgUsageColumn` zone, and the org page draws the credit pool line
 * above it. These are the texts they draw, apart from React so each shape
 * is pinned on its own.
 */

/** The AI fields of one monthly rollup row, as the org usage route serves it. */
export interface StaffOrgUsageAiMonth {
  /**
   * Provider spend for the month in dollars (AGL-2280). Its own column rather
   * than folded into the metering estimate: this is a real provider bill.
   */
  assistCostUsd?: number | null
  /**
   * The credit view of the same spend (AGL-2930): what the month drew
   * against the band, and the part past it that was billed. `null` on a
   * rollup written before the credit meter existed — a `0` there would
   * state, as measurement, that the org used no AI in a month nobody
   * measured.
   */
  assistCredits?: number | null
  assistOverageUsd?: number | null
}

/**
 * The Assist column's text. Four decimals, not two: spend arrives in
 * thousandths of a dollar per exchange, and `$0.00` for a month that really
 * cost eight cents is a silence.
 */
export function assistCostCell(value: number | null | undefined): string {
  return `$${Number(value ?? 0).toFixed(4)}`
}

/** A recorded count, or the dash that says the rollup predates it. */
export function aiCreditsCell(value: number | null | undefined): string {
  return value == null ? '—' : Math.round(value).toLocaleString()
}

/** A billed dollar figure, or the dash that says the rollup predates it. */
export function aiOverageCell(value: number | null | undefined): string {
  return value == null ? '—' : `$${Number(value).toFixed(2)}`
}

/**
 * The org's AI credit pool (AGL-2899): whether the AI add-on is on, the
 * credits the add-on contributes, and the whole band the Assist column is
 * drawn against.
 */
export interface StaffAssistPool {
  aiAddon: boolean
  /** The add-on's band alone; 0 without the add-on. */
  addonCredits: number
  /** Plan band plus add-on band, or null where the plan sells no band. */
  creditsPerMonth: number | null
}

/**
 * The pool as the meter resolves it from the org document: the plan's band
 * plus the add-on's, folded by `resolveOrgEntitlements`, with the add-on
 * read off the EFFECTIVE plan through `hasAiAddon` — so a dead
 * subscription's add-on reads as off here exactly as it does on the
 * customer's own meter.
 */
export function staffAssistPool(
  org: Partial<AglynOrgBilling> | null | undefined,
): StaffAssistPool {
  const aiAddon = hasAiAddon(org)
  const creditsPerMonth = resolveOrgEntitlements(org).assistCreditsPerMonth
  return {
    aiAddon,
    addonCredits: aiAddon
      ? AI_ADDON_CREDITS_PER_MONTH[resolveEffectivePlan(org)]
      : 0,
    creditsPerMonth: creditsPerMonth > 0 ? creditsPerMonth : null,
  }
}

/**
 * The pool as one line: the reader of the Assist column needs to know what
 * band the dollars are drawn against, and whether an add-on is part of it.
 */
export function assistPoolSentence(pool: StaffAssistPool): string {
  const band =
    pool.creditsPerMonth === null
      ? 'no AI credit band'
      : `${pool.creditsPerMonth.toLocaleString()} AI credits/mo`
  const name = aiAddonName()
  return pool.aiAddon
    ? `${name} add-on on — ${band}, ${pool.addonCredits.toLocaleString()} ` +
        'of them from the add-on.'
    : `${name} add-on off — ${band}.`
}
