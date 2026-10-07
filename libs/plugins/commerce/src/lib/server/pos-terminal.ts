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
import { merchantAccountIsReady } from '@aglyn/tenant-data-admin/server/payment-provider'
import {
  cardAuthenticationParams,
  checkoutSessionCardAuthenticationParams,
} from '@aglyn/tenant-data-admin/server/stripe-card-authentication'
import * as CommerceModel from '../model'
import type { PosRegisterSettings } from '../plugin-config'
import {
  POS_CURRENCY,
  posCardApplicationFeeCents,
  posStripe,
  posStripeErrorMessage,
  posStripeTestMode,
} from './pos-stripe'
import { applyPosPayment, readPosSale, type PosLiftedOrder, type PosPaymentOutcome } from './pos-sale'

/*==========================================
 * STRIPE TERMINAL AND THE REGISTER'S OTHER CARD TENDERS (AGL-3607).
 *
 * ## Where the readers live
 *
 * Every register charge is a DESTINATION charge on the platform account, so
 * Stripe's rule for that model applies: Locations and Readers are created on
 * the PLATFORM with the platform key, and identify their merchant by
 * metadata. One Location per site (`hosts/{hostId}/terminal/config`), and one
 * `hosts/{hostId}/terminalReaders/{readerId}` document per reader, written
 * only here. The document is what makes a reader THIS site's: every call that
 * names a reader reads it under the caller's own site first, so one store can
 * never drive, rename or remove another's reader, and the reader's own
 * `metadata.hostId` is checked again before a payment is sent to it.
 *
 * ## Why the reader charges with MANUAL capture
 *
 * On-reader tipping changes the amount after the PaymentIntent exists: the
 * reader adds the tip on confirmation and reports it in
 * `amount_details.tip.amount`. `application_fee_amount` set at creation was
 * sized on the pre-tip amount, and the platform's take must exclude the tip
 * while Stripe's processing cost (debited from the platform) is on the whole
 * charge. So the reader only AUTHORIZES; {@link refreshPosCardPayment} reads
 * the tip, re-prices the fee as
 *
 *     take share (of the sale, never of the tip) + card processing (whole charge)
 *
 * and captures with that exact `application_fee_amount`. Stripe's own Connect
 * guidance for Terminal is the same: inspect, fix the application fee, then
 * capture. An authorization expires after two days, and a register capture
 * happens seconds after the tap.
 *=========================================*/

const NOT_A_SALE = { ok: false as const, status: 409, error: 'This sale is no longer open' }

/** `hosts/{hostId}/terminalReaders/{readerId}`. */
export interface PosTerminalReader {
  label: string
  registerId?: string
  stripeLocationId: string
  deviceType?: string
  serialNumber?: string
  status?: 'online' | 'offline' | string
  livemode: boolean
  createdAtMs: number
  createdBy?: string
  lastSeenAtMs?: number
}

/**
 * The payment without its failure reason. Removed, never set to `undefined`:
 * Firestore refuses an undefined field inside the `payments` array.
 */
function withoutFailure(payment: CommerceModel.OrderPayment): CommerceModel.OrderPayment {
  const next = { ...payment }
  delete next.failureMessage
  return next
}

/** The merchant's connected account, when it can take card payments now. */
export async function posMerchantAccount(
  hostId: string,
  org: Record<string, any> | null,
): Promise<string | null> {
  const ownerUid = String(org?.['ownerUid'] ?? '')
  if (!ownerUid) return null
  const profile = await firebaseAdmin.app().firestore().collection('profiles').doc(ownerUid).get()
  const accountId = profile.get('stripeAccountId')
  if (
    !merchantAccountIsReady(
      {
        accountId,
        chargesEnabled: profile.get('stripeChargesEnabled'),
        accountLivemode: profile.get('stripeAccountLivemode'),
      },
      { subject: `POS card payment host ${hostId}` },
    )
  ) {
    return null
  }
  return String(accountId)
}

function terminalConfigRef(hostId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('terminal')
    .doc('config')
}

function readerRef(hostId: string, readerId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('terminalReaders')
    .doc(readerId)
}

/** A reader id as Stripe mints them; anything else never reaches Stripe. */
export function isTerminalReaderId(value: unknown): value is string {
  return typeof value === 'string' && /^tmr_[A-Za-z0-9]{6,64}$/.test(value)
}

/** The reader, when it is THIS site's; null for anyone else's or none. */
export async function ownedTerminalReader(
  hostId: string,
  readerId: unknown,
): Promise<(PosTerminalReader & { id: string }) | null> {
  if (!isTerminalReaderId(readerId)) return null
  const snapshot = await readerRef(hostId, readerId).get()
  if (!snapshot.exists) return null
  return { ...(snapshot.data() as PosTerminalReader), id: readerId }
}

/** A Terminal Location's address, as the console sends it. */
export interface PosTerminalAddress {
  line1: string
  line2?: string
  city: string
  state?: string
  postalCode: string
  country: string
}

export function posTerminalAddressProblem(address: Partial<PosTerminalAddress> | undefined): string | null {
  if (!address?.line1 || !address?.city || !address?.postalCode || !address?.country) {
    return 'Enter the street, city, postal code and country where the reader is used.'
  }
  if (!/^[A-Z]{2}$/.test(String(address.country))) return 'Choose a two-letter country code, like US.'
  return null
}

/**
 * The site's Terminal Location, created on first use (on the PLATFORM, with
 * the merchant named in metadata). Its address is the store's, because Stripe
 * uses it to configure the reader for the right country.
 */
export async function ensurePosTerminalLocation(options: {
  hostId: string
  orgId: string
  displayName: string
  address?: PosTerminalAddress
}): Promise<{ ok: true; locationId: string } | { ok: false; status: number; error: string }> {
  const ref = terminalConfigRef(options.hostId)
  const existing = await ref.get()
  const known = String(existing.get('stripeLocationId') ?? '')
  if (known) return { ok: true, locationId: known }
  const problem = posTerminalAddressProblem(options.address)
  if (problem) return { ok: false, status: 400, error: problem }
  const address = options.address as PosTerminalAddress
  const created = await posStripe('POST', 'terminal/locations', {
    idempotencyKey: `pos-location:${options.hostId}`,
    params: {
      display_name: options.displayName.slice(0, 100) || 'Store',
      'address[line1]': address.line1,
      'address[line2]': address.line2 || undefined,
      'address[city]': address.city,
      'address[state]': address.state || undefined,
      'address[postal_code]': address.postalCode,
      'address[country]': address.country,
      'metadata[orgId]': options.orgId,
      'metadata[hostId]': options.hostId,
    },
  })
  if (!created.ok || !created.body?.id) {
    return {
      ok: false,
      status: 502,
      error: posStripeErrorMessage(created.body, 'The reader location could not be set up.'),
    }
  }
  await ref.set(
    {
      stripeLocationId: String(created.body.id),
      livemode: Boolean(created.body.livemode),
      createdAtMs: Date.now(),
    },
    { merge: true },
  )
  return { ok: true, locationId: String(created.body.id) }
}

/** The tipping a reader shows: Stripe offers three buttons, so three presets. */
export function posReaderTippingKey(settings: PosRegisterSettings): string {
  return settings.tippingEnabled ? settings.tipPercentages.slice(0, 3).join(',') : 'off'
}

/**
 * Keeps the site's reader tipping in step with the merchant's settings: one
 * Terminal Configuration per site, assigned to its Location, rewritten only
 * when the presets changed. Never fatal: a reader that keeps the previous
 * presets still takes the payment.
 */
export async function syncPosReaderTipping(
  hostId: string,
  settings: PosRegisterSettings,
): Promise<void> {
  if (!settings.tippingEnabled) return
  const ref = terminalConfigRef(hostId)
  const config = await ref.get()
  const locationId = String(config.get('stripeLocationId') ?? '')
  if (!locationId) return
  const key = posReaderTippingKey(settings)
  if (config.get('tippingKey') === key) return
  const percentages = settings.tipPercentages.slice(0, 3)
  const configurationId = String(config.get('stripeConfigurationId') ?? '')
  const params = {
    [`tipping[${POS_CURRENCY}][percentages]`]: percentages.map(String),
  }
  const saved = await posStripe(
    'POST',
    configurationId ? `terminal/configurations/${configurationId}` : 'terminal/configurations',
    {
      params,
      ...(configurationId ? {} : { idempotencyKey: `pos-configuration:${hostId}:${key}` }),
    },
  )
  if (!saved.ok || !saved.body?.id) {
    console.error('[pos-terminal] tipping configuration failed', hostId, saved.body?.error)
    return
  }
  if (!configurationId) {
    const assigned = await posStripe('POST', `terminal/locations/${locationId}`, {
      params: { configuration_overrides: String(saved.body.id) },
    })
    if (!assigned.ok) {
      console.error('[pos-terminal] configuration assignment failed', hostId, assigned.body?.error)
      return
    }
  }
  await ref.set(
    { stripeConfigurationId: String(saved.body.id), tippingKey: key },
    { merge: true },
  )
}

/** Reads a reader from Stripe and keeps its status on the site's document. */
export async function refreshPosReaderStatus(
  hostId: string,
  readerId: string,
): Promise<{ status: string; action: any } | null> {
  const fetched = await posStripe('GET', `terminal/readers/${readerId}`)
  if (!fetched.ok) return null
  const status = String(fetched.body?.status ?? 'offline')
  await readerRef(hostId, readerId)
    .set({ status, lastSeenAtMs: Date.now() }, { merge: true })
    .catch(() => undefined)
  return { status, action: fetched.body?.action ?? null }
}

/*==========================================
 * TAKING A CARD PAYMENT.
 *=========================================*/

interface CardStart {
  hostId: string
  orderId: string
  paymentId: string
  amountCents: number
  /** A tip already chosen (on the customer display or by the cashier). */
  tipCents: number
  cashierId: string
  org: Record<string, any> | null
}

/** Reserves a pending card payment in the ledger, or finds the one this attempt made. */
async function reserveCardPayment(
  start: CardStart,
  method: CommerceModel.OrderPaymentMethod,
  extra: Partial<CommerceModel.OrderPayment>,
): Promise<PosPaymentOutcome> {
  return await applyPosPayment({
    hostId: start.hostId,
    orderId: start.orderId,
    paymentId: start.paymentId,
    decide: ({ order, payments, existing }) => {
      if (existing) {
        // The same attempt again: hand back what it started. A failed card
        // is re-armed by `retry`, not by pressing the tender a second time.
        return { kind: 'keep' }
      }
      if (order.status !== 'pending') return { kind: 'refuse', ...NOT_A_SALE }
      const total = Number(order.totals?.totalCents ?? 0)
      const tenderable = CommerceModel.posTenderableCents(total, payments)
      if (!(start.amountCents > 0)) {
        return { kind: 'refuse', status: 400, error: 'Enter an amount to charge.' }
      }
      if (start.amountCents > tenderable) {
        return {
          kind: 'refuse',
          status: 409,
          error:
            tenderable > 0
              ? `Only $${(tenderable / 100).toFixed(2)} is left to pay on this sale.`
              : 'Nothing is left to pay on this sale.',
        }
      }
      const tipProblem = CommerceModel.posTipProblem(start.tipCents, start.amountCents)
      if (tipProblem) return { kind: 'refuse', status: 400, error: tipProblem }
      const takeFeeCents = CommerceModel.posTakeShareCents({
        takeFeeCents: Number(order.posTakeFeeCents ?? 0),
        totalCents: total,
        amountCents: start.amountCents,
      })
      return {
        kind: 'put',
        payment: {
          id: start.paymentId,
          method,
          amountCents: start.amountCents,
          ...(start.tipCents > 0 ? { tipCents: start.tipCents } : {}),
          status: 'pending',
          atMs: Date.now(),
          takeFeeCents,
          cashierId: start.cashierId,
          ...extra,
        },
      }
    },
  })
}

/** Writes Stripe's answer onto a pending card payment. */
async function patchCardPayment(
  hostId: string,
  orderId: string,
  paymentId: string,
  patch: (payment: CommerceModel.OrderPayment) => CommerceModel.OrderPayment | null,
  event?: { event: string; detail?: string },
): Promise<PosPaymentOutcome> {
  return await applyPosPayment({
    hostId,
    orderId,
    paymentId,
    decide: ({ existing }) => {
      if (!existing) return { kind: 'refuse', status: 404, error: 'Unknown payment' }
      const next = patch(existing)
      if (!next) return { kind: 'keep' }
      return { kind: 'put', payment: next, ...(event ? { event } : {}) }
    },
  })
}

function paymentIntentParams(
  start: CardStart,
  payment: CommerceModel.OrderPayment,
  destination: string,
  extra: Record<string, string | number | boolean | undefined | readonly string[]>,
) {
  const chargeCents = start.amountCents + start.tipCents
  const fee = posCardApplicationFeeCents({
    takeShareCents: Number(payment.takeFeeCents ?? 0),
    chargeCents,
  })
  return {
    amount: chargeCents,
    currency: POS_CURRENCY,
    'transfer_data[destination]': destination,
    ...(fee > 0 ? { application_fee_amount: fee } : {}),
    'metadata[kind]': 'pos',
    'metadata[hostId]': start.hostId,
    'metadata[orderId]': start.orderId,
    'metadata[paymentId]': start.paymentId,
    'metadata[tipCents]': String(start.tipCents),
    ...extra,
  }
}

/**
 * Creates (or finds) the card-present PaymentIntent for one payment WITHOUT
 * choosing how the card is collected: reserves the amount in the ledger and
 * creates a manual-capture destination charge to the merchant (settled on
 * Aglyn's platform account, with no `on_behalf_of`, as ToS §10.7 states),
 * keyed by the payment so a retry returns the same intent.
 *
 * Two collectors use it. {@link startCardPresentPayment} pushes the intent
 * to a smart reader the site owns; a native companion app (AGL-3618)
 * collects it with the Stripe Terminal SDK (Tap to Pay, Bluetooth readers)
 * using the returned `clientSecret`. However the card is collected, the
 * payment is recorded by {@link refreshPosCardPayment}, keyed on the intent's
 * metadata, from the register's poll or the webhook alike.
 */
export async function createCardPresentIntent(
  start: CardStart & { readerId?: string },
): Promise<PosPaymentOutcome & { clientSecret?: string; paymentIntentId?: string }> {
  const destination = await posMerchantAccount(start.hostId, start.org)
  if (!destination) return { ok: false, status: 409, error: 'Card payments not set up' }
  const reserved = await reserveCardPayment(
    start,
    'card_present',
    start.readerId ? { readerId: start.readerId } : {},
  )
  if (!reserved.ok || !reserved.payment) return reserved
  const payment = reserved.payment
  if (payment.status !== 'pending') return reserved
  // Keyed by the payment: a second call for the same payment replays the
  // intent Stripe already made rather than opening another.
  const intent = await posStripe('POST', 'payment_intents', {
    idempotencyKey: `pos-pi:${payment.id}`,
    params: paymentIntentParams(start, payment, destination, {
      payment_method_types:
        POS_CURRENCY === 'usd' ? ['card_present'] : ['card_present', 'interac_present'],
      capture_method: 'manual',
      ...(start.readerId ? { 'metadata[readerId]': start.readerId } : {}),
      description: 'In-store purchase',
    }),
  })
  if (!intent.ok || !intent.body?.id) {
    return await patchCardPayment(start.hostId, start.orderId, payment.id, (current) => ({
      ...current,
      status: 'failed',
      failureMessage: posStripeErrorMessage(intent.body, 'The card payment could not be started.'),
    }))
  }
  const paymentIntentId = String(intent.body.id)
  const recorded = payment.paymentIntentId
    ? reserved
    : await patchCardPayment(start.hostId, start.orderId, payment.id, (current) => ({
        ...current,
        paymentIntentId,
        livemode: Boolean(intent.body.livemode),
      }))
  return {
    ...recorded,
    paymentIntentId,
    ...(intent.body.client_secret ? { clientSecret: String(intent.body.client_secret) } : {}),
  }
}

/**
 * A smart-reader payment: the card-present intent from
 * {@link createCardPresentIntent}, pushed to a reader THIS site owns. The
 * register then polls {@link refreshPosCardPayment} until the reader answers;
 * webhooks land on the same function.
 */
export async function startCardPresentPayment(
  start: CardStart & { readerId: string; settings: PosRegisterSettings },
): Promise<PosPaymentOutcome> {
  const reader = await ownedTerminalReader(start.hostId, start.readerId)
  if (!reader) return { ok: false, status: 404, error: 'That card reader is not on this site.' }
  await syncPosReaderTipping(start.hostId, start.settings).catch((error) =>
    console.error('[pos-terminal] tipping sync failed', error),
  )
  const created = await createCardPresentIntent({ ...start, readerId: reader.id })
  if (!created.ok || !created.payment || !created.paymentIntentId) return created
  if (created.payment.status !== 'pending') return created
  return await sendToReader({
    hostId: start.hostId,
    orderId: start.orderId,
    paymentId: created.payment.id,
    readerId: reader.id,
    paymentIntentId: created.paymentIntentId,
    // A tip the customer already chose on the display is in the amount;
    // asking again on the reader would ask twice.
    skipTipping: !start.settings.tippingEnabled || start.tipCents > 0,
    attempt: 0,
  })
}

/** The site's Terminal Location id, or null before a reader was ever set up. */
export async function posTerminalLocationId(hostId: string): Promise<string | null> {
  const config = await terminalConfigRef(hostId).get()
  return String(config.get('stripeLocationId') ?? '') || null
}

/**
 * A Terminal SDK connection token scoped to the site's own Location, for a
 * native companion app's SDK (AGL-3618). Scoping it to the Location is what
 * keeps one store's app from discovering another store's readers: Stripe
 * only lets a location-scoped token connect to readers in that Location.
 * Null when the site has no Location yet, never an unscoped token.
 */
export async function createPosTerminalConnectionToken(
  hostId: string,
): Promise<{ secret: string; locationId: string } | null> {
  const locationId = await posTerminalLocationId(hostId)
  if (!locationId) return null
  const token = await posStripe('POST', 'terminal/connection_tokens', {
    params: { location: locationId },
  })
  if (!token.ok || !token.body?.secret) return null
  return { secret: String(token.body.secret), locationId }
}

async function sendToReader(input: {
  hostId: string
  orderId: string
  paymentId: string
  readerId: string
  paymentIntentId: string
  skipTipping: boolean
  attempt: number
}): Promise<PosPaymentOutcome> {
  const processed = await posStripe(
    'POST',
    `terminal/readers/${input.readerId}/process_payment_intent`,
    {
      idempotencyKey: `pos-process:${input.paymentId}:${input.attempt}`,
      params: {
        payment_intent: input.paymentIntentId,
        'process_config[enable_customer_cancellation]': true,
        ...(input.skipTipping ? { 'process_config[skip_tipping]': true } : {}),
      },
    },
  )
  if (!processed.ok) {
    return await patchCardPayment(input.hostId, input.orderId, input.paymentId, (current) => ({
      ...current,
      status: 'failed',
      failureMessage: posStripeErrorMessage(processed.body, 'The card reader could not start the payment.'),
    }))
  }
  return await patchCardPayment(input.hostId, input.orderId, input.paymentId, (current) => {
    if (!current.failureMessage) return null
    return withoutFailure(current)
  })
}

/**
 * Re-arms a declined or failed reader payment on the SAME PaymentIntent, as
 * Stripe asks (a new one per attempt risks a double charge).
 */
export async function retryCardPresentPayment(input: {
  hostId: string
  orderId: string
  paymentId: string
  settings: PosRegisterSettings
}): Promise<PosPaymentOutcome> {
  const order = await readPosSale(input.hostId, input.orderId)
  if (!order || order.status !== 'pending') return NOT_A_SALE
  const payment = CommerceModel.orderPayments(order).find((entry) => entry.id === input.paymentId)
  if (!payment || payment.method !== 'card_present' || !payment.paymentIntentId || !payment.readerId) {
    return { ok: false, status: 404, error: 'Unknown payment' }
  }
  if (payment.status === 'succeeded') return { ok: true, order, payment, completed: false, changed: false }
  const reader = await ownedTerminalReader(input.hostId, payment.readerId)
  if (!reader) return { ok: false, status: 404, error: 'That card reader is not on this site.' }
  // Back to pending first, so the amount is reserved again before the reader
  // is asked; a sale paid meanwhile by another tender refuses here.
  const rearmed = await applyPosPayment({
    hostId: input.hostId,
    orderId: input.orderId,
    paymentId: input.paymentId,
    decide: ({ order: fresh, payments, existing }) => {
      if (!existing) return { kind: 'refuse', status: 404, error: 'Unknown payment' }
      if (existing.status === 'pending') return { kind: 'keep' }
      if (existing.status !== 'failed' && existing.status !== 'canceled') {
        return { kind: 'refuse', status: 409, error: 'This payment cannot be retried.' }
      }
      const tenderable = CommerceModel.posTenderableCents(
        Number(fresh.totals?.totalCents ?? 0),
        payments.filter((entry) => entry.id !== existing.id),
      )
      if (existing.amountCents > tenderable) {
        return { kind: 'refuse', status: 409, error: 'The balance changed. Start a new card payment.' }
      }
      return { kind: 'put', payment: { ...withoutFailure(existing), status: 'pending' } }
    },
  })
  if (!rearmed.ok) return rearmed
  const attempt = Date.now()
  return await sendToReader({
    hostId: input.hostId,
    orderId: input.orderId,
    paymentId: input.paymentId,
    readerId: reader.id,
    paymentIntentId: payment.paymentIntentId,
    skipTipping: !input.settings.tippingEnabled || Number(payment.tipCents ?? 0) > 0,
    attempt,
  })
}

/**
 * A typed card (card not present): a PaymentIntent the console confirms with
 * the Payment Element. No MOTO: the card is keyed into Stripe's own field and
 * goes through Stripe's normal online checks, 3-D Secure included.
 */
export async function startCardKeyedPayment(
  start: CardStart,
): Promise<PosPaymentOutcome & { clientSecret?: string }> {
  const destination = await posMerchantAccount(start.hostId, start.org)
  if (!destination) return { ok: false, status: 409, error: 'Card payments not set up' }
  const reserved = await reserveCardPayment(start, 'card_keyed', {})
  if (!reserved.ok || !reserved.payment) return reserved
  const payment = reserved.payment
  if (payment.status !== 'pending') return reserved
  const intent = await posStripe('POST', 'payment_intents', {
    idempotencyKey: `pos-pi:${payment.id}`,
    params: paymentIntentParams(start, payment, destination, {
      payment_method_types: ['card'],
      description: 'In-store purchase (typed card)',
      // 3-D Secure from the one seam every card payment shares (AGL-3360).
      ...cardAuthenticationParams('one-time'),
    }),
  })
  if (!intent.ok || !intent.body?.id || !intent.body?.client_secret) {
    return await patchCardPayment(start.hostId, start.orderId, payment.id, (current) => ({
      ...current,
      status: 'failed',
      failureMessage: posStripeErrorMessage(intent.body, 'The card payment could not be started.'),
    }))
  }
  const updated = payment.paymentIntentId
    ? reserved
    : await patchCardPayment(start.hostId, start.orderId, payment.id, (current) => ({
        ...current,
        paymentIntentId: String(intent.body.id),
        livemode: Boolean(intent.body.livemode),
      }))
  return { ...updated, clientSecret: String(intent.body.client_secret) }
}

/**
 * The customer pays on their own phone from a QR code: a Stripe payment page
 * for this payment's amount (and tip, as its own line). Settled by
 * `checkout.session.completed` or by the register's poll.
 */
export async function startCardLinkPayment(
  start: CardStart & { returnUrl: string },
): Promise<PosPaymentOutcome> {
  const destination = await posMerchantAccount(start.hostId, start.org)
  if (!destination) return { ok: false, status: 409, error: 'Card payments not set up' }
  const reserved = await reserveCardPayment(start, 'card_link', {})
  if (!reserved.ok || !reserved.payment) return reserved
  const payment = reserved.payment
  if (payment.checkoutSessionId || payment.status !== 'pending') return reserved
  const fee = posCardApplicationFeeCents({
    takeShareCents: Number(payment.takeFeeCents ?? 0),
    chargeCents: start.amountCents + start.tipCents,
  })
  const session = await posStripe('POST', 'checkout/sessions', {
    idempotencyKey: `pos-link:${payment.id}`,
    params: {
      mode: 'payment',
      ...checkoutSessionCardAuthenticationParams('payment'),
      'payment_method_types': ['card'],
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': POS_CURRENCY,
      'line_items[0][price_data][unit_amount]': start.amountCents,
      'line_items[0][price_data][product_data][name]': 'In-store purchase',
      ...(start.tipCents > 0
        ? {
            'line_items[1][quantity]': 1,
            'line_items[1][price_data][currency]': POS_CURRENCY,
            'line_items[1][price_data][unit_amount]': start.tipCents,
            'line_items[1][price_data][product_data][name]': 'Tip',
          }
        : {}),
      'payment_intent_data[transfer_data][destination]': destination,
      ...(fee > 0 ? { 'payment_intent_data[application_fee_amount]': fee } : {}),
      'payment_intent_data[metadata][kind]': 'pos',
      'payment_intent_data[metadata][hostId]': start.hostId,
      'payment_intent_data[metadata][orderId]': start.orderId,
      'payment_intent_data[metadata][paymentId]': payment.id,
      'payment_intent_data[metadata][tipCents]': String(start.tipCents),
      success_url: `${start.returnUrl}?paid=1`,
      cancel_url: `${start.returnUrl}?paid=0`,
      'metadata[type]': 'pos-payment',
      'metadata[hostId]': start.hostId,
      'metadata[orderId]': start.orderId,
      'metadata[paymentId]': payment.id,
    },
  })
  if (!session.ok || !session.body?.url) {
    return await patchCardPayment(start.hostId, start.orderId, payment.id, (current) => ({
      ...current,
      status: 'failed',
      failureMessage: posStripeErrorMessage(session.body, 'The payment page could not be created.'),
    }))
  }
  return await patchCardPayment(start.hostId, start.orderId, payment.id, (current) => ({
    ...current,
    checkoutSessionId: String(session.body.id),
    checkoutUrl: String(session.body.url),
    livemode: Boolean(session.body.livemode),
  }))
}

/*==========================================
 * SETTLING A CARD PAYMENT.
 *=========================================*/

/** The card's brand and last four, off the charge Stripe made. */
function cardDetailsOf(intent: any): { cardBrand?: string; last4?: string } {
  const charge = typeof intent?.latest_charge === 'object' ? intent.latest_charge : null
  const details =
    charge?.payment_method_details?.card_present ??
    charge?.payment_method_details?.interac_present ??
    charge?.payment_method_details?.card ??
    null
  return {
    ...(details?.brand ? { cardBrand: String(details.brand) } : {}),
    ...(details?.last4 ? { last4: String(details.last4) } : {}),
  }
}

/** The tip on an intent: what the display chose plus what the reader added. */
export function posIntentTipCents(intent: any): number {
  const preset = Math.max(0, Math.round(Number(intent?.metadata?.tipCents ?? 0)) || 0)
  const onReader = Math.max(0, Math.round(Number(intent?.amount_details?.tip?.amount ?? 0)) || 0)
  return preset + onReader
}

/**
 * The fee a register card charge is captured with: the payment's share of the
 * take (fixed at reservation, the sale's share and never the tip's) plus the
 * card processing cost on the whole amount, tip included.
 */
export function posCaptureFeeCents(payment: CommerceModel.OrderPayment, intent: any): number {
  return posCardApplicationFeeCents({
    takeShareCents: Number(payment.takeFeeCents ?? 0),
    chargeCents: Math.max(0, Math.round(Number(intent?.amount ?? 0))),
  })
}

/**
 * Brings one card payment up to date with Stripe, from a webhook or the
 * register's poll alike: captures an authorized reader payment with its final
 * fee, records a success, a decline or a cancellation. Idempotent: the
 * capture is keyed by the intent, and the ledger change is a no-op when the
 * payment already says what Stripe says.
 */
export async function refreshPosCardPayment(input: {
  hostId: string
  orderId: string
  paymentId: string
}): Promise<PosPaymentOutcome> {
  const order = await readPosSale(input.hostId, input.orderId)
  if (!order) return { ok: false, status: 404, error: 'Unknown sale' }
  const payment = CommerceModel.orderPayments(order).find((entry) => entry.id === input.paymentId)
  if (!payment) return { ok: false, status: 404, error: 'Unknown payment' }
  if (!CommerceModel.isCardPaymentMethod(payment.method)) {
    return { ok: true, order, payment, completed: false, changed: false }
  }
  let paymentIntentId = payment.paymentIntentId ?? ''
  if (!paymentIntentId && payment.checkoutSessionId) {
    const session = await posStripe('GET', `checkout/sessions/${payment.checkoutSessionId}`)
    if (session.ok && session.body?.status === 'expired' && payment.status === 'pending') {
      return await patchCardPayment(input.hostId, input.orderId, payment.id, (current) =>
        current.status === 'pending' ? { ...current, status: 'canceled' } : null,
      )
    }
    paymentIntentId = String(session.body?.payment_intent ?? '')
  }
  if (!paymentIntentId) return { ok: true, order, payment, completed: false, changed: false }
  let intent = (
    await posStripe('GET', `payment_intents/${paymentIntentId}`, {
      params: { 'expand[]': 'latest_charge' },
    })
  ).body
  if (!intent?.id) return { ok: true, order, payment, completed: false, changed: false }
  if (intent.metadata?.hostId !== input.hostId || intent.metadata?.paymentId !== payment.id) {
    console.error('[pos-terminal] intent does not belong to this payment', paymentIntentId)
    return { ok: false, status: 409, error: 'This payment does not match its card charge.' }
  }
  if (intent.status === 'requires_capture') {
    if (order.status !== 'pending' && payment.status !== 'pending') {
      // Nothing to capture into: the sale is gone. Release the hold.
      await posStripe('POST', `payment_intents/${intent.id}/cancel`, {
        idempotencyKey: `pos-release:${intent.id}`,
      })
      return { ok: true, order, payment, completed: false, changed: false }
    }
    const fee = posCaptureFeeCents(payment, intent)
    const captured = await posStripe('POST', `payment_intents/${intent.id}/capture`, {
      idempotencyKey: `pos-capture:${intent.id}`,
      params: {
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
        'expand[]': 'latest_charge',
      },
    })
    if (captured.ok && captured.body?.id) intent = captured.body
    else {
      console.error('[pos-terminal] capture failed', intent.id, captured.body?.error)
      return { ok: true, order, payment, completed: false, changed: false }
    }
  }
  if (intent.status === 'succeeded') {
    const tipCents = posIntentTipCents(intent)
    const amountCents = Math.max(0, Math.round(Number(intent.amount ?? 0))) - tipCents
    return await patchCardPayment(
      input.hostId,
      input.orderId,
      payment.id,
      (current) => {
        if (current.status === 'succeeded' && current.paymentIntentId === intent.id) return null
        return {
          ...withoutFailure(current),
          status: 'succeeded',
          settledAtMs: Date.now(),
          paymentIntentId: String(intent.id),
          // What the charge actually put toward the sale. Equal to the
          // reserved amount; restated from Stripe so the ledger records the
          // money that moved rather than the money that was asked for.
          amountCents: amountCents > 0 ? amountCents : current.amountCents,
          ...(tipCents > 0 ? { tipCents } : {}),
          feeCents: Math.max(0, Math.round(Number(intent.application_fee_amount ?? 0))),
          livemode: Boolean(intent.livemode),
          ...cardDetailsOf(intent),
        }
      },
    )
  }
  if (intent.status === 'canceled') {
    return await patchCardPayment(input.hostId, input.orderId, payment.id, (current) =>
      current.status === 'pending' || current.status === 'failed'
        ? { ...current, status: 'canceled' }
        : null,
    )
  }
  if (intent.status === 'requires_payment_method' && intent.last_payment_error) {
    const message = String(intent.last_payment_error?.message ?? 'The card was declined.')
    return await patchCardPayment(input.hostId, input.orderId, payment.id, (current) =>
      current.status === 'pending' ? { ...current, status: 'failed', failureMessage: message } : null,
    )
  }
  // Still waiting on the customer. A reader action that already failed (a
  // card removed, a cancel on the reader) says so on the reader, not the
  // intent, so ask the reader too.
  if (payment.method === 'card_present' && payment.readerId && payment.status === 'pending') {
    const reader = await refreshPosReaderStatus(input.hostId, payment.readerId)
    const action = reader?.action
    if (
      action?.type === 'process_payment_intent' &&
      action?.process_payment_intent?.payment_intent === intent.id &&
      action?.status === 'failed'
    ) {
      const message = String(action.failure_message ?? 'The reader could not take the card.')
      return await patchCardPayment(input.hostId, input.orderId, payment.id, (current) =>
        current.status === 'pending' ? { ...current, status: 'failed', failureMessage: message } : null,
      )
    }
  }
  const fresh = await readPosSale(input.hostId, input.orderId)
  return {
    ok: true,
    order: fresh ?? order,
    payment:
      CommerceModel.orderPayments(fresh ?? order).find((entry) => entry.id === payment.id) ?? payment,
    completed: false,
    changed: false,
  }
}

/**
 * Stops a card payment that has not been paid: clears the reader, cancels the
 * intent, expires the payment page. A charge that already went through is
 * left alone and recorded as paid, never cancelled under the customer.
 */
export async function cancelPosCardPayment(input: {
  hostId: string
  orderId: string
  paymentId: string
}): Promise<PosPaymentOutcome> {
  const refreshed = await refreshPosCardPayment(input)
  if (!refreshed.ok || !refreshed.payment) return refreshed
  const payment = refreshed.payment
  if (payment.status === 'succeeded' || payment.status === 'canceled') return refreshed
  if (payment.method === 'card_present' && payment.readerId) {
    const cleared = await posStripe('POST', `terminal/readers/${payment.readerId}/cancel_action`)
    if (!cleared.ok && cleared.body?.error?.code === 'terminal_reader_busy') {
      return {
        ok: false,
        status: 409,
        error: 'The customer is mid-payment on the reader. Wait for it to finish.',
      }
    }
  }
  if (payment.paymentIntentId) {
    await posStripe('POST', `payment_intents/${payment.paymentIntentId}/cancel`, {
      idempotencyKey: `pos-cancel:${payment.paymentIntentId}`,
    })
  }
  if (payment.checkoutSessionId) {
    await posStripe('POST', `checkout/sessions/${payment.checkoutSessionId}/expire`, {
      idempotencyKey: `pos-expire:${payment.checkoutSessionId}`,
    })
  }
  // Re-read: a payment that completed in the gap is recorded as paid.
  const settled = await refreshPosCardPayment(input)
  if (settled.ok && settled.payment?.status === 'succeeded') return settled
  return await patchCardPayment(input.hostId, input.orderId, payment.id, (current) =>
    current.status === 'pending' || current.status === 'failed'
      ? { ...current, status: 'canceled' }
      : null,
  )
}

/**
 * TEST MODE ONLY: Stripe's simulated reader is "tapped" with a test card.
 * Refused outright on a live key, whatever the request says.
 */
export async function simulatePosReaderTap(input: {
  hostId: string
  orderId: string
  paymentId: string
  /** `4000000000000002` declines; anything else Stripe's default approves. */
  cardNumber?: string
}): Promise<PosPaymentOutcome> {
  if (!posStripeTestMode()) return { ok: false, status: 403, error: 'Only in test mode' }
  const order = await readPosSale(input.hostId, input.orderId)
  if (!order) return { ok: false, status: 404, error: 'Unknown sale' }
  const payment = CommerceModel.orderPayments(order).find((entry) => entry.id === input.paymentId)
  if (!payment?.readerId || payment.method !== 'card_present') {
    return { ok: false, status: 404, error: 'Unknown payment' }
  }
  const reader = await ownedTerminalReader(input.hostId, payment.readerId)
  if (!reader) return { ok: false, status: 404, error: 'That card reader is not on this site.' }
  const presented = await posStripe(
    'POST',
    `test_helpers/terminal/readers/${reader.id}/present_payment_method`,
    {
      params: {
        type: 'card_present',
        ...(input.cardNumber && /^[0-9]{12,19}$/.test(input.cardNumber)
          ? { 'card_present[number]': input.cardNumber }
          : {}),
      },
    },
  )
  if (!presented.ok) {
    return {
      ok: false,
      status: 502,
      error: posStripeErrorMessage(presented.body, 'The simulated tap failed.'),
    }
  }
  return await refreshPosCardPayment(input)
}

/*==========================================
 * WEBHOOKS (the small branch `billing-webhook.ts` calls).
 *=========================================*/

/** Where a Stripe object says a register payment lives, or null. */
function posPaymentRef(
  metadata: Record<string, unknown> | undefined,
): { hostId: string; orderId: string; paymentId: string } | null {
  const hostId = String(metadata?.['hostId'] ?? '')
  const orderId = String(metadata?.['orderId'] ?? '')
  const paymentId = String(metadata?.['paymentId'] ?? '')
  if (!hostId || !orderId || !paymentId) return null
  return { hostId, orderId, paymentId }
}

/**
 * The register's Stripe events: a reader finished or failed an action, a
 * register PaymentIntent was authorized, paid, declined or cancelled, or a
 * register QR page was paid or expired. Each resolves to ONE payment and is
 * answered by re-reading Stripe through {@link refreshPosCardPayment}, never
 * by trusting the event's own copy (whose API version predates the tip
 * fields). Returns the site when the event was the register's, so the
 * dispatcher can count it as claimed; null for every other event.
 */
export async function handlePosStripeEvent(input: {
  type: string
  object: any
}): Promise<{ hostId: string } | null> {
  const { type, object } = input
  let ref: { hostId: string; orderId: string; paymentId: string } | null = null
  if (type === 'terminal.reader.action_succeeded' || type === 'terminal.reader.action_failed') {
    const intentId = String(object?.action?.process_payment_intent?.payment_intent ?? '')
    if (object?.action?.type !== 'process_payment_intent' || !intentId) return null
    const intent = await posStripe('GET', `payment_intents/${intentId}`)
    if (!intent.ok || intent.body?.metadata?.kind !== 'pos') return null
    ref = posPaymentRef(intent.body.metadata)
  } else if (
    type === 'payment_intent.amount_capturable_updated' ||
    type === 'payment_intent.succeeded' ||
    type === 'payment_intent.payment_failed' ||
    type === 'payment_intent.canceled'
  ) {
    if (object?.metadata?.kind !== 'pos') return null
    ref = posPaymentRef(object.metadata)
  } else if (
    (type === 'checkout.session.completed' || type === 'checkout.session.expired') &&
    object?.metadata?.type === 'pos-payment'
  ) {
    ref = posPaymentRef(object.metadata)
  } else {
    return null
  }
  if (!ref) return null
  // A reader can be re-registered by nobody else, but an event is only a
  // claim: the intent's own metadata must name a reader this site owns.
  await refreshPosCardPayment(ref).catch((error) => {
    console.error('[pos-terminal] webhook settle failed', ref, error)
    // Rethrown so the delivery is retried: a lost settlement is a sale the
    // register cannot complete without its poll.
    throw error
  })
  return { hostId: ref.hostId }
}

export type { PosLiftedOrder }
