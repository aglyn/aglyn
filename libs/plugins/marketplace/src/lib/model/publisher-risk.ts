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

/*==========================================
 * A YOUNG PUBLISHER'S RISK TIER (AGL-3365).
 *
 * The 9/26 actor signed up, paid for a plan on a card that never met 3-D
 * Secure, and within days was sending lures. On the marketplace the same
 * actor has one more move: publish a listing, buy it with stolen cards, and
 * cash the sales out through the payouts the platform sends the publisher.
 *
 * Every marketplace sale is a destination charge — the funds settle on the
 * platform and the publisher's share moves to its connected account at the
 * charge — so the lever the platform keeps is the connected account's PAYOUT
 * SCHEDULE: how long a share sits in the account before it leaves Stripe. A
 * share still in the account can be reversed when a card turns out stolen
 * (the refund and dispute doors already reverse it); a share already paid
 * out to a bank cannot.
 *
 * So a publisher workspace in its first {@link YOUNG_PUBLISHER_DAYS} days has
 * its payouts held {@link YOUNG_PUBLISHER_PAYOUT_DELAY_DAYS} days, which
 * outlasts the window in which issuers send early fraud warnings on most
 * stolen-card charges, and a single sale of
 * {@link YOUNG_PUBLISHER_REVIEW_SALE_CENTS} or more to one files a staff
 * signal while the money can still be reversed. A publisher that ages out of
 * the tier returns to the account's standard schedule on its next sale or its
 * next visit to the payout settings.
 *
 * Age alone, as the phishing screen's tier is: payment history is what the
 * actor bought.
 *=========================================*/

/** A publisher workspace younger than this many days is in the tier. */
export const YOUNG_PUBLISHER_DAYS = 30

/** How long a young publisher's payouts sit in its account. */
export const YOUNG_PUBLISHER_PAYOUT_DELAY_DAYS = 14

/** A young publisher's single sale at or above this files a staff signal. */
export const YOUNG_PUBLISHER_REVIEW_SALE_CENTS = 10_000

/**
 * Is a publisher workspace of this age (days) in the young tier? `null` — a
 * creation date that cannot be read — is an existing customer, as the
 * phishing screen reads it, and is not young.
 */
export function isYoungPublisher(ageDays: number | null | undefined): boolean {
  return (
    typeof ageDays === 'number' &&
    Number.isFinite(ageDays) &&
    ageDays < YOUNG_PUBLISHER_DAYS
  )
}

/**
 * The payout delay a publisher's account should carry: a number of days, or
 * `null` for the account's standard (minimum) schedule.
 */
export function publisherPayoutDelayDays(
  ageDays: number | null | undefined,
): number | null {
  return isYoungPublisher(ageDays) ? YOUNG_PUBLISHER_PAYOUT_DELAY_DAYS : null
}

/** One reason a sale looks like the publisher paying itself or cashing out cards. */
export type SaleRiskSignal =
  | {
      code: 'young-publisher-large-sale'
      ageDays: number
      amountCents: number
    }
  | {
      /** The buyer and the publisher share a member (a uid in both workspaces). */
      code: 'shared-member'
      uids: string[]
    }
  | {
      /**
       * The card that paid was used by ANOTHER buyer workspace to buy from
       * the same publisher — one card, several buyers, one seller.
       */
      code: 'card-reused-across-buyers'
      otherBuyerOrgIds: string[]
    }

/** One line per signal, in the words staff read on the row. */
export function describeSaleRiskSignals(
  signals: readonly SaleRiskSignal[],
): string[] {
  return signals.map((signal) => {
    switch (signal.code) {
      case 'young-publisher-large-sale':
        return (
          `The publisher's workspace is ${signal.ageDays} day(s) old and this one sale was ` +
          `$${(signal.amountCents / 100).toFixed(2)}.`
        )
      case 'shared-member':
        return (
          `The buying and publishing workspaces share ${signal.uids.length} member(s): ` +
          `${signal.uids.join(', ')}.`
        )
      case 'card-reused-across-buyers':
        return (
          'The same card also bought from this publisher for other workspace(s): ' +
          `${signal.otherBuyerOrgIds.join(', ')}.`
        )
      default:
        return 'Sale risk signal.'
    }
  })
}
