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

import {
  firebaseAdmin,
  hostDisplayName,
  notifyHostManagers,
  raiseOperatorAlert,
} from '@aglyn/tenant-data-admin'
import { keepAlive } from '@aglyn/tenant-data-admin/server/keep-alive'
import { COMMERCE_CHECKOUT_TAX_SETUP_REFUSED } from '../constants/operator-alerts'
import {
  type CheckoutTaxBlock,
  checkoutTaxRefusalNotice,
} from '../model/commerce-tax-readiness'

/*==========================================
 * TELLING THE OWNER A SHOPPER WAS REFUSED FOR TAX (AGL-4245)
 *
 * Checkout refuses every shopper of a store whose sales tax is not set up,
 * and until this the shopper was the only one who knew. A refusal now writes
 * one marker per store, `hosts/{hostId}/settings/taxCheckoutRefusal`, in a
 * transaction, and the raise that CREATES it tells the site's managers and
 * raises the operator alert. Every later refusal for the same reason only
 * counts, so a busy store's owner is told once, not once per shopper.
 *
 * The marker goes when the console's readiness route reads the store as no
 * longer blocked (a mode chosen, Stripe Tax on), so a store that breaks again
 * later is told again. A marker whose last refusal is older than
 * `CHECKOUT_TAX_REFUSAL_RETELL_MS` counts as a new episode too: an owner who
 * fixed it in Stripe without opening the console leaves the marker behind,
 * and it must not silence the next time.
 *=========================================*/

export const CHECKOUT_TAX_REFUSAL_DOC = 'taxCheckoutRefusal'
export const CHECKOUT_TAX_REFUSAL_RETELL_MS = 14 * 24 * 60 * 60 * 1000

/** The marker, as stored. */
export interface CheckoutTaxRefusalRecord {
  reason: CheckoutTaxBlock
  firstAtMs: number
  lastAtMs: number
  count: number
}

export interface CheckoutTaxRefusalDeps {
  firestore(): FirebaseFirestore.Firestore
  notifyManagers: typeof notifyHostManagers
  raiseAlert: typeof raiseOperatorAlert
  now(): number
}

const defaultDeps = (): CheckoutTaxRefusalDeps => ({
  firestore: () => firebaseAdmin.app().firestore(),
  notifyManagers: notifyHostManagers,
  raiseAlert: raiseOperatorAlert,
  now: () => Date.now(),
})

const markerRef = (firestore: FirebaseFirestore.Firestore, hostId: string) =>
  firestore.collection('hosts').doc(hostId).collection('settings').doc(CHECKOUT_TAX_REFUSAL_DOC)

/** Whether a refusal starts a new episode: the marker is gone, for another reason, or long quiet. */
export function isNewCheckoutTaxRefusal(
  existing: Partial<CheckoutTaxRefusalRecord> | null | undefined,
  reason: CheckoutTaxBlock,
  nowMs: number,
): boolean {
  if (!existing || existing.reason !== reason) return true
  const last = Number(existing.lastAtMs)
  return !Number.isFinite(last) || nowMs - last >= CHECKOUT_TAX_REFUSAL_RETELL_MS
}

const REASON_FOR_STAFF: Readonly<Record<CheckoutTaxBlock, string>> = {
  'tax-undecided': 'the store has not chosen how it handles sales tax',
  'stripe-tax-not-active': 'the store chose Stripe Tax and Stripe Tax is not on in its own Stripe account',
}

/**
 * Records one refused checkout and, when it starts an episode, tells the
 * site's managers and the operator. Never throws and never delays the
 * refusal: callers `void` it beside the 409 they return.
 */
export async function reportCheckoutTaxRefusal(
  hostId: string,
  reason: CheckoutTaxBlock,
  deps: CheckoutTaxRefusalDeps = defaultDeps(),
): Promise<'told' | 'counted' | 'failed'> {
  try {
    if (!hostId) return 'failed'
    const firestore = deps.firestore()
    const ref = markerRef(firestore, hostId)
    const nowMs = deps.now()
    const started = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const existing = snapshot.exists ? (snapshot.data() as Partial<CheckoutTaxRefusalRecord>) : null
      if (isNewCheckoutTaxRefusal(existing, reason, nowMs)) {
        const record: CheckoutTaxRefusalRecord = { reason, firstAtMs: nowMs, lastAtMs: nowMs, count: 1 }
        transaction.set(ref, record)
        return record
      }
      transaction.set(
        ref,
        { lastAtMs: nowMs, count: Math.max(0, Number(existing?.count) || 0) + 1 },
        { merge: true },
      )
      return null
    })
    if (!started) return 'counted'
    const notice = checkoutTaxRefusalNotice(reason)
    await deps.notifyManagers(hostId, {
      type: 'content.order',
      level: 'warning',
      title: notice.title,
      body: notice.body,
      link: `/${hostId}/products/taxes`,
    })
    const host = await firestore.collection('hosts').doc(hostId).get().catch(() => null)
    const site = host?.exists ? hostDisplayName(host.data() as Record<string, unknown>, hostId) : hostId
    await deps.raiseAlert(COMMERCE_CHECKOUT_TAX_SETUP_REFUSED, {
      dedupeKey: `${hostId}:${reason}:${started.firstAtMs}`,
      hostId,
      context: { site: `${site} (${hostId})`, reason: REASON_FOR_STAFF[reason] },
    })
    return 'told'
  } catch (error) {
    console.error('[commerce] checkout tax refusal report failed', hostId, reason, error)
    return 'failed'
  }
}

/**
 * {@link reportCheckoutTaxRefusal} for a checkout route: started beside the
 * refusal it reports and kept alive past the response, so the 409 goes out
 * at once and the report still finishes.
 */
export function tellCheckoutTaxRefusal(hostId: string, reason: CheckoutTaxBlock): void {
  void keepAlive(reportCheckoutTaxRefusal(hostId, reason))
}

/** The marker's last refusal for `reason`, or null. Never throws. */
export async function readCheckoutTaxRefusal(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<CheckoutTaxRefusalRecord | null> {
  try {
    const snapshot = await markerRef(firestore, hostId).get()
    return snapshot.exists ? (snapshot.data() as CheckoutTaxRefusalRecord) : null
  } catch {
    return null
  }
}

/** Drops the marker, so the next refusal tells the owner again. Never throws. */
export async function clearCheckoutTaxRefusal(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<void> {
  try {
    await markerRef(firestore, hostId).delete()
  } catch (error) {
    console.error('[commerce] checkout tax refusal clear failed', hostId, error)
  }
}
