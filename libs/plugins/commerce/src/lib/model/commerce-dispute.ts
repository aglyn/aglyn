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

import type { HostOrder, OrderDispute } from './commerce-orders'

/**
 * Reading a chargeback back out of an order (AGL-1796).
 *
 * AGL-1787 decided that a lost dispute leaves the order `status: 'refunded'`,
 * because five entitlement gates match that literal and a new status would
 * have escaped all of them. The cost of that decision is paid HERE: a merchant
 * opening the order sees "Refunded", the one word that says they chose it.
 * The distinction rides on the `dispute` record beside the status, and these
 * are the pure readers that turn it back into something a console can say.
 *
 * Kept out of `commerce-orders.ts` on the same principle the model directory
 * already follows — cart, discounts, shipping and tax each own a file — and
 * because this is presentation-shaped: it answers "what should the merchant be
 * told", not "what is true of the order".
 *
 * Dates render as `YYYY-MM-DD` through `toISOString`, which is what the
 * webhook's own timeline entries do. Deterministic, and the console shows
 * these strings beside those entries.
 */

/**
 * Stripe dispute statuses that mean it is over.
 *
 * `warning_*` statuses belong to an inquiry that has not become a dispute yet;
 * `warning_closed` is the one that ends. The other `warning_*` values
 * (`warning_needs_response`, `warning_under_review`) are OPEN, which is why
 * this is a settled-list rather than a "starts with warning" test.
 */
const SETTLED_DISPUTE_STATUSES = new Set(['won', 'lost', 'warning_closed'])

/** How the merchant should read a dispute at a glance. */
export type OrderDisputeTone = 'open' | 'lost' | 'won' | 'settled'

/**
 * A dispute Stripe has not decided yet — the case with a DEADLINE attached.
 *
 * Three independent signals, all of which must say "open", because saying
 * "evidence due" about a settled dispute is the one error with a cost: it
 * sends a merchant to gather documents for a case that is closed. `outcome`
 * and `closedAtMs` are both written by `charge.dispute.closed` and `status` is
 * overwritten with the outcome, so a record that disagrees with itself is
 * malformed — and this resolves a malformed record to "settled", the answer
 * that cannot waste anyone's afternoon.
 *
 * Note `evidenceDueByMs` is NOT one of the signals: Stripe sends
 * `evidence_details.due_by` on the `closed` event too, so a closed dispute
 * still carries a deadline and testing for one would report every settled
 * dispute as open.
 */
export function isOrderDisputeOpen(dispute?: OrderDispute): boolean {
  if (!dispute) return false
  if (dispute.outcome) return false
  if (dispute.closedAtMs) return false
  return !SETTLED_DISPUTE_STATUSES.has(String(dispute.status ?? ''))
}

/** Whether this order has a dispute still running against it. */
export function orderHasOpenDispute(
  order: Pick<HostOrder, 'dispute'>,
): boolean {
  return isOrderDisputeOpen(order?.dispute)
}

/** What the console renders beside an order's status when a dispute exists. */
export interface OrderDisputeBadge {
  tone: OrderDisputeTone
  /** Short chip label, e.g. `Chargeback open`, `Charged back`. */
  label: string
  /** A sentence for the tooltip: reason, amount, deadline or outcome. */
  detail: string
  /** The deadline, present ONLY while the dispute is open. */
  evidenceDueByMs?: number
  /**
   * Whole days until evidence is due, negative once the deadline has passed.
   * Present only alongside `evidenceDueByMs`.
   */
  evidenceDaysLeft?: number
}

/** `product_not_received` reads as `product not received`. */
function humanReason(reason?: string): string {
  return String(reason ?? '')
    .replace(/_/g, ' ')
    .trim()
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const usd = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`

/**
 * The badge for an order's dispute, or `null` when there is none.
 *
 * `nowMs` is a parameter rather than a `Date.now()` call so the deadline
 * arithmetic is testable without freezing the clock.
 */
export function describeOrderDispute(
  order: Pick<HostOrder, 'dispute'>,
  nowMs: number = Date.now(),
): OrderDisputeBadge | null {
  const dispute = order?.dispute
  if (!dispute) return null
  const reason = humanReason(dispute.reason)
  const because = reason ? ` (${reason})` : ''

  if (isOrderDisputeOpen(dispute)) {
    const dueBy = Number(dispute.evidenceDueByMs ?? 0)
    // `Math.ceil` so a deadline eight hours away reads as "1 day left" rather
    // than "0" — rounding a live deadline down to zero reads as expired.
    const daysLeft =
      dueBy > 0 ? Math.ceil((dueBy - nowMs) / 86_400_000) : undefined
    return {
      tone: 'open',
      label: 'Chargeback open',
      detail:
        `${usd(dispute.amountCents)} disputed${because}, opened ` +
        `${isoDay(dispute.openedAtMs)}. ` +
        (dueBy > 0
          ? `Evidence is due to Stripe by ${isoDay(dueBy)}` +
            (daysLeft !== undefined && daysLeft >= 0
              ? ` — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`
              : ' — that deadline has passed.')
          : 'Respond in the Stripe dashboard while the case is open.'),
      ...(dueBy > 0
        ? { evidenceDueByMs: dueBy, evidenceDaysLeft: daysLeft }
        : {}),
    }
  }

  const outcome = String(dispute.outcome ?? dispute.status ?? '')
  const closed = dispute.closedAtMs ? ` on ${isoDay(dispute.closedAtMs)}` : ''
  if (outcome === 'lost') {
    const reversed = Number(dispute.reversedCents ?? 0)
    return {
      tone: 'lost',
      label: 'Charged back',
      // The reversed figure can be LESS than the disputed one: AGL-1787 caps
      // the reversal against what is left, so a partly-refunded order loses
      // only the remainder. Saying only the disputed amount would overstate
      // what left the merchant's books.
      detail:
        `Dispute lost${closed}. ${usd(reversed)} was taken back` +
        `${because}` +
        (reversed < dispute.amountCents
          ? ` (of ${usd(dispute.amountCents)} disputed — the rest was already refunded).`
          : '.'),
    }
  }
  if (outcome === 'won') {
    return {
      tone: 'won',
      label: 'Dispute won',
      detail: `Dispute won${closed}${because} — no money was reversed.`,
    }
  }
  return {
    tone: 'settled',
    label: 'Dispute closed',
    detail:
      `Dispute closed${closed}${because}` +
      (outcome ? ` as ${humanReason(outcome)}` : '') +
      ' — no money was reversed.',
  }
}

/** What the orders list needs to raise the alarm, over a window of orders. */
export interface OpenDisputeSummary {
  /** Orders with a dispute still running. */
  count: number
  /** The soonest evidence deadline among them, when any carries one. */
  soonestDueByMs?: number
  /** Whole days to `soonestDueByMs`; negative once it has passed. */
  soonestDaysLeft?: number
  /** True when at least one deadline is already behind us. */
  overdue: boolean
}

/**
 * Count the open disputes in a window of orders and find the tightest
 * deadline (AGL-1796).
 *
 * A filter only helps a merchant who already suspects there is something to
 * filter FOR, and an evidence window is days long — so the orders list has to
 * say it unprompted. Computed over every loaded order rather than the visible
 * ones: a merchant filtered to "delivered" still needs to know a dispute is
 * running on a `paid` one.
 */
export function summariseOpenDisputes(
  orders: ReadonlyArray<Pick<HostOrder, 'dispute'>>,
  nowMs: number = Date.now(),
): OpenDisputeSummary {
  let count = 0
  let soonestDueByMs: number | undefined
  for (const order of orders ?? []) {
    if (!orderHasOpenDispute(order)) continue
    count += 1
    const dueBy = Number(order.dispute?.evidenceDueByMs ?? 0)
    if (dueBy > 0 && (soonestDueByMs === undefined || dueBy < soonestDueByMs)) {
      soonestDueByMs = dueBy
    }
  }
  if (soonestDueByMs === undefined) return { count, overdue: false }
  const soonestDaysLeft = Math.ceil((soonestDueByMs - nowMs) / 86_400_000)
  return {
    count,
    soonestDueByMs,
    soonestDaysLeft,
    overdue: soonestDueByMs < nowMs,
  }
}

/** Money off this order, split by the door it left through. */
export interface OrderReversalSplit {
  /** Cents refunded by a decision the merchant made. */
  refundedCents: number
  /** Cents taken back by a lost chargeback. */
  chargedBackCents: number
}

/**
 * Split `order.refundedCents` into the part the merchant chose and the part
 * a chargeback took.
 *
 * AGL-1787 writes BOTH into `refundedCents`, deliberately — money reversed is
 * money reversed, and the CSV, the analytics card and the member drawer all
 * want the total. Only the label needs the split, and `dispute.reversedCents`
 * is the piece to subtract.
 *
 * The chargeback share is clamped to the recorded total, so a `reversedCents`
 * larger than `refundedCents` (which can only mean the two fields disagree)
 * yields a zero refund line rather than a negative one.
 */
export function splitOrderReversal(
  order: Pick<HostOrder, 'refundedCents' | 'dispute'>,
): OrderReversalSplit {
  const total = Math.max(0, Number(order?.refundedCents ?? 0) || 0)
  const chargedBackCents = Math.min(
    total,
    Math.max(0, Number(order?.dispute?.reversedCents ?? 0) || 0),
  )
  return { refundedCents: total - chargedBackCents, chargedBackCents }
}
