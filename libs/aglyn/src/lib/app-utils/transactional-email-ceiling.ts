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
 * The per-organization DAILY CEILING on a workspace's transactional mail
 * (AGL-4145).
 *
 * ## The hole
 *
 * Campaign email is refused at its monthly band (`emailSendsPerMonth`, an
 * atomic claim on `orgs/{id}/counters/campaignEmailSends`), and a site's
 * one-to-one mail at its daily pace. Everything else a site sends — receipts,
 * order and shipping notices, booking mail, abandoned-cart and review asks,
 * dunning, workflow steps, member posts — was refused by nothing at any tier,
 * and every message of it costs the provider's rate
 * (`ORG_COGS_UNIT_RATES_USD.perEmailSend`). So a workspace on any plan could
 * send without bound at the platform's expense.
 *
 * ## An abuse ceiling, not a plan dimension
 *
 * The figures below are containment lines, sized so that no real store meets
 * them: a busy Starter store confirms a few dozen orders a day, and 1,000 is
 * that day many times over. A workspace that reaches one is a script, a
 * compromised account or a workflow in a loop, and the response is an
 * incident staff look at, not an upgrade prompt.
 *
 * That is why this is NOT a key of `PLAN_ENTITLEMENTS`. A plan row is what a
 * plan sells: `/pricing`, the plan comparison and the pricing-table generator
 * read it, and every number on it is a promise. Nothing customer-facing names
 * this ceiling — no pricing row, no banner, no copy — the same posture the
 * flat visitor-record ceilings (`visitor-record-ceiling.ts`) and the
 * form and bandwidth abuse ceilings take. It varies by plan only because a
 * plan with more sites legitimately sends more.
 *
 * ## It is overridable per organization, on the existing map
 *
 * A contract or a support case that needs more writes
 * `orgs/{id}.entitlements.transactionalEmailsPerDay`, through the same staff
 * override route and dialog every numeric entitlement uses
 * ({@link TRANSACTIONAL_EMAIL_CEILING_OVERRIDE_FIELDS}). The override wins
 * outright; it is the figure staff chose.
 *
 * ## An uncapped plan comp does not lift it
 *
 * An uncapped comp reads every BAND as unlimited (AGL-3049). This is not a
 * band: lifting an abuse control because a workspace was granted a plan is
 * the one direction this should never move by accident. A comped workspace
 * gets its comped plan's ceiling, and an override if it needs more.
 */

import type { AglynOrgBilling, OrgPlan } from '../foundation'
import { resolveEffectivePlan, UNLIMITED } from './plan-entitlements'

/** The override key on `orgs/{id}.entitlements`, and the workspace stamp's name. */
export const TRANSACTIONAL_EMAILS_PER_DAY_KEY = 'transactionalEmailsPerDay'

/**
 * Transactional messages one organization's sites may send per UTC day,
 * every site together, before the next is refused.
 *
 * Free, Starter and Pro are the figures the 2026-11-03 margin check set.
 * The tiers between Pro and Enterprise sit at or above Pro's figure and rise
 * with the sites each sells (Business 10, Scale 15, Advanced 25, Agency 100),
 * so none of them is tighter per site than Pro. Enterprise is unlimited, and
 * an agreement that wants a number writes it as the override.
 */
export const TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN: Readonly<Record<OrgPlan, number>> = {
  free: 200,
  starter: 1_000,
  pro: 5_000,
  business: 10_000,
  scale: 15_000,
  advanced: 25_000,
  agency: 50_000,
  enterprise: UNLIMITED,
}

/**
 * The organization's ceiling for the day: the per-org override when staff
 * wrote one, otherwise the figure for the plan it RESOLVES as — a canceled
 * subscription reads as Free, a staff comp as its comped plan.
 *
 * An override must be a finite number of 0 or more to count. `0` is a real
 * ceiling (nothing but security mail leaves), never a stand-in for
 * unlimited; anything else stored there is ignored rather than trusted.
 */
export function resolveTransactionalEmailDailyCeiling(
  org: Partial<AglynOrgBilling> | null | undefined,
): number {
  const overrides = org?.entitlements as Record<string, unknown> | undefined
  const override = overrides?.[TRANSACTIONAL_EMAILS_PER_DAY_KEY]
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override)
  }
  return TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN[resolveEffectivePlan(org)]
}

/** One claim's verdict against the day's ceiling. */
export interface TransactionalEmailCeilingResult {
  /** True when every message of the claim fits under the ceiling. */
  allowed: boolean
  ceiling: number
  /** Messages already counted on the day, floored at 0. */
  used: number
  /** Messages still allowed today after this claim, or before it when refused. */
  remaining: number
}

/**
 * Does a claim of `count` messages fit under `ceiling`, with `used` counted?
 *
 * The comparison is `used + count > ceiling`, the campaign claim's: the
 * ceiling is the last message that may leave, so the N+1th is the first
 * refused. `strictNullChecks` is off repo-wide, so every input is
 * normalised: a missing or corrupt `used` is 0, a claim is at least one
 * message, and a missing ceiling is 0 — which refuses, because an absent
 * figure must never read as headroom. `Infinity` admits everything.
 */
export function checkTransactionalEmailCeiling(
  used: number,
  count: number,
  ceiling: number,
): TransactionalEmailCeilingResult {
  const resolvedUsed = Math.max(0, Math.floor(Number(used) || 0))
  const resolvedCount = Math.max(1, Math.floor(Number(count) || 0))
  const limit = Number(ceiling)
  const resolvedCeiling =
    limit === Number.POSITIVE_INFINITY ? limit : Math.max(0, Math.floor(limit || 0))
  const allowed = resolvedUsed + resolvedCount <= resolvedCeiling
  const after = allowed ? resolvedUsed + resolvedCount : resolvedUsed
  return {
    allowed,
    ceiling: resolvedCeiling,
    used: resolvedUsed,
    remaining: Math.max(0, resolvedCeiling - after),
  }
}

/**
 * The staff override dialog's row for this ceiling, beside the fields it
 * derives from `PLAN_ENTITLEMENTS`. `byPlan` is what the dialog shows as the
 * inherited figure, because the plan table does not carry this key.
 */
export const TRANSACTIONAL_EMAIL_CEILING_OVERRIDE_FIELDS: ReadonlyArray<{
  key: string
  label: string
  byPlan: Readonly<Record<OrgPlan, number>>
}> = [
  {
    key: TRANSACTIONAL_EMAILS_PER_DAY_KEY,
    label: 'Transactional emails / day (abuse ceiling)',
    byPlan: TRANSACTIONAL_EMAILS_PER_DAY_BY_PLAN,
  },
]

/** Every override key this module owns, for the staff route's allowlist. */
export const TRANSACTIONAL_EMAIL_CEILING_OVERRIDE_KEYS: ReadonlySet<string> = new Set(
  TRANSACTIONAL_EMAIL_CEILING_OVERRIDE_FIELDS.map((field) => field.key),
)
