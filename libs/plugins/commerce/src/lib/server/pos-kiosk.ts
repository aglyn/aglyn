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

import { createHmac, timingSafeEqual } from 'crypto'
import * as Aglyn from '@aglyn/aglyn/server'
import type { PluginApiHandler, PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { pluginSmsAvailable } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import {
  consumeRateLimit,
  firebaseAdmin,
  getLockdownVerdict,
  getOrgForHost,
  getPluginConfig,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import * as CommerceModel from '../model'
import { posRegisterSettings, type PosRegisterSettings } from '../plugin-config'
import { posKioskSettings, type PosKioskSettings } from '../pos-kiosk-config'
import { verifyMemberPassword } from './membership'
import { authorizePosStaff, posIdempotencyKey, posQueryBody, posRequestBody, type PosStaff } from './pos-auth'
import {
  displayBranding,
  displayToken,
  posDisplayCurrency,
  resolveDisplayToken,
  type PosDeviceToken,
} from './pos-display'
import { withPosKioskPrincipal } from './pos-kiosk-principal'
import { posOrderHandler } from './pos-order'
import { recordReceiptChoice, voidPosSale } from './pos-payment'
import { posPaymentId, posSaleSummary, readPosSale, type PosLiftedOrder } from './pos-sale'
import { posStripeTestMode, posTerminalAvailable } from './pos-stripe'
import {
  cancelPosCardPayment,
  createCardPresentIntent,
  createPosTerminalConnectionToken,
  refreshPosCardPayment,
  simulatePosReaderTap,
  startCardPresentPayment,
} from './pos-terminal'

/*==========================================
 * THE SELF-SERVICE KIOSK (AGL-3623): `/api/commerce/pos-kiosk`.
 *
 * ## Who is asking
 *
 * A kiosk is a register's paired screen with `mode: 'kiosk'` — the same
 * six-digit code and hashed device token as the customer display
 * (`pos-display.ts`), so pairing is one trust path, not two. It holds no
 * staff session. Every device action carries the token, and the gate below
 * re-checks, on every call, that the staff member whose code paired it may
 * still work this register (`admin`/`editor` on the site, `managePos`), that
 * the plan still includes POS, and that no lockdown covers them, the org or
 * the site. Demote them and the kiosk stops on its next tap.
 *
 * ## What it can reach
 *
 * Its own register's catalog, the orders IT opened (`kioskDeviceId`), and
 * nothing else: no staff names, no other customer's order, no register
 * state. A customer's email or phone goes straight onto their own order as
 * the receipt request and is never echoed back.
 *
 * ## Money
 *
 * The cart is priced by the register's own sale route (`pos-order.ts`), in
 * process, as an OPEN sale — the same tax, automatic promotions, platform
 * fee and idempotency as a cashier's sale, and none of a cashier's
 * discretion: no discount, no code, no customer, no stay. The amount a card
 * pays is always the server's balance; the kiosk names only a tip choice,
 * which is recomputed here from the store's own presets. Card payments are
 * the register's Stripe Terminal flow (AGL-3607) unchanged, and they stay
 * behind `STRIPE_TERMINAL_LIVE_ENABLED` exactly as the register's do.
 *
 * ## Staff
 *
 * `queue` and `take` are the register's: signed in and gated like a sale.
 * A queued ("pay at counter") order is an open sale like any other, and the
 * register takes payment on it through `commerce/pos-payment`.
 *=========================================*/

type Outcome = { status: number; body: Record<string, unknown> }

const DEVICE_READS = new Set(['context', 'catalog', 'sale'])
const STAFF_READS = new Set(['queue'])

interface KioskGate {
  device: PosDeviceToken
  /** The token hash prefix the kiosk's orders carry. */
  deviceId: string
  hostId: string
  registerId: string
  hostRef: FirebaseFirestore.DocumentReference
  /** The staff member who paired the kiosk; what it acts as. */
  uid: string
  orgId: string
  org: Record<string, any> | null
  register: Record<string, any>
  settings: PosRegisterSettings
  kiosk: PosKioskSettings
}

/** The prefix of a token row's id a kiosk's orders are stamped with. */
export function posKioskDeviceId(device: PosDeviceToken): string {
  return String(device.ref?.id ?? '').slice(0, 16)
}

function refuse(status: number, error: string): Outcome {
  return { status, body: { error } }
}

/** The kiosk's gate, asked again on every call. */
async function authorizeKiosk(
  req: PluginApiRequest,
  body: Record<string, any>,
  write: boolean,
): Promise<KioskGate | Outcome> {
  const device = await resolveDisplayToken(displayToken(req, body))
  if (!device) return refuse(401, 'This kiosk is not paired.')
  if (device.mode !== 'kiosk') return refuse(403, 'This device is a customer display, not a kiosk.')
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(device.hostId)
  const [host, register] = await Promise.all([
    hostRef.get(),
    hostRef.collection('registers').doc(device.registerId).get(),
  ])
  if (!host.exists || !register.exists) return refuse(401, 'This kiosk is not paired.')
  const role = (host.get('memberRoles') ?? {})[device.createdBy]
  const membership = device.createdBy
    ? await resolveOrgPermissions(device.createdBy, { hostId: device.hostId })
    : null
  if ((role !== 'admin' && role !== 'editor') || !membership?.permissions?.managePos) {
    return refuse(403, 'This kiosk needs a staff member to pair it again.')
  }
  const owner = await getOrgForHost(device.hostId)
  if (!Aglyn.checkEntitlement(owner?.org as any, 'pos')) {
    return refuse(403, 'This kiosk is not available. Please order at the counter.')
  }
  const locked = await getLockdownVerdict({
    uid: device.createdBy,
    org: owner?.org as never,
    host: host.data() as never,
    intent: write ? 'write' : 'read',
  })
  if (locked) return { status: 423, body: { error: 'This kiosk is paused. Please order at the counter.', locked: true } }
  const orgId = String(owner?.org?.id ?? owner?.orgId ?? '')
  const config = await getPluginConfig(orgId || undefined, 'commerce', { hostId: device.hostId }).catch(
    () => ({}),
  )
  return {
    device,
    deviceId: posKioskDeviceId(device),
    hostId: device.hostId,
    registerId: device.registerId,
    hostRef,
    uid: device.createdBy,
    orgId,
    org: (owner?.org as Record<string, any>) ?? null,
    register: (register.data() ?? {}) as Record<string, any>,
    settings: posRegisterSettings(config),
    kiosk: posKioskSettings(config),
  }
}

/** One durable budget per kiosk and action; refused requests do nothing. */
async function withinBudget(gate: KioskGate, action: string, limit: number): Promise<boolean> {
  const rate = await consumeRateLimit(`pos-kiosk:${action}:${gate.deviceId}`, {
    limit,
    windowMs: 10 * 60 * 1000,
  })
  return rate.allowed
}

/** The register's card readers, when Terminal is switched on. */
async function registerReaders(gate: KioskGate): Promise<Array<{ id: string; label: string; status: string }>> {
  if (!posTerminalAvailable()) return []
  const snapshot = await gate.hostRef
    .collection('terminalReaders')
    .where('registerId', '==', gate.registerId)
    .limit(10)
    .get()
  return snapshot.docs.map((doc: any) => ({
    id: String(doc.id),
    label: String(doc.get('label') ?? 'Card reader'),
    status: String(doc.get('status') ?? 'offline'),
  }))
}

/** The reader this kiosk sends cards to: the one chosen in its settings, else the register's only one. */
async function kioskReaderId(gate: KioskGate): Promise<string | null> {
  const readers = await registerReaders(gate)
  const chosen = String(gate.device.data['kioskReaderId'] ?? '')
  if (chosen && readers.some((reader) => reader.id === chosen)) return chosen
  return readers.length === 1 ? readers[0]!.id : null
}

/** The receipt choices this kiosk can honor. */
async function receiptChannels(gate: KioskGate): Promise<CommerceModel.PosReceiptChannel[]> {
  const channels: CommerceModel.PosReceiptChannel[] = ['email']
  if (pluginSmsAvailable()) channels.push('sms')
  // Printed on the register's own receipt printer, so offered only when it has one.
  const printers = await gate.hostRef
    .collection('printers')
    .where('registerId', '==', gate.registerId)
    .limit(1)
    .get()
    .catch(() => null)
  if (printers && !printers.empty) channels.push('print')
  channels.push('none')
  return channels
}

async function context(gate: KioskGate): Promise<Outcome> {
  const [branding, currency, reader, receipts] = await Promise.all([
    displayBranding(gate.hostId),
    posDisplayCurrency(gate.hostId),
    kioskReaderId(gate),
    receiptChannels(gate),
  ])
  const value: CommerceModel.PosKioskContext = {
    branding: { ...branding, message: gate.kiosk.welcome || 'Order here' },
    currency,
    tipping: { enabled: gate.settings.tippingEnabled, percentages: gate.settings.tipPercentages },
    payments: {
      reader: Boolean(reader),
      cardPresent: posTerminalAvailable(),
      payAtCounter: gate.kiosk.payAtCounter,
    },
    receipts,
    offerMarketing: gate.settings.displayMarketingOptIn,
    idleSeconds: gate.kiosk.idleSeconds,
    testMode: posStripeTestMode(),
  }
  return { status: 200, body: value as unknown as Record<string, unknown> }
}

/**
 * Whether a product may be sold at a kiosk at all: what the register sells,
 * less what a customer cannot be handed at a counter — a subscription-only
 * product, a gift card whose code needs issuing, and a digital download.
 */
export function posKioskSellable(product: CommerceModel.HostProduct): boolean {
  if (product.status !== 'active') return false
  if (product.subscription && !product.subscriptionOptional) return false
  if (product.giftCard) return false
  if (product.type === 'digital') return false
  return (product.variants ?? []).some((variant) => CommerceModel.variantHasPrice(variant))
}

/** A product as the kiosk may show it: names, prices and choices, nothing else. */
export function posKioskProduct(
  id: string,
  product: CommerceModel.HostProduct,
  hostId: string,
): CommerceModel.PosKioskProduct {
  const image = resolveMediaSrc(product.mediaUrls?.[0], { hostId })
  const description = String(product.description ?? '').trim().slice(0, 280)
  return {
    id,
    name: String(product.name ?? '').slice(0, 120),
    ...(description ? { description } : {}),
    ...(image ? { imageUrl: image } : {}),
    categoryIds: (product.categoryIds ?? []).slice(0, 20),
    options: (product.options ?? []).map((option) => ({ name: option.name, values: [...option.values] })),
    variants: (product.variants ?? [])
      .filter((variant) => CommerceModel.variantHasPrice(variant))
      .map((variant) => ({
        id: variant.id,
        options: { ...(variant.options ?? {}) },
        priceCents: Math.round(Number(variant.priceUsd) * 100),
        soldOut: Boolean(CommerceModel.stockShortfall(product, variant.id, 1)),
      })),
    modifierGroups: CommerceModel.productModifierGroups(product),
  }
}

async function catalog(gate: KioskGate, body: Record<string, any>): Promise<Outcome> {
  const categoryId = String(body['categoryId'] ?? '')
  if (categoryId && !/^[A-Za-z0-9_-]{1,128}$/.test(categoryId)) return refuse(400, 'Unknown category')
  // The register grid's query (AGL-3321): live, active, by name — and a
  // category is a clause on the query, never a filter over what was read.
  let query: FirebaseFirestore.Query = gate.hostRef
    .collection('products')
    .where('deletedAt', '==', null)
    .where('status', '==', 'active')
  if (categoryId) query = query.where('categoryIds', 'array-contains', categoryId)
  const [products, categories, currency] = await Promise.all([
    query.orderBy('nameLower').limit(CommerceModel.POS_KIOSK_CATALOG_LIMIT).get(),
    gate.hostRef.collection('productCategories').limit(30).get(),
    posDisplayCurrency(gate.hostId),
  ])
  const value: CommerceModel.PosKioskCatalog = {
    products: products.docs
      .map((doc: any) => ({ id: String(doc.id), product: CommerceModel.liftLegacyProduct(doc.data()) }))
      .filter(({ product }) => posKioskSellable(product))
      .map(({ id, product }) => posKioskProduct(id, product, gate.hostId)),
    categories: categories.docs.map((doc: any) => ({
      id: String(doc.id),
      name: String(doc.get('name') ?? 'Category').slice(0, 60),
    })),
    currency,
  }
  return { status: 200, body: value as unknown as Record<string, unknown> }
}

/** An order as its kiosk reads it back; null for any order this kiosk did not open. */
export function posKioskSaleView(
  order: PosLiftedOrder | null,
  deviceId: string,
): CommerceModel.PosKioskSale | null {
  if (!order || order.posSource !== 'kiosk' || order.kioskDeviceId !== deviceId) return null
  const summary = posSaleSummary(order)
  const status: CommerceModel.PosKioskSaleStatus =
    order.status === 'paid'
      ? 'paid'
      : order.status === 'pending'
        ? order.kioskQueueRegisterId
          ? 'queued'
          : 'open'
        : 'voided'
  const card = [...summary.payments]
    .reverse()
    .find((payment) => CommerceModel.isCardPaymentMethod(payment.method))
  return {
    orderId: order.$id,
    number: Number(order.number ?? 0),
    status,
    lines: (order.lineItems ?? []).map((line) => ({
      name: line.name,
      ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
      quantity: line.quantity,
      amountCents: line.unitAmountCents * line.quantity,
    })),
    itemsCents: Number(order.totals?.itemsCents ?? 0),
    discountCents: Number(order.totals?.discountCents ?? 0),
    taxCents: Number(order.totals?.taxCents ?? 0),
    totalCents: summary.totalCents,
    tipCents: summary.tipCents,
    paidCents: summary.paidCents,
    dueCents: summary.dueCents,
    payment: card
      ? {
          id: card.id,
          status: card.status,
          ...(card.failureMessage ? { failureMessage: card.failureMessage } : {}),
        }
      : null,
  }
}

/** This kiosk's order, or a refusal that says nothing about anyone else's. */
async function readOwnSale(
  gate: KioskGate,
  rawOrderId: unknown,
): Promise<{ order: PosLiftedOrder; view: CommerceModel.PosKioskSale } | Outcome> {
  const orderId = String(rawOrderId ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) return refuse(404, 'Unknown order')
  const order = await readPosSale(gate.hostId, orderId)
  const view = posKioskSaleView(order, gate.deviceId)
  if (!order || !view) return refuse(404, 'Unknown order')
  return { order, view }
}

/** The response the in-process sale route wrote. */
function recorder() {
  const result = { status: 500, body: {} as Record<string, any> }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(value: unknown) {
      result.body = (value ?? {}) as Record<string, any>
    },
    send() {},
    setHeader() {},
    redirect() {},
    end() {},
  } as unknown as PluginApiResponse
  return { res, result }
}

async function checkout(
  gate: KioskGate,
  req: PluginApiRequest,
  body: Record<string, any>,
): Promise<Outcome> {
  const attemptKey = posIdempotencyKey(req)
  if (!attemptKey) return refuse(400, 'Missing Idempotency-Key')
  const cart = CommerceModel.sanitizePosKioskLines(body['lines'])
  if ('error' in cart) return refuse(400, cart.error)
  if (!(await withinBudget(gate, 'checkout', 40))) {
    return refuse(429, 'Too many orders from this kiosk. Please order at the counter.')
  }
  // What a customer may buy here, read from the product documents before
  // anything is priced: the sale route warns a cashier about stock and sells
  // anyway (the goods are in their hand); a kiosk refuses what is sold out.
  const ids = [...new Set(cart.lines.map((line) => line.productId))]
  const snapshots = await Promise.all(ids.map((id) => gate.hostRef.collection('products').doc(id).get()))
  const products = new Map(
    snapshots.map((snapshot: any) => [
      String(snapshot.id),
      snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data()) : null,
    ]),
  )
  for (const line of cart.lines) {
    const product = products.get(line.productId)
    if (!product || (product as { deletedAt?: unknown }).deletedAt || !posKioskSellable(product)) {
      return refuse(409, 'An item in your cart is no longer available. Remove it and try again.')
    }
    const variant = line.variantId
      ? product.variants.find((candidate) => candidate.id === line.variantId)
      : product.variants[0]
    if (!variant || !CommerceModel.variantHasPrice(variant)) {
      return refuse(409, `${product.name} is no longer available. Remove it and try again.`)
    }
    const wanted = cart.lines
      .filter((other) => other.productId === line.productId && (other.variantId ?? '') === (line.variantId ?? ''))
      .reduce((sum, other) => sum + other.quantity, 0)
    if (CommerceModel.stockShortfall(product, variant.id, wanted)) {
      return refuse(409, `${product.name} is sold out. Remove it and try again.`)
    }
  }
  const { res, result } = recorder()
  const priced = withPosKioskPrincipal(
    {
      method: 'POST',
      headers: { 'idempotency-key': `kiosk:${gate.deviceId}:${attemptKey}` },
      query: {},
      cookies: {},
      socket: req.socket,
      body: {
        hostId: gate.hostId,
        registerId: gate.registerId,
        payment: 'open',
        lines: cart.lines,
        ...(typeof gate.register['locationId'] === 'string' && gate.register['locationId']
          ? { locationId: gate.register['locationId'] }
          : {}),
      },
    } as PluginApiRequest,
    { uid: gate.uid, registerId: gate.registerId, deviceId: gate.deviceId },
  )
  await posOrderHandler(priced, res)
  if (result.status !== 200 || !result.body['orderId']) {
    // A refusal about a product names it, and the customer can fix it. One
    // about the store — a shift, the tax setup, the plan — is the staff's to
    // fix, and the customer is sent to the counter.
    console.warn('[pos-kiosk] sale refused', gate.hostId, result.status, result.body['error'])
    if (result.status === 400 && result.body['error']) return refuse(400, String(result.body['error']))
    return refuse(
      result.status === 429 ? 429 : 409,
      'This kiosk cannot take orders right now. Please order at the counter.',
    )
  }
  const own = await readOwnSale(gate, result.body['orderId'])
  if ('status' in own) return own
  if (own.view.totalCents <= 0) {
    // Nothing to take a card for, and nothing a kiosk should hand out free.
    await voidPosSale(kioskStaff(gate), own.order.$id).catch(() => undefined)
    return refuse(409, 'Please ask at the counter for this order.')
  }
  return { status: 200, body: { sale: own.view } }
}

/** The kiosk, as the register's payment helpers expect the person at the till. */
function kioskStaff(gate: KioskGate): PosStaff {
  return { uid: gate.uid, hostId: gate.hostId, orgId: gate.orgId, org: gate.org }
}

async function pay(gate: KioskGate, req: PluginApiRequest, body: Record<string, any>): Promise<Outcome> {
  const attemptKey = posIdempotencyKey(req)
  if (!attemptKey) return refuse(400, 'Missing Idempotency-Key')
  const method = String(body['method'] ?? '')
  if (method !== 'reader' && method !== 'tap') return refuse(400, 'Choose how to pay.')
  if (!posTerminalAvailable()) return refuse(409, 'Card payments are not available on this kiosk.')
  if (!(await withinBudget(gate, 'pay', 60))) return refuse(429, 'Too many tries. Please pay at the counter.')
  const own = await readOwnSale(gate, body['orderId'])
  if ('status' in own) return own
  if (own.view.status !== 'open') return refuse(409, 'This order is no longer waiting for payment.')
  const paymentId = posPaymentId(own.order.$id, `kiosk:${attemptKey}`)
  // A retried press finds the payment its first press reserved, for the
  // amount and tip that press chose: the reservation is already out of the
  // balance, so the balance alone would read as nothing left to pay.
  const pressed = CommerceModel.orderPayments(own.order).find((payment) => payment.id === paymentId)
  const amountCents = pressed ? pressed.amountCents : posSaleSummary(own.order).tenderableCents
  if (!(amountCents > 0)) return refuse(409, 'Nothing is left to pay on this order.')
  const tipCents = pressed ? Number(pressed.tipCents ?? 0) : CommerceModel.posKioskTipCents(body['tipChoice'], {
    baseCents: amountCents,
    enabled: gate.settings.tippingEnabled,
    percentages: gate.settings.tipPercentages,
    percent: body['tipPercent'],
    cents: body['tipCents'],
  })
  if (tipCents === null) return refuse(400, 'Choose one of the tips shown, or no tip.')
  const start = {
    hostId: gate.hostId,
    orderId: own.order.$id,
    paymentId,
    amountCents,
    tipCents,
    cashierId: gate.uid,
    org: gate.org,
  }
  let outcome: Awaited<ReturnType<typeof createCardPresentIntent>>
  if (method === 'reader') {
    const readerId = await kioskReaderId(gate)
    if (!readerId) return refuse(409, 'No card reader is set up for this kiosk. Please pay at the counter.')
    // The kiosk asked for the tip on its own screen: the reader must not ask again.
    outcome = await startCardPresentPayment({
      ...start,
      readerId,
      settings: { ...gate.settings, tippingEnabled: false },
    })
  } else {
    // Tap to Pay: collected by the native POS app's Stripe Terminal SDK
    // against this server-made intent (AGL-3618), settled like any reader.
    outcome = await createCardPresentIntent(start)
  }
  if ('error' in outcome) return refuse(outcome.status, outcome.error)
  const view = posKioskSaleView(outcome.order, gate.deviceId)
  return {
    status: 200,
    body: {
      sale: view,
      ...(outcome.payment ? { paymentId: outcome.payment.id } : {}),
      ...(outcome.clientSecret ? { clientSecret: outcome.clientSecret } : {}),
      ...(outcome.paymentIntentId ? { paymentIntentId: outcome.paymentIntentId } : {}),
    },
  }
}

/** A card payment on this kiosk's own order: refreshed, canceled or (test mode) tapped. */
async function cardStep(
  gate: KioskGate,
  body: Record<string, any>,
  step: 'payment-status' | 'cancel-payment' | 'simulate',
): Promise<Outcome> {
  if (!(await withinBudget(gate, 'card', 900))) return refuse(429, 'Too many tries. Wait a moment.')
  const own = await readOwnSale(gate, body['orderId'])
  if ('status' in own) return own
  const paymentId = String(body['paymentId'] ?? '')
  if (!own.order.payments?.some((payment) => payment.id === paymentId)) return refuse(404, 'Unknown payment')
  const ref = { hostId: gate.hostId, orderId: own.order.$id, paymentId }
  let outcome
  if (step === 'payment-status') outcome = await refreshPosCardPayment(ref)
  else if (step === 'cancel-payment') outcome = await cancelPosCardPayment(ref)
  else {
    if (!posStripeTestMode()) return refuse(404, 'Unknown action')
    outcome = await simulatePosReaderTap({ ...ref, cardNumber: String(body['cardNumber'] ?? '') })
  }
  if ('error' in outcome) return refuse(outcome.status, outcome.error)
  return { status: 200, body: { sale: posKioskSaleView(outcome.order, gate.deviceId) } }
}

/** "Pay at counter": the order joins the register's queue with its number. */
async function sendToCounter(gate: KioskGate, body: Record<string, any>): Promise<Outcome> {
  if (!gate.kiosk.payAtCounter) return refuse(409, 'Please pay here with a card.')
  if (!(await withinBudget(gate, 'counter', 40))) return refuse(429, 'Too many orders from this kiosk.')
  const own = await readOwnSale(gate, body['orderId'])
  if ('status' in own) return own
  if (own.view.status === 'queued') return { status: 200, body: { sale: own.view } }
  const ref = gate.hostRef.collection('orders').doc(own.order.$id)
  const firestore = firebaseAdmin.app().firestore()
  // In a transaction: a card that settled between the customer's two taps
  // leaves a paid order, which never joins a queue.
  const queued = await firestore.runTransaction(async (transaction: any) => {
    const fresh = await transaction.get(ref)
    if (!fresh.exists || fresh.get('status') !== 'pending') return false
    const payments = CommerceModel.orderPayments(fresh.data() as any)
    if (payments.some((payment) => payment.status === 'pending' || payment.status === 'succeeded')) {
      return false
    }
    transaction.set(
      ref,
      {
        kioskQueueRegisterId: gate.registerId,
        kioskQueuedAtMs: Date.now(),
        timeline: CommerceModel.appendOrderEvent(
          { ...(fresh.data() as any) },
          'pos-kiosk-pay-at-counter',
          'Sent to the counter from the self-service kiosk',
        ),
      },
      { merge: true },
    )
    return true
  })
  if (!queued) return refuse(409, 'This order is already being paid. Check the screen.')
  const after = await readOwnSale(gate, own.order.$id)
  if ('status' in after) return after
  return { status: 200, body: { sale: after.view } }
}

async function receipt(gate: KioskGate, body: Record<string, any>): Promise<Outcome> {
  if (!(await withinBudget(gate, 'receipt', 40))) return refuse(429, 'Too many tries.')
  const own = await readOwnSale(gate, body['orderId'])
  if ('status' in own) return own
  if (own.view.status !== 'paid') return refuse(409, 'Your receipt is ready once your order is paid.')
  const channel = String(body['channel'] ?? '') as CommerceModel.PosReceiptChannel
  if (!(await receiptChannels(gate)).includes(channel)) return refuse(400, 'Choose a receipt shown on the screen.')
  const outcome = await recordReceiptChoice(kioskStaff(gate), own.order.$id, {
    channel,
    to: body['to'],
    marketingOptIn: gate.settings.displayMarketingOptIn && body['marketingOptIn'] === true,
  })
  if ('error' in outcome) return refuse(outcome.status, outcome.error)
  // The address is on the order now; nothing of it comes back to the screen.
  return { status: 200, body: { ok: true } }
}

/**
 * The idle reset and "Start over": an order this kiosk opened and nobody
 * paid is voided, so it holds no promotion slot and no stock. A queued or
 * paid order is left exactly as it is.
 */
async function abandon(gate: KioskGate, body: Record<string, any>): Promise<Outcome> {
  const own = await readOwnSale(gate, body['orderId'])
  if ('status' in own) return own
  if (own.view.status !== 'open') return { status: 200, body: { sale: own.view } }
  // Money that already moved is the counter's to settle, never a screen's
  // to refund on its own.
  if (CommerceModel.orderPayments(own.order).some((payment) => payment.status === 'succeeded')) {
    return { status: 200, body: { sale: own.view } }
  }
  const outcome = await voidPosSale(kioskStaff(gate), own.order.$id)
  if ('error' in outcome) return refuse(outcome.status, outcome.error)
  return { status: 200, body: { sale: posKioskSaleView(outcome.order, gate.deviceId) } }
}

/*==========================================
 * STAFF UNLOCK.
 *
 * The register's staff PINs (AGL-3609), checked on the server: a PIN at a
 * kiosk unlocks its settings — choosing the card reader, leaving kiosk mode
 * — for a few minutes. A kiosk faces the public, so it shows no roster of
 * names; the PIN alone is checked against every member of the site who may
 * work the register. The attempt is claimed on the device's own token row
 * BEFORE any PIN is checked, so a burst of guesses gets
 * POS_KIOSK_UNLOCK_MAX_ATTEMPTS in the lockout window and no more, and a
 * member whose own PIN is locked at the register cannot unlock a kiosk
 * either.
 *=========================================*/

function unlockSecret(): string {
  const secret = process.env['TOKEN_SIGNING_SECRET']
  if (!secret) throw new Error('TOKEN_SIGNING_SECRET is not configured')
  return secret
}

function signUnlock(payload: string): string {
  return createHmac('sha256', unlockSecret()).update(`pos-kiosk-unlock:${payload}`).digest('hex')
}

/** A short-lived, signed "staff unlocked THIS kiosk". */
export function mintPosKioskUnlock(deviceId: string, memberUid: string, nowMs: number): {
  unlock: string
  expiresAtMs: number
} {
  const expiresAtMs = nowMs + CommerceModel.POS_KIOSK_UNLOCK_TTL_MS
  const payload = Buffer.from(JSON.stringify({ v: 1, d: deviceId, u: memberUid, e: expiresAtMs })).toString(
    'base64url',
  )
  return { unlock: `${payload}.${signUnlock(payload)}`, expiresAtMs }
}

/** The member a valid unlock names for this kiosk, or null. */
export function readPosKioskUnlock(token: unknown, deviceId: string, nowMs: number): string | null {
  const value = typeof token === 'string' ? token.trim() : ''
  const dot = value.lastIndexOf('.')
  if (dot <= 0 || value.length > 1000) return null
  const payload = value.slice(0, dot)
  let expected: string
  try {
    expected = signUnlock(payload)
  } catch {
    return null
  }
  const a = Buffer.from(value.slice(dot + 1))
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(new Uint8Array(a), new Uint8Array(b))) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (claims?.v !== 1 || claims.d !== deviceId || typeof claims.u !== 'string' || !(Number(claims.e) > nowMs)) {
      return null
    }
    return claims.u
  } catch {
    return null
  }
}

/** Whether a member may still unlock: their role and `managePos` today. */
async function mayUnlock(gate: KioskGate, memberUid: string): Promise<boolean> {
  const host = await gate.hostRef.get()
  const role = (host.get('memberRoles') ?? {})[memberUid]
  if (role !== 'admin' && role !== 'editor') return false
  const membership = await resolveOrgPermissions(memberUid, { hostId: gate.hostId })
  return membership?.permissions?.managePos === true
}

async function unlock(gate: KioskGate, req: PluginApiRequest, body: Record<string, any>): Promise<Outcome> {
  const pin = String(body['pin'] ?? '')
  if (!/^\d{4,6}$/.test(pin)) return refuse(400, 'Enter your staff PIN.')
  const address = String(req.socket?.remoteAddress ?? '') || 'no-address'
  const rate = await consumeRateLimit(`pos-kiosk-unlock:${address}`, { limit: 20, windowMs: 15 * 60 * 1000 })
  if (!rate.allowed) return refuse(429, 'Too many tries. Wait a few minutes and try again.')
  try {
    unlockSecret()
  } catch {
    return refuse(501, 'Staff PINs are not configured on this server.')
  }
  const firestore = firebaseAdmin.app().firestore()
  const now = Date.now()
  const claim = await firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(gate.device.ref)
    if (!snapshot.exists) return { kind: 'gone' as const }
    const lockedUntilMs = Number(snapshot.get('kioskUnlockLockedUntilMs') ?? 0)
    if (lockedUntilMs > now) return { kind: 'locked' as const, lockedUntilMs }
    const failed = lockedUntilMs ? 0 : Number(snapshot.get('kioskUnlockFailures') ?? 0)
    if (failed >= CommerceModel.POS_KIOSK_UNLOCK_MAX_ATTEMPTS) {
      const until = now + CommerceModel.POS_KIOSK_UNLOCK_LOCKOUT_MS
      transaction.update(gate.device.ref, { kioskUnlockLockedUntilMs: until, kioskUnlockFailures: 0 })
      return { kind: 'locked' as const, lockedUntilMs: until }
    }
    transaction.update(gate.device.ref, { kioskUnlockFailures: failed + 1, kioskUnlockLockedUntilMs: null })
    return { kind: 'claimed' as const, attempt: failed + 1 }
  })
  if (claim.kind === 'gone') return refuse(401, 'This kiosk is not paired.')
  if (claim.kind === 'locked') {
    return { status: 423, body: { error: 'Too many wrong PINs. Try again later.', lockedUntilMs: claim.lockedUntilMs } }
  }
  const host = await gate.hostRef.get()
  const roles = (host.get('memberRoles') ?? {}) as Record<string, string>
  const pins = await gate.hostRef.collection('posStaffPins').limit(50).get()
  let matched = ''
  for (const doc of pins.docs) {
    const uid = String(doc.id)
    if (roles[uid] !== 'admin' && roles[uid] !== 'editor') continue
    if (Number(doc.get('lockedUntilMs') ?? 0) > now) continue
    const hash = String(doc.get('pinScrypt') ?? '')
    if (hash && verifyMemberPassword(pin, hash)) {
      matched = uid
      break
    }
  }
  if (!matched || !(await mayUnlock(gate, matched))) {
    const left = CommerceModel.POS_KIOSK_UNLOCK_MAX_ATTEMPTS - claim.attempt
    if (left <= 0) {
      await gate.device.ref.update({
        kioskUnlockLockedUntilMs: now + CommerceModel.POS_KIOSK_UNLOCK_LOCKOUT_MS,
        kioskUnlockFailures: 0,
      })
      return { status: 423, body: { error: 'Too many wrong PINs. Try again later.' } }
    }
    return { status: 401, body: { error: `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` } }
  }
  await gate.device.ref.update({ kioskUnlockFailures: 0, kioskUnlockLockedUntilMs: null })
  const minted = mintPosKioskUnlock(gate.deviceId, matched, now)
  return { status: 200, body: minted }
}

async function staffSettings(
  gate: KioskGate,
  body: Record<string, any>,
  action: 'settings' | 'set-reader' | 'exit',
): Promise<Outcome> {
  const memberUid = readPosKioskUnlock(body['unlock'], gate.deviceId, Date.now())
  if (!memberUid || !(await mayUnlock(gate, memberUid))) return refuse(401, 'Enter your staff PIN again.')
  if (action === 'exit') {
    // Leaving kiosk mode unpairs the device: a new code from the register
    // is the only way back.
    await gate.device.ref.delete()
    return { status: 200, body: { ok: true } }
  }
  const readers = await registerReaders(gate)
  let data = gate.device.data
  if (action === 'set-reader') {
    const readerId = String(body['readerId'] ?? '')
    if (readerId && !readers.some((reader) => reader.id === readerId)) {
      return refuse(404, 'That card reader is not on this register.')
    }
    await gate.device.ref.set({ kioskReaderId: readerId || null }, { merge: true })
    data = { ...data, kioskReaderId: readerId || null }
  }
  const chosen = await kioskReaderId({ ...gate, device: { ...gate.device, data } })
  return {
    status: 200,
    body: {
      readers,
      readerId: chosen,
      label: String(gate.device.data['label'] ?? 'Self-service kiosk'),
    },
  }
}

/** A Terminal SDK connection token for the native app's Tap to Pay, scoped to the site's Location. */
async function connectionToken(gate: KioskGate): Promise<Outcome> {
  if (!posTerminalAvailable()) return refuse(409, 'Card payments are not available on this kiosk.')
  if (!(await withinBudget(gate, 'connection-token', 60))) return refuse(429, 'Too many tries.')
  const token = await createPosTerminalConnectionToken(gate.hostId)
  if (!token) return refuse(409, 'Set up a card reader location for this site first.')
  return { status: 200, body: token }
}

/*==========================================
 * THE REGISTER'S SIDE: the queue of "pay at counter" orders.
 *=========================================*/

export interface PosKioskQueueEntry {
  orderId: string
  number: number
  queuedAtMs: number
  totalCents: number
  itemCount: number
}

async function staffAction(req: PluginApiRequest, body: Record<string, any>, action: string): Promise<Outcome> {
  const hostId = String(body['hostId'] ?? '')
  const gate = await authorizePosStaff(req, hostId)
  if ('error' in gate) return refuse(gate.status, gate.error)
  const registerId = String(body['registerId'] ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(registerId)) return refuse(400, 'Missing registerId')
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  if (!(await hostRef.collection('registers').doc(registerId).get()).exists) {
    return refuse(404, 'Unknown register')
  }
  if (action === 'queue') {
    // `kioskQueueRegisterId ==, status ==, kioskQueuedAtMs ASC`, declared in
    // the index file: the oldest order first, as a counter serves them.
    const snapshot = await hostRef
      .collection('orders')
      .where('kioskQueueRegisterId', '==', registerId)
      .where('status', '==', 'pending')
      .orderBy('kioskQueuedAtMs', 'asc')
      .limit(25)
      .get()
    const entries: PosKioskQueueEntry[] = snapshot.docs.map((doc: any) => {
      const order = CommerceModel.liftLegacyOrder(doc.data()) as CommerceModel.HostOrder
      return {
        orderId: String(doc.id),
        number: Number(order.number ?? 0),
        queuedAtMs: Number(order.kioskQueuedAtMs ?? 0),
        totalCents: Number(order.totals?.totalCents ?? 0),
        itemCount: (order.lineItems ?? []).reduce((sum, line) => sum + line.quantity, 0),
      }
    })
    return { status: 200, body: { entries, currency: await posDisplayCurrency(hostId) } }
  }
  // `take`: the queued order, as the register loads it into its tender panel.
  const orderId = String(body['orderId'] ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) return refuse(400, 'Missing orderId')
  const order = await readPosSale(hostId, orderId)
  if (!order || order.kioskQueueRegisterId !== registerId) return refuse(404, 'Unknown order')
  if (order.status !== 'pending') return refuse(409, 'This order is no longer waiting for payment.')
  return {
    status: 200,
    body: {
      sale: posSaleSummary(order),
      number: Number(order.number ?? 0),
      lines: (order.lineItems ?? []).map((line) => ({
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        name: line.name,
        ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
        unitAmountCents: line.unitAmountCents,
        quantity: line.quantity,
        ...(line.modifiers?.length
          ? { modifiers: line.modifiers.map((modifier) => ({ groupId: modifier.groupId, optionId: modifier.optionId })) }
          : {}),
      })),
    },
  }
}

export async function handlePosKiosk(req: PluginApiRequest): Promise<Outcome> {
  const body = req.method === 'GET' ? posQueryBody(req) : posRequestBody(req)
  const action = String(body['action'] ?? '')
  const read = DEVICE_READS.has(action) || STAFF_READS.has(action)
  if (!(req.method === 'POST' || (req.method === 'GET' && read))) {
    return refuse(405, 'Method not allowed')
  }
  if (action === 'queue' || action === 'take') return await staffAction(req, body, action)
  const gate = await authorizeKiosk(req, body, !read)
  if ('status' in gate) return gate
  switch (action) {
    case 'context':
      return await context(gate)
    case 'catalog':
      return await catalog(gate, body)
    case 'sale': {
      const own = await readOwnSale(gate, body['orderId'])
      return 'status' in own ? own : { status: 200, body: { sale: own.view } }
    }
    case 'checkout':
      return await checkout(gate, req, body)
    case 'pay':
      return await pay(gate, req, body)
    case 'payment-status':
    case 'cancel-payment':
    case 'simulate':
      return await cardStep(gate, body, action)
    case 'counter':
      return await sendToCounter(gate, body)
    case 'receipt':
      return await receipt(gate, body)
    case 'abandon':
      return await abandon(gate, body)
    case 'connection-token':
      return await connectionToken(gate)
    case 'unlock':
      return await unlock(gate, req, body)
    case 'settings':
    case 'set-reader':
    case 'exit':
      return await staffSettings(gate, body, action)
    default:
      return refuse(400, 'Unknown action')
  }
}

/** `GET|POST /api/commerce/pos-kiosk`. */
export const posKioskHandler: PluginApiHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const outcome = await handlePosKiosk(req)
    return res.status(outcome.status).json(outcome.body)
  } catch (error) {
    console.error('[pos-kiosk]', error)
    return res.status(500).json({ error: 'Something went wrong. Please order at the counter.' })
  }
}
