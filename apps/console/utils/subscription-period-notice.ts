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

import { isLiveSubscriptionStatus } from '@aglyn/aglyn'

/**
 * ONE honest sentence about the billing period.
 *
 * ## The contradiction this replaces
 *
 * The Current plan card rendered three independent fragments and let the
 * reader reconcile them. Observed live, top to bottom: plan name **Free**, a
 * **canceled** status chip, a **cancels at period end** badge, and
 * **Renews 8/18/2026**.
 *
 * "Cancels at period end" and "Renews" cannot both be true. The date was the
 * same `currentPeriodEnd` in either case and the LABEL was hardcoded to
 * "Renews", so the word doing the semantic work was the one word that never
 * changed. A customer reading both lines learns nothing they can trust; one
 * who reads only the last believes they are still a customer.
 *
 * So the card no longer composes fragments — it asks this, and renders the
 * single sentence it returns.
 *
 * ## Why `status` decides and `plan` does not
 *
 * `plan` is not evidence about billing. A staff entitlement override sets it
 * without writing `subscription` at all, which is exactly how a **Free** plan
 * comes to sit beside a **canceled** subscription: the two are describing
 * different moments — what is in effect now, and what happened before — with
 * nothing on the card saying so. The billing state is the honest signal, so
 * the sentence is derived from `status` and `cancelAtPeriodEnd`, and `plan`
 * is left to name the tier and nothing else.
 */

/** The Stripe subscription fields the card actually has. */
export interface SubscriptionPeriodInput {
  /** Stripe's subscription status word, or absent when never subscribed. */
  status?: string | null
  /** True when Stripe will not renew at the end of this period. */
  cancelAtPeriodEnd?: boolean | null
  /** Period end, as an ISO string, epoch ms, or a Firestore Timestamp. */
  currentPeriodEnd?: unknown
}

export interface SubscriptionPeriodNotice {
  /** The one sentence to render, or null when there is nothing to say. */
  sentence: string | null
  /**
   * Which state produced it, for styling and for tests that should not
   * assert on prose.
   */
  kind: 'renewing' | 'ending' | 'ended' | 'overdue' | 'never'
}

/**
 * Accepts the three shapes `currentPeriodEnd` arrives in.
 *
 * Firestore hands back a `Timestamp` from a live listener and a plain
 * ISO string once it has been through JSON — the billing page sees both,
 * because the org doc is merged from a listener and the billing doc from a
 * one-shot read. Returning null for anything unparseable keeps a malformed
 * value out of `Invalid Date`, which is what a bare `new Date(x)` renders.
 */
function toDate(value: unknown): Date | null {
  if (value == null) return null
  const raw =
    typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : value
  const date = raw instanceof Date ? raw : new Date(raw as string | number)
  return Number.isFinite(date.getTime()) ? date : null
}

/** Statuses that mean the subscription is over and will not come back. */
const DEAD_STATUSES = ['canceled', 'incomplete_expired']

/** Statuses where Stripe is still retrying a payment. */
const OVERDUE_STATUSES = ['past_due', 'unpaid']

export function subscriptionPeriodNotice(
  input: SubscriptionPeriodInput | null | undefined,
  formatDate: (date: Date) => string = (date) => date.toLocaleDateString(),
): SubscriptionPeriodNotice {
  const status = String(input?.status ?? '').trim()
  const date = toDate(input?.currentPeriodEnd)

  // Never subscribed. Deliberately NOT "no subscription" beside a plan name —
  // an org on a staff-granted plan has no subscription and is not a mistake.
  if (!status) return { sentence: null, kind: 'never' }

  if (DEAD_STATUSES.includes(status)) {
    return {
      // Past tense, and it does not promise a date it may not have: a
      // cancelled subscription's `currentPeriodEnd` is the period it was
      // cancelled in, which is the day access ended.
      sentence: date
        ? `This subscription ended ${formatDate(date)}.`
        : 'This subscription has ended.',
      kind: 'ended',
    }
  }

  if (input?.cancelAtPeriodEnd === true) {
    return {
      // The word the old card could not say. The date is when access STOPS,
      // and saying so is the whole point — it is also the reassurance, because
      // the customer keeps what they paid for until then.
      sentence: date
        ? `Cancels ${formatDate(date)} — you keep this plan until then.`
        : 'Cancels at the end of this billing period.',
      kind: 'ending',
    }
  }

  if (OVERDUE_STATUSES.includes(status)) {
    return {
      sentence: date
        ? `Payment overdue. Stripe is retrying; this plan runs to ${formatDate(date)}.`
        : 'Payment overdue. Stripe is retrying.',
      kind: 'overdue',
    }
  }

  if (isLiveSubscriptionStatus(status) && date) {
    return { sentence: `Renews ${formatDate(date)}.`, kind: 'renewing' }
  }

  // A live status with no date — an incomplete subscription mid-authentication,
  // or a mirror that has not caught up. Say nothing rather than guess: a wrong
  // date here is the bug this function exists to remove.
  return { sentence: null, kind: 'never' }
}
