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

import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import {
  firebaseAdmin,
  getOrgForHost,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import {
  buildRoute,
  claimAttempt,
  Route,
  type AttemptClaim,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'

/**
 * The settlement claim (AGL-1691) now lives in `@aglyn/aglyn/server`
 * (AGL-1697), because it is the answer for every unkeyed money route and not
 * just this one. Moved whole and unchanged in behaviour — the digest is still
 * `sha256('pos:{hostId}:{key}')`, so keys minted against the local version
 * still resolve. The only difference is the claim document: it carries
 * `scopeId` where this file wrote `hostId`, and no longer writes a
 * `serverTimestamp` sentinel alongside `createdAtMs`, since the shared version
 * takes a plain Firestore-shaped store rather than firebase-admin itself.
 */

/**
 * POS sale (AGL-312): manager-gated, server-priced. Cash sales create a
 * paid `channel: 'pos'` order immediately (with change calculation);
 * card sales mint a Stripe payment link the register shows as a QR
 * (Stripe Terminal hardware can slot in behind the same endpoint
 * later). Inventory decrements per line from the register's location,
 * and sales can post to an open reservation folio instead (AGL-317).
 */
export const posOrderHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const payment = String(body.payment ?? 'cash') as 'cash' | 'link' | 'folio'
  const cashReceivedCents = Math.round(Number(body.cashReceivedCents ?? 0))
  const customerEmail = String(body.customerEmail ?? '').trim().toLowerCase()
  const reservationId = String(body.reservationId ?? '')
  const registerId = String(body.registerId ?? '')
  const locationId = String(body.locationId ?? '')
  const discountPct = Math.min(100, Math.max(0, Number(body.discountPct ?? 0)))
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  // One settlement attempt, minted by the register (AGL-1691). Node lowercases
  // incoming headers, but read both spellings — the plugin API request type
  // makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  ).trim().slice(0, 200)
  if (!hostId || rawLines.length === 0) {
    return res.status(400).json({ error: 'Missing hostId or lines' })
  }

  let claim: AttemptClaim | null = null
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!memberRole || memberRole === 'viewer') {
      return res.status(403).json({ error: 'Not permitted' })
    }
    const ownerOrg = await getOrgForHost(hostId)
    if (!Aglyn.checkEntitlement(ownerOrg?.org as any, 'pos')) {
      return res
        .status(403)
        .json({ error: 'POS requires the Pro plan or above' })
    }
    // Register attribution + cap (AGL-472/482): a sale must run through a
    // named register that exists on this host. Creation is quota-gated by
    // the resources route, but that's creation-only — a paid→paid
    // downgrade (e.g. Business 2 → Pro 1) would otherwise keep every
    // existing register transacting. So re-check the cap at sale time:
    // rank the host's registers by creation order and refuse any whose
    // rank is beyond the plan's `posRegisters` limit. Deterministic and
    // self-healing — no data is deleted, and re-upgrading restores them.
    if (!registerId) {
      return res.status(400).json({ error: 'Missing registerId' })
    }
    const registerDocs = (
      await hostRef.collection('registers').get()
    ).docs
      .map((doc) => ({
        id: doc.id,
        createdAtMs: doc.get('createdAt')?.toMillis?.() ?? 0,
      }))
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
    const rank = registerDocs.findIndex((r) => r.id === registerId)
    if (rank < 0) {
      return res.status(404).json({ error: 'Unknown register' })
    }
    if (!Aglyn.checkQuota(ownerOrg?.org as any, 'posRegisters', rank).allowed) {
      return res.status(403).json({
        error:
          'This register is over your plan’s limit — remove extra ' +
          'registers or upgrade in Billing to use it.',
      })
    }

    // Server pricing per line.
    const uniqueIds: string[] = [
      ...new Set<string>(rawLines.map((line: any) => String(line.productId))),
    ]
    const productSnapshots = await Promise.all(
      uniqueIds.map((id) => hostRef.collection('products').doc(id).get()),
    )
    const productsById = new Map(
      productSnapshots.map((snapshot) => [
        snapshot.id,
        snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data() as any) : null,
      ]),
    )
    const lineItems: CommerceModel.OrderLineItem[] = []
    for (const raw of rawLines) {
      const product = productsById.get(String(raw.productId))
      if (!product) continue
      const variant =
        product.variants.find((item) => item.id === raw.variantId) ??
        product.variants[0]
      const quantity = Math.max(1, Math.min(99, Math.round(Number(raw.quantity ?? 1))))
      lineItems.push({
        productId: String(raw.productId),
        ...(variant.id !== 'default' ? { variantId: variant.id } : {}),
        name: product.name,
        ...(Object.keys(variant.options ?? {}).length
          ? { variantLabel: Object.values(variant.options ?? {}).join(' / ') }
          : {}),
        ...(variant.sku ? { sku: variant.sku } : {}),
        productType: product.type,
        quantity,
        unitAmountCents: Math.round(Number(variant.priceUsd) * 100),
      })
    }
    if (lineItems.length === 0) {
      return res.status(400).json({ error: 'No valid lines' })
    }
    const itemsCents = lineItems.reduce(
      (sum, line) => sum + line.unitAmountCents * line.quantity,
      0,
    )
    const discountCents = Math.round((itemsCents * discountPct) / 100)
    // Origin tax (AGL-285) — in-person sales are origin-based by nature.
    const storeSettings = await hostRef.collection('settings').doc('store').get()
    const taxSettings = (storeSettings.get('tax') ?? {}) as CommerceModel.TaxSettings
    const rate =
      taxSettings.mode === 'manual'
        ? CommerceModel.resolveTaxRate(taxSettings, taxSettings.origin ?? {})
        : null
    const taxCents =
      rate && !taxSettings.pricesIncludeTax
        ? CommerceModel.computeTaxCents(itemsCents - discountCents, rate.pct)
        : 0
    const totals = CommerceModel.computeOrderTotals(lineItems, {
      discountCents,
      taxCents,
    })

    // Deterministic tender rejections run BEFORE the claim is taken, so they
    // never burn the key (AGL-1691): "cash received is short" is a 400 the
    // cashier fixes by taking more cash and pressing the same button, and a
    // claimed key would replay the rejection forever. Hoisted above the card
    // branch so one claim site covers every tender; both are no-ops for `link`.
    if (payment === 'cash' && cashReceivedCents < totals.totalCents) {
      return res.status(400).json({ error: 'Cash received is short' })
    }
    if (payment === 'folio' && !reservationId) {
      return res.status(400).json({ error: 'Pick a reservation' })
    }

    // Point of no return: everything past here writes an order or moves money.
    const claimed = await claimAttempt(firestore, {
      kind: 'pos',
      scopeId: hostId,
      orgId: String(ownerOrg?.org?.id ?? ''),
      key: idempotencyKey,
      busyMessage: 'This sale is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim

    if (payment === 'link') {
      // QR payment link on the merchant account, completed by webhook.
      const ownerProfile = await firestore
        .collection('profiles')
        .doc(String(ownerOrg?.org?.ownerUid ?? ''))
        .get()
      const accountId = ownerProfile.get('stripeAccountId')
      if (!accountId || !ownerProfile.get('stripeChargesEnabled')) {
        return res.status(409).json({ error: 'Card payments not set up' })
      }
      const orderRef = hostRef.collection('orders').doc()
      const counterRef = hostRef.collection('counters').doc('orders')
      await firestore.runTransaction(async (transaction) => {
        const counter = await transaction.get(counterRef)
        const number = Number(counter.get('next') ?? 1)
        transaction.set(counterRef, { next: number + 1 }, { merge: true })
        transaction.set(orderRef, {
          number,
          status: 'pending',
          channel: 'pos',
          registerId,
          lineItems,
          totals,
          customerEmail: customerEmail || null,
          timeline: [{ atMs: Date.now(), event: 'pos-card-pending' }],
          createdAtMs: Date.now(),
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
      })
      // Stripe returns the cashier to the console POS page. This was
      // `/{hostDocId}/pos`, the pre-AGL-621/622 shape, so completing a card
      // sale dropped the register on a 404 (AGL-685). POS is the plugin
      // route keyed by org slug + host SUBDOMAIN; server code cannot call
      // useConsoleHostRoute, so resolve them here, and fall back to the
      // origin root rather than a fabricated dead path.
      const posOrigin = `https://${req.headers.host}`
      const posSubdomain = (
        await firestore.collection('hostIndex').doc(hostId).get()
      ).get('subdomain') as string | undefined
      const posOrgSlug = ownerOrg?.org?.slug as string | undefined
      const posUrl =
        posOrgSlug && posSubdomain
          ? `${posOrigin}${buildRoute(Route.HOST_PLUGIN, {
              orgSlug: posOrgSlug,
              host: posSubdomain,
              pluginSlug: 'pos',
            })}`
          : posOrigin
      const params = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(totals.totalCents),
        'line_items[0][price_data][product_data][name]': 'In-store purchase',
        'payment_intent_data[transfer_data][destination]': String(accountId),
        success_url: `${posUrl}?paid=1`,
        cancel_url: `${posUrl}?paid=0`,
        'metadata[type]': 'commerce-draft',
        'metadata[hostId]': hostId,
        'metadata[orderId]': orderRef.id,
      })
      const response = await fetch(
        'https://api.stripe.com/v1/checkout/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            // The half that costs real money (AGL-1691). Stripe replays the
            // existing session for a repeated key instead of opening a second
            // one on the merchant's live account, which covers the window
            // where our own claim is written but the response never arrives.
            ...(claim.stripeKey
              ? { 'Idempotency-Key': claim.stripeKey }
              : {}),
          },
          body: params.toString(),
        },
      )
      const session = (await response.json()) as { url?: string; error?: any }
      if (!response.ok || !session.url) {
        await orderRef.delete().catch(() => undefined)
        // The sale did not happen — let the same key be tried again rather
        // than locking this basket out over one flaky moment.
        await claim.release()
        return res.status(502).json({ error: 'Payment link failed' })
      }
      const cardPayload = { orderId: orderRef.id, url: session.url, totals }
      await claim.record(200, cardPayload)
      return res.status(200).json(cardPayload)
    }

    // Cash (or folio) sale: paid immediately. Tender validation for both ran
    // above, before the claim.
    const orderRef = hostRef.collection('orders').doc()
    const counterRef = hostRef.collection('counters').doc('orders')
    await firestore.runTransaction(async (transaction) => {
      const counter = await transaction.get(counterRef)
      const number = Number(counter.get('next') ?? 1)
      transaction.set(counterRef, { next: number + 1 }, { merge: true })
      transaction.set(orderRef, {
        number,
        status: 'paid',
        channel: 'pos',
        registerId,
        lineItems,
        totals,
        customerEmail: customerEmail || null,
        timeline: [
          {
            atMs: Date.now(),
            event: 'paid',
            detail:
              payment === 'folio'
                ? `Charged to reservation ${reservationId}`
                : `Cash — received $${(cashReceivedCents / 100).toFixed(2)}, ` +
                  `change $${((cashReceivedCents - totals.totalCents) / 100).toFixed(2)}`,
          },
        ],
        ...(payment === 'folio' ? { reservationId } : {}),
        createdAtMs: Date.now(),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
    })

    // Folio (AGL-317): the stay settles the charge at check-out.
    //
    // AGL-1757: this branch used to WRITE to the reservation without ever
    // READING it, which is why the guest went unrecorded. The reservation is
    // the one POS tender where the customer is already identified by the
    // system — `reserve.ts` populated `guestName`/`guestEmail` from the
    // guest's own booking — so load it here and carry that identity down to
    // the contact call below. A missing or identity-less reservation (the
    // console walk-in writes `guestEmail: null`) simply leaves these empty;
    // the read is best-effort and never fails the sale, which is already
    // paid by this point.
    let folioGuestEmail = ''
    let folioGuestName = ''
    if (payment === 'folio') {
      const reservationRef = hostRef
        .collection('reservations')
        .doc(reservationId)
      const reservationSnapshot = await reservationRef.get().catch(() => null)
      folioGuestEmail = String(reservationSnapshot?.get('guestEmail') ?? '')
        .trim()
        .toLowerCase()
      folioGuestName = String(reservationSnapshot?.get('guestName') ?? '')
        .trim()
        .slice(0, 120)
      await reservationRef
        .set(
          {
            folio: firebaseAdmin.firestore.FieldValue.arrayUnion({
              orderId: orderRef.id,
              amountCents: totals.totalCents,
              note: lineItems
                .map((line) => `${line.quantity}× ${line.name}`)
                .join(', ')
                .slice(0, 120),
              atMs: Date.now(),
            }),
          },
          { merge: true },
        )
        .catch(() => undefined)
    }

    // Inventory decrement per line (location-aware, AGL-286).
    for (const line of lineItems) {
      const product = productsById.get(line.productId)
      if (!product) continue
      const variantId = line.variantId ?? product.variants[0]?.id
      const tracked = product.variants.some(
        (variant) => variant.id === variantId && variant.inventory != null,
      )
      if (!variantId || !tracked) continue
      const variants = CommerceModel.adjustVariantInventory(
        product,
        variantId,
        -line.quantity,
        locationId || undefined,
      )
      await hostRef
        .collection('products')
        .doc(line.productId)
        .set(
          { variants, inventory: CommerceModel.productInventory({ variants }) },
          { merge: true },
        )
        .catch(() => undefined)
      await hostRef
        .collection('inventoryAdjustments')
        .add({
          productId: line.productId,
          variantId,
          delta: -line.quantity,
          reason: 'sale',
          orderId: orderRef.id,
          ...(locationId ? { locationId } : {}),
          atMs: Date.now(),
        } satisfies CommerceModel.InventoryAdjustment)
        .catch(() => undefined)
    }
    // AGL-1757: the register's email box is optional, and a room charge is
    // exactly the sale nobody stops to re-ask an email for — so a stay's
    // ancillary revenue, the part a guest house most wants to see per guest,
    // was the part most likely to be anonymous. Fall back to the reservation's
    // guest, and prefer a TYPED address when there is one: a cashier
    // correcting the guest's address should beat stale reservation data.
    //
    // The guest's name rides along only when the address we are attributing to
    // IS the reservation's guest — if the cashier redirected the receipt to
    // some other address, that person is not the named guest. Passing it is
    // safe either way: `mergeContactInteraction` keeps an existing name, so
    // this fills a blank and never clobbers a better one.
    //
    // Nothing is invented. A walk-in reservation (`guestEmail: null`) or a
    // reservationId pointing at nothing leaves this empty, and no contact is
    // created — which is the right answer, not a gap.
    const contactEmail = customerEmail || folioGuestEmail
    const contactName =
      contactEmail && contactEmail === folioGuestEmail ? folioGuestName : ''
    if (contactEmail) {
      void upsertHostContact({
        hostId,
        email: contactEmail,
        ...(contactName ? { name: contactName } : {}),
        source: 'order',
        // AGL-1748: the amount was formatted into the summary STRING below and
        // never passed to the field that exists to hold it, so `ltvCents`
        // counted online sales only — a shop-counter merchant's best customers
        // all ranked at zero. `totals.totalCents` is what the cashier actually
        // took (items + tax - discount, from `computeOrderTotals` above), not a
        // figure re-derived from the product docs.
        //
        // Gross of the platform fee and gross of refunds, matching the cart,
        // buy-now and subscription call sites; see the module note in
        // `upsert-contact.ts`. Replay safety is the `claimAttempt` above: this
        // line is past the point of no return, so a keyed double-submit never
        // reaches it, and a KEYLESS one already wrote a second order document
        // long before it got here — `purchaseCents` adds no hazard the order
        // write does not already have.
        purchaseCents: totals.totalCents,
        interaction: {
          refId: orderRef.id,
          // `source` stays `'order'` for both (AGL-1757): a folio sale is a
          // shop sale that happens to be settled against a stay, and the
          // reservation's own `'booking'` interaction already exists. Only the
          // human-readable summary distinguishes them, so a merchant reading
          // the timeline can tell a counter sale from a room charge.
          summary:
            payment === 'folio'
              ? `Room charge ($${(totals.totalCents / 100).toFixed(2)})`
              : `In-store purchase ($${(totals.totalCents / 100).toFixed(2)})`,
        },
      })
    }
    const cashPayload = {
      orderId: orderRef.id,
      totals,
      changeCents:
        payment === 'cash' ? cashReceivedCents - totals.totalCents : 0,
    }
    await claim.record(200, cashPayload)
    return res.status(200).json(cashPayload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691). The order write itself may or may not have landed; the
    // cashier reconciles from the orders list, which is the same position
    // they were in before this endpoint had a claim at all.
    await claim?.release()
    return res.status(500).json({ error: 'Sale failed' })
  }
}
