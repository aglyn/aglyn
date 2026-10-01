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
  pluginSpendLines,
  type ResolvedPluginSpendLine,
} from '../plugin-manager/plugin-usage-axes'

/**
 * Per-org USAGE BUDGETS, modelled on a Google Cloud billing budget (AGL-1528).
 *
 * ## the directive, 2026-08-18, verbatim
 *
 *   "*our usage metering, usage alerts, budgets for usage alerts, similar to
 *   how google cloud charges*"
 *
 * and, on the org-library storage decision the same day: bill from today
 * "*but with overage protection + usage alerts, so customers don't get a
 * surprise bill*".
 *
 * ## What a GCP billing budget actually is, and what this copies
 *
 * A GCP budget is **an amount plus a set of percentage alert rules**. It is
 * not a cap: crossing 100% of a budget stops nothing, it sends the email that
 * makes the bill stop being a surprise. Each rule fires **once per budget
 * period per rule** — the console shows the budget and its progress, and the
 * same rules push mail.
 *
 * This module is that shape, and only that shape:
 *
 *   - an **amount** (`amountUsd`), chosen by the customer;
 *   - **threshold rules** as percentages of the amount (default 50/90/100 —
 *     GCP's own default trio);
 *   - one alert per threshold per **month**, which is our budget period
 *     because every meter underneath it (`orgs/{id}/usage/{month}`, each
 *     plugin's spend-line document, the counters' `YYYY-MM` fields) already
 *     resets monthly. A budget period the meters do not share would silently compare
 *     a month of spend against a quarter of budget.
 *
 * ## WHY THIS IS NOT THE STORAGE CAP, AND MUST NOT BECOME IT
 *
 * `utils/storage-overage.ts` owns the customer's optional **hard cap**: past
 * it uploads are refused. That is a wall, it is off by default, and it exists
 * because the requirement was for a control "*by the end user*".
 *
 * A budget is the OTHER half and the softer one — it never refuses anything.
 * The distinction is load-bearing in both directions: a budget that quietly
 * became a cap would take a customer's site down to save them $2 (the failure
 * mode AGL-1529 rejected on arrival), and a cap with no budget beneath it
 * means the only warning a customer gets is the refusal itself.
 *
 * ## WHY DOLLARS AND NOT PERCENT-OF-QUOTA
 *
 * `usage-alerts` has warned at 80%/100% of individual QUOTAS since AGL-276 —
 * sites, media storage, email sends, bandwidth. Those answer "am I near a
 * band". They cannot answer "what will I owe", which is the question a
 * metered customer actually has, and no sum of per-quota percentages produces
 * it: an org at 60% of four different bands may owe nothing at all, and an
 * org at 101% of one band may owe $40. Dollars are the customer's unit.
 *
 * ## THE SPEND FIGURE IS READ, NEVER RE-DERIVED
 *
 * `report-usage` already computes `billedCents` daily onto
 * `orgs/{orgId}/usage/{month}` — metered infra excess at cost x 1.3, plus the
 * data, API and contacts overages. That document is the invoice's own
 * arithmetic, and this module takes it verbatim.
 *
 * A second aggregation here is the specific mistake AGL-1371 exists about:
 * the console meter and the warning email each summed their own figures and
 * disagreed by up to `hostLimit`x. A budget alert quoting a number the
 * invoice will not show is worse than no budget alert, because it is believed.
 */

/** GCP's own default budget alert rules, and the same three here. */
export const DEFAULT_BUDGET_THRESHOLD_PCTS: readonly number[] = [50, 90, 100]

/** Bounds on the amount a self-serve org may set as its own budget. */
export const BUDGET_MIN_USD = 1
export const BUDGET_MAX_USD = 100_000

/**
 * Bounds on a threshold rule, as a percentage of the amount.
 *
 * The ceiling is 200 rather than 100 because GCP allows rules above the
 * budget and they are the useful ones on a runaway: an org that set $20 and
 * is at $45 wants to hear about 200%, and a ladder that stops at 100 says
 * exactly as much at $45 as it did at $20.
 */
export const BUDGET_THRESHOLD_MIN_PCT = 1
export const BUDGET_THRESHOLD_MAX_PCT = 200
/** At most this many rules, so one org cannot mail its admins 40 times. */
export const BUDGET_MAX_THRESHOLDS = 6

/** The guard key this budget dedupes under, inside `orgs/{id}.usageAlerts`. */
export const BUDGET_GUARD_KEY = 'budget'

export interface UsageBudget {
  /** Whether the customer has set a budget at all. Absent by default. */
  budgetSet: boolean
  /** The amount in USD, or `null` when no budget is set. */
  amountUsd: number | null
  /**
   * Threshold rules as percentages, ascending and deduplicated. Always the
   * default trio when a budget exists but named no rules — a budget with an
   * empty rule set is a budget that cannot alert, which is the defect this
   * whole file exists to remove.
   */
  thresholdPcts: number[]
}

/**
 * Coerces whatever is stored (or posted) into a usable ascending rule set.
 *
 * FAILS TO THE DEFAULT, never to empty. Every rejection path here — a blank,
 * a string, a negative, a duplicate, an over-long list — lands on
 * {@link DEFAULT_BUDGET_THRESHOLD_PCTS} rather than on `[]`, because an empty
 * ladder is silence that reads as coverage.
 */
export function normalizeBudgetThresholds(
  input: unknown,
): number[] {
  const list = Array.isArray(input) ? input : []
  const cleaned = [
    ...new Set(
      list
        .map((entry) => Math.round(Number(entry)))
        .filter(
          (pct) =>
            Number.isFinite(pct) &&
            pct >= BUDGET_THRESHOLD_MIN_PCT &&
            pct <= BUDGET_THRESHOLD_MAX_PCT,
        ),
    ),
  ].sort((a, b) => a - b)
  if (!cleaned.length) return [...DEFAULT_BUDGET_THRESHOLD_PCTS]
  return cleaned.slice(0, BUDGET_MAX_THRESHOLDS)
}

/**
 * The budget this org has in force, from its raw org document.
 *
 * `null` amount means no budget — deliberately `null` rather than `Infinity`,
 * matching `resolveStorageCap`: the value is serialised into the budget
 * route's JSON and `JSON.stringify(Infinity)` is `null` anyway, so one
 * spelling for "no budget" on both sides of the wire.
 *
 * An amount that is present but unusable (blank, negative, `NaN`) reads as NO
 * budget, which is the opposite of how `resolveStorageCap` treats a corrupt
 * CAP — and deliberately so. A corrupt cap must fall back to a low ceiling
 * because failing open there bills someone who asked not to be billed. A
 * budget refuses nothing, so the only cost of failing open is a missing
 * warning, whereas inventing an amount nobody typed produces alerts about a
 * number the customer never chose.
 */
export function resolveUsageBudget(
  org: Record<string, unknown> | null | undefined,
): UsageBudget {
  const raw = (org as any)?.usageBudget
  const amount = Number(raw?.amountUsd)
  if (!raw || !Number.isFinite(amount) || amount <= 0) {
    return { budgetSet: false, amountUsd: null, thresholdPcts: [...DEFAULT_BUDGET_THRESHOLD_PCTS] }
  }
  return {
    budgetSet: true,
    amountUsd: amount,
    thresholdPcts: normalizeBudgetThresholds(raw?.thresholdPcts),
  }
}

/**
 * The HIGHEST rule this spend has crossed, or 0 for none.
 *
 * Highest rather than all-of-them because the dedupe guard stores one number
 * per key (the shape `usage-alerts` has used since AGL-276), and because an
 * org that goes from $0 to $80 against a $50 budget between two cron ticks
 * wants one email saying 160%, not three saying 50, 90 and 100. GCP behaves
 * the same way — the rules are notification points on one number, not a queue.
 */
export function budgetThresholdCrossed(
  spendUsd: number,
  budget: UsageBudget,
): number {
  if (!budget.budgetSet || budget.amountUsd == null) return 0
  if (!Number.isFinite(budget.amountUsd) || budget.amountUsd <= 0) return 0
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) return 0
  const pct = (spendUsd / budget.amountUsd) * 100
  let crossed = 0
  for (const rule of budget.thresholdPcts) {
    if (pct >= rule && rule > crossed) crossed = rule
  }
  return crossed
}

/** One entry of `orgs/{orgId}.usageAlerts` — the existing guard shape. */
export interface UsageAlertGuard {
  month?: string
  threshold?: number
}

/**
 * The rule to alert on RIGHT NOW, or 0 for silence.
 *
 * This is the whole of the idempotency requirement and it is one expression,
 * so a caller cannot implement half of it:
 *
 *   - nothing crossed -> silent;
 *   - crossed, but a guard from THIS month already recorded that rule or a
 *     higher one -> silent. A cron that ticks hourly must not mail hourly.
 *   - crossed, and the guard is from a PREVIOUS month -> alert. The budget
 *     period rolled over, and a customer who exceeded last month's budget
 *     must hear about this month's too.
 *
 * The comparison is `>=` on purpose: after alerting at 100 an org that climbs
 * to 200 alerts again (200 > 100), and an org that stays at 100 does not.
 */
export function budgetAlertDue(input: {
  spendUsd: number
  budget: UsageBudget
  guard: UsageAlertGuard | null | undefined
  month: string
}): number {
  const { spendUsd, budget, guard, month } = input
  const crossed = budgetThresholdCrossed(spendUsd, budget)
  if (!crossed) return 0
  if (guard?.month === month && Number(guard?.threshold ?? 0) >= crossed) {
    return 0
  }
  return crossed
}

/**
 * One plugin's line of the month's spend, as its `spendLines` declaration
 * names it (`plugin-usage-axes.ts`).
 */
export interface OrgSpendLine {
  id: string
  pluginId: string
  label: string
  /**
   * The month's figure in dollars at the rates the plugin bills, read off the
   * document the declaration names. For a line declared with a `unit` these
   * dollars are the platform's cost and never cross to a customer's browser
   * (see {@link publicOrgMonthlySpend}).
   */
  usd: number
  /** Whether `usd` entered `totalUsd` — see {@link billsFromMonth}. */
  billed: boolean
}

/**
 * What an org is spending this month, split by where it comes from.
 *
 * Every field is a figure some other module already owns; nothing here is
 * re-derived (see the header). The split exists because a budget alert that
 * says only "$62" invites a support ticket asking what the $62 was.
 */
export interface OrgSpendBreakdown {
  /**
   * Metered infrastructure + plan-priced overages, from the invoice's own
   * `billedCents`. This is the part that reaches a Stripe invoice.
   */
  meteredUsd: number
  /**
   * Each plugin's line, in catalog order.
   *
   * ALWAYS REPORTED, and counted toward the budget only once the line's own
   * start month says this month is charged for it. Until then the plugin's
   * usage is an entitlement with no price anywhere in the platform, and adding
   * it to a customer's "you will owe" figure would be a surprise bill invented
   * by a notification — precisely the thing this feature exists to stop.
   *
   * Carried rather than left out for two reasons that both bite: the day a
   * line is priced this is a deployment variable instead of a new pipeline,
   * and a plugin's staff alert reads its own line as the platform's cost.
   */
  lines: readonly OrgSpendLine[]
  /** What counts against the budget: metered, plus every billed line. */
  totalUsd: number
  /**
   * FALSE when no rollup exists for this month yet, so `meteredUsd` is 0
   * because nothing has been computed rather than because nothing was spent.
   *
   * The distinction is the difference between a quiet budget and a broken
   * one, and it is not theoretical: `usage-alerts` reads the LATEST usage
   * rollup by `computedAt`, which on the first days of a month is still LAST
   * month's document. Alerting from that would compare August's budget
   * against July's spend; suppressing the alert without recording why would
   * make a budget that never fires look like a budget that never needed to.
   */
  meteredFresh: boolean
}

/**
 * Whether `month`'s invoice charges for a line whose deployment variable
 * holds `configuredStart`.
 *
 * Same START-MONTH shape and the same fail-closed posture as
 * `billsOrgLibraryStorage`, and for the identical reason: a boolean flipped
 * mid-period would retroactively bill a re-run of an earlier month at that
 * month's accumulated usage. A start month cannot reach backwards.
 *
 * Anything but a `YYYY-MM` — `true`, `1`, a date, a typo — bills nothing.
 */
export function billsFromMonth(
  month: string,
  configuredStart: string | null | undefined,
): boolean {
  const start = String(configuredStart ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(start)) return false
  if (!/^\d{4}-\d{2}$/.test(month)) return false
  return month >= start
}

/** A positive finite dollar figure, or 0. */
function dollars(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Builds the month's spend from figures already read elsewhere.
 *
 * `rollupMonth` is compared to `month` rather than trusted: see
 * {@link OrgSpendBreakdown.meteredFresh}. Every declared spend line is
 * reported, read as nothing when its document was not read.
 */
export function orgMonthlySpend(input: {
  month: string
  /** `billedCents` off the latest `orgs/{id}/usage/*` document. */
  rollupBilledCents: number | null | undefined
  /** The `month` field of that same document. */
  rollupMonth: string | null | undefined
  /**
   * Each declared spend line's figure, keyed by line id: the `live.field` of
   * its month document, as read.
   */
  lineReadings?: Readonly<Record<string, unknown>>
  /** The deployment's variables, holding each line's start month. */
  env?: Readonly<Record<string, string | undefined>>
}): OrgSpendBreakdown {
  const { month, rollupBilledCents, rollupMonth } = input
  const meteredFresh = Boolean(rollupMonth) && rollupMonth === month
  const cents = Number(rollupBilledCents)
  const meteredUsd =
    meteredFresh && Number.isFinite(cents) && cents > 0 ? cents / 100 : 0
  const lines = pluginSpendLines().map(
    (line): OrgSpendLine => ({
      id: line.id,
      pluginId: line.pluginId,
      label: line.label,
      usd: dollars(input.lineReadings?.[line.id]),
      billed: billsFromMonth(month, input.env?.[line.billedFromEnv]),
    }),
  )
  return {
    meteredUsd,
    lines,
    totalUsd:
      meteredUsd +
      lines.reduce((sum, line) => sum + (line.billed ? line.usd : 0), 0),
    meteredFresh,
  }
}

/** A spend line as a customer's browser receives it. */
export interface PublicOrgSpendLine {
  id: string
  label: string
  billed: boolean
  /**
   * The month's figure in the line's declared unit (`ceil(dollars / unit
   * cost)`), or `null` for a line declared without one.
   */
  units: number | null
  /** What the unit is called, or `null` for a line without one. */
  unitLabel: string | null
  /** Dollars, only for a line declared WITHOUT a unit; `null` otherwise. */
  usd: number | null
}

/**
 * The customer-facing half of {@link OrgSpendBreakdown} — dollars the customer
 * is charged, and each plugin's line in the unit it declared.
 */
export interface PublicOrgSpend {
  /** Metered infrastructure and plan overages, from the invoice's own figure. */
  meteredUsd: number
  lines: PublicOrgSpendLine[]
  /** What counts against the budget. */
  totalUsd: number
  meteredFresh: boolean
}

/** Dollars in a unit of cost, rounded UP — spend already made never reads as less. */
function unitsOf(usd: number, costUsd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0
  return Math.ceil(usd / costUsd)
}

/**
 * The projection that crosses the boundary to a customer's browser.
 *
 * A line declared with a `unit` stores the platform's own cost — for the AI
 * plugin, its provider bill at the serving model's list rates, not a price
 * and not a rate the platform publishes. Serving it to an org-scoped caller
 * would put a model choice, per-token rates and a margin on a billing page,
 * so such a line crosses in its unit only, through the same rounding-up
 * conversion the plugin's own meter uses, and its dollars never do.
 *
 * `meteredUsd` and `totalUsd` stay dollars: `billedCents` is what an invoice
 * charges, which is the customer's own money and the whole subject of a
 * budget.
 *
 * Units and dollars are deliberately not summed. A budget is a dollar rule,
 * a unit is not a dollar, and folding one into the other would republish the
 * cost the conversion just removed.
 */
export function publicOrgMonthlySpend(spend: OrgSpendBreakdown): PublicOrgSpend {
  const declared = new Map<string, ResolvedPluginSpendLine>(
    pluginSpendLines().map((line) => [line.id, line]),
  )
  return {
    meteredUsd: spend.meteredUsd,
    lines: spend.lines.map((line) => {
      const unit = declared.get(line.id)?.unit
      return {
        id: line.id,
        label: line.label,
        billed: line.billed,
        units: unit ? unitsOf(line.usd, unit.costUsd) : null,
        unitLabel: unit ? unit.label : null,
        usd: unit ? null : line.usd,
      }
    }),
    totalUsd: spend.totalUsd,
    meteredFresh: spend.meteredFresh,
  }
}
