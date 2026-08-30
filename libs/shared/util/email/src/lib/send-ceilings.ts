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
 * THE EMAIL CEILINGS, DIMENSIONED AGAINST EACH OTHER.
 *
 * Three independent limits govern how much campaign mail leaves the platform,
 * and until this module none of them was expressed in terms of any other:
 *
 *  - a per-send recipient cap, in `campaign-send.ts`;
 *  - a platform hourly ceiling, in `send-rate.ts`;
 *  - a per-plan monthly allowance, `emailSendsPerMonth` in `PLAN_ENTITLEMENTS`.
 *
 * Three numbers picked separately describe a machine that cannot exist. The
 * arithmetic below is the whole point of the file: every derived ceiling is a
 * function of the others, so the relations can be checked rather than
 * believed, and a future change to any one of them fails a test instead of
 * quietly overselling the sending domain.
 *
 * ## The units
 *
 * Every figure here is a COUNT OF MESSAGES — one per recipient address handed
 * to the sender — matching `email-metering.ts` exactly. The window each one
 * counts over is the only thing that differs: one invocation, one hour, one
 * calendar month.
 *
 * ## The derivation
 *
 * A month is projected from an hour at {@link EMAIL_CEILING_MONTH_DAYS} days
 * of {@link EMAIL_CEILING_HOURS_PER_DAY} hours. That projection is
 * deliberately generous — it assumes an org sends flat out around the clock
 * for a whole month, which nobody does — because its job is to prove an upper
 * bound. A plan that oversells even against continuous sending oversells
 * against every real pattern too.
 *
 *     orgPerHour          = floor(platformPerHour x orgShare)
 *     deliverableMonthly  = orgPerHour x 24 x 30
 *
 * With the shipped defaults (2,000/hour platform, 25% share):
 *
 *     orgPerHour          = floor(2,000 x 0.25)  =        500 / hour
 *     deliverableMonthly  = 500 x 24 x 30        =    360,000 / month
 *
 * ## The three relations
 *
 * **R1 — a send must fit in the org's hour.** `perSend <= orgPerHour`. At the
 * defaults these are both 500, so one maximal send is exactly one hour of the
 * org's share. A per-send cap ABOVE the hourly cap would be a cap that can
 * never be reached, which is the shape that teaches an operator to ignore the
 * number the composer shows them.
 *
 * **R2 — an org may not be the whole platform.** `orgPerHour <=
 * platformPerHour`. At 25% four orgs can occupy the hour together; at 100%
 * one org can shut every other tenant out of campaign sending, which is the
 * tenant-versus-tenant denial of service the share exists to close.
 * Transactional mail is exempt from both ceilings and is unaffected by this.
 *
 * **R3 — a plan may not sell more than the platform can deliver.**
 * `planMonthly <= deliverableMonthly`. This is the relation that does not hold
 * today, and {@link describeEmailCeilings} reports it rather than repairing
 * it: the repair would be to lower an entitlement, and an entitlement is what
 * a locked price bought. See `email-ceiling-dimensioning.spec.ts`, which pins
 * exactly which plans fail so that the set cannot grow unnoticed.
 *
 * ## What a violated relation does NOT do
 *
 * It does not clamp anything. `PLAN_ENTITLEMENTS` is the authority for what a
 * customer bought, and silently resolving an entitlement down to what the
 * current platform ceiling can deliver would be a price change made by
 * arithmetic. The model reports; the operator decides; the hourly ceiling is
 * what actually paces the mail, and it defers rather than refuses.
 */

/**
 * Recipients one campaign invocation may address.
 *
 * The cap is a bound on a single function call, not a plan feature: beyond it
 * a send stops being a request and becomes a batch job that has to survive
 * timeouts and resume without double-sending. It is stated here rather than
 * privately in `campaign-send.ts` so that R1 can be checked against it.
 *
 * A merchant whose audience is larger is NOT told this number is their
 * audience. The composer reports the true audience and how much of it this
 * send reaches — a truncation reported as a total is the silent cap this
 * product keeps rediscovering.
 */
export const EMAIL_MAX_RECIPIENTS_PER_SEND = 500

/**
 * The fraction of the platform hour one org's campaigns may occupy.
 *
 * 25% is the starting value: it leaves room for four concurrent large senders
 * plus all transactional traffic (which the governor counts but may never
 * refuse), and at the default platform ceiling it lands the org's hour on
 * exactly {@link EMAIL_MAX_RECIPIENTS_PER_SEND}, so R1 holds with no slack
 * and the two caps explain each other.
 *
 * Compiled in rather than stored, unlike the platform ceiling beside it. The
 * platform ceiling is a ramp — an operator moves it during an incident or a
 * warm-up, and `send-rate.ts` makes that a value change on
 * `rateLimits/sendRateConfig` for exactly that reason. This share is a
 * fairness policy between tenants, not a ramp: changing it redistributes
 * headroom between paying customers, which is a decision that should carry a
 * deploy and a review. If that stops being true it becomes a second field on
 * the same config document and inherits the same staff card.
 */
export const EMAIL_ORG_HOURLY_SHARE = 0.25

/** Lower bound on a share. Zero would refuse every campaign on the platform. */
export const EMAIL_ORG_HOURLY_SHARE_MIN = 0.01

/** Upper bound. Above 1 an org would be entitled to more than the whole hour. */
export const EMAIL_ORG_HOURLY_SHARE_MAX = 1

/**
 * Days used to project an hourly ceiling onto a month.
 *
 * 30 rather than the true length of the calendar month, and that choice is
 * conservative in the direction that matters: a 31-day month would raise the
 * projected ceiling and make an overselling plan look like it fits. The
 * monthly ALLOWANCE is a real calendar month — `email-metering.ts` keys it
 * `YYYY-MM` — and nothing here changes that. This constant only bounds the
 * projection used to compare the two ceilings.
 */
export const EMAIL_CEILING_MONTH_DAYS = 30

/** Hours in the projection day. Named so the arithmetic reads as arithmetic. */
export const EMAIL_CEILING_HOURS_PER_DAY = 24

/** Hours in the projected month: 720 at the shipped constants. */
export const EMAIL_CEILING_MONTH_HOURS =
  EMAIL_CEILING_MONTH_DAYS * EMAIL_CEILING_HOURS_PER_DAY

/** A relation between two ceilings that must hold, named for reporting. */
export type EmailCeilingRelation =
  /** R1: a single send must fit inside the org's hourly share. */
  | 'send-exceeds-org-hour'
  /** R2: an org's hourly share must fit inside the platform hour. */
  | 'org-hour-exceeds-platform-hour'
  /** R3: a plan may not sell more than the platform can deliver in a month. */
  | 'plan-exceeds-deliverable-month'

/** One failed relation, with the two numbers that failed it. */
export interface EmailCeilingViolation {
  relation: EmailCeilingRelation
  /** The ceiling that is too large. */
  claimed: number
  /** The ceiling it must not exceed. */
  available: number
  /** Human-readable, and the text a surface may show verbatim. */
  detail: string
}

/** The reconciled model: every ceiling, and whether they agree. */
export interface EmailCeilingModel {
  /** Recipients one invocation may address. */
  perSend: number
  /** Messages one org's campaigns may send in an hour. */
  orgPerHour: number
  /** Messages the whole platform may send in an hour. */
  platformPerHour: number
  /** The share used to derive `orgPerHour`. */
  orgShare: number
  /** Upper bound on what one org can actually get out in a month. */
  deliverableMonthly: number
  /**
   * The plan's monthly campaign allowance as a FINITE number.
   *
   * An unlimited plan reports `deliverableMonthly` here and sets
   * {@link planUnlimited}. `UNLIMITED` is `Number.POSITIVE_INFINITY`, and
   * `JSON.stringify(Infinity)` is `null` — `Number(null)` is `0` and
   * `Number.isFinite(0)` is `true`, so the sentinel crossing the wire arrives
   * as a cap of ZERO on the most expensive plan and sails through every
   * guard. A finite number plus an explicit flag is the only shape that
   * survives serialization.
   */
  planMonthly: number
  /** True when the plan's allowance is unbounded. Never infer this from the number. */
  planUnlimited: boolean
  /**
   * Hours of the org's own hourly share a full plan allowance would need.
   *
   * The figure that makes an overselling plan legible: at the defaults an
   * agency allowance of 1,000,000 needs 2,000 hours of a 720-hour month.
   */
  hoursToSpendPlan: number
  /** Every relation that does not hold. Empty when the model is coherent. */
  violations: EmailCeilingViolation[]
  /** True when all three relations hold. */
  coherent: boolean
}

/** Clamps a raw ceiling to a positive integer, or returns `fallback`. */
function positiveInt(raw: unknown, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Clamps a share into `[MIN, MAX]`.
 *
 * An unreadable share falls back to the default and never to zero: a share of
 * zero would derive an org hourly ceiling of zero and refuse every campaign
 * on the platform, which is the stubbed-resolver failure — a clamp that goes
 * green having refused everything.
 */
export function normalizeOrgHourlyShare(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return EMAIL_ORG_HOURLY_SHARE
  return Math.min(
    EMAIL_ORG_HOURLY_SHARE_MAX,
    Math.max(EMAIL_ORG_HOURLY_SHARE_MIN, value),
  )
}

/**
 * Messages one org's campaigns may send in one hour.
 *
 * Floored at 1, never 0: a platform ceiling small enough to round the share
 * away must throttle campaigns to a trickle, not stop them dead. Stopping
 * them dead is indistinguishable from an outage and is what an operator would
 * accidentally configure while ramping DOWN during an incident.
 */
export function orgHourlyCampaignCeiling(
  platformPerHour: number,
  share: number = EMAIL_ORG_HOURLY_SHARE,
): number {
  const platform = positiveInt(platformPerHour, 0)
  if (platform <= 0) return 1
  return Math.max(1, Math.floor(platform * normalizeOrgHourlyShare(share)))
}

/**
 * The most one org could get out in a projected month, at its hourly share.
 *
 * This is the ceiling a plan's monthly allowance has to fit inside for the
 * plan to be deliverable, and it is an upper bound rather than a forecast —
 * see the projection note on {@link EMAIL_CEILING_MONTH_DAYS}.
 */
export function deliverableMonthlyCeiling(
  platformPerHour: number,
  share: number = EMAIL_ORG_HOURLY_SHARE,
  monthHours: number = EMAIL_CEILING_MONTH_HOURS,
): number {
  return (
    orgHourlyCampaignCeiling(platformPerHour, share) *
    positiveInt(monthHours, EMAIL_CEILING_MONTH_HOURS)
  )
}

export interface DescribeEmailCeilingsInput {
  /** The live platform hourly ceiling, from `rateLimits/sendRateConfig`. */
  platformPerHour: number
  /**
   * The plan's `emailSendsPerMonth`. May be `Infinity` (`UNLIMITED`); the
   * model converts it to a finite number plus a flag.
   */
  planMonthlyLimit: number
  /** Recipients per invocation. Defaults to the shipped cap. */
  perSend?: number
  /** Fraction of the platform hour for one org. Defaults to the shipped share. */
  orgShare?: number
  /** Hours in the projected month. Injectable for tests. */
  monthHours?: number
}

/**
 * Builds the reconciled model and names every relation that fails.
 *
 * Pure, and total: no input produces a throw, because this runs on the path
 * that decides whether a campaign goes out and a thrown model would be an
 * outage caused by bookkeeping. Nonsense inputs clamp to the shipped
 * defaults, which is the same posture `normalizeEmailSendRateConfig` takes
 * for the same reason.
 */
export function describeEmailCeilings(
  input: DescribeEmailCeilingsInput,
): EmailCeilingModel {
  const orgShare = normalizeOrgHourlyShare(input.orgShare ?? EMAIL_ORG_HOURLY_SHARE)
  const platformPerHour = positiveInt(input.platformPerHour, 0)
  const perSend = positiveInt(input.perSend, EMAIL_MAX_RECIPIENTS_PER_SEND)
  const monthHours = positiveInt(input.monthHours, EMAIL_CEILING_MONTH_HOURS)
  const orgPerHour = orgHourlyCampaignCeiling(platformPerHour, orgShare)
  const deliverableMonthly = orgPerHour * monthHours

  const rawPlan = Number(input.planMonthlyLimit)
  const planUnlimited = rawPlan === Number.POSITIVE_INFINITY
  // A negative or unreadable allowance reads as 0 — no included band — rather
  // than as unlimited. `emailSendsOverage` makes the same choice: the
  // direction to be wrong in is the one that cannot let unbounded mail out.
  const planMonthly = planUnlimited
    ? deliverableMonthly
    : Number.isFinite(rawPlan) && rawPlan > 0
      ? Math.floor(rawPlan)
      : 0

  const violations: EmailCeilingViolation[] = []
  if (perSend > orgPerHour) {
    violations.push({
      relation: 'send-exceeds-org-hour',
      claimed: perSend,
      available: orgPerHour,
      detail:
        `A single send may address ${perSend} recipients but a workspace may ` +
        `only send ${orgPerHour} an hour, so a full send can never complete ` +
        'inside one window.',
    })
  }
  if (orgPerHour > platformPerHour) {
    violations.push({
      relation: 'org-hour-exceeds-platform-hour',
      claimed: orgPerHour,
      available: platformPerHour,
      detail:
        `One workspace may send ${orgPerHour} an hour against a platform ` +
        `ceiling of ${platformPerHour}, so a single tenant can occupy the ` +
        'whole hour.',
    })
  }
  // An unlimited plan violates R3 by construction: no finite platform can
  // deliver an unbounded allowance. Reported, not repaired — the hourly
  // ceiling is what paces it, and it defers rather than refuses.
  if (planUnlimited || planMonthly > deliverableMonthly) {
    violations.push({
      relation: 'plan-exceeds-deliverable-month',
      claimed: planUnlimited ? Number.POSITIVE_INFINITY : planMonthly,
      available: deliverableMonthly,
      detail: planUnlimited
        ? 'The plan sells an unlimited monthly allowance, which no finite ' +
          `platform ceiling can deliver; ${deliverableMonthly.toLocaleString()} ` +
          'a month is the most this workspace can actually send.'
        : `The plan includes ${planMonthly.toLocaleString()} campaign emails a ` +
          `month but the platform can deliver at most ` +
          `${deliverableMonthly.toLocaleString()} to one workspace.`,
    })
  }

  return {
    perSend,
    orgPerHour,
    platformPerHour,
    orgShare,
    deliverableMonthly,
    planMonthly,
    planUnlimited,
    hoursToSpendPlan: planUnlimited
      ? Number.POSITIVE_INFINITY
      : orgPerHour > 0
        ? Math.ceil(planMonthly / orgPerHour)
        : 0,
    violations,
    coherent: violations.length === 0,
  }
}

/**
 * The wire shape for the monitoring surface: what a workspace has sent
 * against what it may send.
 *
 * Every field is a finite number. `planUnlimited` and `hoursToSpendPlanKnown`
 * carry what the numbers cannot — see the note on
 * {@link EmailCeilingModel.planMonthly} for why a sentinel is never sent.
 */
export interface EmailSendHeadroom {
  /** Campaign messages this workspace has sent this calendar month. */
  monthUsed: number
  /** The plan's monthly allowance, finite. */
  monthLimit: number
  /** True when the plan's allowance is unbounded. */
  planUnlimited: boolean
  /** Allowance left this month, floored at 0. Zero when unlimited is false and spent. */
  monthRemaining: number
  /** Campaign messages this workspace has sent in the current hour. */
  hourUsed: number
  /** What it may send in an hour. */
  hourLimit: number
  /** Headroom left in the current hour, floored at 0. */
  hourRemaining: number
  /** When the hour rolls, ms since epoch. */
  hourResetMs: number
  /** Recipients one send may address. */
  perSend: number
  /** Upper bound on what the platform can deliver to one workspace in a month. */
  deliverableMonthly: number
  /**
   * True when the plan sells more than {@link deliverableMonthly}.
   *
   * Surfaced rather than hidden: a customer whose plan promises a million
   * emails is entitled to know that the pacing controls will not let them
   * spend it, and an operator is entitled to see it before a support ticket
   * arrives asking why.
   */
  planExceedsDeliverable: boolean
}

/**
 * Assembles the monitoring figure from the two counters and the model.
 *
 * Pure. The counters are read by the caller — this library is `scope:shared`
 * and may not reach Firestore — so the same function serves the console, the
 * composer and a test with no harness at all.
 */
export function emailSendHeadroom(input: {
  model: EmailCeilingModel
  /** Campaign sends recorded for the calendar month. */
  monthUsed: number
  /** Campaign sends recorded in the current hourly window. */
  hourUsed: number
  /** When the current window rolls. */
  hourResetMs: number
}): EmailSendHeadroom {
  const { model } = input
  // A corrupt or negative counter must not read as headroom a cap honours —
  // the clamp `campaignEmailSendsForMonth` and `emailSendRateVerdict` both
  // apply, for the same reason.
  const monthUsed = Math.max(0, Math.floor(Number(input.monthUsed) || 0))
  const hourUsed = Math.max(0, Math.floor(Number(input.hourUsed) || 0))
  return {
    monthUsed,
    monthLimit: model.planMonthly,
    planUnlimited: model.planUnlimited,
    monthRemaining: model.planUnlimited
      ? model.deliverableMonthly
      : Math.max(0, model.planMonthly - monthUsed),
    hourUsed,
    hourLimit: model.orgPerHour,
    hourRemaining: Math.max(0, model.orgPerHour - hourUsed),
    hourResetMs: Math.max(0, Math.floor(Number(input.hourResetMs) || 0)),
    perSend: model.perSend,
    deliverableMonthly: model.deliverableMonthly,
    planExceedsDeliverable: model.violations.some(
      (violation) => violation.relation === 'plan-exceeds-deliverable-month',
    ),
  }
}
