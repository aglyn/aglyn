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
  decodePosHardwareLines,
  isPosHardwareShippingMethod,
  POS_HARDWARE_CURRENCY,
  POS_HARDWARE_METADATA_TYPE,
  POS_HARDWARE_ORDER_ID,
  POS_HARDWARE_SHIPPING_LABELS,
  posHardwareSaleRecord,
  type PosHardwareAddress,
  type PosHardwareOrder,
} from '../model/pos-hardware'
import { hardwareOrdersRef, posHardwareSaleRef } from './pos-hardware'
import { raisePosHardwareOrderAlert, sendPosHardwareEmail } from './pos-hardware-notify'

/*==========================================
 * A PAID HARDWARE CHECKOUT BECOMES AN ORDER (AGL-4038).
 *
 * The platform's Stripe webhook fans every event out to the plugins' handlers
 * (`registerBillingWebhookHandler`); this one self-selects on a
 * `checkout.session.completed` whose metadata says it is a POS hardware
 * order, and writes `orgs/{orgId}/hardwareOrders/{orderId}` and, in the same
 * transaction, the retained sale record `posHardwareSales/{orderId}` that
 * outlives the workspace (see `PosHardwareSaleRecord`).
 *
 * IDEMPOTENT BY THE ORDER ID. The id was fixed when the session was made
 * (from the merchant's attempt key), and the write is a transactional
 * create: a redelivered event finds the document and does nothing, so a
 * replay never makes a second order, a second email or a second alert.
 *
 * NOTHING ON THE WIRE IS TRUSTED FOR WHAT IT NAMES. The lines are re-read
 * against the catalog; the amounts are Stripe's own totals for the session;
 * an unreadable session is logged and ignored rather than half-recorded.
 *=========================================*/

function addressFrom(raw: any): PosHardwareAddress | null {
  if (!raw || typeof raw !== 'object') return null
  const line1 = String(raw.line1 ?? '').trim()
  const city = String(raw.city ?? '').trim()
  const postalCode = String(raw.postal_code ?? '').trim()
  const country = String(raw.country ?? '').trim().toUpperCase()
  if (!line1 || !city || !postalCode || !country) return null
  const line2 = String(raw.line2 ?? '').trim()
  const state = String(raw.state ?? '').trim()
  return {
    line1: line1.slice(0, 200),
    ...(line2 ? { line2: line2.slice(0, 200) } : {}),
    city: city.slice(0, 100),
    ...(state ? { state: state.slice(0, 100) } : {}),
    postalCode: postalCode.slice(0, 20),
    country: country.slice(0, 2),
  }
}

const cents = (value: unknown): number => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

/** The order a paid session describes, or `null` when it is not readable. */
export function posHardwareOrderFromSession(
  session: any,
  now = Date.now(),
): { orderId: string; order: PosHardwareOrder } | null {
  const metadata = session?.metadata ?? {}
  if (metadata.type !== POS_HARDWARE_METADATA_TYPE) return null
  const orderId = String(metadata.orderId ?? '')
  const orgId = String(metadata.orgId ?? '')
  const hostId = String(metadata.hostId ?? '')
  if (!POS_HARDWARE_ORDER_ID.test(orderId) || !orgId || !hostId) return null
  const lines = decodePosHardwareLines(metadata.lines)
  if (!lines) return null
  const method = isPosHardwareShippingMethod(metadata.shippingMethod) ? metadata.shippingMethod : 'standard'
  // Where the newer API versions keep the shipping details, then the older.
  const shippingDetails =
    session?.collected_information?.shipping_details ?? session?.shipping_details ?? null
  const customer = session?.customer_details ?? {}
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0)
  const shippingCents =
    session?.shipping_cost?.amount_total != null
      ? cents(session.shipping_cost.amount_total)
      : cents(metadata.shippingCents)
  const taxCents = cents(session?.total_details?.amount_tax)
  const totalCents =
    session?.amount_total != null ? cents(session.amount_total) : subtotalCents + shippingCents + taxCents
  const paymentIntent = session?.payment_intent
  return {
    orderId,
    order: {
      orgId,
      hostId,
      createdBy: String(metadata.uid ?? ''),
      contactEmail: String(customer?.email ?? '').trim() || null,
      lines,
      subtotalCents,
      shipping: {
        method,
        label: POS_HARDWARE_SHIPPING_LABELS[method],
        cents: shippingCents,
        name: String(shippingDetails?.name ?? customer?.name ?? '').trim() || null,
        phone: String(customer?.phone ?? '').trim() || null,
        address: addressFrom(shippingDetails?.address),
      },
      taxCents,
      totalCents,
      currency: String(session?.currency ?? POS_HARDWARE_CURRENCY),
      stripeCheckoutSessionId: String(session?.id ?? ''),
      stripePaymentIntentId:
        (typeof paymentIntent === 'string' ? paymentIntent : String(paymentIntent?.id ?? '')) || null,
      stripeHardwareOrderId: null,
      tracking: null,
      status: 'paid',
      livemode: session?.livemode === true,
      createdAtMs: now,
      updatedAtMs: now,
      paidAtMs: now,
    },
  }
}

/**
 * Writes the order once, with its retained sale record. `created` is false
 * when a delivery already did, so the caller tells people only the first time.
 */
export async function recordPosHardwareOrder(
  orderId: string,
  order: PosHardwareOrder,
): Promise<{ created: boolean }> {
  const ref = hardwareOrdersRef(order.orgId).doc(orderId)
  const saleRef = posHardwareSaleRef(orderId)
  return firebaseAdmin
    .app()
    .firestore()
    .runTransaction(async (transaction: any) => {
      const existing = await transaction.get(ref)
      if (existing.exists) return { created: false }
      transaction.create(ref, order)
      transaction.set(saleRef, posHardwareSaleRecord(orderId, order))
      return { created: true }
    })
}

export const posHardwareBillingWebhookHandler: BillingWebhookHandler = async ({ type, object }) => {
  if (type !== 'checkout.session.completed') return
  if (object?.metadata?.type !== POS_HARDWARE_METADATA_TYPE) return
  const hostId = String(object?.metadata?.hostId ?? '')
  // A session that is not paid holds nothing to fulfil. Card is the only
  // method offered, so payment is settled when the session completes.
  if (object?.mode !== 'payment' || object?.payment_status !== 'paid') {
    return { claimed: true, ...(hostId ? { hostId } : {}) }
  }
  const parsed = posHardwareOrderFromSession(object)
  if (!parsed) {
    console.error('[pos-hardware] a paid hardware session could not be read', String(object?.id ?? ''))
    return { claimed: true, ...(hostId ? { hostId } : {}) }
  }
  // Errors here propagate on purpose: the route answers 500 and Stripe
  // redelivers, and the create above makes the retry safe.
  const { created } = await recordPosHardwareOrder(parsed.orderId, parsed.order)
  if (created) {
    await Promise.all([
      sendPosHardwareEmail('received', parsed.orderId, parsed.order),
      raisePosHardwareOrderAlert(parsed.orderId, parsed.order),
    ])
  }
  return { claimed: true, hostId: parsed.order.hostId }
}
