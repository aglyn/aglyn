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

import firebaseAdmin from './firebase-admin'
import { getOrgForHost } from './organizations'
import { saleChargeModel, type SaleChargeModel } from './payment-provider'

/**
 * The Stripe account a site sells into, and how it sells (direct or
 * destination), as recorded for it.
 *
 * ONE place reads where that record lives. Today it is the site owner's
 * profile (`profiles/{ownerUid}`: `stripeAccountId`, `stripeChargeModel`,
 * `stripeChargesEnabled`, `stripeAccountLivemode`), so one account serves
 * every workspace that person owns. When the account moves to the workspace
 * (one account per store, as the hosted store builders do), this function is
 * the one that changes: the in-person money routes (the register's card
 * readers, Tap to Pay, booking payments at the counter) ask it and nothing
 * else.
 *
 * Readiness is NOT decided here: the fields are returned as recorded, for
 * `merchantAccountIsReady` to judge at the door that charges. A Terminal
 * Location or reader belongs on the account whatever its readiness.
 */
export interface SellerPaymentAccount {
  /** The connected account id, trimmed. */
  accountId: string
  /** `direct` only when recorded so; anything else is a destination seller. */
  chargeModel: SaleChargeModel
  /** As recorded (`stripeChargesEnabled`), for the readiness rule. */
  chargesEnabled: unknown
  /** As recorded (`stripeAccountLivemode`), for the readiness rule. */
  accountLivemode: unknown
}

/**
 * The site's selling account, or null when none is recorded.
 *
 * `org` is the owning workspace when the caller already holds it (`null`
 * means the site has none, and so no account); omitted, it is looked up.
 * A failed read throws: a caller that guessed "the platform" on an error
 * would put a direct seller's money or readers on the wrong account.
 */
export async function sellerPaymentAccount(
  hostId: string,
  org?: Record<string, any> | null,
): Promise<SellerPaymentAccount | null> {
  const owner =
    org !== undefined
      ? org
      : (((await getOrgForHost(hostId))?.org as Record<string, any> | undefined) ?? null)
  const ownerUid = String(owner?.['ownerUid'] ?? '')
  if (!ownerUid) return null
  const profile = await firebaseAdmin
    .app()
    .firestore()
    .collection('profiles')
    .doc(ownerUid)
    .get()
  const accountId = String(profile.get('stripeAccountId') ?? '').trim()
  if (!accountId) return null
  return {
    accountId,
    chargeModel: saleChargeModel(profile.get('stripeChargeModel')),
    chargesEnabled: profile.get('stripeChargesEnabled'),
    accountLivemode: profile.get('stripeAccountLivemode'),
  }
}
