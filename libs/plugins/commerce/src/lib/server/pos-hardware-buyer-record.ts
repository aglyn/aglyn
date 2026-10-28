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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  posHardwareBuyerAddress,
  posHardwareOrderSource,
  posHardwareSaleRecord,
  posHardwareSaleSetOptions,
  type PosHardwareAddress,
  type PosHardwareAttachment,
  type PosHardwareOrder,
} from '../model/pos-hardware'
import { hardwareOrdersRef, posHardwareSaleRef } from './pos-hardware'
import { posStripe } from './pos-stripe'

/*==========================================
 * THE BUYER'S ADDRESS ON AN IN-PERSON SALE (AGL-4038).
 *
 * The platform keeps each hardware buyer's name and address for its
 * reseller records (`PosHardwareSaleBuyer`). An online order has the address
 * it shipped to. A sale at the booth has none unless the register typed one,
 * so the address of the store the buyer's readers are set up on stands in:
 * the store's card reader Location, which Stripe holds. It is filled in once,
 * the first time the sale is attached to a store that has one, and never
 * replaces an address the register typed.
 *=========================================*/

/** The address of a store's card reader Location, or null when it has none. */
export async function posHardwareStoreAddress(hostId: string): Promise<PosHardwareAddress | null> {
  const config = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('terminal')
    .doc('config')
    .get()
  const locationId = String(config.get('stripeLocationId') ?? '')
  if (!/^tml_[A-Za-z0-9]+$/.test(locationId)) return null
  const location = await posStripe('GET', `terminal/locations/${locationId}`)
  if (!location.ok) return null
  const address = (location.body?.address ?? {}) as Record<string, unknown>
  return posHardwareBuyerAddress({
    line1: address['line1'],
    line2: address['line2'],
    city: address['city'],
    state: address['state'],
    postalCode: address['postal_code'],
    country: address['country'],
  })
}

/** An attached in-person sale on a store, with no address for its buyer yet. */
function wantsStoreAddress(order: PosHardwareOrder | undefined): order is PosHardwareOrder {
  return Boolean(
    order &&
      posHardwareOrderSource(order) === 'in_person' &&
      order.attachment?.state === 'attached' &&
      order.attachment.hostId &&
      !order.attachment.address,
  )
}

/**
 * Gives an attached in-person sale its buyer's address from their store's
 * reader Location, with its sale record in the same transaction. Never
 * throws: a sale left without an address keeps the buyer's name, and the
 * next attach or reader set-up tries again. True when it wrote one.
 */
export async function fillPosHardwareBuyerAddress(input: { orgId: string; orderId: string }): Promise<boolean> {
  try {
    const ref = hardwareOrdersRef(input.orgId).doc(input.orderId)
    const before = (await ref.get()).data() as PosHardwareOrder | undefined
    if (!wantsStoreAddress(before)) return false
    const address = await posHardwareStoreAddress(String(before.attachment?.hostId))
    if (!address) return false
    return await firebaseAdmin
      .app()
      .firestore()
      .runTransaction(async (transaction: any) => {
        const now = (await transaction.get(ref)).data() as PosHardwareOrder | undefined
        if (!wantsStoreAddress(now) || now.attachment?.hostId !== before.attachment?.hostId) return false
        const after: PosHardwareOrder = {
          ...now,
          attachment: { ...(now.attachment as PosHardwareAttachment), address },
          updatedAtMs: Date.now(),
        }
        transaction.set(ref, after)
        transaction.set(
          posHardwareSaleRef(input.orderId),
          posHardwareSaleRecord(input.orderId, after),
          posHardwareSaleSetOptions(after),
        )
        return true
      })
  } catch (error) {
    console.error('[pos-hardware] the buyer’s store address was not recorded', input.orderId, error)
    return false
  }
}
