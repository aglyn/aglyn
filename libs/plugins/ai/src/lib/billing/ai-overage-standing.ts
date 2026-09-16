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
 * A WORKSPACE'S OVERAGE STANDING (AGL-3011) — the pure half.
 *
 * AI credits past a plan's included band are sold on every paid plan. What
 * bounds them is not one number but four facts about the workspace, and this
 * module is the one derivation of all four: whether a card can be charged,
 * whether accrual is paused, how much overage this month may reach, and how
 * much may be outstanding at once.
 *
 * Nothing here reads Firestore, calls Stripe or knows what a month cost.
 * `ai-overage-ledger.ts` holds the documents and `ai-overage-charge.ts` the
 * charging; the gate and the staff card both resolve their figures here, so
 * the ceiling a customer is refused at is the ceiling the card displays.
 *
 * ## The bound, stated once
 *
 * A workspace may leave at most `AI_OVERAGE_UNPAID_LIMIT_USD` of overage
 * unpaid. That is enforced by REFUSING, not by charging — the gate compares
 * what a month accrued against what it paid, inside the reservation
 * transaction, every request. So the bound holds when a charge is late, when
 * Stripe is down, and when the charge path never ran at all. Charging at
 * `AI_OVERAGE_THRESHOLD_USD` exists to keep a workspace working, by settling
 * the balance before it reaches the bound; it is not what makes the bound
 * true.
 */

import { resolveAssistOverageCapUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'

/** The billing fields of an org, as every resolver in this folder takes it. */
export type AiOverageOrg = Partial<AglynOrgBilling> | null | undefined

/**
 * The unbilled overage at which the card on file is charged.
 *
 * Fifty times Stripe's minimum charge, so no charge is refused for being too
 * small; low enough that what is outstanding between charges stays near the
 * bound below; high enough that per-invoice fees stay a few percent.
 */
export const AI_OVERAGE_THRESHOLD_USD = 25

/**
 * The most overage a workspace may have accrued and not paid for.
 *
 * Twice the threshold, so one charge in flight plus one accruing is inside
 * it, and a workspace doing ordinary work never meets it. Meeting it means
 * the charges are not settling, and that is exactly when accrual must stop.
 */
export const AI_OVERAGE_UNPAID_LIMIT_USD = 50

/**
 * The monthly ceiling, by step. It rises one step for each later calendar
 * month in which the workspace paid an invoice with a real charge.
 *
 * Months, not invoices: every paid workspace pays an invoice the moment it
 * subscribes, and threshold invoices can arrive several times a day, so
 * counting invoices would reach the top step in an afternoon. Counting
 * months takes at least two, which covers much of the window in which a
 * stolen card is reported.
 */
export const AI_OVERAGE_CEILING_LADDER_USD = [50, 150, 500] as const

/** The top index of the ladder; `step` is clamped to it. */
export const AI_OVERAGE_MAX_STEP = AI_OVERAGE_CEILING_LADDER_USD.length - 1

/**
 * The smallest amount worth an invoice — Stripe's own minimum charge. A
 * close-out remainder under it is carried, not billed: an invoice that
 * cannot be paid is a document that dunning chases forever.
 */
export const AI_OVERAGE_MIN_CHARGE_USD = 0.5

/** Bounds on a ceiling staff may write by hand, the customer ceiling's. */
export const AI_OVERAGE_STAFF_CEILING_MIN_USD = 1
export const AI_OVERAGE_STAFF_CEILING_MAX_USD = 100_000

/** Why overage is paused. Each one is payment trust dropping, differently. */
export type AiOveragePauseReason =
  | 'charge_failed'
  | 'past_due'
  | 'dispute'
  | 'staff'

/** A staff ceiling that outranks the ladder. */
export interface AiOverageStaffOverride {
  ceilingUsd: number
  reason: string
  setBy: string
  setAt: string | null
  /** ISO instant, or `null` to stand until staff clear it. */
  expiresAt: string | null
}

/** Accrual stopped, and why. */
export interface AiOveragePause {
  reason: AiOveragePauseReason
  /** The invoice that failed, when a charge is what stopped it. */
  invoiceId: string | null
  since: string | null
}

/**
 * `orgs/{orgId}/aiBilling/standing`, normalized.
 *
 * Written only by the server, read by the gate on every request past the
 * band. The Firestore rules deny every client write and allow the same reads
 * as `aiAllotments`.
 */
export interface AiOverageStanding {
  /**
   * The workspace's default payment method type, `null` when it has none,
   * and `undefined` when nobody has looked yet.
   *
   * THREE states, not two, and the third is the important one. A workspace
   * that has been paying for a year has no standing document until something
   * writes one, and reading that absence as "no card" would refuse a paying
   * customer's work over a document we never wrote. So "never observed"
   * declines to answer the card question and lets the other guards bind —
   * the unpaid bound does not rest on the card check, which is why it can
   * afford to abstain. A pre-cutover backfill is what turns `undefined` into
   * a real answer for existing workspaces.
   */
  paymentMethodType: string | null | undefined
  /** The first month (`YYYY-MM`) an invoice of this workspace's was paid. */
  firstPaidMonth: string | null
  /**
   * Later months with a paid invoice, ascending, the most recent 12 kept. A
   * month is dropped again if an AI charge of that month was still unpaid
   * when the month ended.
   */
  qualifyingMonths: string[]
  staffOverride: AiOverageStaffOverride | null
  pause: AiOveragePause | null
  lastDisputeAt: string | null
}

/** The standing of a workspace nothing has written a document for. */
export const EMPTY_AI_OVERAGE_STANDING: AiOverageStanding = {
  paymentMethodType: undefined,
  firstPaidMonth: null,
  qualifyingMonths: [],
  staffOverride: null,
  pause: null,
  lastDisputeAt: null,
}

/** How many qualifying months the document keeps. */
export const AI_OVERAGE_QUALIFYING_MONTHS_KEPT = 12

const MONTH = /^\d{4}-\d{2}$/

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readInstant(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  // A Firestore Timestamp, as the Admin SDK hands one back.
  const toDate = (value as { toDate?: () => Date } | null)?.toDate
  if (typeof toDate === 'function') {
    const date = toDate.call(value)
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString()
      : null
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  return null
}

const PAUSE_REASONS: readonly AiOveragePauseReason[] = [
  'charge_failed',
  'past_due',
  'dispute',
  'staff',
]

/**
 * Reads the stored document into the shape above, strictly.
 *
 * Strictly, because every field here decides whether a workspace may spend
 * money: a string `"true"` that read as a boolean, or a `NaN` ceiling that
 * every comparison passes, is a guard that is not there. Anything that does
 * not narrow is the empty standing's value for that field — which is the
 * conservative answer in each case except the card, where the deliberate
 * answer is "nobody has looked".
 */
export function readAiOverageStanding(
  data: Record<string, unknown> | null | undefined,
): AiOverageStanding {
  if (!data || typeof data !== 'object') return EMPTY_AI_OVERAGE_STANDING
  const rawType = data['paymentMethodType']
  const paymentMethodType =
    rawType === undefined
      ? undefined
      : typeof rawType === 'string' && rawType.trim()
        ? rawType.trim()
        : null
  const firstPaidMonth = readString(data['firstPaidMonth'])
  const months = Array.isArray(data['qualifyingMonths'])
    ? (data['qualifyingMonths'] as unknown[])
        .filter((month): month is string => typeof month === 'string' && MONTH.test(month))
        .filter((month, index, all) => all.indexOf(month) === index)
        .sort()
    : []
  const override = data['staffOverride'] as Record<string, unknown> | null | undefined
  const ceilingUsd = Number(override?.['ceilingUsd'])
  const staffOverride: AiOverageStaffOverride | null =
    override && Number.isFinite(ceilingUsd) && ceilingUsd > 0
      ? {
          ceilingUsd,
          reason: readString(override['reason']) ?? '',
          setBy: readString(override['setBy']) ?? '',
          setAt: readInstant(override['setAt']),
          expiresAt: readInstant(override['expiresAt']),
        }
      : null
  const rawPause = data['pause'] as Record<string, unknown> | null | undefined
  const pauseReason = readString(rawPause?.['reason']) as AiOveragePauseReason | null
  const pause: AiOveragePause | null =
    rawPause && pauseReason && PAUSE_REASONS.includes(pauseReason)
      ? {
          reason: pauseReason,
          invoiceId: readString(rawPause['invoiceId']),
          since: readInstant(rawPause['since']),
        }
      : null
  return {
    paymentMethodType,
    firstPaidMonth: firstPaidMonth && MONTH.test(firstPaidMonth) ? firstPaidMonth : null,
    qualifyingMonths: months,
    staffOverride,
    pause,
    lastDisputeAt: readInstant(data['lastDisputeAt']),
  }
}

/**
 * The workspace's step on the ladder — one per qualifying month, clamped.
 *
 * Derived rather than stored, so a stored `step` cannot disagree with the
 * months it was supposed to have been derived from. The document carries a
 * mirrored copy for readers that want one figure, and this is what writes it.
 */
export function aiOverageStep(standing: AiOverageStanding): number {
  return Math.min(AI_OVERAGE_MAX_STEP, standing.qualifyingMonths.length)
}

/** Is a staff override still standing at this instant? */
export function aiOverageOverrideApplies(
  override: AiOverageStaffOverride | null,
  now: Date,
): boolean {
  if (!override) return false
  if (!override.expiresAt) return true
  const expires = Date.parse(override.expiresAt)
  // An unparseable expiry expires the override rather than extending it: a
  // ceiling that was meant to end and cannot say when must not outlive its
  // reason because a timestamp did not read back.
  if (!Number.isFinite(expires)) return false
  return now.getTime() < expires
}

/**
 * Aglyn's own ceiling on this month's overage, in retail dollars.
 *
 * The staff override when one stands, and the ladder otherwise. This is the
 * platform's limit; the customer's own `capUsd` is a separate figure and the
 * lower of the two binds — see `aiOverageEffectiveCeilingUsd`.
 */
export function aiOverageStandingCeilingUsd(
  standing: AiOverageStanding,
  now: Date,
): number {
  if (aiOverageOverrideApplies(standing.staffOverride, now)) {
    return standing.staffOverride!.ceilingUsd
  }
  return AI_OVERAGE_CEILING_LADDER_USD[aiOverageStep(standing)]
}

/**
 * The ceiling that actually binds: the lower of the workspace's own and
 * Aglyn's. For display and for staff; the gate consults the two separately,
 * because the customer's ceiling and the platform's need different words.
 */
export function aiOverageEffectiveCeilingUsd(
  org: AiOverageOrg,
  standing: AiOverageStanding,
  now: Date,
): number {
  const own = resolveAssistOverageCapUsd(org)
  const ours = aiOverageStandingCeilingUsd(standing, now)
  return own === null ? ours : Math.min(own, ours)
}

/**
 * Whether a card is the default payment method, as far as anyone has looked.
 *
 * `undefined` when nobody has, and callers must handle that third answer
 * rather than coercing it — see `paymentMethodType`.
 */
export function aiOverageCardOnFile(
  standing: AiOverageStanding,
): boolean | undefined {
  if (standing.paymentMethodType === undefined) return undefined
  return standing.paymentMethodType === 'card'
}

/**
 * The month a qualifying step is recorded under, from a paid invoice.
 *
 * `null` when the payment is not evidence that money moved or that time has
 * passed: an invoice marked paid out of band is a staff action, a zero
 * payment is a credit, and the first paid month is the baseline the ladder
 * counts FROM rather than a step on it.
 */
export function aiOverageQualifyingMonth(
  standing: AiOverageStanding,
  payment: { month: string; amountPaidCents: number; paidOutOfBand: boolean },
): string | null {
  if (!MONTH.test(payment.month)) return null
  if (payment.paidOutOfBand) return null
  if (!(payment.amountPaidCents > 0)) return null
  if (!standing.firstPaidMonth) return null
  if (!(payment.month > standing.firstPaidMonth)) return null
  return payment.month
}
