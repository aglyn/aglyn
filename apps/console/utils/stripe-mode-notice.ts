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
 * The sentence a billing card shows instead of "No invoices yet." when the
 * workspace's Stripe customer lives in the mode this deployment is NOT in
 * (AGL-2486, follow-up).
 *
 * ## Why this is a copy change and not a fallback
 *
 * The obvious "fix" — read the live customer id when the test slot is empty —
 * is the original AGL-2486 defect: it sends `cus_…` from live Stripe to an
 * `sk_test` key, which 502s every billing call for any org that has ever been
 * through checkout. The stored id is mode-scoped and stays that way. What was
 * actually broken is that the resulting empty list was reported as an
 * observation ("you have no invoices") when it was a limitation ("this
 * deployment cannot look them up").
 *
 * ## Written for a developer on localhost
 *
 * In practice only a `sk_test` deployment can show this, and the only such
 * deployment is a laptop: production spends with `sk_live_`. So the copy names
 * both modes explicitly, says the history is intact, and points at where it
 * can be seen — rather than apologising to a customer who will never read it.
 * The live→test direction is worded symmetrically because it is reachable in
 * principle (an org first exercised in test mode, then opened in production)
 * and a message that only handled one direction would be wrong in the other.
 */
export function stripeOtherModeInvoiceNotice(
  deploymentMode: 'live' | 'test',
): string {
  const here = deploymentMode === 'live' ? 'live' : 'test'
  const there = deploymentMode === 'live' ? 'test' : 'live'
  return (
    `This workspace's Stripe customer exists in ${there} mode, and this ` +
    `deployment is running against Stripe ${here} mode — so no invoices can ` +
    `be listed here. The billing history is intact; it is visible from a ` +
    `${there}-mode deployment${
      there === 'live' ? ' (production)' : ''
    }. This is not "no invoices".`
  )
}

/** What the staff billing panel knows about an org's Stripe customer. */
export interface StaffBillingCustomerState {
  /** False when THIS deployment has no customer to query (AGL-940). */
  hasCustomer?: boolean
  /** True when the customer exists, but in the other Stripe mode (AGL-2486). */
  otherModeOnly?: boolean
  /** Which Stripe world this deployment spends in. */
  deploymentMode?: 'live' | 'test'
}

/**
 * The staff panel's empty billing history, and WHICH emptiness it is.
 *
 * Three states, not two. `hasCustomer: false` used to mean "never subscribed"
 * on its own, and since the customer id became mode-scoped that is no longer
 * sound: a live-only org read by a `sk_test` deployment lands in exactly the
 * same branch with a paid invoice history behind it. Staff acting on "never
 * subscribed" — refusing a refund, closing a ticket, correcting a plan — would
 * be acting on a deployment artefact.
 *
 * `tone` rather than a component: the notice is an `Alert` because it is about
 * this deployment and not about the customer, and the two plain states stay
 * secondary text so an ordinary unbilled org does not shout.
 */
export function staffBillingHistoryEmptyState(
  billing: StaffBillingCustomerState,
): { tone: 'notice' | 'plain'; message: string } {
  if (billing?.otherModeOnly === true) {
    return {
      tone: 'notice',
      message: stripeOtherModeInvoiceNotice(
        billing?.deploymentMode === 'live' ? 'live' : 'test',
      ),
    }
  }
  if (billing?.hasCustomer === false) {
    return { tone: 'plain', message: 'This organization has never subscribed.' }
  }
  return { tone: 'plain', message: 'No invoices yet.' }
}

/**
 * The chip standing in for a payment method.
 *
 * Same defect one line up: a mode-invisible customer is not evidence that
 * nobody ever paid, so it must not be labelled "Never subscribed" either.
 */
export function staffBillingCustomerChipLabel(
  billing: StaffBillingCustomerState,
): string {
  if (billing?.otherModeOnly === true) return 'Other Stripe mode'
  if (billing?.hasCustomer === false) return 'Never subscribed'
  return 'No payment method'
}
