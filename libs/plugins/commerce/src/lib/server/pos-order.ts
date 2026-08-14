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
import { buildRoute, Route, type PluginApiHandler } from '@aglyn/aglyn/server'
import { createHash } from 'crypto'

/**
 * A claim on one settlement attempt (AGL-1691).
 *
 * `replay` is set when this key has already been settled — the caller must
 * return the recorded response instead of transacting again.
 */
interface AttemptClaim {
  /** Stripe idempotency key for this attempt, or null when the client sent none. */
  stripeKey: string | null
  record: (status: number, body: unknown) => Promise<void>
  release: () => Promise<void>
}

/**
 * Take an exclusive claim on a settlement attempt, so a retry cannot mint a
 * second order or a second Checkout session (AGL-1691).
 *
 * The key is supplied by the client, once per checkout attempt — deliberately
 * NOT derived from the basket. A cashier ringing the same coffee twice in a
 * minute is a real second sale, and a content hash would silently swallow it;
 * that would be a worse bug than the one this closes. So the client mints a
 * key when a basket first becomes an attempt and retires it when the register
 * resets, which makes the key stable across a retry of THAT attempt and
 * distinct for a legitimately identical next one.
 *
 * Storage reuses the REST API's shape (`apiIdempotency/{sha256(scope:key)}`,
 * AGL-618) rather than inventing a second replay collection, and carries the
 * same `orgId` field, so `eraseOrgIdempotencyKeys` already sweeps these on
 * org erasure (AGL-1448) with no change there.
 *
 * The claim is `create()` — Firestore rejects a create on an existing document,
 * and that rejection is the whole dedupe primitive. A read-then-write would
 * race exactly the double-submit it is meant to stop.
 */
async function claimAttempt(
  firestore: FirebaseFirestore.Firestore,
  scope: { hostId: string; orgId: string; key: string },
): Promise<{ claim: AttemptClaim } | { replay: { status: number; body: unknown } }> {
  // No key: transact as before. This endpoint is a plugin API route and an
  // older cached console bundle must keep selling rather than start failing.
  if (!scope.key) {
    return {
      claim: {
        stripeKey: null,
        record: async () => undefined,
        release: async () => undefined,
      },
    }
  }
  const digest = createHash('sha256')
    .update(`pos:${scope.hostId}:${scope.key}`)
    .digest('hex')
  const ref = firestore.collection('apiIdempotency').doc(digest)
  try {
    await ref.create({
      orgId: scope.orgId || null,
      hostId: scope.hostId,
      kind: 'pos-order',
      status: 'pending',
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    })
  } catch {
    // Already claimed: either the attempt finished and we replay its result,
    // or it is still in flight.
    const prior = await ref.get()
    const priorResponse = prior.get('response')
    if (priorResponse) {
      return {
        replay: {
          status: Number(prior.get('responseStatus') ?? 200),
          body: priorResponse,
        },
      }
    }
    // In flight. Fail CLOSED — the money direction. The alternative (letting
    // the second caller through) is the duplicate charge itself. A process
    // killed between the claim and the record leaves a key stuck here; the
    // cashier starts a fresh sale with a fresh key, which is the correct
    // failure direction even though it is not a pleasant one.
    return {
      replay: {
        status: 409,
        body: { error: 'This sale is already being processed' },
      },
    }
  }
  return {
    claim: {
      // Same digest handed to Stripe, so even if our claim is lost after the
      // Checkout call, Stripe replays its own session rather than opening a
      // second one. Scoped by host and attempt, so it cannot collide.
      stripeKey: digest,
      record: async (status, body) => {
        await ref
          .set(
            {
              status: 'done',
              responseStatus: status,
              response: body,
              settledAtMs: Date.now(),
            },
            { merge: true },
          )
          .catch(() => undefined)
      },
      // A rejected or failed attempt must not burn the key: the cashier fixes
      // the cause and presses the same button.
      release: async () => {
        await ref.delete().catch(() => undefined)
      },
    },
  }
}

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
      hostId,
      orgId: String(ownerOrg?.org?.id ?? ''),
      key: idempotencyKey,
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
    if (payment === 'folio') {
      const reservationRef = hostRef
        .collection('reservations')
        .doc(reservationId)
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
    if (customerEmail) {
      void upsertHostContact({
        hostId,
        email: customerEmail,
        source: 'order',
        interaction: {
          refId: orderRef.id,
          summary: `In-store purchase ($${(totals.totalCents / 100).toFixed(2)})`,
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
