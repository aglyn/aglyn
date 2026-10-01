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

import type { UsageAlertGuard } from '@aglyn/aglyn/app-utils/usage-budget'

/*
 * THE AI PLUGIN'S SPEND GUARDS: the staff review threshold on one
 * workspace's monthly provider spend, the hard ceiling past which its
 * reservations refuse, and the dedupe arithmetic the usage-alerts sweep's
 * contributor announces both with. Pure over configured values and the
 * sweep's guard map, so the meter that refuses and the alert that announces
 * the refusal read one variable and agree on what it means.
 */

/**
 * The MARGIN GUARD.
 *
 * A customer's usage budget (`usage-budget.ts`) protects the customer. This
 * protects the platform, from the one meter whose unit cost is real money
 * paid to a third party and whose ceiling is a message count rather than a
 * dollar figure: `assistEntitledMonthlyLimit` caps an entitled org at 1,000
 * MESSAGES a month, and a thousand long, cache-cold Opus-class exchanges is
 * a three-figure bill against a subscription that did not move.
 *
 * So one org's Assist COGS crossing this threshold notifies STAFF, not the
 * customer — the customer is not being charged and has done nothing wrong.
 * Returns the threshold crossed, or 0.
 *
 * `ASSIST_ORG_MONTHLY_COGS_ALERT_USD` overrides the default and FAILS TO THE
 * DEFAULT: a blank or malformed value that disabled the guard would be
 * another alert that cannot fire.
 */
export const ASSIST_ORG_MONTHLY_COGS_ALERT_USD_DEFAULT = 25

export function assistCogsAlertThresholdUsd(
  configured?: string | null,
): number {
  const parsed = Number(String(configured ?? '').trim())
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return ASSIST_ORG_MONTHLY_COGS_ALERT_USD_DEFAULT
  }
  return parsed
}

/**
 * The repo default spend ceiling: **$40 per org per month** (AGL-2264).
 *
 * The number is arithmetic rather than pricing. After AGL-2441 the
 * 1,000-message entitled guard bounds roughly $28/org/month of worst-case
 * spend at Sonnet, and the staff margin alert already fires at $25. $40
 * therefore sits ABOVE anything the message cap can produce at the current
 * model, so it changes no charged amount and no plan's behaviour — it is a
 * ceiling on OUR cost, not a customer price, which is why it is outside the
 * Sept-1 pricing lock. It binds only when an assumption behind that
 * arithmetic has moved: an `ASSIST_MODEL` swap to an Opus-class tier, a
 * longer prompt, or a caller finding another way to inflate input. That is
 * the failure it exists for.
 *
 * It ships as a DEFAULT rather than as an environment variable someone must
 * remember, because an unset ceiling is the fail-open this issue was opened
 * about: a fresh deployment and a self-hoster both inherit a sane bound
 * without knowing the variable exists.
 *
 * The free tier gets no separate figure and needs none — its 10 messages a
 * UTC day bound it at roughly $0.28/day, so this is a backstop it cannot
 * reach rather than a cap it runs into.
 *
 * ⚠️ It applies only to an org whose plan sells NO assist band. Agency and
 * Enterprise include more assist than $40 of spend, so the meter's
 * `assistMonthlyCeilingUsd` keeps this default off every plan that sells a
 * band — see there for which figure binds when.
 */
export const ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD = 40

/**
 * The per-org monthly PROVIDER-SPEND ceiling in USD — the dollar half of
 * the cap (AGL-2264), from `ASSIST_ORG_MONTHLY_COGS_LIMIT_USD` as the caller
 * read it. Defaults to {@link ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD};
 * `off` removes it.
 *
 * Pure over the configured value, like {@link assistCogsAlertThresholdUsd}:
 * the meter that refuses at the ceiling and the cron that announces the
 * refusal read the one variable and must agree on what it means.
 *
 * The meter's message caps bound spend only through an assumed cost per
 * message, and that assumption is exactly what drifts: `ASSIST_MODEL` is an
 * env override, prompts grow, and a client controls how much history it
 * posts. The ceiling is measured against the real figure instead: the
 * running `estCostUsd` on the month's assist usage document, which the meter
 * increments at the SERVING model's rates. So it bounds the actual bill
 * rather than a forecast of it.
 *
 * The refusal is deliberately the same shape as the message refusal (a
 * reservation that did not move the counter), so an org at the ceiling
 * spends nothing at all rather than spending less. It refuses — it does
 * NOT quietly swap to a cheaper model. A silent quality drop is worse than
 * an honest stop, because nobody can tell it happened.
 *
 * ⚠️ **Fails to the DEFAULT, never to “no ceiling”.** An empty, negative or
 * unparseable value reads as unconfigured and takes the repo default, so a
 * typo cannot reopen the fail-open this exists to close. It cannot become a
 * ceiling of `$0` either — a value of zero is not “refuse everyone”, it is
 * “not a number I will honour” — because an outage across every workspace
 * would be worse than the overspend being guarded.
 *
 * Removing the ceiling therefore takes a WORD rather than a number:
 * `ASSIST_ORG_MONTHLY_COGS_LIMIT_USD=off`. A deployment paying its own
 * provider bill may genuinely want none, and that is a decision someone
 * should have to write down rather than reach by mistyping a digit.
 */
export function assistOrgMonthlyCostLimitUsd(
  configured?: string | null,
): number | null {
  const operator = assistOperatorCeilingUsd(configured)
  return operator === undefined
    ? ASSIST_ORG_MONTHLY_COGS_LIMIT_DEFAULT_USD
    : operator
}

/**
 * The operator's ceiling exactly as CONFIGURED — three states, not two:
 * a number, `null` for the word `off`, and `undefined` for unset or
 * unparseable.
 *
 * `assistOrgMonthlyCostLimitUsd` collapses `undefined` onto the repo default
 * and is the reading every existing caller wants. The composition with a
 * plan's own band needs the third state, because "the operator wrote a
 * number" and "nobody configured anything" have to bind differently against a
 * band that was sold: an operator's figure is a decision, and the repo
 * default is a backstop for orgs that have no band of their own.
 */
export function assistOperatorCeilingUsd(
  configured?: string | null,
): number | null | undefined {
  const raw = String(configured ?? '').trim()
  if (raw === '') return undefined
  if (raw.toLowerCase() === 'off') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Whether this org's Assist spend has newly crossed the margin threshold.
 *
 * Dedupes through the same guard shape and the same month semantics as the
 * customer budget, under its own key, so a staff alert and a customer alert
 * can never suppress one another.
 */
export function assistMarginBreach(input: {
  assistUsd: number
  thresholdUsd: number
  guard: UsageAlertGuard | null | undefined
  month: string
}): boolean {
  const { assistUsd, thresholdUsd, guard, month } = input
  if (!Number.isFinite(assistUsd) || !Number.isFinite(thresholdUsd)) return false
  if (thresholdUsd <= 0 || assistUsd < thresholdUsd) return false
  // The guard records how many WHOLE multiples of the threshold have been
  // announced, so an org at 1x is announced once and an org that climbs to 2x
  // is announced again — an escalating cost must not go quiet because it
  // already spoke.
  const multiple = Math.floor(assistUsd / thresholdUsd)
  if (guard?.month === month && Number(guard?.threshold ?? 0) >= multiple) {
    return false
  }
  return true
}

/**
 * Whether this org has newly crossed the HARD spend ceiling — the one that
 * refuses (AGL-2264), as distinct from {@link assistMarginBreach}'s review
 * threshold, which only warns.
 *
 * It needs its own guard and its own announcement because the margin alert
 * cannot carry this news. That alert speaks in WHOLE MULTIPLES of its $25
 * threshold, so an org that climbs from $25 to the $40 ceiling is still at
 * 1x and stays silent — staff would learn that the assistant had stopped
 * answering for a customer only when someone complained. A ceiling that
 * refuses quietly is the same defect as a ceiling that does not refuse.
 *
 * Once per org per month: crossing is a state, not an escalating figure, and
 * the org is refused from here to the month boundary regardless of how far
 * past it the recorded spend sits.
 */
export function assistCeilingBreach(input: {
  assistUsd: number
  ceilingUsd: number | null
  guard: UsageAlertGuard | null | undefined
  month: string
}): boolean {
  const { assistUsd, ceilingUsd, guard, month } = input
  if (ceilingUsd === null) return false
  if (!Number.isFinite(assistUsd) || !Number.isFinite(ceilingUsd)) return false
  if (ceilingUsd <= 0 || assistUsd < ceilingUsd) return false
  return guard?.month !== month
}

/** The multiple {@link assistMarginBreach} would record. */
export function assistMarginMultiple(
  assistUsd: number,
  thresholdUsd: number,
): number {
  if (!Number.isFinite(assistUsd) || !Number.isFinite(thresholdUsd)) return 0
  if (thresholdUsd <= 0) return 0
  return Math.max(0, Math.floor(assistUsd / thresholdUsd))
}
