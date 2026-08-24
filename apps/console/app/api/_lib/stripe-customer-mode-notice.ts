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
 * WHY an org's Stripe customer id came back empty (AGL-2486, follow-up).
 *
 * `readOrgBilling(orgId).stripeCustomerId` is mode-scoped, and deliberately
 * does not fall back to the other mode's id — that fallback is the bug the
 * mode split exists to prevent. The cost of that correctness is that a
 * workspace with a month of live invoices and a workspace that has never been
 * billed hand a test-mode deployment the identical answer: nothing.
 *
 * Both billing surfaces then printed "No invoices yet." over an intact
 * history. This is the census that lets them tell the two apart, and it
 * carries no ids: a test-mode response must never publish a live `cus_…`.
 *
 * `otherModeOnly` is only ever true when THIS deployment has no customer and
 * the other mode does, so it can be attached unconditionally to a
 * missing-customer response without changing what "never subscribed" means.
 */
export interface StripeCustomerModeNotice {
  /** The org's customer exists, but only in the mode this deployment is not. */
  readonly otherModeOnly: boolean
  /** Which Stripe world this deployment spends in. */
  readonly deploymentMode: 'live' | 'test'
}

export async function describeMissingStripeCustomer(
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
