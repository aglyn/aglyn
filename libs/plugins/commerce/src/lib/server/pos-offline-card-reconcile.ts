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

import type { BillingWebhookHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  POS_OFFLINE_CARD_INTENT_KIND,
  posOfflineSaleKeyIsValid,
} from '../model/commerce-pos-offline'

/*==========================================
 * A CARD TAKEN OFFLINE, AS STRIPE REPORTS IT (AGL-4039).
 *
 * The Aglyn POS app creates the PaymentIntent of a card it takes offline, so
 * Stripe can know of a charge before the sale itself reaches the server: the
 * SDK forwards the card the moment a connection returns, and the sale syncs
 * right after, from the same device. Usually seconds apart. If the sale never
 * arrives (the device was lost or wiped between the two), the charge must not
 * be invisible: each event on such an intent is kept on the site, by the
 * sale's key, under the site's server-only Terminal document
 * (`terminal/config/offlineCardCharges/{saleKey}`), beside whether the sale
 * has synced. The sync itself never depends on this: it reads Stripe.
 *
 * Self-selecting: every other event returns `null` untouched. Registered on
 * the platform webhook from the commerce server module, beside the other
 * commerce handlers, rather than as a branch of the storefront sections.
 *=========================================*/

/** What the site keeps about one offline card's PaymentIntent. */
export interface PosOfflineCardChargeRecord {
  saleKey: string
  paymentIntentId: string
  status: string
  amountCents: number
  registerId: string
  livemode: boolean
  /** Whether the sale has synced (its order exists). */
  synced: boolean
  lastEvent: string
  updatedAtMs: number
}

export async function reconcilePosOfflineCardEvent(
  input: { type: string; object: any },
  firestore?: FirebaseFirestore.Firestore,
  now: () => number = Date.now,
): Promise<{ hostId: string } | null> {
  if (!input.type.startsWith('payment_intent.')) return null
  const intent = input.object ?? {}
  const metadata = (intent.metadata ?? {}) as Record<string, string>
  if (metadata['kind'] !== POS_OFFLINE_CARD_INTENT_KIND) return null
  const hostId = String(metadata['hostId'] ?? '')
  const saleKey = String(metadata['saleKey'] ?? '')
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(hostId) ||
    !posOfflineSaleKeyIsValid(saleKey)
  )
    return null
  const hostRef = (firestore ?? firebaseAdmin.app().firestore())
    .collection('hosts')
    .doc(hostId)
  const synced = (
    await hostRef.collection('posOfflineSales').doc(saleKey).get()
  ).exists
  const record: PosOfflineCardChargeRecord = {
    saleKey,
    paymentIntentId: String(intent.id ?? ''),
    status: String(intent.status ?? ''),
    amountCents: Number(intent.amount ?? 0),
    registerId: String(metadata['registerId'] ?? '').slice(0, 128),
    livemode: Boolean(intent.livemode),
    synced,
    lastEvent: input.type,
    updatedAtMs: now(),
  }
  await hostRef
    .collection('terminal')
    .doc('config')
    .collection('offlineCardCharges')
    .doc(saleKey)
    .set(record, { merge: true })
  return { hostId }
}

/** The platform webhook's handler for offline card intents: claims only its own. */
export const posOfflineCardBillingWebhookHandler: BillingWebhookHandler =
  async ({ type, object }) => {
    const reconciled = await reconcilePosOfflineCardEvent({ type, object })
    return reconciled ? { claimed: true, hostId: reconciled.hostId } : undefined
  }
