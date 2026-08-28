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

import type { AttemptClaim, PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { claimAttempt } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { connectLinkageIsReady } from '@aglyn/tenant-data-admin/server/stripe-account-mode'

/**
 * Reserve a stay (AGL-310): server-side quote + availability check,
 * pending reservation doc, then a Stripe session for the deposit (or
 * full amount) on the merchant's account. Webhook completion confirms
 * the reservation; abandoned pending holds expire after 30 minutes and
 * stop blocking the calendar.
 */
export const reserveHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({ error: 'Payments are not configured.' })
  }
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const resourceId = String(body.resourceId ?? '')
  const checkInDayMs = CommerceModel.toDayMs(Number(body.checkInDayMs ?? 0))
  const checkOutDayMs = CommerceModel.toDayMs(Number(body.checkOutDayMs ?? 0))
  const guestName = String(body.guestName ?? '').trim().slice(0, 120)
  const guestEmail = String(body.guestEmail ?? '').trim().toLowerCase().slice(0, 120)
  // One reservation attempt, minted by the widget (AGL-1697). Node lowercases
  // incoming headers, but read both spellings — the plugin API request type
  // makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  ).trim().slice(0, 200)
  if (!hostId || !resourceId || !checkInDayMs || !checkOutDayMs) {
    return res.status(400).json({ error: 'Missing reservation details' })
  }

  let claim: AttemptClaim | null = null
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    // Owner + payment readiness, HOISTED above the claim (AGL-1697): both are
    // deterministic refusals a merchant fixes out of band, and neither should
    // burn the guest's attempt key.
    const ownerOrg = await getOrgForHost(hostId)
    // Plan gate, re-asked per request exactly as the storefront checkout
    // asks it (AGL-1873, the AGL-481 pattern): a lapsed org's storefront
    // must not keep taking reservation deposits — at the free plan's 0%
    // transaction fee — through the one shopper-facing commerce door that
    // skipped the entitlement. Deterministic and merchant-side, so it sits
    // here above the claim with the readiness check.
    if (!Aglyn.checkEntitlement(ownerOrg?.org as any, 'commerce')) {
      return res.status(403).json({ error: 'Reservations are not enabled' })
    }
    const ownerId = ownerOrg?.org?.ownerUid
    const ownerProfile = ownerId
      ? await firestore.collection('profiles').doc(String(ownerId)).get()
      : null
    const accountId = ownerProfile?.get('stripeAccountId')
    if (
      !connectLinkageIsReady(
        {
          accountId,
          chargesEnabled: ownerProfile?.get('stripeChargesEnabled'),
          accountLivemode: ownerProfile?.get('stripeAccountLivemode'),
        },
        { subject: `reserve host ${hostId}` },
      )
    ) {
      return res.status(409).json({ error: 'Payments are not set up yet' })
    }

    // The claim sits ABOVE the availability read, and that placement is the
    // fix for this handler's particular lie (AGL-1697): a retried attempt used
    // to collide with its OWN 30-minute pending hold and be told "Those dates
    // just sold out" — about dates the guest was holding — where the correct
    // answer was the original session URL. Replaying here means the retry
    // never reaches the availability check at all. Every refusal below the
    // claim releases it, because each is deterministic and retryable.
    const claimed = await claimAttempt(firestore, {
      kind: 'commerce-reserve',
      scopeId: hostId,
      orgId: String(ownerOrg?.org?.id ?? ''),
      key: idempotencyKey,
      busyMessage: 'This reservation is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim

    // ONLY STAYS THAT COULD STILL OVERLAP, NEAREST FIRST (AGL-2159).
    //
    // This was `.where('resourceId','==',resourceId).limit(500)` with no
    // ordering, so Firestore returned 500 documents in `__name__` order — an
    // arbitrary slice of the resource's ENTIRE booking history. Every stay the
    // resource has ever had competed for those 500 slots on equal terms with
    // the ones that matter, so a cottage that had taken 500 bookings began
    // silently dropping LIVE reservations out of its own availability check
    // and confirming a second guest into an occupied room. Nothing about that
    // failure is visible: `isRangeAvailable` is handed a short list and
    // answers, correctly, that the range is free.
    //
    // `checkOutDayMs > checkInDayMs` is the one inequality that removes the
    // whole of the past — a stay that ended before the requested arrival
    // cannot overlap it — and ordering by the same field puts the stays
    // nearest the requested window at the front of the limit rather than
    // whichever ones happen to sort early by id. Needs the composite index
    // `reservations (resourceId ASC, checkOutDayMs ASC)`, added to
    // `cloud/firebase-firestore.indexes.json` and pinned by
    // `reserve-availability-indexes.spec.ts` — an equality plus an `orderBy`
    // on a second field is exactly the shape that reads as free and is not
    // (AGL-1793), and here a missing index throws rather than under-reporting.
    //
    // RESIDUAL, stated: the cap can still bite when a single resource holds
    // more than 500 stays that all end between the requested arrival and the
    // end of a genuinely overlapping one. That is a far narrower window than
    // "500 bookings in this resource's lifetime", but it is not zero, and the
    // sweep that would keep expired `pending` holds from filling those slots
    // is a scheduled job this change does not add (see the commit).
    const availabilityQuery = hostRef
      .collection('reservations')
      .where('resourceId', '==', resourceId)
      .where('checkOutDayMs', '>', checkInDayMs)
      .orderBy('checkOutDayMs')
      .limit(500)
    const [resourceSnapshot, reservationsSnapshot, storeSnapshot] =
      await Promise.all([
        hostRef.collection('resources').doc(resourceId).get(),
        availabilityQuery.get(),
        // The merchant's own lodging rate (AGL-1969). Read in the SAME round
        // trip as the availability query rather than as a fourth sequential
        // await — this path already runs three reads before it can answer, and
        // a tax lookup is not a reason to make a guest wait for a fourth.
        hostRef.collection('settings').doc('store').get(),
      ])
    const resource = resourceSnapshot.data() as CommerceModel.HostResource | undefined
    if (!resource) {
      await claim.release()
      return res.status(404).json({ error: 'Unknown resource' })
    }

    // Pending holds block for 30 minutes only, so abandoned checkouts
    // release the dates. The lapse itself lives in
    // `reservationHoldsDates`, which `isRangeAvailable` applies — this reads
    // the fields that rule needs and leaves the rule to the model, so the
    // storefront's date-picker cannot answer a different question from the
    // door that takes the money.
    //
    // Extracted so the pre-read below and the re-read inside the booking
    // transaction cannot drift apart (AGL-2450). Two copies of a filter that
    // decides whether a room is free is exactly the shape where one of them
    // quietly stops matching the other.
    const readLive = (snapshot: {
      docs: any[]
    }): CommerceModel.HostReservation[] =>
      snapshot.docs.map((docSnapshot) => ({
        checkInDayMs: Number(docSnapshot.get('checkInDayMs')),
        checkOutDayMs: Number(docSnapshot.get('checkOutDayMs')),
        status: String(
          docSnapshot.get('status'),
        ) as CommerceModel.ReservationStatus,
        createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
      })) as CommerceModel.HostReservation[]
    const now = Date.now()
    const live = readLive(reservationsSnapshot)
    if (
      !CommerceModel.isRangeAvailable(
        resource,
        live,
        checkInDayMs,
        checkOutDayMs,
        now,
      )
    ) {
      // A GENUINE sold-out (a keyed retry replayed before reaching here). The
      // guest picks other dates or the blocking stay is cancelled; either way
      // the key must survive the refusal.
      await claim.release()
      return res.status(409).json({ error: 'Those dates just sold out' })
    }
    const quote = CommerceModel.computeReservationQuote(
      resource,
      checkInDayMs,
      checkOutDayMs,
    )
    if (quote.problem) {
      await claim.release()
      return res.status(400).json({ error: quote.problem })
    }

    const chargeCents = quote.depositCents || quote.totalCents

    // LODGING TAX: the MERCHANT'S OWN RATE, off unless they set one
    // (AGL-1969, answering the decision AGL-1953 recorded here).
    //
    // What this path used to do, and why it was only ever a holding position:
    // it computed no tax in either store mode, on two stated grounds. The
    // first is still true and is the reason for the shape below — a stay is
    // not goods. The AGL-285 zone editor configures a SALES rate, lodging is
    // an occupancy/hotel regime with its own rates, its own registration and
    // its own return, and reading `rates[]` for a night would be confidently
    // wrong rather than merely absent. Stripe Tax has the mirror problem: it
    // needs a lodging tax code this handler does not send, so
    // `automatic_tax` here would compute a goods rate on a room. Neither of
    // those changes, and neither is used.
    //
    // What DID change is that the merchant now has a field of their own to
    // answer in (`tax.lodging`), so "Aglyn does not know the right number"
    // stops being a reason to collect nothing. They type the rate, we compute
    // it, charge it, record it and stamp the regime; the settings card states
    // plainly that determining what is owed and to whom is theirs. Aglyn
    // takes no tax position here — this is the manual LODGING rate, which
    // never touches Aglyn's registrations.
    //
    // ⚠️ This comment used to say "Terms §10.3 ... untouched by this". §10.3
    // CHANGED on 2026-08-24 (AGL-1956): Aglyn accepts marketplace-facilitator
    // status and new §10.7 makes storefront sales tax Aglyn's where it has a
    // collection obligation. Lodging tax is still the merchant's, so this
    // handler is unaffected — but §10.3 is no longer the authority for that.
    //
    // DEFAULT OFF, and that is load-bearing: `resolveFlatTaxCents` answers
    // zero for an absent, zero, negative or out-of-range rate, so no existing
    // reservation's charge moves because this shipped.
    //
    // THE BASIS IS WHAT IS CHARGED, AND THAT IS A STATED LIMITATION RATHER
    // THAN AN ANSWER. `chargeCents` is `depositCents || totalCents`, so on a
    // deposit-taking resource the tax collected here is the rate on the
    // DEPOSIT, not on the stay. Whether a given jurisdiction wants occupancy
    // tax on the full stay at booking, on the deposit only, or on redemption
    // at check-out is a tax question, it differs by jurisdiction, and this
    // code deliberately does NOT decide it — the amount the platform actually
    // moves is the only basis available to it, the settings card says so in
    // the merchant's own view, and the residual is on AGL-1969.
    const taxSettings = ((storeSnapshot.data() as any)?.tax ??
      {}) as CommerceModel.TaxSettings
    const lodgingTax = CommerceModel.resolveFlatTaxCents(
      taxSettings.lodging,
      chargeCents,
      'Lodging tax',
    )

    // Platform take PLUS Stripe's card cost at cost (AGL-2152). This is a
    // destination charge, so Stripe debits its percentage plus 30¢ from the
    // PLATFORM's balance; with the old take-only figure every tier carrying a
    // 0% service rate paid Aglyn nothing and cost it that fee on each
    // reservation.
    //
    // THE TWO BASES ARE NOW DIFFERENT NUMBERS (AGL-1969), and the split is
    // AGL-2317's rule: the platform take is computed on the ITEMS — the stay
    // — while Stripe's cost is passed through on the WHOLE charge, because
    // that is what Stripe actually debits. Taking a percentage of the lodging
    // tax would be taking a cut of the state's money, which no storefront
    // path does. The previous single-argument form is what made this a real
    // risk: it read as "the fee base is the charge" and would have silently
    // started taxing the tax the moment a tax line appeared.
    const feeCents = Aglyn.resolveTransactionFeeCents(
      ownerOrg?.org as any,
      'service',
      chargeCents,
      chargeCents + lodgingTax.taxCents,
    )

    // THE HOLD IS TAKEN IN A TRANSACTION (AGL-2450).
    //
    // The check above is a fast refusal on a stale read, and on its own that is
    // all it ever was: the availability query ran, the quote and the fee were
    // computed, and only then did the hold land — so two guests requesting the
    // same dates both read a reservation set that lacked the other's booking,
    // both passed, and both got a `pending` row and a real payment. Nothing
    // downstream caught it. The webhook's transaction guards double-CONFIRMATION
    // of one booking against Stripe redelivery; it never re-asks availability,
    // so both holds confirmed cleanly into two guests in one room.
    //
    // `claimAttempt` does not help either, and it is worth being explicit about
    // why: it is keyed on the guest's own `Idempotency-Key`, so it dedupes
    // retries of ONE attempt. Two different guests carry two different keys and
    // never contend.
    //
    // Re-asking inside the transaction that writes is the whole guard — the
    // same shape as `decrementVariantStock` (AGL-2320), and easier to justify
    // here: the conflicting write lands BEFORE Stripe is contacted, so this
    // door can legitimately refuse rather than take the money and withhold the
    // room.
    const reservationRef = hostRef.collection('reservations').doc()
    const booked = await firestore.runTransaction(async (transaction: any) => {
      const fresh = await transaction.get(availabilityQuery)
      // Re-timed, not reusing `now`: a transaction that retries under
      // contention may run appreciably later, and the 30-minute pending window
      // has to be measured from when this attempt actually commits.
      if (
        !CommerceModel.isRangeAvailable(
          resource,
          readLive(fresh),
          checkInDayMs,
          checkOutDayMs,
          Date.now(),
        )
      ) {
        return false
      }
      // `create()`, not `set()`: the ref is freshly minted, so an id collision
      // is a bug rather than an overwrite to absorb silently.
      transaction.create(reservationRef, {
        resourceId,
        status: 'pending',
        checkInDayMs,
        checkOutDayMs,
        guestName: guestName || null,
        guestEmail: guestEmail || null,
        nights: quote.nights,
        totalCents: quote.totalCents,
        depositCents: quote.depositCents,
        paidCents: 0,
        createdAtMs: now,
      } satisfies CommerceModel.HostReservation)
      return true
    })
    if (!booked) {
      // Lost the race for these dates. Same refusal as the pre-read's, and the
      // key survives it for the same reason: the guest picks other dates or the
      // blocking stay is cancelled.
      await claim.release()
      return res.status(409).json({ error: 'Those dates just sold out' })
    }

    const referer = String(req.headers.referer ?? '')
    const origin = `https://${req.headers.host}`
    const backUrl = referer.startsWith('http') ? referer : origin
    const separator = backUrl.includes('?') ? '&' : '?'
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(chargeCents),
      'line_items[0][price_data][product_data][name]': `${resource.name} — ${
        quote.nights
      } night${quote.nights === 1 ? '' : 's'}${
        quote.depositCents && quote.depositCents < quote.totalCents
          ? ' (deposit)'
          : ''
      }`.slice(0, 120),
      // The merchant's lodging tax as an ORDINARY product line Stripe is
      // never told is tax — the AGL-1711 construction every other manual rate
      // rides. That is what makes the derived `taxMode` read `manual`: the
      // figure is the merchant's own, computed from their own rate, and never
      // against Aglyn's registrations the way `automatic_tax` would be
      // (AGL-1904). Absent entirely when no rate is set, so a default store's
      // session carries no tax parameter of any kind.
      ...(lodgingTax.taxCents > 0
        ? {
            'line_items[1][quantity]': '1',
            'line_items[1][price_data][currency]': 'usd',
            'line_items[1][price_data][unit_amount]': String(
              lodgingTax.taxCents,
            ),
            'line_items[1][price_data][product_data][name]': lodgingTax.label,
          }
        : {}),
      ...(feeCents > 0
        ? { 'payment_intent_data[application_fee_amount]': String(feeCents) }
        : {}),
      'payment_intent_data[transfer_data][destination]': String(accountId),
      ...(guestEmail ? { customer_email: guestEmail } : {}),
      success_url: `${backUrl}${separator}reserved=1`,
      cancel_url: `${backUrl}${separator}reserved=0`,
      'metadata[type]': 'commerce-reservation',
      'metadata[hostId]': hostId,
      'metadata[reservationId]': reservationRef.id,
      'metadata[feeCents]': String(feeCents),
      // The only witness to the tax (AGL-1969). By the construction above
      // Stripe does not know the second line is tax, so it reports
      // `total_details.amount_tax: 0` — the session's own metadata is what
      // `storefront-tax-record.ts` and the confirmation branch read to record
      // the figure and derive the regime, exactly as `checkout.ts` stamps it
      // for a buy-now sale. Absent when there is no tax, never a reassuring
      // `'0'`: absent and zero are different facts on a back-book question.
      ...(lodgingTax.taxCents > 0
        ? {
            'metadata[taxCents]': String(lodgingTax.taxCents),
            'metadata[taxPct]': String(lodgingTax.pct),
          }
        : {}),
    })
    const response = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // The half that costs real money (AGL-1697). Stripe replays the
          // existing session for a repeated key instead of opening a second
          // one, covering the window where the claim is written but the
          // response never arrives.
          ...(claim.stripeKey ? { 'Idempotency-Key': claim.stripeKey } : {}),
        },
        body: params.toString(),
      },
    )
    const session = (await response.json()) as { url?: string; error?: any }
    if (!response.ok || !session.url) {
      console.error('Stripe reservation error', session.error)
      await reservationRef.delete().catch(() => undefined)
      // The hold is rolled back, so the key must come back too — the guest
      // presses the same button and the retry re-derives the same digest,
      // which Stripe replays if the session did get created.
      await claim.release()
      return res.status(502).json({ error: 'Payment setup failed' })
    }
    const payload = { url: session.url }
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule): the hold may or may not have landed, and it expires
    // in 30 minutes either way.
    await claim?.release()
    return res.status(500).json({ error: 'Reservation failed' })
  }
}
