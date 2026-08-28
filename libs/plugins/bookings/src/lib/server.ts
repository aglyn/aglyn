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

import { checkEntitlement,
  pluginJobHostGate,
  type PluginJobHostGate,
  registerPluginConfigSchema,
  registerPluginJob,
  resolveBrandingProfile,
  resolveTransactionFeeCents,
} from '@aglyn/aglyn/server'
import { type BookedInterval, BOOKING_MAX_DAYS_AHEAD, computeOpenSlots, type HostBookingService, isBookingReminderDue, isSlotOpen, REMINDER_WINDOW_END_HOURS, REMINDER_WINDOW_START_HOURS } from './model'
import {
  registerBillingWebhookHandler,
  registerPluginApiRoute,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  resolveFlatTaxCents,
  type TaxSettings,
} from '@aglyn/plugins-commerce/model'
import { BUNDLE_ID } from './constants/bundle-common'
import { BOOKINGS_CONFIG_SCHEMA } from './plugin-config'
import { bookingsBillingWebhookHandler } from './server/billing-webhook'
import { bookingAnalyticsHandler } from './server/booking-analytics'
import { bookingRefundHandler } from './server/refund'

// Settings schema (AGL-428): registered here too so server-only loads
// (API dispatchers) get defaults-merged getPluginConfig reads.
registerPluginConfigSchema(BOOKINGS_CONFIG_SCHEMA)

// Scheduled cleanup (AGL-435): lapse day-old expired payment holds to
// 'canceled' (the read paths already treat them as released — this keeps
// the collection tidy and the read-time filter cheap). Bounded + failure
// tolerant: a missing collection-group index just logs and retries on
// the next beat.
registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'expire-stale-holds',
  intervalMinutes: 6 * 60,
  description: 'Cancel pendingPayment bookings whose hold lapsed >24h ago.',
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    const cutoff = Date.now() - 24 * 60 * 60_000
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collectionGroup('bookings')
      .where('status', '==', 'pendingPayment')
      .where('expiresAtMs', '<', cutoff)
      .limit(100)
      .get()
    let lapsed = 0
    for (const doc of snapshot.docs) {
      // LOCKDOWN (AGL-2495). `bookings` live at `hosts/{hostId}/bookings/{id}`,
      // so the grandparent is the host. This flips a booking to `canceled` for
      // a site that may be suspended mid-dispute, and a status a customer can
      // see is not a change to make while the operator is deciding whether the
      // site should exist.
      //
      // SKIPPED, NOT DROPPED: the query selects on `status == 'pendingPayment'`
      // and an age cutoff that only gets truer with time, so an untouched hold
      // is picked up by the next six-hour beat after the lift. The read paths
      // already treat a lapsed hold as released, so waiting costs tidiness and
      // nothing else — which is why this one can afford to wait at all.
      const hostId = doc.ref.parent.parent?.id ?? ''
      if (await gate.isLocked(hostId)) continue
      await doc.ref.set({ status: 'canceled' }, { merge: true })
      lapsed += 1
    }
    if (lapsed) {
      console.info(`bookings: lapsed ${lapsed} stale payment holds`)
    }
  },
})
import {
  addHostLead,
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
  notifyHostManagers,
  upsertHostContact,
  getPluginConfig,
  resolveOrgIdForHost,
  renderHostEmailWithTokens,
} from '@aglyn/tenant-data-admin'
import { connectLinkageIsReady } from '@aglyn/tenant-data-admin/server/stripe-account-mode'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import {
  isEmailConfigured,
  loadHostEmail,
  renderLoadedHostEmail,
  sendEmail,
  type LoadedHostEmail,
} from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'

const BOOKING_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Best-effort per-instance rate limit (mirrors forms/submit).
const recentBookingIpHits = new Map<string, number[]>()
const BOOKING_RATE_WINDOW_MS = 60_000
const BOOKING_RATE_MAX = 5

function bookingRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentBookingIpHits.get(ip) ?? []).filter(
    (t) => now - t < BOOKING_RATE_WINDOW_MS,
  )
  hits.push(now)
  recentBookingIpHits.set(ip, hits)
  return hits.length > BOOKING_RATE_MAX
}

/**
 * Public open-slot listing (AGL-159): visitors browse a service's next
 * open times. Server-side because bookings (names/emails) must never be
 * client-readable — only the derived busy intervals are used here.
 */
// Exported for `bookings-slot-window.spec.ts`: the query's bounds are a
// read-cost and correctness property of THIS handler, and asserting them
// through the route registry would test the registry instead. Its siblings
// (`bookHandler`, the refund and analytics handlers) are exported already.
export const slotsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  const serviceId = String(req.query['serviceId'] ?? '')
  if (!hostId) {
    return res.status(400).json({ error: 'Missing hostId' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)

    // No serviceId → public service directory for the booking widget
    // (AGL-160): names/durations/prices only, never availability internals.
    if (!serviceId) {
      const services = await hostRef.collection('services').limit(50).get()
      return res.status(200).json({
        services: services.docs
          .filter((doc) => !doc.get('deletedAt'))
          .map((doc) => ({
            $id: doc.id,
            name: doc.get('name') ?? '',
            durationMinutes: Number(doc.get('durationMinutes') ?? 30),
            priceUsd: Number(doc.get('priceUsd') ?? 0),
            description: doc.get('description') ?? '',
          })),
      })
    }
    const serviceSnapshot = await hostRef
      .collection('services')
      .doc(serviceId)
      .get()
    const service = serviceSnapshot.data() as HostBookingService | undefined
    if (!service || (serviceSnapshot.get('deletedAt') as unknown)) {
      return res.status(404).json({ error: 'Unknown service' })
    }
    const fromMs = Date.now()
    // Booking horizon (AGL-428): configurable via the plugin settings
    // framework; defaults to BOOKING_MAX_DAYS_AHEAD through the schema.
    //
    // Resolved for THIS SITE (AGL-428, AGL-1014), not just the workspace.
    // The horizon is the setting per-site overrides were built for — one
    // chain, one answer, and the flagship branch taking bookings further out
    // — so reading only the org's would leave the console showing a number
    // this endpoint never honors.
    const config = await getPluginConfig(
      await resolveOrgIdForHost(hostId),
      'bookings',
      { hostId },
    )
    const maxDaysAhead = Number(config.maxDaysAhead ?? BOOKING_MAX_DAYS_AHEAD)
    const toMs = fromMs + maxDaysAhead * 24 * 60 * 60_000
    // Bounded at BOTH ends, to the window the slots are actually computed
    // over. `computeOpenSlots` below is handed `fromMs`/`toMs` and ignores
    // anything outside them, so a booking past the horizon was read, billed
    // and discarded — and worse, it competed for the 500 with the bookings
    // that do matter, so a service booked far ahead could push the near-term
    // stays out of its own availability check and offer a taken slot.
    //
    // A second range on `startsAtMs` needs no new index: the field already
    // carries one, and the range it narrows is the one already here.
    const bookedSnapshot = await hostRef
      .collection('bookings')
      .where('serviceId', '==', serviceId)
      .where('startsAtMs', '>=', fromMs - 24 * 60 * 60_000)
      .where('startsAtMs', '<=', toMs)
      .limit(500)
      .get()
    const booked: BookedInterval[] = bookedSnapshot.docs
      .filter(
        (doc) =>
          doc.get('status') !== 'canceled' &&
          // Expired payment holds release the slot (AGL-170).
          !(
            doc.get('status') === 'pendingPayment' &&
            Number(doc.get('expiresAtMs') ?? 0) < Date.now()
          ),
      )
      .map((doc) => ({
        startsAtMs: Number(doc.get('startsAtMs') ?? 0),
        endsAtMs: Number(doc.get('endsAtMs') ?? 0),
      }))
    const slots = computeOpenSlots(service, fromMs, toMs, booked, 120)
    return res.status(200).json({
      service: {
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceUsd: service.priceUsd ?? 0,
        timezone: service.timezone ?? 'UTC',
      },
      slots,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Slot lookup failed' })
  }
}

/**
 * Booking creation (AGL-159): validates the slot against the service's
 * windows AND stored bookings inside a transaction (double-booking safe),
 * stores the booking, records a lead, emits the `booking` host event, and
 * sends an env-gated Resend confirmation. Plan gate: the owning org
 * needs the `bookings` flag (dark-launch workspaces pass).
 */
/**
 * Exported for spec (AGL-2000). The tax decision this handler takes lives in
 * the ABSENCE of a parameter, and an absence is only a decision if something
 * asserts it — see `server-booking-tax.spec.ts`.
 */
export const bookHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const serviceId = String(req.body?.serviceId ?? '')
  const startsAtMs = Number(req.body?.startsAtMs ?? 0)
  const name = String(req.body?.name ?? '')
    .trim()
    .slice(0, 80)
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase()
  // Explicit opt-in checkbox (AGL-2499) — a booking is not by itself
  // consent to be emailed marketing, so this is only set when the visitor
  // checked it.
  const marketingConsent = req.body?.marketingConsent === true
  if (!hostId || !serviceId || !Number.isFinite(startsAtMs) || !startsAtMs) {
    return res.status(400).json({ error: 'Invalid booking request' })
  }
  if (!name) return res.status(400).json({ error: 'Enter your name' })
  if (!BOOKING_EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  if (startsAtMs < Date.now()) {
    return res.status(409).json({ error: 'That time has already passed' })
  }
  // Keeps counting under the no-address bucket rather than being skipped: an
  // unauthenticated booking endpoint that stops counting writes reservations
  // for anyone who can reach it.
  const ip =
    readClientIp(req.headers, { remoteAddress: req.socket?.remoteAddress }) ??
    NO_CLIENT_ADDRESS_BUCKET
  if (bookingRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many booking attempts' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [hostSnapshot, serviceSnapshot] = await Promise.all([
      hostRef.get(),
      hostRef.collection('services').doc(serviceId).get(),
    ])
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const service = serviceSnapshot.data() as HostBookingService | undefined
    if (!service || (serviceSnapshot.get('deletedAt') as unknown)) {
      return res.status(404).json({ error: 'Unknown service' })
    }

    // Plan gate (dark-launch rule preserved). Plan/quota gates ride the
    // owning org's doc (AGL-238). Hoisted out of its block for AGL-2315:
    // the same org doc now also prices the platform's cut below, and reading
    // it twice would let a gate and a fee disagree within one request.
    const ownerOrg = (await getOrgForHost(hostId))?.org
    if (!checkEntitlement(ownerOrg as never, 'bookings')) {
      return res
        .status(403)
        .json({ error: 'Bookings are not enabled on this site' })
    }

    const durationMs =
      Math.max(5, Math.round(service.durationMinutes || 30)) * 60_000
    const endsAtMs = startsAtMs + durationMs
    const bookingsRef = hostRef.collection('bookings')

    // Paid services (AGL-170): the slot is HELD pending payment — the
    // booking lands as `pendingPayment` with a 15-minute expiry (expired
    // holds release the slot in the collision filters), and the visitor
    // goes to Stripe Checkout; the webhook confirms + emails on payment.
    const priceUsd = Number(service.priceUsd ?? 0)
    const paid = priceUsd > 0
    if (paid && !process.env.STRIPE_SECRET_KEY) {
      return res.status(501).json({
        error: 'Paid bookings are not configured (STRIPE_SECRET_KEY).',
      })
    }

    // WHO GETS THE MONEY (AGL-2315). Until this landed, a paid booking opened
    // a Checkout Session with no Connect wiring of any kind — no
    // `transfer_data`, no `application_fee_amount`, no connected account read
    // anywhere in the plugin — so 100% of every paid booking settled in
    // AGLYN'S OWN platform balance and the merchant was never paid at all.
    // Not under-paid: never paid. Every sibling tenant money path (storefront
    // checkout, cart, draft orders, POS, reservations) was already a
    // destination charge to the merchant's connected account; this was the one
    // door that took a card and kept the proceeds.
    //
    // Resolved BEFORE the hold transaction on purpose, the `reserve.ts`
    // ordering: an unconnected merchant is a deterministic refusal the site
    // owner fixes out of band, and discovering it after the slot is written
    // would strand a real appointment slot as `pendingPayment` for 15 minutes
    // on a booking that could never be paid.
    let chargeAccountId = ''
    let feeCents = 0
    let serviceTax = resolveFlatTaxCents(undefined, 0, 'Service tax')
    if (paid) {
      const ownerUid = (ownerOrg as { ownerUid?: unknown } | null)?.ownerUid
      const [ownerProfile, storeSnapshot] = await Promise.all([
        ownerUid
          ? firestore.collection('profiles').doc(String(ownerUid)).get()
          : Promise.resolve(null),
        // The merchant's own service rate (AGL-2028), in the SAME round trip
        // as the connected-account read this path already makes.
        hostRef.collection('settings').doc('store').get(),
      ])
      chargeAccountId = String(ownerProfile?.get('stripeAccountId') ?? '')
      if (
        !connectLinkageIsReady(
          {
            accountId: chargeAccountId,
            chargesEnabled: ownerProfile?.get('stripeChargesEnabled'),
            accountLivemode: ownerProfile?.get('stripeAccountLivemode'),
          },
          { subject: `booking host ${hostId}` },
        )
      ) {
        return res.status(409).json({ error: 'Payments are not set up yet' })
      }

      // THE TAKE RATE IS THE STOREFRONT LADDER'S, NOT A NEW ONE (AGL-2315).
      //
      // the decision, 2026-08-19: bookings mirror the storefront ladder —
      // the same rate a storefront sale already takes, tapering to 0% on the
      // upper tiers. It is consistent with what merchants already agreed to
      // and needs no new price communication, so pricing stays locked for
      // Sept 1.
      //
      // Implemented by ROUTING THROUGH the existing resolver rather than
      // adding a bookings rate: `resolveTransactionFeePct` already carries a
      // `'service'` axis (it resolves to the digital rate), and a booking is a
      // service sale — `reserve.ts` prices a stay through the identical call.
      // So there is no new constant, no new plan-table row, and no second
      // place for a rate to drift out of step with `/pricing`. Every guard
      // that already holds for the storefront rate holds here for free: the
      // malformed-override floor (AGL-2114), the lapsed-plan re-resolution,
      // and the staff override.
      //
      // FEE BASIS: post-discount ITEMS ONLY, matching the one-time storefront
      // paths and deliberately NOT the subscription path's
      // `application_fee_percent`, which Stripe applies to the whole invoice
      // and so takes a cut of sales tax and shipping (AGL-2317). Here the two
      // bases happen to coincide, because this session carries exactly one
      // line item and, by AGL-2000's stated decision, no tax line and no
      // shipping option. That coincidence is not the reason for the choice —
      // sending a computed CENTS amount rather than a percent is what makes
      // the basis survive the day this path does compute service tax: a fee
      // derived from `priceUsd` stays off the tax the moment tax is added,
      // whereas a percent would silently start taxing the state's money.
      //
      // PLUS STRIPE'S CARD COST, AT COST (AGL-2152). A 0%-fee tier used to
      // take a destination charge with NO application fee at all, which is not
      // "no take rate" — Stripe debits 2.9% + 30¢ from the PLATFORM's balance
      // when that charge settles, so every paid booking on Pro and above cost
      // Aglyn money. `resolveTransactionFeeCents` is the same resolver's cents
      // form: the advertised take (still 0% where the ladder says 0%) plus the
      // card cost passed through, so the net per booking is the take and never
      // less. The `Math.max(1, …)` floor on a chargeable take is folded into
      // it, unchanged.
      //
      // The fee base and the charge base are the same number here: by
      // AGL-2000's stated decision this session carries one line item, no tax
      // line and no shipping option, so the card runs for exactly `priceUsd`.
      // SERVICE TAX: the MERCHANT'S OWN RATE, off unless they set one
      // (AGL-2028, answering the decision AGL-2000 recorded here).
      //
      // AGL-2000's reasoning is unchanged and is why this is a field of its
      // own rather than a reuse of the goods table. A service is not goods:
      // whether one is taxable is jurisdiction-specific and frequently the
      // opposite answer, so the AGL-285 `rates[]` are still never read here
      // — a test in `server-booking-tax.spec.ts` pins that with a fully
      // configured sales-tax store. Stripe Tax is still never asked either:
      // it has no service tax code from this handler and would compute a
      // goods rate against AGLYN's registrations (AGL-1904).
      //
      // What changed is that the merchant now has somewhere to answer. A
      // service business is one of the three named ICPs and in many states
      // their services ARE taxable, so "Aglyn does not compute it" could only
      // ever be a holding position. They type the rate, we compute it, charge
      // it, record it and stamp the regime; the settings card states plainly
      // that determining what is owed and to whom is theirs. Aglyn takes no
      // tax position, and the existence of a separate, blank-by-default field
      // is also AGL-2000's second reason answered — it is the merchant
      // saying, explicitly, that they mean this to cover bookings.
      //
      // DEFAULT OFF, and load-bearing: an absent, zero, negative or
      // out-of-range rate resolves to zero, so no existing merchant's charge
      // moves because this shipped.
      const taxSettings = ((storeSnapshot?.data() as any)?.tax ??
        {}) as TaxSettings
      const chargeCents = Math.round(priceUsd * 100)
      serviceTax = resolveFlatTaxCents(
        taxSettings.service,
        chargeCents,
        'Service tax',
      )
      // THE TWO FEE BASES ARE NOW DIFFERENT NUMBERS (AGL-2028). The take is
      // computed on the SERVICE, never on the state's money — AGL-2317's rule
      // — while Stripe's card cost is debited from the platform balance on
      // the WHOLE charge and so is passed through on the whole charge
      // (AGL-2152). The comment above already promised this: "a fee derived
      // from `priceUsd` stays off the tax the moment tax is added". This is
      // the moment.
      feeCents = resolveTransactionFeeCents(
        ownerOrg as never,
        'service',
        chargeCents,
        chargeCents + serviceTax.taxCents,
      )
    }

    // Transaction: re-read overlapping bookings and validate the slot so
    // two simultaneous requests cannot double-book.
    const bookingId = await firestore.runTransaction(async (transaction) => {
      const overlapping = await transaction.get(
        bookingsRef
          .where('serviceId', '==', serviceId)
          .where('startsAtMs', '>=', startsAtMs - 24 * 60 * 60_000)
          .limit(500),
      )
      const booked: BookedInterval[] = overlapping.docs
        .filter(
          (doc) =>
            doc.get('status') !== 'canceled' &&
            // Expired payment holds release the slot (AGL-170).
            !(
              doc.get('status') === 'pendingPayment' &&
              Number(doc.get('expiresAtMs') ?? 0) < Date.now()
            ),
        )
        .map((doc) => ({
          startsAtMs: Number(doc.get('startsAtMs') ?? 0),
          endsAtMs: Number(doc.get('endsAtMs') ?? 0),
        }))
      if (!isSlotOpen(service, startsAtMs, booked)) {
        throw Object.assign(new Error('Slot unavailable'), { code: 409 })
      }
      const bookingRef = bookingsRef.doc()
      transaction.set(bookingRef, {
        serviceId,
        serviceName: service.name ?? '',
        name,
        email,
        startsAtMs,
        endsAtMs,
        status: paid ? 'pendingPayment' : 'confirmed',
        ...(paid && { expiresAtMs: Date.now() + 15 * 60_000 }),
        createdAt: FieldValue.serverTimestamp(),
      })
      return bookingRef.id
    })

    // Contacts ingestion (AGL-197) — booking requests identify a person.
    void upsertHostContact({
      hostId,
      email,
      name: name || undefined,
      source: 'booking',
      interaction: {
        refId: bookingId,
        summary: `Booked "${String(service.name ?? 'a service').slice(0, 60)}"`,
      },
      ...(marketingConsent ? { marketingConsent: true } : {}),
    })

    if (paid) {
      const origin = req.headers.origin ?? `https://${req.headers.host}`
      // TAX ON A PAID BOOKING: the merchant's own service rate, resolved
      // above and default OFF (AGL-2028, answering AGL-2000).
      //
      // The rate rides as an ORDINARY product line Stripe is never told is
      // tax — the AGL-1711 construction every other manual rate in this
      // repo uses. That is what makes the derived `taxMode` read `manual`:
      // the figure is the merchant's own, from their own rate, and is never
      // computed against Aglyn's registrations the way `automatic_tax` would
      // be (AGL-1904). Absent entirely when no rate is set, so a default
      // store's session carries no tax parameter of any kind — the property
      // `server-booking-tax.spec.ts` asserts over the whole emitted body.
      //
      // The sale is recorded either way: `booking-payment` has been in
      // `storefront-tax-record.ts`'s SESSION_TYPES since AGL-2000, so an
      // untaxed booking still files a row reading `taxMode: 'none'` and a
      // taxed one files `manual` with the figure, both with no further
      // wiring.
      const params = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(
          Math.round(priceUsd * 100),
        ),
        'line_items[0][price_data][product_data][name]': String(
          service.name ?? 'Booking',
        ).slice(0, 120),
        ...(serviceTax.taxCents > 0
          ? {
              'line_items[1][quantity]': '1',
              'line_items[1][price_data][currency]': 'usd',
              'line_items[1][price_data][unit_amount]': String(
                serviceTax.taxCents,
              ),
              'line_items[1][price_data][product_data][name]': serviceTax.label,
            }
          : {}),
        // Destination charge to the MERCHANT's connected account (AGL-2315).
        // Unconditional: `transfer_data[destination]` is what makes this the
        // merchant's money, and it is required on every paid booking whatever
        // the take rate. Only the fee below is conditional.
        'payment_intent_data[transfer_data][destination]': chargeAccountId,
        ...(feeCents > 0
          ? { 'payment_intent_data[application_fee_amount]': String(feeCents) }
          : {}),
        // `{CHECKOUT_SESSION_ID}` is Stripe's own template token, substituted
        // on the redirect (AGL-2481). Without it the guest came back holding
        // the word `paid` and nothing else — no id, no amount — so the
        // merchant-side `purchase` had nothing to look itself up by and could
        // not have stated what was actually charged. The id is safe in the
        // URL: Stripe hands it only to the payer, and
        // `booking-analytics.ts` scopes it to the host and answers with a
        // projection rather than the booking document.
        success_url: `${origin}/?booking=paid&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?booking=canceled`,
        customer_email: email,
        'metadata[type]': 'booking-payment',
        'metadata[hostId]': hostId,
        'metadata[bookingId]': bookingId,
        // The fee actually charged, recorded on the session exactly as every
        // sibling path records it — the figure a refund reverses and the
        // figure a reconciliation reads. `'0'` on a 0%-fee tier is a real
        // answer, not a missing one.
        'metadata[feeCents]': String(feeCents),
        // The only witness to the tax (AGL-2028). By the construction above
        // Stripe does not know the second line is tax and reports
        // `total_details.amount_tax: 0`, so the session's own metadata is
        // what `storefront-tax-record.ts` and the confirmation webhook read
        // to record the figure and derive the regime — exactly as
        // `checkout.ts` stamps it for a buy-now sale. Absent when there is no
        // tax, never a reassuring `'0'`: absent and zero are different facts.
        ...(serviceTax.taxCents > 0
          ? {
              'metadata[taxCents]': String(serviceTax.taxCents),
              'metadata[taxPct]': String(serviceTax.pct),
            }
          : {}),
        expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
      })
      const stripeResponse = await fetch(
        'https://api.stripe.com/v1/checkout/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            // AGL-2147. This was the ONE session-creating path in the repo
            // with no idempotency key: console checkout, enterprise billing,
            // marketplace checkout, and commerce's checkout / cart-checkout /
            // draft-order / reservation / POS paths all carry one, and this
            // takes a card payment exactly as they do.
            //
            // Keyed on the BOOKING, not on a client-minted header: the
            // transaction above mints a fresh `bookingId` per attempt, so it
            // already names this attempt uniquely and needs no widget change
            // to supply. That also sidesteps Stripe's 24h key expiry — a key
            // reused across attempts eventually replays a session that has
            // since expired (these are opened with a 30-minute `expires_at`),
            // handing the guest a dead checkout page instead of a new one.
            //
            // What it closes: a retried POST after Stripe has already created
            // the session but before its response arrived. Without the key
            // that opens a SECOND payable session against one held slot, and
            // a guest who pays both is charged twice for one appointment.
            'Idempotency-Key': `booking-${bookingId}`,
          },
          body: params.toString(),
        },
      )
      const session = (await stripeResponse.json()) as {
        url?: string
        error?: unknown
      }
      if (!stripeResponse.ok || !session.url) {
        console.error('Stripe booking checkout error', session.error)
        // Release the hold so the slot isn't stuck for 15 minutes.
        await bookingsRef
          .doc(bookingId)
          .set({ status: 'canceled' }, { merge: true })
          .catch(() => undefined)
        return res.status(502).json({ error: 'Payment setup failed' })
      }
      // Lead lands now; the confirmation email + workflow event fire from
      // the payment webhook. Through the one writer that enforces
      // `LEADS_MAX_PER_HOST` (AGL-1529) — a refused lead never fails the
      // booking, and the trip is recorded for the site's owner either way.
      await addHostLead({
        hostRef,
        hostId,
        lead: {
          email,
          // AGL-2303 — `campaign-send` reads `leads.name` and nothing wrote
          // it, so the leads audience was addressed by nobody's name.
          ...(name ? { name } : {}),
          source: 'booking',
          ...(marketingConsent ? { marketingConsent: true } : {}),
        },
      })
      return res
        .status(200)
        .json({ bookingId, startsAtMs, endsAtMs, checkoutUrl: session.url })
    }

    // Bookings double as leads for the site owner (mirrors sign-ups), through
    // the one bounded writer (AGL-1529), same as the checkout branch above.
    await addHostLead({
      hostRef,
      hostId,
      lead: {
        email,
        // AGL-2303, same as the checkout branch above.
        ...(name ? { name } : {}),
        source: 'booking',
        ...(marketingConsent ? { marketingConsent: true } : {}),
      },
    })

    // Event trigger (AGL-128/148/159).
    // In-app notification to the site's managers (AGL-259).
    void notifyHostManagers(hostId, {
      type: 'content.booking',
      title: 'New booking',
      body: new Date(startsAtMs).toLocaleString(),
      link: `/${hostId}/bookings`,
    })
    const { alerts } = await emitHostEvent(hostId, 'booking', {
      serviceName: service.name ?? '',
      email,
      startsAtMs,
    })

    // Env-gated confirmation email (same provider as AGL-98).
    if (isEmailConfigured()) {
      const timezone = service.timezone || 'UTC'
      const when = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(startsAtMs))
      const fallbackText =
        `Hi ${name},\n\nYour booking for "${service.name}" is ` +
        `confirmed for ${when} (${timezone}).\n\n` +
        `Reference: ${bookingId}`
      // Site-owner-designed template when published (AGL-770); null keeps the
      // built-in copy above.
      const designed = await renderHostEmailWithTokens(
        firestore,
        hostId,
        'booking-confirmed',
        {
          name: String(name ?? ''),
          'service.name': String(service.name ?? ''),
          when,
          timezone,
          'booking.ref': String(bookingId),
        },
      )
      // White-label sender identity (White-Label Phase 3): the store's brand
      // via the one shared resolver, from the owning org doc.
      const branding = resolveBrandingProfile(
        (await getOrgForHost(hostId).catch(() => null))?.org as never,
      )
      await sendEmail({
        to: email,
        subject: designed?.subject ?? `Booking confirmed: ${service.name}`,
        text: designed?.text || fallbackText,
        ...(designed?.html ? { html: designed.html } : {}),
        fromName: branding.fromName,
        context: 'booking confirmation',
      })
      // Cost meter (AGL-1438). Transactional: counted, never capped — a
      // confirmation the customer never receives reads to them as a booking
      // that did not happen.
      await meterHostEmail(hostId)
    }

    return res.status(200).json({ bookingId, startsAtMs, endsAtMs, alerts })
  } catch (error: unknown) {
    if ((error as { code?: number })?.code === 409) {
      return res
        .status(409)
        .json({ error: 'That time was just taken — pick another slot' })
    }
    console.error(error)
    return res.status(500).json({ error: 'Booking failed' })
  }
}

/**
 * One reminder pass (AGL-160), extracted from its HTTP door in AGL-2431.
 *
 * Finds confirmed bookings starting 23–25 hours out (collection-group query,
 * so one call covers every host), emails each visitor through the env-gated
 * Resend path, and stamps `reminderSentAt` so re-runs are idempotent.
 *
 * WHY THIS IS A FUNCTION NOW. It only ever existed as `POST bookings/reminders`
 * behind `x-cron-secret`, and nothing anywhere POSTed to it — not
 * `scheduled-crons.yml`, not `vercel.json` (which has no `crons` key), not
 * `registerPluginJob`. The route's own docblock said "invoke hourly from the
 * scheduler" for as long as it has existed. It never ran, for anyone. Same
 * shape as the two commerce beats in AGL-2227, one plugin over.
 */
export async function scanBookingReminders(
  /** The lockdown gate, injected by the caller (AGL-2495). Not optional. */
  gate: PluginJobHostGate,
): Promise<{
  scanned: number
  sent: number
  skipped: number
  skippedLocked: number
}> {
  const firestore = firebaseAdmin.app().firestore()
  // ONE instant for the query bounds and for the per-booking predicate. Two
  // `Date.now()` calls would put a booking sitting on an edge inside the
  // query and outside the test, so the pass would fetch it, skip it, and
  // report a `skipped` the console could not explain.
  const nowMs = Date.now()
  const windowStart = nowMs + REMINDER_WINDOW_START_HOURS * 60 * 60 * 1000
  const windowEnd = nowMs + REMINDER_WINDOW_END_HOURS * 60 * 60 * 1000
  const upcoming = await firestore
    .collectionGroup('bookings')
    .where('startsAtMs', '>=', windowStart)
    .where('startsAtMs', '<=', windowEnd)
    .limit(500)
    .get()

  let sent = 0
  let skipped = 0
  let skippedLocked = 0
  // Resolve each host's designed reminder template once per run (AGL-770),
  // not once per booking — a busy site has many bookings in the window.
  const templateCache = new Map<string, LoadedHostEmail | null>()
  // White-label brand per host (White-Label Phase 3): resolved once per host
  // from the owning org doc through the one shared resolver, so a reminder
  // reads as the store's brand.
  const brandingByHost = new Map<
    string,
    ReturnType<typeof resolveBrandingProfile>
  >()
  for (const doc of upcoming.docs) {
    const data = doc.data()
    // The shared predicate, not a local copy of it (AGL-2431): the console
    // card counts what is waiting with this same function, so the number a
    // merchant reads is the number this loop will act on.
    if (!isBookingReminderDue(data as never, nowMs)) {
      skipped += 1
      continue
    }
    const when = new Date(Number(data['startsAtMs'])).toLocaleString(
      'en-US',
      { dateStyle: 'full', timeStyle: 'short' },
    )
    // bookings live at hosts/{hostId}/bookings/{id}, so the grandparent is
    // the host.
    const hostId = doc.ref.parent.parent?.id ?? ''
    // LOCKDOWN (AGL-2495), ahead of the send, the meter and the
    // `reminderSentAt` stamp — the three things this loop does, all of them
    // for the host. Counted separately from `skipped` on purpose: `skipped`
    // means "this booking was not due", and folding a locked site into it
    // would make a suspended merchant's silence read as an ordinary quiet
    // hour on the console card that shows these numbers.
    //
    // SKIPPED, NOT DROPPED: `reminderSentAt` is what retires a booking from
    // this pass, and it is stamped only on a successful send. An unstamped
    // booking is re-scanned hourly — though unlike the other five, this one
    // has a real deadline: the 23–25h window closes. A reminder whose window
    // passed under a lock is genuinely lost, and that is the correct
    // outcome, not a defect to engineer around. A site under takedown should
    // not be mailing its customers, and a reminder that arrives after the
    // appointment is worse than none.
    if (await gate.isLocked(hostId)) {
      skippedLocked += 1
      continue
    }
    let loaded = templateCache.get(hostId)
    if (loaded === undefined) {
      loaded = hostId
        ? await loadHostEmail(firestore, hostId, 'booking-reminder')
        : null
      templateCache.set(hostId, loaded)
      brandingByHost.set(
        hostId,
        resolveBrandingProfile(
          (hostId
            ? await getOrgForHost(hostId).catch(() => null)
            : null
          )?.org as never,
        ),
      )
    }
    const serviceName = String(data['serviceName'] ?? 'your booking')
    const designed = loaded
      ? renderLoadedHostEmail(loaded, {
          name: String(data['name'] ?? ''),
          'service.name': serviceName,
          when,
        })
      : null
    const result = await sendEmail({
      to: String(data['email']),
      subject: designed?.subject ?? `Reminder: ${serviceName} tomorrow`,
      text:
        designed?.text ||
        `Hi ${data['name'] ?? ''},\n\nA reminder that "${serviceName}" is ` +
          `scheduled for ${when}.\n\nReference: ${doc.id}`,
      ...(designed?.html ? { html: designed.html } : {}),
      fromName: brandingByHost.get(hostId)?.fromName,
      context: 'booking reminder',
    })
    if (result.sent) {
      // Cost meter (AGL-1438). Transactional: a reminder a quota refused is
      // a missed appointment for the site's own customer.
      await meterHostEmail(hostId)
      sent += 1
      await doc.ref
        .set(
          {
            reminderSentAt:
              firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => undefined)
    }
  }
  return { scanned: upcoming.size, sent, skipped, skippedLocked }
}

/**
 * The reminder beat (AGL-2431).
 *
 * MODULE SCOPE, like `expire-stale-holds` above and the three commerce beats:
 * the runner route reaches jobs through `ensureAll(['tenantApi'])`, so a
 * registration inside a `register*` function would depend on which entry
 * point happened to be loaded — the AGL-2227 lesson.
 *
 * HOURLY, matching the window's own resolution. The scan mails a two-hour
 * band 23–25h out, so a beat faster than the band buys nothing; a beat slower
 * than 2h could step over the band entirely and skip a day's reminders. An
 * hour sits inside that with room, and the pass is bounded (500 docs) and
 * idempotent — `reminderSentAt` is stamped on send — so an overlapping or
 * repeated beat cannot double-mail anybody.
 */
registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'booking-reminders',
  intervalMinutes: 60,
  description: 'Email a 24-hour reminder for each upcoming confirmed booking.',
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    // Quietly, not as an error: email is optional per deployment, and a beat
    // that logs hourly on a self-host without Resend buries everything else.
    if (!isEmailConfigured()) return
    const { sent } = await scanBookingReminders(gate)
    if (sent) console.info(`bookings: sent ${sent} booking reminders`)
  },
})

/**
 * The manual door, kept for ops (AGL-2431): the scheduling now lives in the
 * `booking-reminders` job above, and this stays so a pass can be forced
 * without waiting for the beat.
 */
const remindersHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res
      .status(501)
      .json({ error: 'Reminders are not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  if (!isEmailConfigured()) {
    return res.status(501).json({
      error: 'Reminders are not configured (RESEND_API_KEY, USAGE_EMAIL_FROM).',
    })
  }
  try {
    // The manual door asks the same question the beat does (AGL-2495).
    return res.status(200).json(await scanBookingReminders(pluginJobHostGate()))
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Reminders failed' })
  }
}

/** Registers the bookings plugin's public (site-facing) API routes (AGL-396). */
export function registerBookingsApi(): void {
  registerPluginApiRoute('bookings/slots', slotsHandler)
  registerPluginApiRoute('bookings/book', bookHandler)
}

/** Registers the bookings plugin's console-side API routes (AGL-396). */
export function registerBookingsConsoleApi(): void {
  registerPluginApiRoute('bookings/reminders', remindersHandler)
  // Refunding a paid booking (AGL-2315). Console-side, because it is
  // site-admin-gated and moves money — never a site-facing route.
  registerPluginApiRoute('bookings/refund', bookingRefundHandler)
  // The merchant-side `purchase` lookup (AGL-2481). A public, unauthenticated
  // read like `bookings/slots`, authorised by the unguessable Stripe session
  // id and answering with a projection that carries no guest identity.
  registerPluginApiRoute('bookings/booking-analytics', bookingAnalyticsHandler)
  // Paid-booking confirmation rides the platform Stripe webhook (AGL-418).
  registerBillingWebhookHandler(bookingsBillingWebhookHandler)
}
