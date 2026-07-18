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
import { type PluginApiHandler } from '@aglyn/aglyn/server'

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
  if (!hostId || rawLines.length === 0) {
    return res.status(400).json({ error: 'Missing hostId or lines' })
  }

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
      const params = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(totals.totalCents),
        'line_items[0][price_data][product_data][name]': 'In-store purchase',
        'payment_intent_data[transfer_data][destination]': String(accountId),
        success_url: `https://${req.headers.host}/${hostId}/pos?paid=1`,
        cancel_url: `https://${req.headers.host}/${hostId}/pos?paid=0`,
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
          },
          body: params.toString(),
        },
      )
      const session = (await response.json()) as { url?: string; error?: any }
      if (!response.ok || !session.url) {
        await orderRef.delete().catch(() => undefined)
        return res.status(502).json({ error: 'Payment link failed' })
      }
      return res
        .status(200)
        .json({ orderId: orderRef.id, url: session.url, totals })
    }

    // Cash (or folio) sale: paid immediately.
    if (payment === 'cash' && cashReceivedCents < totals.totalCents) {
      return res.status(400).json({ error: 'Cash received is short' })
    }
    if (payment === 'folio' && !reservationId) {
      return res.status(400).json({ error: 'Pick a reservation' })
    }
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
    return res.status(200).json({
      orderId: orderRef.id,
      totals,
      changeCents:
        payment === 'cash' ? cashReceivedCents - totals.totalCents : 0,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Sale failed' })
  }
}
