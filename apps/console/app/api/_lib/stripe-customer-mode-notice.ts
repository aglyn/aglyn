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

import { deploymentLivemode } from '@aglyn/aglyn/app-utils/stripe-deployment-mode'
import { readOrgBillingCustomerModes } from '@aglyn/tenant-data-admin'

/**
 * WHY a billing history looks empty on this deployment (AGL-2486, follow-up).
 *
 * `readOrgBilling(orgId).stripeCustomerId` is mode-scoped, and deliberately
 * does not fall back to the other mode's id — that fallback is the bug the
 * mode split exists to prevent. The cost of that correctness is that an empty
 * screen has more than one cause, and they are not interchangeable.
 *
 * ## Three states, and collapsing any two recreates the bug
 *
 *  1. **Never billed.** No customer in either mode. "No invoices yet." is the
 *     true answer.
 *  2. **Billed, and readable here.** Invoices come back. No notice at all.
 *  3. **Billed in the mode this deployment cannot reach.** The history exists
 *     and this key cannot see it. Rendering that as (1) is the falsehood.
 *
 * ## Why this asks about the OTHER mode, not about a missing customer
 *
 * The first version of this answered "does this deployment have no customer
 * while the other mode does", and was attached only to a missing-customer
 * response. That covered a workspace touched in one mode only — and missed
 * the normal state of any workspace that has ever transacted live and been
 * opened in test, which has BOTH ids populated:
 *
 *     stripeCustomerId     → live, holds the history
 *     stripeCustomerIdTest → test, empty
 *
 * On localhost the customer is then not missing at all, the notice never
 * fired, and the card printed "No invoices yet." over an intact live history —
 * state 3 rendered as state 1, on the exact org the spec was written for.
 *
 * So the question is now the one the cards actually ask: **is there a customer
 * in the mode this deployment cannot read?** Callers attach the answer
 * whenever the history they are about to render is EMPTY, whatever made it
 * empty. A non-empty history needs no explanation and gets none.
 *
 * It carries no ids: a test-mode response must never publish a live `cus_…`.
 */
export interface StripeCustomerModeNotice {
  /**
   * The org has a customer in the mode this deployment is NOT running against.
   *
   * NOT "and none in this one" — that narrower reading is what missed the
   * both-ids case. Only meaningful beside an empty history; on its own it says
   * nothing about whether anything was billed.
   */
  readonly otherModeOnly: boolean
  /** Which Stripe world this deployment spends in. */
  readonly deploymentMode: 'live' | 'test'
}

/**
 * The census, for a history that is about to render EMPTY.
 *
 * Attach it on every empty-history path — the no-customer branch and the
 * customer-with-no-invoices branch alike. Attaching it to a NON-empty listing
 * would be a second bug: there is nothing to explain, and a notice beside real
 * invoices reads as though they were the wrong ones.
 */
export async function describeStripeModeSplit(
  orgId: string,
): Promise<StripeCustomerModeNotice> {
  const livemode = deploymentLivemode()
  const modes = await readOrgBillingCustomerModes(orgId)
  // The OTHER mode's slot — read explicitly rather than as "the one that is
  // not ours", so that a future third mode cannot silently make this lie.
  const otherModeHasCustomer = livemode ? modes.test : modes.live
  return {
    otherModeOnly: otherModeHasCustomer === true,
    deploymentMode: livemode ? 'live' : 'test',
  }
}
