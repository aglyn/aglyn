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

import { createHash } from 'crypto'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { merchantAccountIsReady } from '@aglyn/tenant-data-admin/server/payment-provider'
import {
  checkEntitlement,
  resolveTransactionFeeCents,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { pluginTaxProfile } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import {
  bookingInPersonAmountProblem,
  bookingInPersonState,
  type BookingInPersonPayment,
} from '../model/booking-in-person'

/*==========================================
 * `POST /api/bookings/in-person-payment` (AGL-3618).
 *
 * Takes payment for a booking at the counter, on the card reader the native
 * Aglyn POS app has connected (Tap to Pay or a Bluetooth reader). The server
 * owns the money; the app only presents the card:
 *
 * - `start` prices the charge (the amount staff typed, plus the merchant's
 *   own service tax), and creates a card-present PaymentIntent: a
 *   DESTINATION charge to the merchant, settled on Aglyn's platform account
 *   with no `on_behalf_of` (ToS §10.7, AGL-3607), with the take and
 *   Stripe's card cost as `application_fee_amount` — exactly the fee a paid
 *   booking already carries online (`resolveTransactionFeeCents`, `service`).
 *   Returns the intent's client secret for the app's Terminal SDK.
 * - `settle` re-reads the intent from Stripe (never trusting the app's word),
 *   captures an authorized one, and records the booking paid with the same
 *   fields an online payment writes, so the console's refund and the dispute
 *   handling work on it unchanged.
 * - `cancel` releases an intent that was not collected.
 *
 * MANUAL capture, so a card that authorizes but whose booking was changed in
 * between is released rather than charged. On-reader tipping is not offered
 * here; the amount is the amount.
 *
 * Gate: a site `admin` or `editor`, and the owning org's `bookings` and
 * `pos` entitlements (taking card-present payments is a POS capability).
 *=========================================*/

const BOOKING_ID = /^[A-Za-z0-9_-]{1,128}$/
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]{6,128}$/

type Res = Parameters<PluginApiHandler>[1]

interface Staff {
  uid: string
  hostId: string
  org: Record<string, any> | null
}

function requestBody(req: Parameters<PluginApiHandler>[0]): Record<string, any> {
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {}
}

/** Card-present payments: always in test mode, in live mode once switched on. */
export function inPersonCardsAvailable(): boolean {
  const key = String(process.env.STRIPE_SECRET_KEY ?? '')
  if (!key) return false
  return (
    key.startsWith('sk_test_') ||
    String(process.env.STRIPE_TERMINAL_LIVE_ENABLED ?? '').toLowerCase() === 'true'
  )
}

async function stripe(
  method: 'GET' | 'POST',
  path: string,
  options: { params?: Record<string, string | number | boolean | undefined>; idempotencyKey?: string } = {},
): Promise<{ ok: boolean; status: number; body: any }> {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) form.append(key, String(value))
  }
  const query = method === 'GET' && form.toString() ? `?${form}` : ''
  const response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    ...(method === 'POST' ? { body: form.toString() } : {}),
  })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

function stripeMessage(body: any, fallback: string): string {
  const message = body?.error?.message
  return typeof message === 'string' && message ? message : fallback
}

async function authorize(
  req: Parameters<PluginApiHandler>[0],
  hostId: string,
): Promise<{ ok: true; staff: Staff } | { ok: false; status: number; error: string }> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  if (!hostId) return { ok: false, status: 400, error: 'Missing hostId' }
  let uid: string
  try {
    uid = (await firebaseAdmin.app().auth().verifyIdToken(idToken)).uid
  } catch {
    return { ok: false, status: 401, error: 'Unauthenticated' }
  }
  const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
  if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
  const role = (host.get('memberRoles') ?? {})[uid]
  if (role !== 'admin' && role !== 'editor') return { ok: false, status: 403, error: 'Not permitted' }
  const org = ((await getOrgForHost(hostId))?.org as Record<string, any> | undefined) ?? null
  if (!checkEntitlement(org as never, 'bookings') || !checkEntitlement(org as never, 'pos')) {
    return { ok: false, status: 403, error: 'Taking booking payments in person needs the POS plan.' }
  }
  return { ok: true, staff: { uid, hostId, org } }
}

export const bookingInPersonPaymentHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = requestBody(req)
  const hostId = String(body['hostId'] ?? '')
  const bookingId = String(body['bookingId'] ?? '')
  const gate = await authorize(req, hostId)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  if (!BOOKING_ID.test(bookingId)) return res.status(400).json({ error: 'Missing bookingId' })
  if (!inPersonCardsAvailable()) {
    return res.status(409).json({ error: 'Card readers are not available yet.' })
  }
  const action = String(body['action'] ?? '')
  try {
    switch (action) {
      case 'start':
        return await start(gate.staff, bookingId, body, req, res)
      case 'settle':
        return await settle(gate.staff, bookingId, res)
      case 'cancel':
        return await cancel(gate.staff, bookingId, res)
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[bookings/in-person-payment]', action, error)
    return res.status(500).json({ error: 'The payment could not be updated. Check the booking before trying again.' })
  }
}

function bookingRef(hostId: string, bookingId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('bookings')
    .doc(bookingId)
}

async function merchantAccount(org: Record<string, any> | null, hostId: string): Promise<string | null> {
  const ownerUid = String(org?.['ownerUid'] ?? '')
  if (!ownerUid) return null
  const profile = await firebaseAdmin.app().firestore().collection('profiles').doc(ownerUid).get()
  const accountId = String(profile.get('stripeAccountId') ?? '')
  return merchantAccountIsReady(
    {
      accountId,
      chargesEnabled: profile.get('stripeChargesEnabled'),
      accountLivemode: profile.get('stripeAccountLivemode'),
    },
    { subject: `booking in-person host ${hostId}` },
  )
    ? accountId
    : null
}

async function start(
  staff: Staff,
  bookingId: string,
  body: Record<string, any>,
  req: Parameters<PluginApiHandler>[0],
  res: Res,
) {
  const attemptKey = String(req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '')
    .trim()
    .slice(0, 200)
  if (!attemptKey) return res.status(400).json({ error: 'Missing Idempotency-Key' })
  const serviceCents = typeof body['amountCents'] === 'number' ? body['amountCents'] : NaN
  const problem = bookingInPersonAmountProblem(serviceCents)
  if (problem) return res.status(400).json({ error: problem })

  const ref = bookingRef(staff.hostId, bookingId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return res.status(404).json({ error: 'Unknown booking' })
  const booking = snapshot.data() as Record<string, any>
  const state = bookingInPersonState(booking)
  const existing = booking['inPersonPayment'] as BookingInPersonPayment | undefined
  const attempt = createHash('sha256').update(`${bookingId}:${attemptKey}`).digest('hex').slice(0, 40)

  if (state === 'paid') return res.status(409).json({ error: 'This booking is already paid.' })
  if (state === 'canceled') return res.status(409).json({ error: 'This booking was canceled.' })
  if (state === 'awaiting-online') {
    return res.status(409).json({ error: 'The customer is paying for this booking online right now.' })
  }

  const destination = await merchantAccount(staff.org, staff.hostId)
  if (!destination) return res.status(409).json({ error: 'Finish setting up payments before taking cards.' })

  // The merchant's own service tax, off unless they set one (AGL-2028): the
  // same rate a paid booking is charged online.
  const tax = pluginTaxProfile().flatTax(
    await pluginTaxProfile().flatRate(staff.hostId, 'service'),
    serviceCents,
    'Service tax',
  )
  const amountCents = serviceCents + tax.taxCents
  const feeCents = resolveTransactionFeeCents(staff.org as never, 'service', serviceCents, amountCents)

  // A pending intent for this booking that is not this attempt's: release it
  // first, so one booking never has two cards in flight.
  if (existing?.status === 'pending' && existing.paymentIntentId) {
    const sameAttempt = existing.attempt === attempt
    if (sameAttempt) {
      const replay = await stripe('GET', `payment_intents/${existing.paymentIntentId}`)
      if (replay.ok && replay.body?.client_secret) {
        return res.status(200).json(startAnswer(existing, String(replay.body.client_secret)))
      }
    } else {
      const released = await releaseIntent(existing.paymentIntentId)
      if (!released) {
        return res.status(409).json({
          error: 'A card was already authorized for this booking. Settle it before starting another payment.',
        })
      }
    }
  }

  const intent = await stripe('POST', 'payment_intents', {
    idempotencyKey: `booking-in-person:${attempt}`,
    params: {
      amount: amountCents,
      currency: 'usd',
      'payment_method_types[]': 'card_present',
      capture_method: 'manual',
      'transfer_data[destination]': destination,
      ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
      description: `Booking: ${String(booking['serviceName'] ?? 'appointment').slice(0, 80)}`,
      'metadata[type]': 'booking-in-person',
      'metadata[hostId]': staff.hostId,
      'metadata[bookingId]': bookingId,
      'metadata[feeCents]': feeCents,
      'metadata[cashierId]': staff.uid,
      ...(tax.taxCents > 0 ? { 'metadata[taxCents]': tax.taxCents, 'metadata[taxPct]': tax.pct } : {}),
    },
  })
  if (!intent.ok || !intent.body?.id || !intent.body?.client_secret) {
    return res.status(502).json({ error: stripeMessage(intent.body, 'The card payment could not be started.') })
  }
  const payment: BookingInPersonPayment = {
    paymentIntentId: String(intent.body.id),
    amountCents,
    serviceCents,
    taxCents: tax.taxCents,
    feeCents,
    status: 'pending',
    startedAtMs: Date.now(),
    startedBy: staff.uid,
    attempt,
  }
  // Recorded in a transaction that re-checks the booking: a payment that
  // landed meanwhile (online, or on another device) wins, and this intent is
  // released instead of left to authorize a second charge.
  const recorded = await firebaseAdmin.app().firestore().runTransaction(async (transaction: any) => {
    const fresh = await transaction.get(ref)
    const freshState = bookingInPersonState((fresh.data() ?? {}) as Record<string, any>)
    const freshPending = fresh.get('inPersonPayment') as BookingInPersonPayment | undefined
    if (freshState === 'paid' || freshState === 'canceled' || freshState === 'awaiting-online') return false
    if (
      freshPending?.status === 'pending' &&
      freshPending.paymentIntentId !== payment.paymentIntentId &&
      freshPending.paymentIntentId !== existing?.paymentIntentId
    ) {
      return false
    }
    transaction.set(ref, { inPersonPayment: payment }, { merge: true })
    return true
  })
  if (!recorded) {
    await releaseIntent(payment.paymentIntentId)
    return res.status(409).json({ error: 'This booking changed while the payment started. Open it again.' })
  }
  return res.status(200).json(startAnswer(payment, String(intent.body.client_secret)))
}

function startAnswer(payment: BookingInPersonPayment, clientSecret: string) {
  return {
    paymentIntentId: payment.paymentIntentId,
    clientSecret,
    amountCents: payment.amountCents,
    serviceCents: payment.serviceCents,
    taxCents: payment.taxCents,
  }
}

/** Cancels an intent that holds no money yet; false when it does. */
async function releaseIntent(paymentIntentId: string): Promise<boolean> {
  const current = await stripe('GET', `payment_intents/${paymentIntentId}`)
  const status = String(current.body?.status ?? '')
  if (status === 'canceled') return true
  if (status === 'succeeded' || status === 'requires_capture' || status === 'processing') return false
  const canceled = await stripe('POST', `payment_intents/${paymentIntentId}/cancel`, {
    idempotencyKey: `booking-in-person-cancel:${paymentIntentId}`,
  })
  return canceled.ok || String(canceled.body?.status ?? '') === 'canceled'
}

async function settle(staff: Staff, bookingId: string, res: Res) {
  const ref = bookingRef(staff.hostId, bookingId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return res.status(404).json({ error: 'Unknown booking' })
  const payment = snapshot.get('inPersonPayment') as BookingInPersonPayment | undefined
  if (payment?.status === 'paid') return res.status(200).json({ status: 'paid', amountCents: payment.amountCents })
  if (!payment || payment.status !== 'pending' || !PAYMENT_INTENT_ID.test(String(payment.paymentIntentId))) {
    return res.status(409).json({ error: 'No card payment is in progress for this booking.' })
  }
  let intent = (await stripe('GET', `payment_intents/${payment.paymentIntentId}`)).body
  // The intent must be the one this route made for THIS booking on THIS site.
  if (
    intent?.metadata?.type !== 'booking-in-person' ||
    intent?.metadata?.hostId !== staff.hostId ||
    intent?.metadata?.bookingId !== bookingId
  ) {
    return res.status(409).json({ error: 'That payment is not for this booking.' })
  }
  if (intent.status === 'requires_capture') {
    const captured = await stripe('POST', `payment_intents/${payment.paymentIntentId}/capture`, {
      idempotencyKey: `booking-in-person-capture:${payment.paymentIntentId}`,
      params: payment.feeCents > 0 ? { application_fee_amount: payment.feeCents } : {},
    })
    if (!captured.ok) {
      return res.status(502).json({ error: stripeMessage(captured.body, 'The card could not be charged. Try again.') })
    }
    intent = captured.body
  }
  if (intent?.status !== 'succeeded') {
    // Not collected yet, declined, or canceled: the booking stays payable.
    const status = intent?.status === 'canceled' ? 'canceled' : 'pending'
    if (status === 'canceled') {
      await ref.set({ inPersonPayment: { ...payment, status: 'canceled' } }, { merge: true })
    }
    return res.status(200).json({ status })
  }
  const paidAmountCents = Math.max(0, Math.round(Number(intent.amount_received ?? intent.amount ?? 0)))
  const paidAtMs = Date.now()
  await firebaseAdmin.app().firestore().runTransaction(async (transaction: any) => {
    const fresh = await transaction.get(ref)
    if (fresh.get('paymentIntentId')) return
    transaction.set(
      ref,
      {
        // The same fields an online payment writes (billing-webhook.ts), so
        // the console's refund and dispute handling read it unchanged.
        paidAmountCents,
        paymentIntentId: payment.paymentIntentId,
        feeCents: payment.feeCents,
        taxMode: pluginTaxProfile().taxModeOf(intent, payment.taxCents),
        ...(payment.taxCents > 0 ? { taxCents: payment.taxCents } : {}),
        paidInPerson: true,
        inPersonPayment: { ...payment, status: 'paid', paidAtMs },
      },
      { merge: true },
    )
  })
  return res.status(200).json({ status: 'paid', amountCents: paidAmountCents })
}

async function cancel(staff: Staff, bookingId: string, res: Res) {
  const ref = bookingRef(staff.hostId, bookingId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return res.status(404).json({ error: 'Unknown booking' })
  const payment = snapshot.get('inPersonPayment') as BookingInPersonPayment | undefined
  if (!payment || payment.status !== 'pending') return res.status(200).json({ status: 'none' })
  if (!(await releaseIntent(payment.paymentIntentId))) {
    return res.status(409).json({ error: 'The card was already authorized. Settle the payment instead.' })
  }
  await ref.set({ inPersonPayment: { ...payment, status: 'canceled' } }, { merge: true })
  return res.status(200).json({ status: 'canceled' })
}
