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

import type { BillingWebhookHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  notifyHostManagers,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { createHmac } from 'crypto'
import * as CommerceModel from '../model'
import { mintDownloadToken, tokenSigningSecret } from './download'

/**
 * Assigns unassigned license keys for a digital product (AGL-308):
 * stamps order/email on the key docs, returns the key strings, and
 * nudges managers when the pool runs low.
 */
async function assignLicenseKeys(
  hostRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  productId: string,
  orderId: string,
  email: string | null,
  quantity: number,
): Promise<string[]> {
  try {
    const pool = await hostRef
      .collection('licenseKeys')
      .where('productId', '==', productId)
      .where('assignedAtMs', '==', null)
      .limit(Math.max(1, quantity))
      .get()
    const keys: string[] = []
    for (const docSnapshot of pool.docs) {
      await docSnapshot.ref.set(
        { orderId, email, assignedAtMs: Date.now() },
        { merge: true },
      )
      keys.push(String(docSnapshot.get('key')))
    }
    if (keys.length) {
      const remaining = await hostRef
        .collection('licenseKeys')
        .where('productId', '==', productId)
        .where('assignedAtMs', '==', null)
        .limit(6)
        .get()
      if (remaining.size < 5) {
        void notifyHostManagers(hostId, {
          type: 'content.lowStock',
          title: 'License key pool running low',
          body: `${remaining.size} keys left`,
          link: `/${hostId}/products`,
        })
      }
    }
    return keys
  } catch (error) {
    console.error('license key assignment failed', error)
    return []
  }
}

/**
 * Commerce sections of the platform Stripe webhook (AGL-418): relocated
 * verbatim from the console route — subscriptions sync, reservations,
 * cart orders, draft orders, Commerce Starter orders, plus the license-key
 * assignment helper (AGL-308). Registered via registerCommerceConsoleApi;
 * every section is idempotent by doc key and self-selects on
 * `object.metadata.type`, exactly as the inline route sections did.
 */
export const commerceBillingWebhookHandler: BillingWebhookHandler = async ({
  type,
  object,
  requestHost,
}) => {
  if (
    type === 'customer.subscription.created' ||
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.deleted'
  ) {
      // Storefront subscription status sync (AGL-303).
      if (object?.metadata?.type === 'commerce-subscription') {
        const subHostId = object?.metadata?.hostId
        if (subHostId) {
          await firebaseAdmin
            .app()
            .firestore()
            .collection('hosts')
            .doc(String(subHostId))
            .collection('subscriptions')
            .doc(String(object.id))
            .set(
              {
                status:
                  type === 'customer.subscription.deleted'
                    ? 'canceled'
                    : String(object?.status ?? 'active'),
                currentPeriodEndMs: object?.current_period_end
                  ? object.current_period_end * 1000
                  : null,
              },
              { merge: true },
            )
            .catch(() => undefined)
        }
      }
  }

    // Storefront subscriptions (AGL-303): record the sub under the host;
    // status then follows customer.subscription.* events below.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-subscription' &&
      object?.subscription
    ) {
      const { hostId, productId } = object.metadata ?? {}
      if (hostId && productId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        await hostRef
          .collection('subscriptions')
          .doc(String(object.subscription))
          .set(
            {
              productId: String(productId),
              customerEmail: object?.customer_details?.email ?? null,
              customerName: object?.customer_details?.name ?? null,
              stripeCustomerId: String(object?.customer ?? '') || null,
              status: 'active',
              createdAtMs: Date.now(),
            },
            { merge: true },
          )
        void notifyHostManagers(String(hostId), {
          type: 'content.order',
          title: 'New subscriber',
          ...(object?.customer_details?.email
            ? { body: object.customer_details.email }
            : {}),
          link: `/${hostId}/products`,
        })
        void upsertHostContact({
          hostId: String(hostId),
          email: object?.customer_details?.email,
          name: object?.customer_details?.name ?? undefined,
          source: 'order',
          interaction: {
            refId: String(object.subscription),
            summary: 'Started a subscription',
          },
        })
      }
    }

    // Reservations (AGL-310): payment confirms the pending hold.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-reservation' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, reservationId } = object.metadata ?? {}
      if (hostId && reservationId) {
        const firestore = firebaseAdmin.app().firestore()
        const reservationRef = firestore
          .collection('hosts')
          .doc(String(hostId))
          .collection('reservations')
          .doc(String(reservationId))
        const snapshot = await reservationRef.get()
        if (snapshot.exists && snapshot.get('status') === 'pending') {
          await reservationRef.set(
            {
              status: 'confirmed',
              paidCents: Number(object?.amount_total ?? 0),
              checkoutSessionId: String(object.id),
              paymentIntentId: String(object?.payment_intent ?? '') || null,
            },
            { merge: true },
          )
          void notifyHostManagers(String(hostId), {
            type: 'content.booking',
            title: 'New reservation',
            ...(object?.customer_details?.email
              ? { body: object.customer_details.email }
              : {}),
            link: `/${hostId}/products`,
          })
          void upsertHostContact({
            hostId: String(hostId),
            email: object?.customer_details?.email,
            name: object?.customer_details?.name ?? undefined,
            source: 'booking',
            interaction: {
              refId: String(reservationId),
              summary: 'Reserved a stay',
            },
          })
          const reservationResendKey = process.env.RESEND_API_KEY
          const reservationEmailFrom = process.env.USAGE_EMAIL_FROM
          const guestEmail = object?.customer_details?.email
          if (reservationResendKey && reservationEmailFrom && guestEmail) {
            const checkIn = new Date(
              Number(snapshot.get('checkInDayMs')),
            ).toUTCString()
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${reservationResendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: reservationEmailFrom,
                to: [guestEmail],
                subject: 'Reservation confirmed',
                text:
                  `Your stay is confirmed!\n\nCheck-in: ${checkIn.slice(0, 16)}\n` +
                  `Nights: ${snapshot.get('nights')}\n` +
                  `Paid today: $${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}\n` +
                  `Reference: ${reservationId}`,
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
        const cart = (cartSnapshot.data() as CommerceModel.HostCart | undefined) ?? {
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
              ? CommerceModel.liftLegacyProduct(snapshot.data() as any)
              : null,
          ]),
        )
        const lineItems: CommerceModel.OrderLineItem[] = cart.lines
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
          .filter(Boolean) as CommerceModel.OrderLineItem[]
        const shipping = object?.shipping_details ?? object?.customer_details
        const created = await firestore.runTransaction(async (transaction) => {
          const [existing, counter] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(counterRef),
          ])
          if (existing.exists) return false
          const number = Number(counter.get('next') ?? 1)
          transaction.set(counterRef, { next: number + 1 }, { merge: true })
          const totals = CommerceModel.computeOrderTotals(lineItems, {
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
          return true
        })
        // Redelivery/replay guard (AGL-498): only fulfil when the order was
        // just created. A duplicate delivery finds it already there and skips
        // the non-idempotent effects below (inventory / coupon / gift-card
        // decrements) that would otherwise double-apply.
        if (!created) return
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
          // License keys (AGL-308) per digital line.
          const licenseKeysByProduct: Record<string, string[]> = {}
          for (const line of lineItems) {
            if (line.productType !== 'digital') continue
            const keys = await assignLicenseKeys(
              hostRef,
              String(hostId),
              line.productId,
              String(object.id),
              object?.customer_details?.email ?? null,
              line.quantity,
            )
            if (keys.length) licenseKeysByProduct[line.productId] = keys
          }
          if (Object.keys(licenseKeysByProduct).length) {
            await orderRef
              .set({ licenseKeys: licenseKeysByProduct }, { merge: true })
              .catch(() => undefined)
          }
          const licenseText = Object.entries(licenseKeysByProduct)
            .flatMap(([keyProductId, keys]) => {
              const line = lineItems.find(
                (item) => item.productId === keyProductId,
              )
              return keys.map(
                (key) => `License key (${line?.name ?? 'product'}): ${key}`,
              )
            })
            .join('\n')
          // Digital delivery links (AGL-302); reuse the canonical mint the
          // tenant download endpoint verifies so the secret can never drift.
          const downloadToken = mintDownloadToken(hostId, String(object.id))
          const siteOrigin = String(
            object?.success_url ?? '',
          ).replace(/\/\?.*$|\?.*$/, '')
          const downloadLines = lineItems
            .filter((line) => line.productType === 'digital')
            .map(
              (line) =>
                `Download ${line.name}: ${siteOrigin}/api/commerce/download` +
                `?hostId=${hostId}&orderId=${object.id}` +
                `&productId=${line.productId}&token=${downloadToken}`,
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
                (licenseText ? `${licenseText}\n\n` : '') +
                (downloadLines ? `${downloadLines}\n\n` : '') +
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
          const variants = CommerceModel.adjustVariantInventory(
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
                inventory: CommerceModel.productInventory({ variants }),
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
            } satisfies CommerceModel.InventoryAdjustment)
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
          purchaseCents: Number(object?.amount_total ?? 0),
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
        // Gift card balance decrement (AGL-322).
        if (object.metadata?.giftCardCode) {
          await hostRef
            .collection('giftCards')
            .doc(String(object.metadata.giftCardCode))
            .set(
              {
                balanceCents: firebaseAdmin.firestore.FieldValue.increment(
                  -Number(object.metadata?.giftCardCents ?? 0),
                ),
                lastUsedAtMs: Date.now(),
              },
              { merge: true },
            )
            .catch(() => undefined)
        }
        // Gift card issuance (AGL-322): each purchased gift-card line
        // mints a code for its unit price and emails it to the buyer.
        // Defense in depth (AGL-470): checkout already blocks gift-card
        // sales without the Business entitlement; re-check here so a doc
        // edited between checkout and webhook can't mint codes.
        const giftCardLines = lineItems.filter(
          (line) => productsById.get(line.productId)?.giftCard,
        )
        const giftCardsEntitled =
          giftCardLines.length > 0 &&
          Aglyn.checkEntitlement(
            (await getOrgForHost(String(hostId)))?.org as any,
            'giftCards',
          )
        for (const line of giftCardsEntitled ? giftCardLines : []) {
          const lineProduct = productsById.get(line.productId)
          if (!lineProduct?.giftCard) continue
          for (let unit = 0; unit < line.quantity; unit += 1) {
            const code = `GC-${createHmac('sha256', String(object.id))
              .update(`${line.productId}:${unit}:${Date.now()}`)
              .digest('hex')
              .slice(0, 12)
              .toUpperCase()}`
            await hostRef
              .collection('giftCards')
              .doc(code)
              .set({
                initialCents: line.unitAmountCents,
                balanceCents: line.unitAmountCents,
                recipientEmail: object?.customer_details?.email ?? null,
                orderId: String(object.id),
                createdAtMs: Date.now(),
              })
              .catch(() => undefined)
            const giftResendKey = process.env.RESEND_API_KEY
            const giftEmailFrom = process.env.USAGE_EMAIL_FROM
            const giftTo = object?.customer_details?.email
            if (giftResendKey && giftEmailFrom && giftTo) {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${giftResendKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  from: giftEmailFrom,
                  to: [giftTo],
                  subject: 'Your gift card',
                  text:
                    `Gift card code: ${code}\n` +
                    `Value: $${(line.unitAmountCents / 100).toFixed(2)}\n\n` +
                    'Enter it at checkout to apply the balance.',
                }),
              }).catch(() => undefined)
            }
          }
        }
        // Discounts engine redemptions (AGL-305).
        if (object.metadata?.discountId) {
          await hostRef
            .collection('discounts')
            .doc(String(object.metadata.discountId))
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
        const order = CommerceModel.liftLegacyOrder(
          (orderSnapshot.data() as any) ?? {},
        )
        if (orderSnapshot.exists && order.status === 'pending') {
          await orderRef.set(
            {
              status: 'paid',
              paymentIntentId: String(object?.payment_intent ?? '') || null,
              customerEmail:
                object?.customer_details?.email ?? order.customerEmail ?? null,
              timeline: CommerceModel.appendOrderEvent(order, 'paid'),
            },
            { merge: true },
          )
          void notifyHostManagers(String(hostId), {
            type: 'content.order',
            title: `Draft order paid — ${CommerceModel.formatOrderNumber(order, String(orderId))}`,
            link: `/${hostId}/products`,
          })
          if (productId) {
            const productRef = hostRef
              .collection('products')
              .doc(String(productId))
            const productSnapshot = await productRef.get()
            const lifted = CommerceModel.liftLegacyProduct(
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
              const variants = CommerceModel.adjustVariantInventory(
                lifted,
                soldVariantId,
                -quantity,
              )
              await productRef
                .set(
                  {
                    variants,
                    inventory: CommerceModel.productInventory({ variants }),
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
        const created = await firestore.runTransaction(async (transaction) => {
          const [existing, counter] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(counterRef),
          ])
          if (existing.exists) return false
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
            totals: CommerceModel.computeOrderTotals(
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
          return true
        })
        // Redelivery guard (AGL-498): skip the notification + fulfilment side
        // effects when this order already existed.
        if (!created) return
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
              | CommerceModel.HostSupplier
              | undefined
            if (!supplier) return
            const supplierToken = createHmac('sha256', tokenSigningSecret())
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
                `https://${requestHost}/api/commerce/supplier-update` +
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
          purchaseCents: Number(object?.amount_total ?? 0),
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
          const lifted = CommerceModel.liftLegacyProduct(
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
            const variants = CommerceModel.adjustVariantInventory(
              lifted,
              soldVariantId,
              -1,
            )
            const updated = { ...lifted, variants }
            await productRef
              .set(
                {
                  variants,
                  inventory: CommerceModel.productInventory(updated),
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
              } satisfies CommerceModel.InventoryAdjustment)
              .catch(() => undefined)
            // Low-stock alert (AGL-281): fires on the crossing sale only,
            // so managers get one nudge per threshold breach, not one per
            // order after it.
            if (
              CommerceModel.isLowStock(updated) &&
              !CommerceModel.isLowStock(lifted)
            ) {
              void notifyHostManagers(String(hostId), {
                type: 'content.lowStock',
                title: `Low stock — ${updated.name}`,
                body: `${CommerceModel.productInventory(updated) ?? 0} left across tracked variants`,
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
}
