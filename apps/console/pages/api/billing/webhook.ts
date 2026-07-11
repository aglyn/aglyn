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

import * as Aglyn from '@aglyn/aglyn'
import {
  firebaseAdmin,
  getOrgForHost,
  notifyHostManagers,
  notifyOrgAdmins,
  resolveOrgMembership,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

// Stripe signs the RAW body; Next's default JSON parsing would break it.
export const config = { api: { bodyParser: false } }

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks as any)))
    req.on('error', reject)
  })
}

/** Verifies a `Stripe-Signature` header against the signing secret. */
function verifyStripeSignature(
  payload: Buffer,
  header: string,
  secret: string,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((pair) => pair.split('=') as [string, string]),
  )
  const timestamp = parts['t']
  const signature = parts['v1']
  if (!timestamp || !signature) return false
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload.toString('utf8')}`)
    .digest('hex')
  try {
    return timingSafeEqual(
      Buffer.from(expected) as any,
      Buffer.from(signature) as any,
    )
  } catch {
    return false
  }
}

/**
 * Maps a Stripe price id back to a plan via the STRIPE_PRICE_* env vars
 * (AGL-68) — fallback for subscriptions whose metadata lacks `plan`, e.g.
 * ones edited in the Stripe dashboard.
 */
function planFromPriceId(priceId: string | undefined): string | undefined {
  if (!priceId) return undefined
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter'
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro'
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return 'business'
  return undefined
}

/**
 * Stripe webhook: syncs subscription lifecycle onto the tenant doc
 * (`tenants/{tenantId}.plan/subscription/stripeCustomerId`). The tenant id
 * travels in the subscription metadata set at checkout. Entitlements resolve
 * from the plan at read time (`resolveTenantEntitlements`), so no
 * entitlement fan-out is needed here.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return res.status(501).json({ error: 'Billing is not configured.' })
  }

  const payload = await readRawBody(req)
  const signatureHeader = String(req.headers['stripe-signature'] ?? '')
  if (!verifyStripeSignature(payload, signatureHeader, secret)) {
    return res.status(400).json({ error: 'Invalid signature' })
  }

  try {
    const event = JSON.parse(payload.toString('utf8'))
    const type = String(event?.type ?? '')
    const object = event?.data?.object ?? {}

    if (
      type === 'customer.subscription.created' ||
      type === 'customer.subscription.updated' ||
      type === 'customer.subscription.deleted'
    ) {
      const tenantId = object?.metadata?.tenantId
      if (tenantId) {
        // tenantId in legacy metadata is the owner uid; new checkouts also
        // carry orgId. Orgs are the only billing target (AGL-238).
        const canceled = type === 'customer.subscription.deleted'
        const priceId = object?.items?.data?.[0]?.price?.id
        const plan = canceled
          ? 'free'
          : (object?.metadata?.plan ?? planFromPriceId(priceId) ?? 'free')
        const billing = {
          plan,
          stripeCustomerId: object?.customer ?? null,
          subscription: {
            status: canceled ? 'canceled' : (object?.status ?? 'active'),
            priceId: object?.items?.data?.[0]?.price?.id ?? null,
            currentPeriodEnd: object?.current_period_end
              ? new Date(object.current_period_end * 1000)
              : null,
          },
        }
        const orgId =
          object?.metadata?.orgId ??
          (await resolveOrgMembership(tenantId))?.orgId ??
          null
        if (orgId) {
          await firebaseAdmin
            .app()
            .firestore()
            .collection('orgs')
            .doc(String(orgId))
            .set(billing, { merge: true })
        }
      }
    }

    // Billing notifications (AGL-259): invoice availability and failed
    // payments reach the org's admins in-app. The org resolves from the
    // Stripe customer mirrored on the org doc.
    if (
      type === 'invoice.finalized' ||
      type === 'invoice.paid' ||
      type === 'invoice.payment_failed'
    ) {
      const customerId = String(object?.customer ?? '')
      if (customerId) {
        const orgs = await firebaseAdmin
          .app()
          .firestore()
          .collection('orgs')
          .where('stripeCustomerId', '==', customerId)
          .limit(1)
          .get()
        const orgId = orgs.docs[0]?.id
        if (orgId) {
          const amount = Number(object?.amount_due ?? object?.amount_paid ?? 0)
          const dollars = (amount / 100).toFixed(2)
          void notifyOrgAdmins(orgId, {
            type:
              type === 'invoice.payment_failed'
                ? 'billing.paymentFailed'
                : 'billing.invoice',
            title:
              type === 'invoice.payment_failed'
                ? `Payment failed for your $${dollars} invoice`
                : `Your $${dollars} invoice is available`,
            link: '/org/billing',
          })
        }
      }
    }

    // Marketplace purchases (AGL-46): keyed by session id (idempotent on
    // Stripe redelivery). Install gating and the seller ledger read these.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'community-purchase' &&
      object?.payment_status === 'paid'
    ) {
      const { listingId, buyerUid, sellerUid, feeCents } =
        object.metadata ?? {}
      if (listingId && buyerUid && sellerUid) {
        await firebaseAdmin
          .app()
          .firestore()
          .collection('communityPurchases')
          .doc(String(object.id))
          .set({
            listingId,
            buyerUid,
            sellerUid,
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
      }
    }
    // Paid bookings (AGL-170): payment confirms the pendingPayment hold.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'booking-payment' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, bookingId } = object.metadata ?? {}
      if (hostId && bookingId) {
        const bookingRef = firebaseAdmin
          .app()
          .firestore()
          .collection('hosts')
          .doc(String(hostId))
          .collection('bookings')
          .doc(String(bookingId))
        await bookingRef.set(
          {
            status: 'confirmed',
            paidAmountCents: Number(object?.amount_total ?? 0),
            expiresAtMs: firebaseAdmin.firestore.FieldValue.delete(),
            confirmedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        // Confirmation email now that payment cleared (env-gated).
        const resendKey = process.env.RESEND_API_KEY
        const emailFrom = process.env.USAGE_EMAIL_FROM
        if (resendKey && emailFrom) {
          const booking = (await bookingRef.get()).data() ?? {}
          if (booking['email']) {
            const when = new Date(
              Number(booking['startsAtMs']),
            ).toLocaleString('en-US', {
              dateStyle: 'full',
              timeStyle: 'short',
            })
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: emailFrom,
                to: [booking['email']],
                subject: `Booking confirmed: ${booking['serviceName'] ?? ''}`,
                text:
                  `Hi ${booking['name'] ?? ''},\n\nPayment received — ` +
                  `"${booking['serviceName'] ?? 'your booking'}" is ` +
                  `confirmed for ${when}.\n\nReference: ${bookingId}`,
              }),
            }).catch(() => undefined)
          }
        }
      }
    }
    // Cart orders (AGL-293): one multi-line order from the cart doc;
    // clears the cart and decrements each line's stock.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-cart' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, cartId, feeCents, couponCode } = object.metadata ?? {}
      if (hostId && cartId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        const cartRef = hostRef.collection('carts').doc(String(cartId))
        const cartSnapshot = await cartRef.get()
        const cart = (cartSnapshot.data() as Aglyn.HostCart | undefined) ?? {
          lines: [],
        }
        const orderRef = hostRef.collection('orders').doc(String(object.id))
        const counterRef = hostRef.collection('counters').doc('orders')
        const productSnapshots = await Promise.all(
          [...new Set(cart.lines.map((line) => line.productId))].map((id) =>
            hostRef.collection('products').doc(id).get(),
          ),
        )
        const productsById = new Map(
          productSnapshots.map((snapshot) => [
            snapshot.id,
            snapshot.exists
              ? Aglyn.liftLegacyProduct(snapshot.data() as any)
              : null,
          ]),
        )
        const lineItems: Aglyn.OrderLineItem[] = cart.lines
          .map((line) => {
            const product = productsById.get(line.productId)
            if (!product) return null
            const variant = line.variantId
              ? product.variants.find((item) => item.id === line.variantId)
              : product.variants[0]
            return {
              productId: line.productId,
              ...(line.variantId ? { variantId: line.variantId } : {}),
              name: product.name,
              ...(variant && Object.keys(variant.options ?? {}).length
                ? {
                    variantLabel: Object.values(variant.options ?? {}).join(
                      ' / ',
                    ),
                  }
                : {}),
              ...(variant?.sku ? { sku: variant.sku } : {}),
              productType: product.type,
              ...(product.supplierId
                ? { supplierId: product.supplierId }
                : {}),
              quantity: line.quantity,
              unitAmountCents: Math.round(
                Number(variant?.priceUsd ?? 0) * 100,
              ),
            }
          })
          .filter(Boolean) as Aglyn.OrderLineItem[]
        const shipping = object?.shipping_details ?? object?.customer_details
        await firestore.runTransaction(async (transaction) => {
          const [existing, counter] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(counterRef),
          ])
          if (existing.exists) return
          const number = Number(counter.get('next') ?? 1)
          transaction.set(counterRef, { next: number + 1 }, { merge: true })
          const totals = Aglyn.computeOrderTotals(lineItems, {
            feeCents: Number(feeCents ?? 0),
            taxCents: Number(object?.total_details?.amount_tax ?? 0),
            discountCents: Number(
              object?.total_details?.amount_discount ?? 0,
            ),
          })
          transaction.set(orderRef, {
            number,
            status: 'paid',
            channel: 'online',
            lineItems,
            totals: {
              ...totals,
              totalCents: Number(object?.amount_total ?? totals.totalCents),
            },
            timeline: [{ atMs: Date.now(), event: 'paid' }],
            paymentIntentId: String(object?.payment_intent ?? '') || null,
            checkoutSessionId: String(object.id),
            customerName: object?.customer_details?.name ?? null,
            customerEmail: object?.customer_details?.email ?? null,
            ...(shipping?.address
              ? {
                  shippingAddress: {
                    name: shipping?.name ?? undefined,
                    line1: shipping.address.line1 ?? undefined,
                    line2: shipping.address.line2 ?? undefined,
                    city: shipping.address.city ?? undefined,
                    state: shipping.address.state ?? undefined,
                    postalCode: shipping.address.postal_code ?? undefined,
                    country: shipping.address.country ?? undefined,
                  },
                }
              : {}),
            ...(couponCode ? { couponCode } : {}),
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            createdAtMs: Date.now(),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
        })
        await cartRef.delete().catch(() => undefined)
        // Recoverable checkout closes (AGL-296) so recovery emails stop;
        // the doc also carries the marketing opt-in (AGL-301).
        const checkoutRef = hostRef.collection('checkouts').doc(String(object.id))
        const checkoutSnapshot = await checkoutRef.get().catch(() => null)
        const marketingOptIn = Boolean(checkoutSnapshot?.get('marketingOptIn'))
        await checkoutRef
          .set({ status: 'completed', completedAtMs: Date.now() }, { merge: true })
          .catch(() => undefined)
        // Branded receipt (AGL-296): env-gated like every outbound email.
        const cartResendKey = process.env.RESEND_API_KEY
        const cartEmailFrom = process.env.USAGE_EMAIL_FROM
        const buyerEmailForReceipt = object?.customer_details?.email
        if (cartResendKey && cartEmailFrom && buyerEmailForReceipt) {
          const receiptSettings = await hostRef
            .collection('settings')
            .doc('store')
            .get()
            .catch(() => null)
          const receiptFooter = String(
            receiptSettings?.get('receiptFooter') ?? '',
          )
          const linesText = lineItems
            .map(
              (line) =>
                `${line.quantity}× ${line.name}${
                  line.variantLabel ? ` (${line.variantLabel})` : ''
                } — $${((line.unitAmountCents * line.quantity) / 100).toFixed(2)}`,
            )
            .join('\n')
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cartResendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: cartEmailFrom,
              to: [buyerEmailForReceipt],
              subject: `Receipt for your order`,
              text:
                `Thanks for your purchase!\n\n${linesText}\n\n` +
                `Total: $${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}\n` +
                `Order reference: ${object.id}` +
                (receiptFooter ? `\n\n${receiptFooter}` : ''),
            }),
          }).catch(() => undefined)
        }
        // Inventory per line (AGL-281 semantics).
        for (const line of cart.lines) {
          const product = productsById.get(line.productId)
          if (!product) continue
          const variantId = line.variantId ?? product.variants[0]?.id
          const tracked = product.variants.some(
            (variant) =>
              variant.id === variantId && variant.inventory != null,
          )
          if (!variantId || !tracked) continue
          const variants = Aglyn.adjustVariantInventory(
            product,
            variantId,
            -line.quantity,
          )
          await hostRef
            .collection('products')
            .doc(line.productId)
            .set(
              {
                variants,
                inventory: Aglyn.productInventory({ variants }),
              },
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
              orderId: String(object.id),
              atMs: Date.now(),
            } satisfies Aglyn.InventoryAdjustment)
            .catch(() => undefined)
        }
        void notifyHostManagers(String(hostId), {
          type: 'content.order',
          title: `New order — $${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}`,
          ...(object?.customer_details?.email
            ? { body: `From ${object.customer_details.email}` }
            : {}),
          link: `/${hostId}/products`,
        })
        void upsertHostContact({
          hostId: String(hostId),
          email: object?.customer_details?.email,
          name: object?.customer_details?.name ?? undefined,
          source: 'order',
          ...(marketingOptIn ? { marketingConsent: true } : {}),
          interaction: {
            refId: String(object.id),
            summary: `Placed an order ($${(Number(object?.amount_total ?? 0) / 100).toFixed(2)})`,
          },
        })
        if (couponCode) {
          await hostRef
            .collection('coupons')
            .doc(String(couponCode))
            .set(
              {
                redemptions: firebaseAdmin.firestore.FieldValue.increment(1),
              },
              { merge: true },
            )
            .catch(() => undefined)
        }
      }
    }
    // Draft orders (AGL-287): the console pre-created the doc; completion
    // flips it to paid, stamps the intent, and decrements stock.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-draft' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, orderId, productId } = object.metadata ?? {}
      if (hostId && orderId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        const orderRef = hostRef.collection('orders').doc(String(orderId))
        const orderSnapshot = await orderRef.get()
        const order = Aglyn.liftLegacyOrder(
          (orderSnapshot.data() as any) ?? {},
        )
        if (orderSnapshot.exists && order.status === 'pending') {
          await orderRef.set(
            {
              status: 'paid',
              paymentIntentId: String(object?.payment_intent ?? '') || null,
              customerEmail:
                object?.customer_details?.email ?? order.customerEmail ?? null,
              timeline: Aglyn.appendOrderEvent(order, 'paid'),
            },
            { merge: true },
          )
          void notifyHostManagers(String(hostId), {
            type: 'content.order',
            title: `Draft order paid — ${Aglyn.formatOrderNumber(order, String(orderId))}`,
            link: `/${hostId}/products`,
          })
          if (productId) {
            const productRef = hostRef
              .collection('products')
              .doc(String(productId))
            const productSnapshot = await productRef.get()
            const lifted = Aglyn.liftLegacyProduct(
              (productSnapshot.data() as any) ?? { name: 'Product' },
            )
            const soldVariantId =
              String(object.metadata?.variantId ?? '') ||
              lifted.variants[0]?.id
            const quantity = order.lineItems?.[0]?.quantity ?? 1
            if (
              soldVariantId &&
              lifted.variants.some(
                (variant) =>
                  variant.id === soldVariantId && variant.inventory != null,
              )
            ) {
              const variants = Aglyn.adjustVariantInventory(
                lifted,
                soldVariantId,
                -quantity,
              )
              await productRef
                .set(
                  {
                    variants,
                    inventory: Aglyn.productInventory({ variants }),
                  },
                  { merge: true },
                )
                .catch(() => undefined)
            }
          }
        }
      }
    }
    // Commerce Starter orders (AGL-90): recorded under the selling host.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-order' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, productId, feeCents, couponCode } =
        object.metadata ?? {}
      if (hostId && productId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        // Orders v1 (AGL-283): line-item snapshot + totals + timeline with
        // a per-host sequential number; legacy flat fields stay for old
        // rows/readers. Transaction keeps numbers gapless per webhook
        // delivery (replays reuse the same order doc id, so re-numbering
        // is bounded to Stripe's at-least-once edge).
        const orderRef = hostRef.collection('orders').doc(String(object.id))
        const counterRef = hostRef.collection('counters').doc('orders')
        const amountCents = Number(object?.amount_total ?? 0)
        const productForSnapshot = await hostRef
          .collection('products')
          .doc(String(productId))
          .get()
        const snapshotName = String(
          productForSnapshot.get('name') ?? 'Product',
        )
        await firestore.runTransaction(async (transaction) => {
          const [existing, counter] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(counterRef),
          ])
          if (existing.exists) return
          const number = Number(counter.get('next') ?? 1)
          transaction.set(counterRef, { next: number + 1 }, { merge: true })
          transaction.set(orderRef, {
            number,
            status: 'paid',
            channel: 'online',
            lineItems: [
              {
                productId: String(productId),
                ...(object.metadata?.variantId
                  ? { variantId: String(object.metadata.variantId) }
                  : {}),
                name: snapshotName,
                quantity: 1,
                unitAmountCents: amountCents,
              },
            ],
            totals: Aglyn.computeOrderTotals(
              [
                {
                  productId: String(productId),
                  name: snapshotName,
                  quantity: 1,
                  unitAmountCents: amountCents,
                },
              ],
              { feeCents: Number(feeCents ?? 0) },
            ),
            timeline: [{ atMs: Date.now(), event: 'paid' }],
            paymentIntentId: String(object?.payment_intent ?? '') || null,
            checkoutSessionId: String(object.id),
            customerName: object?.customer_details?.name ?? null,
            createdAtMs: Date.now(),
            // Legacy Commerce Starter fields (AGL-90).
            productId,
            amountCents,
            feeCents: Number(feeCents ?? 0),
            customerEmail: object?.customer_details?.email ?? null,
            ...(couponCode ? { couponCode } : {}),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
        })
        // In-app order notification (wave v6): host managers see sales
        // in the bell, not just the owner's email.
        void notifyHostManagers(String(hostId), {
          type: 'content.order',
          title: `New order — $${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}`,
          ...(object?.customer_details?.email
            ? { body: `From ${object.customer_details.email}` }
            : {}),
          link: `/${hostId}/products`,
        })
        // Dropship routing (AGL-289): paid lines with a supplier notify
        // it (signed webhook and/or email) and stash a callback token so
        // the supplier can post tracking back. Plan-gated; failures never
        // fail the webhook.
        void (async () => {
          try {
            const routedOrg = await getOrgForHost(String(hostId))
            if (
              !Aglyn.checkEntitlement(routedOrg?.org as any, 'dropshipRouting')
            ) {
              return
            }
            const routedProduct = await hostRef
              .collection('products')
              .doc(String(productId))
              .get()
            const supplierId = routedProduct.get('supplierId')
            if (!supplierId) return
            const supplierSnapshot = await hostRef
              .collection('suppliers')
              .doc(String(supplierId))
              .get()
            const supplier = supplierSnapshot.data() as
              | Aglyn.HostSupplier
              | undefined
            if (!supplier) return
            const supplierToken = createHmac(
              'sha256',
              process.env.STRIPE_SECRET_KEY ?? 'aglyn',
            )
              .update(`${hostId}:${object.id}:${supplierId}`)
              .digest('hex')
              .slice(0, 32)
            const orderReference = hostRef
              .collection('orders')
              .doc(String(object.id))
            await orderReference.set(
              {
                supplierToken,
                timeline: firebaseAdmin.firestore.FieldValue.arrayUnion({
                  atMs: Date.now(),
                  event: 'routed',
                  detail: `Sent to supplier ${supplier.name}`,
                }),
              },
              { merge: true },
            )
            const payload = {
              hostId: String(hostId),
              orderId: String(object.id),
              productId: String(productId),
              productName: String(routedProduct.get('name') ?? 'Product'),
              quantity: 1,
              customerEmail: object?.customer_details?.email ?? null,
              shippingName: object?.customer_details?.name ?? null,
              updateUrl:
                `https://${req.headers.host}/api/commerce/supplier-update` +
                `?hostId=${hostId}&orderId=${object.id}&token=${supplierToken}`,
            }
            if (supplier.webhookUrl) {
              const body = JSON.stringify(payload)
              const signature = createHmac(
                'sha256',
                supplier.webhookSecret ?? '',
              )
                .update(body)
                .digest('hex')
              await fetch(supplier.webhookUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-aglyn-signature': signature,
                },
                body,
              }).catch(() => undefined)
            }
            const resendKeyForSupplier = process.env.RESEND_API_KEY
            const supplierEmailFrom = process.env.USAGE_EMAIL_FROM
            if (supplier.email && resendKeyForSupplier && supplierEmailFrom) {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${resendKeyForSupplier}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: supplierEmailFrom,
                  to: [supplier.email],
                  subject: `New order to fulfill: ${payload.productName}`,
                  text:
                    `${payload.quantity}× ${payload.productName}\n` +
                    `Ship to: ${payload.shippingName ?? payload.customerEmail ?? 'see order'}\n\n` +
                    `Add tracking: ${payload.updateUrl}&trackingNumber=TRACKING&carrier=CARRIER`,
                }),
              }).catch(() => undefined)
            }
          } catch (routingError) {
            console.error('Dropship routing failed', routingError)
          }
        })()
        // Contacts ingestion (AGL-197): buyers become contacts.
        void upsertHostContact({
          hostId: String(hostId),
          email: object?.customer_details?.email,
          name: object?.customer_details?.name ?? undefined,
          source: 'order',
          interaction: {
            refId: String(object.id),
            summary: `Placed an order ($${(Number(object?.amount_total ?? 0) / 100).toFixed(2)})`,
          },
        })
        const productRef = hostRef.collection('products').doc(String(productId))
        const productSnapshot = await productRef.get()
        // Inventory decrement (AGL-281): variant-aware with an adjustment
        // log; the checkout guard makes negative stock a race-window edge,
        // and the helper floors at zero. Legacy flat `inventory` stays
        // denormalized for the Product block.
        {
          const lifted = Aglyn.liftLegacyProduct(
            (productSnapshot.data() as any) ?? { name: 'Product' },
          )
          const soldVariantId =
            String(object.metadata?.variantId ?? '') ||
            lifted.variants[0]?.id
          if (
            soldVariantId &&
            lifted.variants.some(
              (variant) =>
                variant.id === soldVariantId && variant.inventory != null,
            )
          ) {
            const variants = Aglyn.adjustVariantInventory(
              lifted,
              soldVariantId,
              -1,
            )
            const updated = { ...lifted, variants }
            await productRef
              .set(
                {
                  variants,
                  inventory: Aglyn.productInventory(updated),
                },
                { merge: true },
              )
              .catch(() => undefined)
            await hostRef
              .collection('inventoryAdjustments')
              .add({
                productId: String(productId),
                variantId: soldVariantId,
                delta: -1,
                reason: 'sale',
                orderId: String(object.id),
                atMs: Date.now(),
              } satisfies Aglyn.InventoryAdjustment)
              .catch(() => undefined)
            // Low-stock alert (AGL-281): fires on the crossing sale only,
            // so managers get one nudge per threshold breach, not one per
            // order after it.
            if (
              Aglyn.isLowStock(updated) &&
              !Aglyn.isLowStock(lifted)
            ) {
              void notifyHostManagers(String(hostId), {
                type: 'content.lowStock',
                title: `Low stock — ${updated.name}`,
                body: `${Aglyn.productInventory(updated) ?? 0} left across tracked variants`,
                link: `/${hostId}/products`,
              })
            }
          }
        }
        if (couponCode) {
          await hostRef
            .collection('coupons')
            .doc(String(couponCode))
            .set(
              {
                redemptions: firebaseAdmin.firestore.FieldValue.increment(1),
              },
              { merge: true },
            )
            .catch(() => undefined)
        }
        // Receipt + seller notification (AGL-96): env-gated like every
        // other outbound email; failures never fail the webhook.
        const resendKey = process.env.RESEND_API_KEY
        const emailFrom = process.env.USAGE_EMAIL_FROM
        if (resendKey && emailFrom) {
          const productName = String(
            productSnapshot.get('name') ?? 'your purchase',
          )
          const amount = (Number(object?.amount_total ?? 0) / 100).toFixed(2)
          const sendEmail = (to: string, subject: string, text: string) =>
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ from: emailFrom, to: [to], subject, text }),
            }).catch(() => undefined)
          const buyerEmail = object?.customer_details?.email
          if (buyerEmail) {
            await sendEmail(
              String(buyerEmail),
              `Receipt: ${productName}`,
              `Thanks for your purchase!\n\n${productName} — $${amount}` +
                `\nOrder reference: ${object.id}`,
            )
          }
          const hostSnapshot = await hostRef.get()
          const sellerUid = (await getOrgForHost(String(hostId)))?.org
            ?.ownerUid
          if (sellerUid) {
            const seller = await firebaseAdmin
              .app()
              .auth()
              .getUser(sellerUid)
              .catch(() => null)
            if (seller?.email) {
              await sendEmail(
                seller.email,
                `New order: ${productName}`,
                `You made a sale on ${String(
                  hostSnapshot.get('displayName') ?? hostId,
                )}!\n\n${productName} — $${amount}` +
                  (buyerEmail ? `\nBuyer: ${buyerEmail}` : '') +
                  `\nOrder reference: ${object.id}`,
              )
            }
          }
        }
      }
    }
    return res.status(200).json({ received: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Webhook handling failed' })
  }
}
