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
 * THE OVERAGE GUARDS AT THE GATE (AGL-3011).
 *
 * Four reasons a workspace past its included band is refused, decided from
 * the month's own figures and the workspace's standing, and nothing else.
 * Pure: the reservation transaction calls this with what it has already
 * read, so the guard costs one document read and no round trip.
 *
 * ## The one that matters
 *
 * `settling` is why the bound is a bound. The other three describe a
 * workspace whose payment standing is known to be bad; `settling` describes
 * one whose charges simply have not landed — because a background task was
 * killed, because Stripe was down, because the charge path has a bug, or
 * because it was never switched on. In every one of those cases accrued
 * overage stops at the unpaid limit, having charged nothing. **The bound
 * holds even if a charge never runs**, and that is the whole design.
 *
 * ## Every refusal is `refusedBy: 'cap'`
 *
 * These join the workspace's own overage ceiling (AGL-2898) rather than
 * inventing a sixth refusal class, because they are the same kind of fact: a
 * dollar limit on credits sold past the band. `capReason` says whose limit
 * and which one, which is what decides the status and the sentence. Like
 * every other refusal, they move no counter.
 */

import {
  AI_OVERAGE_THRESHOLD_USD,
  AI_OVERAGE_UNPAID_LIMIT_USD,
  aiOverageCardOnFile,
  aiOverageStandingCeilingUsd,
  type AiOverageStanding,
} from './ai-overage-standing'

/**
 * Which limit refused.
 *
 * - `no-card`    the workspace has no card as its default payment method.
 * - `paused`     accrual is stopped — a failed charge, a past-due invoice,
 *                a dispute, or staff.
 * - `limit`      this month's overage reached Aglyn's ceiling.
 * - `settling`   accrued-but-unpaid overage reached the unpaid limit.
 * - `customer`   the workspace's own ceiling (AGL-2898), which refuses
 *                before any of the above and keeps its existing sentence.
 */
export type AiOverageCapReason =
  | 'no-card'
  | 'paused'
  | 'limit'
  | 'settling'
  | 'customer'

/** What the gate hands the guards. All figures are retail dollars. */
export interface AiOverageGateInput {
  /** This month's overage, priced as the invoice prices it. */
  overageUsd: number
  /** What of it has been paid — `overagePaidUsd` on the month's rollup. */
  paidUsd: number
  standing: AiOverageStanding
  now: Date
}

/** The refusal, with the figure its sentence must quote. */
export interface AiOverageRefusal {
  capReason: AiOverageCapReason
  /** The ceiling in force, for `limit`; the unpaid limit for `settling`. */
  limitUsd: number
  /** What is accrued and unpaid, for the pause and settling sentences. */
  unpaidUsd: number
}

function money(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * Which guard, if any, refuses this request.
 *
 * Order is deliberate and is the order a person can act on: a missing card
 * is one action, a failed charge is another, and both of those are things
 * the workspace can fix right now. A ceiling reached and a balance settling
 * are waits, so they come last. Two guards holding at once is ordinary — a
 * paused workspace is usually also at its unpaid limit — and naming the
 * actionable one is worth more than naming the first one numerically true.
 *
 * `>=` throughout, matching `assistOverageCapReached`: a limit is met when
 * it is met, not once it is passed.
 *
 * The card guard ABSTAINS when nobody has observed the workspace's payment
 * method (see `AiOverageStanding.paymentMethodType`). That is a deliberate
 * hole in the card rule and not in the bound: `settling` below does not read
 * the card at all, so an unobserved workspace is still stopped at the unpaid
 * limit. Closing the hole is a backfill, not a code change.
 */
export function aiOverageRefusal(
  input: AiOverageGateInput,
): AiOverageRefusal | null {
  const overageUsd = money(input.overageUsd)
  const paidUsd = money(input.paidUsd)
  const unpaidUsd = Math.max(0, overageUsd - paidUsd)
  const ceilingUsd = aiOverageStandingCeilingUsd(input.standing, input.now)

  if (aiOverageCardOnFile(input.standing) === false) {
    return { capReason: 'no-card', limitUsd: ceilingUsd, unpaidUsd }
  }
  if (input.standing.pause) {
    return { capReason: 'paused', limitUsd: ceilingUsd, unpaidUsd }
  }
  if (overageUsd >= ceilingUsd) {
    return { capReason: 'limit', limitUsd: ceilingUsd, unpaidUsd }
  }
  if (unpaidUsd >= AI_OVERAGE_UNPAID_LIMIT_USD) {
    return {
      capReason: 'settling',
      limitUsd: AI_OVERAGE_UNPAID_LIMIT_USD,
      unpaidUsd,
    }
  }
  return null
}

/** `$25.00`, the one place a dollar figure in these sentences is formatted. */
function usd(value: number): string {
  return `$${value.toFixed(2)}`
}

/**
 * The sentence a workspace is told, by reason.
 *
 * In the plugin, beside the guard that produced it, so the figure quoted is
 * the figure that refused. Every one of them says that INCLUDED CREDITS KEEP
 * WORKING, because that is the fact a customer most needs and least expects:
 * these guards stop what is sold past the band, never the band itself.
 *
 * `customer` is not answered here — the workspace's own ceiling keeps the
 * sentence `assistOverageCapRefusalText` already gives it, which names the
 * control by the label the console shows.
 */
export function aiOverageRefusalText(refusal: AiOverageRefusal): string | null {
  switch (refusal.capReason) {
    case 'no-card':
      return (
        'AI past your included credits needs a card on file. Add one under ' +
        'Billing to keep going — your included credits still work.'
      )
    case 'paused':
      return (
        'AI past your included credits is paused while a payment is ' +
        'outstanding. Pay the open invoice or update your card under ' +
        'Billing — your included credits still work.'
      )
    case 'limit':
      return (
        `This workspace reached this month's AI overage limit of ` +
        `${usd(refusal.limitUsd)}. The limit rises after each month an ` +
        'invoice is paid; contact support to raise it sooner — your ' +
        'included credits still work.'
      )
    case 'settling':
      return (
        `AI past your included credits is waiting on ` +
        `${usd(refusal.unpaidUsd)} of charges to settle. It resumes as soon ` +
        'as they do — your included credits still work.'
      )
    default:
      return null
  }
}

/**
 * The HTTP status each reason answers with.
 *
 * 402 where the workspace can settle it — a card to add, an invoice to pay.
 * 429 where it can only wait, which is the status the message cap and the
 * spend ceiling already use for exactly that meaning. The two must not be
 * swapped: a client retrying a 429 is right to, and retrying a 402 is not.
 */
export function aiOverageRefusalStatus(capReason: AiOverageCapReason): 402 | 429 {
  return capReason === 'no-card' || capReason === 'paused' || capReason === 'customer'
    ? 402
    : 429
}

/**
 * What the customer's overage card says about when the next charge lands.
 *
 * Here rather than in the component because it is the same arithmetic the
 * charge trigger makes, and a card that named a different figure from the
 * one that actually charges would be worse than a card that named none.
 */
export function aiOverageNextChargeUsd(
  overageUsd: number,
  invoicedUsd: number,
): number {
  const remaining = money(overageUsd) - money(invoicedUsd)
  return Math.max(0, AI_OVERAGE_THRESHOLD_USD - remaining)
}

/** The refusal fields a reservation carries, without importing its type. */
export interface AiOverageRefusedReservation {
  refusedBy: string | null
  capReason?: AiOverageCapReason | null
  overageLimitUsd?: number | null
  overageUnpaidUsd?: number | null
}

/**
 * The sentence and status for a reservation that AGLYN'S guards refused, or
 * `null` when they did not.
 *
 * ONE function for all four doors — the chat door, the besigner copy
 * assistant, the shared gate ladder and the generation jobs — because a
 * refusal whose words differ by door is a refusal a customer cannot search
 * for, and because the status and the sentence must agree about whether the
 * workspace can do anything about it.
 *
 * `null` for the workspace's OWN ceiling and for every other refusal, so a
 * door falls through to `assistOwnControlRefusalText` and the sentences it
 * has always given.
 */
export function aiOverageReservationRefusal(
  reservation: AiOverageRefusedReservation,
): { text: string; status: 402 | 429 } | null {
  if (reservation.refusedBy !== 'cap') return null
  const capReason = reservation.capReason ?? null
  if (!capReason || capReason === 'customer') return null
  const text = aiOverageRefusalText({
    capReason,
    limitUsd: money(reservation.overageLimitUsd),
    unpaidUsd: money(reservation.overageUnpaidUsd),
  })
  if (!text) return null
  return { text, status: aiOverageRefusalStatus(capReason) }
}
