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

import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import {
  isPosHardwareSkuId,
  normalizePosHardwareSerial,
  type PosHardwareInPersonConfig,
  type PosHardwareOrder,
  type PosHardwareTaxRegion,
} from '../model/pos-hardware'
import {
  inPersonPosHardwareOrder,
  posHardwareRegisterShare,
  type PosHardwareRegisterLine,
} from '../model/pos-hardware-in-person'
import { hardwareOrdersRef, posHardwareInPersonConfig, posHardwareInPersonOrderId } from './pos-hardware'
import { recordPosHardwareOrder } from './pos-hardware-webhook'
import { posStripeTestMode } from './pos-stripe'

/*==========================================
 * RECORDING A REGISTER SALE OF HARDWARE (AGL-4038).
 *
 * The platform's own store sells a card reader at its register; once the
 * sale is paid this writes the hardware order it becomes — attached to the
 * buyer's workspace when a register user attached one, PENDING on the
 * selling workspace's "To attach" list otherwise — and its retained sale
 * record, through the shop's own recorder.
 *
 * ONE SALE IS ONE ORDER. The order's id is derived from the register sale
 * (`posHardwareInPersonOrderId`) and the recorder writes it once by that id,
 * so the completion listener, a replayed webhook, an offline sync and the
 * sweep below can all reach the same sale and only the first writes.
 *
 * NOTHING IS LOST TO A FAILED LISTENER. Listeners on a completed sale are
 * logged and swallowed (the money is already taken), so the sale is marked
 * `hardwareSalePending` when it is written (`pos-hardware-sale-fields.ts`)
 * and the mark is cleared only once the order exists. The sweep records
 * every paid sale still marked, each time the To attach list is read.
 *=========================================*/

export type InPersonRecordOutcome =
  | { outcome: 'off' | 'not-seller' | 'missing' | 'not-paid' | 'no-hardware' }
  | { outcome: 'recorded' | 'already'; orderId: string; orgId: string; pending: boolean }

/** How many marked sales one sweep records at most. */
export const IN_PERSON_SWEEP_LIMIT = 25

/** Statuses after which a marked sale can never be paid, so the mark is dropped. */
const NEVER_PAID = new Set(['cancelled', 'canceled', 'voided', 'refunded', 'expired'])

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

function firestore() {
  return firebaseAdmin.app().firestore()
}

function registerOrderRef(hostId: string, orderId: string) {
  return firestore().collection('hosts').doc(hostId).collection('orders').doc(orderId)
}

/** Where the store taxes from, and its rate there, from its own tax settings. */
async function storeTax(hostId: string): Promise<{ region: PosHardwareTaxRegion | null; ratePct: number | null }> {
  const settings = await firestore().collection('hosts').doc(hostId).collection('settings').doc('store').get()
  const tax = (settings.get('tax') ?? {}) as CommerceModel.TaxSettings
  const origin = tax.origin ?? {}
  const country = text(origin.country)?.toUpperCase() ?? null
  const rate = country ? CommerceModel.resolveTaxRate(tax, origin) : null
  return {
    region: country ? { country, state: text(origin.state)?.toUpperCase() ?? null, postalCode: null } : null,
    ratePct: rate && Number.isFinite(rate.pct) ? rate.pct : null,
  }
}

/** The store owner's connected Stripe account, where the store's card money goes. */
async function storeStripeAccount(hostId: string): Promise<string | null> {
  const owner = await getOrgForHost(hostId).catch(() => null)
  const ownerUid = text((owner?.org as { ownerUid?: unknown } | undefined)?.ownerUid)
  if (!ownerUid) return null
  const profile = await firestore().collection('profiles').doc(ownerUid).get()
  return text(profile.get('stripeAccountId'))
}

/**
 * Records the hardware order of one register sale on the seller store, once.
 * Never throws for a sale that is not one: it says why it did nothing.
 */
export async function recordInPersonPosHardwareSale(
  hostId: string,
  registerOrderId: string,
  options: { offline?: boolean; config?: PosHardwareInPersonConfig | null; now?: number } = {},
): Promise<InPersonRecordOutcome> {
  const config = options.config === undefined ? posHardwareInPersonConfig() : options.config
  if (!config) return { outcome: 'off' }
  if (hostId !== config.sellerHostId) return { outcome: 'not-seller' }
  const orderRef = registerOrderRef(hostId, registerOrderId)
  const snapshot = await orderRef.get()
  if (!snapshot.exists) return { outcome: 'missing' }
  const order = snapshot.data() as CommerceModel.HostOrder & {
    paidAtMs?: number
    checkoutSessionId?: string
    customerEmail?: string | null
  }
  if (order.status !== 'paid') return { outcome: 'not-paid' }

  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : []
  const productIds = [...new Set(lineItems.map((line) => String(line.productId ?? '')).filter(Boolean))]
  const products = new Map(
    (
      await Promise.all(
        productIds.map((id) => firestore().collection('hosts').doc(hostId).collection('products').doc(id).get()),
      )
    ).map((doc: any) => [String(doc.id), doc.exists ? (doc.data() as CommerceModel.HostProduct) : null]),
  )
  const lines: PosHardwareRegisterLine[] = lineItems.map((line) => {
    const sku = products.get(String(line.productId))?.hardwareSku
    return {
      sku: isPosHardwareSkuId(sku) ? sku : null,
      quantity: Number(line.quantity),
      unitAmountCents: Number(line.unitAmountCents),
    }
  })
  const share = posHardwareRegisterShare({
    lines,
    discountCents: Number(order.totals?.discountCents ?? 0),
    taxCents: Number(order.totals?.taxCents ?? 0),
  })
  if (!share) {
    // Marked when it was rung, but no line is hardware now: nothing to record.
    if (order.hardwareSalePending) {
      await orderRef.set({ hardwareSalePending: firebaseAdmin.firestore.FieldValue.delete() }, { merge: true })
    }
    return { outcome: 'no-hardware' }
  }

  const orderId = posHardwareInPersonOrderId(hostId, registerOrderId)
  const payments = CommerceModel.orderPayments(order).filter((payment) => payment.status === 'succeeded')
  const livemodes = payments.map((payment) => payment.livemode).filter((mode): mode is boolean => typeof mode === 'boolean')
  const [tax, stripeAccountId] = await Promise.all([storeTax(hostId), storeStripeAccount(hostId)])
  const paidAtMs = Number(order.paidAtMs ?? order.createdAtMs ?? options.now ?? Date.now())
  const hardwareOrder: PosHardwareOrder = inPersonPosHardwareOrder({
    sellerHostId: config.sellerHostId,
    sellerOrgId: config.sellerOrgId,
    registerOrderId,
    number: Number.isFinite(Number(order.number)) ? Number(order.number) : null,
    registerId: text(order.registerId),
    kiosk: order.posSource === 'kiosk',
    offline: options.offline === true || Boolean((order as { offline?: unknown }).offline),
    share,
    paidAtMs,
    tenders: payments.map((payment) => payment.method),
    paymentLinkSessionId:
      text(payments.find((payment) => payment.checkoutSessionId)?.checkoutSessionId) ?? text(order.checkoutSessionId),
    receiptEmail: text(order.customerEmail)?.toLowerCase() ?? null,
    buyer: order.hardwareBuyer,
    termsAcceptance: order.hardwareTermsAcceptance,
    serials: (Array.isArray(order.hardwareSerials) ? order.hardwareSerials : [])
      .map(normalizePosHardwareSerial)
      .filter(Boolean),
    taxRegion: tax.region,
    ratePct: tax.ratePct,
    stripeAccountId,
    // A card payment says which mode it was in; a cash sale takes the
    // deployment's, so a test deployment's booth is never a real sale.
    livemode: livemodes.length ? livemodes.every(Boolean) : !posStripeTestMode(),
    currency: String((order as { currency?: unknown }).currency ?? 'usd').toLowerCase(),
  })

  const { created } = await recordPosHardwareOrder(orderId, hardwareOrder)
  // The mark comes off once the order exists, by this call or an earlier one.
  await orderRef.set(
    { hardwareOrderId: orderId, hardwareSalePending: firebaseAdmin.firestore.FieldValue.delete() },
    { merge: true },
  )
  // A buyer with no account, named at the register while the sale was open,
  // is invited to sign up now that there is an order to point them at.
  if (created && hardwareOrder.attachment?.state === 'pending' && hardwareOrder.attachment.email) {
    await (await import('./pos-hardware-attach')).invitePendingBuyer(orderId, hardwareOrder.orgId, hardwareOrder)
  }
  return {
    outcome: created ? 'recorded' : 'already',
    orderId,
    orgId: hardwareOrder.orgId,
    pending: hardwareOrder.attachment?.state === 'pending',
  }
}

/**
 * Records every paid sale on the seller store that is still marked, at most
 * {@link IN_PERSON_SWEEP_LIMIT} a time, and drops the mark from a sale that
 * can no longer be paid. Never throws: a sale it cannot record stays marked
 * for the next sweep.
 */
export async function sweepInPersonPosHardwareSales(
  config: PosHardwareInPersonConfig | null = posHardwareInPersonConfig(),
): Promise<{ recorded: number; failed: number }> {
  if (!config) return { recorded: 0, failed: 0 }
  const marked = await firestore()
    .collection('hosts')
    .doc(config.sellerHostId)
    .collection('orders')
    .where('hardwareSalePending', '==', true)
    .limit(IN_PERSON_SWEEP_LIMIT)
    .get()
  let recorded = 0
  let failed = 0
  for (const doc of marked.docs as Array<{ id: string; ref: any; get: (field: string) => unknown }>) {
    const status = String(doc.get('status') ?? '')
    try {
      if (NEVER_PAID.has(status)) {
        await doc.ref.set({ hardwareSalePending: firebaseAdmin.firestore.FieldValue.delete() }, { merge: true })
        continue
      }
      if (status !== 'paid') continue
      const outcome = await recordInPersonPosHardwareSale(config.sellerHostId, String(doc.id), { config })
      if (outcome.outcome === 'recorded') recorded += 1
    } catch (error) {
      failed += 1
      console.error('[pos-hardware-in-person] a marked sale could not be recorded', doc.id, error)
    }
  }
  return { recorded, failed }
}

/** The "To attach" list: the selling workspace's pending in-person orders, newest first. */
export async function pendingInPersonPosHardwareOrders(
  config: PosHardwareInPersonConfig,
  limit = 50,
): Promise<Array<{ id: string; order: PosHardwareOrder }>> {
  const snapshot = await hardwareOrdersRef(config.sellerOrgId)
    .where('attachment.state', '==', 'pending')
    .orderBy('createdAtMs', 'desc')
    .limit(limit)
    .get()
  return snapshot.docs.map((doc: any) => ({ id: String(doc.id), order: doc.data() as PosHardwareOrder }))
}

/**
 * What the completion listener runs for a sale on the seller store. Never
 * throws into a sale: a failure is logged and the sale stays marked for the
 * sweep.
 */
export async function recordCompletedSaleHardware(event: {
  hostId: string
  orderId: string
  offline?: boolean
}): Promise<void> {
  try {
    await recordInPersonPosHardwareSale(event.hostId, event.orderId, { offline: event.offline === true })
  } catch (error) {
    console.error('[pos-hardware-in-person] sale not recorded; the sweep will', event.orderId, error)
  }
}
