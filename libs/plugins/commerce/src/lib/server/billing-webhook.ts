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
  findUserByUidAcrossPools,
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
  notifyHostManagers,
  upsertHostContact,
  renderHostEmailWithTokens,
} from '@aglyn/tenant-data-admin'
import { createHmac } from 'crypto'
import {
  isEmailConfigured,
  sendEmail,
} from '@aglyn/shared-util-email'
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
  // White-label brand per host (White-Label Phase 3): every storefront email
  // this webhook sends — receipts, gift cards, reservation and sale notices,
  // supplier notices — reads as the store's brand. Resolved once per host from
  // the org doc through the one shared resolver, memoized for the event.
  const brandCache = new Map<string, Aglyn.ResolvedBrandingProfile>()
  const brandFor = async (
    hostId: string | number,
  ): Promise<Aglyn.ResolvedBrandingProfile> => {
    const key = String(hostId)
    const cached = brandCache.get(key)
    if (cached) return cached
    const org = await getOrgForHost(key).catch(() => null)
    const brand = Aglyn.resolveBrandingProfile(org?.org as never)
    brandCache.set(key, brand)
    return brand
  }

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
        // AGL-1732: this branch used to write the subscription doc and stop —
        // productId, email, name, customer id, status. NO money, anywhere. Not
        // as an order (subscriptions are deliberately not orders: the docs, the
        // console and the tenant account page all keep the two apart), but not
        // on the subscription doc either, and not in the manager notification
        // or the contact record. A merchant asking "what is this subscriber
        // paying me?" had exactly one answer available: log in to Stripe.
        //
        // The sale is now decomposed and stored ON THE SUBSCRIPTION, which is
        // the record this product already treats as the subscription's home.
        // `computeBuyNowOrder` is the right decomposition rather than a
        // parallel one: a subscription session is built by the SAME
        // `checkout.ts` function, carrying the same `unitAmountCents` /
        // `quantity` / `taxCents` / `discountCents` metadata snapshot, so the
        // two sessions differ only in `mode`. It reads Stripe's own
        // `total_details` through `computeCheckoutSessionTotals` — including
        // the `amount_shipping` AGL-1698 added — so nothing here re-derives a
        // figure Stripe already holds.
        //
        // This records the INITIAL charge only. Renewals arrive as
        // `invoice.payment_succeeded`, which this webhook does not handle at
        // all; see the follow-up filed with AGL-1732.
        const productForSnapshot = await hostRef
          .collection('products')
          .doc(String(productId))
          .get()
        const liftedForSnapshot = CommerceModel.liftLegacyProduct(
          (productForSnapshot.data() as any) ?? { name: 'Product' },
        )
        const soldVariant = object.metadata?.variantId
          ? liftedForSnapshot.variants.find(
              (item) => item.id === String(object.metadata.variantId),
            )
          : liftedForSnapshot.variants[0]
        const variantOptions = Object.values(soldVariant?.options ?? {})
        const { lineItems: subLineItems, totals: subTotals } =
          CommerceModel.computeBuyNowOrder(object, {
            name: String(productForSnapshot.get('name') ?? 'Product'),
            ...(variantOptions.length
              ? { variantLabel: variantOptions.join(' / ') }
              : {}),
            ...(soldVariant?.sku ? { sku: soldVariant.sku } : {}),
            ...(liftedForSnapshot.type
              ? { productType: liftedForSnapshot.type }
              : {}),
          })
        const subscriptionRef = hostRef
          .collection('subscriptions')
          .doc(String(object.subscription))
        // Redelivery guard (AGL-1732, the AGL-498 shape). Stripe delivers at
        // least once, and the effects below this write are NOT idempotent —
        // `upsertHostContact`'s `purchaseCents` is a `FieldValue.increment`, so
        // a replay would inflate the subscriber's lifetime value and their
        // order count on every retry.
        //
        // Keyed on `checkoutSessionId` rather than on the document existing:
        // `customer.subscription.created` writes the SAME doc path (status and
        // period end only) and Stripe does not order the two events, so an
        // existence check would discard the sale record whenever that event
        // won the race.
        const recorded = await firestore.runTransaction(async (transaction) => {
          const existing = await transaction.get(subscriptionRef)
          if (existing.get('checkoutSessionId') === String(object.id)) {
            return false
          }
          transaction.set(
            subscriptionRef,
            {
              productId: String(productId),
              ...(object.metadata?.variantId
                ? { variantId: String(object.metadata.variantId) }
                : {}),
              customerEmail: object?.customer_details?.email ?? null,
              customerName: object?.customer_details?.name ?? null,
              stripeCustomerId: String(object?.customer ?? '') || null,
              status: 'active',
              // What was bought, and for how much (AGL-1732). The interval
              // comes from the product doc because the amount alone is
              // ambiguous — $50 a month and $50 a year are the same number.
              lineItems: subLineItems,
              totals: subTotals,
              ...(liftedForSnapshot.subscription?.interval
                ? { interval: liftedForSnapshot.subscription.interval }
                : {}),
              checkoutSessionId: String(object.id),
              createdAtMs: Date.now(),
            },
            { merge: true },
          )
          return true
        })
        if (!recorded) return
        const subscriptionCents = Number(subTotals.totalCents ?? 0)
        void notifyHostManagers(String(hostId), {
          type: 'content.order',
          // The amount rides the title exactly as the order notification's
          // does (AGL-1732) — "New subscriber" alone never said what for.
          title: `New subscriber — $${(subscriptionCents / 100).toFixed(2)}${
            liftedForSnapshot.subscription?.interval
              ? `/${liftedForSnapshot.subscription.interval}`
              : ''
          }`,
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
          // RFM (AGL-328) counted a subscriber as having spent nothing, so
          // the customer paying every month looked colder than a one-off
          // buyer. The initial charge is real money and belongs in LTV.
          ...(subscriptionCents > 0 ? { purchaseCents: subscriptionCents } : {}),
          interaction: {
            refId: String(object.subscription),
            summary: `Started a subscription ($${(subscriptionCents / 100).toFixed(2)})`,
          },
        })
      }
    }

    // Storefront subscription RENEWALS (AGL-1743).
    //
    // `invoice.payment_succeeded` was unhandled repo-wide, so after AGL-1732
    // gave the INITIAL charge a home, month 2 onward still took the customer's
    // money and produced no record anywhere — not in orders, not in analytics,
    // not on the contact's `ltvCents`, not on the subscription document, whose
    // `totals` stayed frozen at the opening charge however the real one moved.
    //
    // ## What a renewal produces, and what it deliberately does not
    //
    // It does NOT produce an order. Subscriptions are not orders in this
    // product — the merchant docs say so, the console keeps Orders and
    // Subscriptions apart, the tenant account page renders them separately —
    // and AGL-1732 established that on three independent sources. Whether a
    // PHYSICAL subscription's renewal should ALSO produce a fulfilment
    // artifact to pick, pack and label against is a genuine open question
    // (AGL-1743 §1) that carries a channel decision with it (§2), and guessing
    // it wrong writes rows into merchant-facing tables and revenue charts that
    // would then need unpicking.
    //
    // What is unambiguous is that the money must be RECOVERABLE: which cycle
    // was paid, when, by whom, for what, and for how much. So each paid
    // invoice is recorded as its own document under the subscription — the
    // ledger this product was missing — and rolled up onto the subscription
    // itself, which is the record the member drawer already reads.
    //
    // ## Both invoice events, one record
    //
    // Stripe sends `invoice.paid` AND `invoice.payment_succeeded` for the same
    // payment, and which of them this endpoint receives is dashboard
    // configuration no code in this repo can see (the console route handles
    // `invoice.paid` for PLATFORM billing, which is the only evidence either
    // is enabled). Handling both means the branch fires whichever is on; the
    // invoice-id guard means having both on records the cycle once.
    if (type === 'invoice.payment_succeeded' || type === 'invoice.paid') {
      // The SUBSCRIPTION's metadata, which is what `checkout.ts` sets
      // (`subscription_data[metadata]`) — the invoice's own `metadata` is a
      // different, empty bag. `parent.subscription_details` is where newer API
      // versions moved it; both are read because the endpoint's version is not
      // visible from here.
      const subscriptionMeta =
        object?.subscription_details?.metadata ??
        object?.parent?.subscription_details?.metadata ??
        null
      const invoiceId = String(object?.id ?? '')
      const subscriptionId = String(
        object?.subscription ??
          object?.parent?.subscription_details?.subscription ??
          '',
      )
      const invoiceHostId = String(subscriptionMeta?.hostId ?? '')
      // Platform billing — Aglyn charging its own customers — runs through the
      // same endpoint and the same fan-out, and its invoices carry `orgId`
      // instead. Self-selection is on the same discriminator every other
      // section of this file uses.
      if (
        subscriptionMeta?.type === 'commerce-subscription' &&
        invoiceHostId &&
        subscriptionId &&
        invoiceId
      ) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(invoiceHostId)
        const subscriptionRef = hostRef
          .collection('subscriptions')
          .doc(subscriptionId)
        const invoiceRef = subscriptionRef.collection('invoices').doc(invoiceId)
        // The product identity comes from what the sale already recorded: an
        // invoice line knows a description and a price, never a productId, a
        // variant or a SKU. Subscriptions sold before AGL-1732 have no stored
        // line items, so those fall back to the product doc — one extra read,
        // and only for them.
        const soldSnapshot = await subscriptionRef.get()
        const soldLine = ((soldSnapshot.get('lineItems') ?? []) as
          | CommerceModel.OrderLineItem[]
          | undefined)?.[0]
        const productId = String(
          soldLine?.productId ??
            soldSnapshot.get('productId') ??
            subscriptionMeta?.productId ??
            '',
        )
        let snapshot: CommerceModel.BuyNowProductSnapshot & {
          productId: string
          variantId?: string
        }
        if (soldLine) {
          snapshot = {
            productId,
            ...(soldLine.variantId ? { variantId: soldLine.variantId } : {}),
            name: soldLine.name,
            ...(soldLine.variantLabel
              ? { variantLabel: soldLine.variantLabel }
              : {}),
            ...(soldLine.sku ? { sku: soldLine.sku } : {}),
            ...(soldLine.productType
              ? { productType: soldLine.productType }
              : {}),
          }
        } else {
          const productSnapshot = await hostRef
            .collection('products')
            .doc(productId || '__missing__')
            .get()
          const lifted = CommerceModel.liftLegacyProduct(
            (productSnapshot.data() as any) ?? { name: 'Subscription' },
          )
          const variantId = String(soldSnapshot.get('variantId') ?? '')
          const variant = variantId
            ? lifted.variants.find((item) => item.id === variantId)
            : lifted.variants[0]
          const variantOptions = Object.values(variant?.options ?? {})
          snapshot = {
            productId,
            ...(variantId ? { variantId } : {}),
            name: String(productSnapshot.get('name') ?? 'Subscription'),
            ...(variantOptions.length
              ? { variantLabel: variantOptions.join(' / ') }
              : {}),
            ...(variant?.sku ? { sku: variant.sku } : {}),
            ...(lifted.type ? { productType: lifted.type } : {}),
          }
        }
        const { lineItems: invoiceLineItems, totals: invoiceTotals } =
          CommerceModel.computeSubscriptionInvoiceOrder(object, snapshot)
        const paidCents = Math.max(0, Math.round(Number(object?.amount_paid ?? 0)))
        const billingReason = String(object?.billing_reason ?? '')
        // The subscription's FIRST invoice is also a paid invoice, and
        // `checkout.session.completed` has already counted that money into the
        // contact's lifetime value and already told the managers about it
        // (AGL-1732). Recording it again would double every subscriber's
        // opening value. It is still written as an invoice document — that is
        // the ledger, and it must not have a hole where cycle 1 belongs.
        const isOpeningInvoice = billingReason === 'subscription_create'
        const interval = CommerceModel.subscriptionInvoiceInterval(object)
        const paidAtMs = object?.status_transitions?.paid_at
          ? Number(object.status_transitions.paid_at) * 1000
          : Date.now()
        const periodEndMs = object?.period_end
          ? Number(object.period_end) * 1000
          : null
        // Idempotency, keyed on the INVOICE id (AGL-1743). Existence of the
        // invoice document IS that key — the doc id is the invoice id — and
        // unlike the AGL-1732 guard, which could not use existence because
        // `customer.subscription.created` writes the same subscription path,
        // nothing but this branch ever writes here. It also absorbs the
        // `invoice.paid` / `invoice.payment_succeeded` pair for one payment.
        //
        // The roll-up accumulates by reading inside the transaction rather
        // than with `FieldValue.increment`: the read is already happening for
        // the guard, and a lifetime total that can only be verified by
        // replaying every event is not a total a merchant can reconcile.
        const recorded = await firestore.runTransaction(async (transaction) => {
          const existingInvoice = await transaction.get(invoiceRef)
          if (existingInvoice.exists) return false
          const currentSubscription = await transaction.get(subscriptionRef)
          transaction.set(invoiceRef, {
            invoiceId,
            subscriptionId,
            billingReason,
            ...(object?.number ? { number: String(object.number) } : {}),
            currency: String(object?.currency ?? 'usd'),
            paidCents,
            /** Stripe's own total, which a credit balance can exceed. */
            invoiceTotalCents: Math.max(
              0,
              Math.round(Number(object?.total ?? paidCents)),
            ),
            lineItems: invoiceLineItems,
            totals: invoiceTotals,
            ...(interval ? { interval } : {}),
            paidAtMs,
            periodStartMs: object?.period_start
              ? Number(object.period_start) * 1000
              : null,
            periodEndMs,
            customerEmail:
              object?.customer_email ??
              currentSubscription.get('customerEmail') ??
              null,
            ...(object?.hosted_invoice_url
              ? { hostedInvoiceUrl: String(object.hosted_invoice_url) }
              : {}),
          })
          transaction.set(
            subscriptionRef,
            {
              lastInvoiceId: invoiceId,
              lastPaymentCents: paidCents,
              lastPaymentAtMs: paidAtMs,
              ...(periodEndMs ? { paidThroughMs: periodEndMs } : {}),
              paidCents:
                Math.max(0, Number(currentSubscription.get('paidCents') ?? 0)) +
                paidCents,
              invoicesCount:
                Math.max(
                  0,
                  Number(currentSubscription.get('invoicesCount') ?? 0),
                ) + 1,
              // What the subscriber pays NOW, replacing the frozen opening
              // charge — the divergence this issue is about. Never from the
              // opening invoice, whose richer decomposition the session
              // already stored, and never from a zero one: a trial's first
              // invoice is $0 and would wipe the recorded sale to nothing.
              ...(!isOpeningInvoice && paidCents > 0
                ? { totals: invoiceTotals, ...(interval ? { interval } : {}) }
                : {}),
            },
            { merge: true },
          )
          return true
        })
        if (!recorded) return
        if (!isOpeningInvoice && paidCents > 0) {
          const renewalEmail =
            object?.customer_email ?? soldSnapshot.get('customerEmail') ?? null
          // The console has no Subscriptions tab, so until the order question
          // is answered this notification is the only place a merchant learns
          // that the money arrived at all — and, for a physical box, the only
          // signal that something is due to ship.
          void notifyHostManagers(invoiceHostId, {
            type: 'content.order',
            title: `Subscription renewed — $${(paidCents / 100).toFixed(2)}${
              interval ? `/${interval}` : ''
            }`,
            ...(renewalEmail ? { body: String(renewalEmail) } : {}),
            link: `/${invoiceHostId}/products`,
          })
          // RFM (AGL-328): a subscriber in month 12 has paid twelve times, and
          // counting only the first charge ranks them as a one-purchase
          // customer forever. Keyed to the invoice so the guard above is what
          // stops a redelivery inflating it.
          void upsertHostContact({
            hostId: invoiceHostId,
            email: renewalEmail,
            ...(soldSnapshot.get('customerName')
              ? { name: String(soldSnapshot.get('customerName')) }
              : {}),
            source: 'order',
            purchaseCents: paidCents,
            interaction: {
              refId: invoiceId,
              summary: `Subscription renewed ($${(paidCents / 100).toFixed(2)})`,
            },
          })
        }
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
          const guestEmail = object?.customer_details?.email
          if (guestEmail) {
            const checkIn = new Date(
              Number(snapshot.get('checkInDayMs')),
            ).toUTCString()
            const paid = `$${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}`
            const checkInShort = checkIn.slice(0, 16)
            const fallbackText =
              `Your stay is confirmed!\n\nCheck-in: ${checkInShort}\n` +
              `Nights: ${snapshot.get('nights')}\n` +
              `Paid today: ${paid}\n` +
              `Reference: ${reservationId}`
            // Site-owner-designed template when published (AGL-771).
            const designed = await renderHostEmailWithTokens(
              firebaseAdmin.app().firestore(),
              String(hostId),
              'reservation-confirmed',
              {
                'reservation.checkIn': checkInShort,
                'reservation.nights': String(snapshot.get('nights') ?? ''),
                'reservation.paid': paid,
                'reservation.ref': String(reservationId),
              },
            )
            await sendEmail({
              to: guestEmail,
              subject: designed?.subject ?? 'Reservation confirmed',
              text: designed?.text || fallbackText,
              ...(designed?.html ? { html: designed.html } : {}),
              fromName: (await brandFor(hostId)).fromName,
              context: 'reservation confirmation',
            })
            // Cost meter (AGL-1438). Transactional: the guest has paid, and a
            // confirmation a quota refused reads as a failed reservation.
            await meterHostEmail(String(hostId))
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
          // AGL-1698: reads all THREE of `total_details` — the shipping used
          // to be dropped here, storing `shippingCents: 0` on every online
          // order while the shopper's shipping sat inside `amount_total`.
          const totals = CommerceModel.computeCheckoutSessionTotals(
            lineItems,
            object,
            { feeCents: Number(feeCents ?? 0) },
          )
          transaction.set(orderRef, {
            number,
            status: 'paid',
            channel: 'online',
            lineItems,
            totals,
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
        const buyerEmailForReceipt = object?.customer_details?.email
        if (isEmailConfigured() && buyerEmailForReceipt) {
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
          const orderTotal = `$${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}`
          const orderSummary = [linesText, licenseText, downloadLines]
            .filter(Boolean)
            .join('\n\n')
          const fallbackText =
            `Thanks for your purchase!\n\n${linesText}\n\n` +
            (licenseText ? `${licenseText}\n\n` : '') +
            (downloadLines ? `${downloadLines}\n\n` : '') +
            `Total: ${orderTotal}\n` +
            `Order reference: ${object.id}` +
            (receiptFooter ? `\n\n${receiptFooter}` : '')
          // Site-owner-designed template when published (AGL-771). The
          // license keys and download links ride in {{order.summary}}.
          const designed = await renderHostEmailWithTokens(
            firebaseAdmin.app().firestore(),
            String(hostId),
            'order-receipt',
            {
              'order.summary': orderSummary,
              'order.total': orderTotal,
              'order.ref': String(object.id),
            },
          )
          await sendEmail({
            to: buyerEmailForReceipt,
            subject: designed?.subject ?? `Receipt for your order`,
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            fromName: (await brandFor(hostId)).fromName,
            context: 'cart receipt',
          })
          // Cost meter (AGL-1438). Transactional: a dropped receipt looks to
          // the buyer like an order that did not go through.
          await meterHostEmail(String(hostId))
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
            const giftTo = object?.customer_details?.email
            if (giftTo) {
              const giftValue = `$${(line.unitAmountCents / 100).toFixed(2)}`
              const fallbackText =
                `Gift card code: ${code}\n` +
                `Value: ${giftValue}\n\n` +
                'Enter it at checkout to apply the balance.'
              // Site-owner-designed template when published (AGL-771).
              const designed = await renderHostEmailWithTokens(
                firebaseAdmin.app().firestore(),
                String(hostId),
                'gift-card',
                { 'giftcard.code': code, 'giftcard.value': giftValue },
              )
              await sendEmail({
                to: giftTo,
                subject: designed?.subject ?? 'Your gift card',
                text: designed?.text || fallbackText,
                ...(designed?.html ? { html: designed.html } : {}),
                fromName: (await brandFor(hostId)).fromName,
                context: 'gift card',
              })
              // Cost meter (AGL-1438). Transactional: this email IS the
              // purchased goods.
              await meterHostEmail(String(hostId))
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
        // Redelivery guard (AGL-1748), the AGL-1732/AGL-498 shape. The
        // `pending` -> `paid` transition was always the guard, but it used to
        // be a read-then-write with every side effect below hanging off it, so
        // two concurrent deliveries could both observe `pending` and both run
        // them — a doubled manager notification, a doubled inventory decrement
        // and, now that this branch feeds contacts, a doubled
        // `FieldValue.increment` on the buyer's lifetime value.
        //
        // Keyed on the STATUS rather than on the document existing, which is
        // where this differs from AGL-1732: there, a sibling event wrote the
        // same path, so an existence check would have discarded the sale
        // record. Here the console (or the POS card path) pre-creates the order
        // before the session exists, so existence is guaranteed and says
        // nothing; only the transition distinguishes the first delivery.
        let paidOrder: CommerceModel.HostOrder | null = null
        const flipped = await firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(orderRef)
          if (!snapshot.exists) return false
          const lifted = CommerceModel.liftLegacyOrder(
            (snapshot.data() as any) ?? {},
          )
          if (lifted.status !== 'pending') return false
          paidOrder = lifted
          transaction.set(
            orderRef,
            {
              status: 'paid',
              paymentIntentId: String(object?.payment_intent ?? '') || null,
              customerEmail:
                object?.customer_details?.email ?? lifted.customerEmail ?? null,
              timeline: CommerceModel.appendOrderEvent(lifted, 'paid'),
            },
            { merge: true },
          )
          return true
        })
        if (flipped) {
          const order = paidOrder as unknown as CommerceModel.HostOrder
          void notifyHostManagers(String(hostId), {
            type: 'content.order',
            title: `Draft order paid — ${CommerceModel.formatOrderNumber(order, String(orderId))}`,
            link: `/${hostId}/products`,
          })
          // Contacts ingestion (AGL-1748): this branch flipped the order,
          // notified managers and decremented stock, but never reached
          // `upsertHostContact` — so a buyer who paid a merchant-sent payment
          // link never became a contact AT ALL, and neither did a POS card
          // customer, because `pos-order.ts` completes its QR sale through this
          // same `commerce-draft` branch rather than through its own handler.
          //
          // The amount is what Stripe charged (`amount_total`), for the
          // AGL-1698/AGL-1711 reason — the stored `totals.totalCents` is the
          // figure the draft was priced at, and the two agree by construction,
          // but only one of them is the money that moved. Stored totals remain
          // the fallback for a session shape that reports no total.
          const draftEmail =
            object?.customer_details?.email ?? order.customerEmail ?? null
          if (draftEmail) {
            const chargedCents =
              Number(object?.amount_total ?? 0) ||
              Number(order.totals?.totalCents ?? 0)
            void upsertHostContact({
              hostId: String(hostId),
              email: draftEmail,
              name: object?.customer_details?.name ?? undefined,
              source: 'order',
              ...(chargedCents > 0 ? { purchaseCents: chargedCents } : {}),
              interaction: {
                refId: String(orderId),
                summary: `Paid ${CommerceModel.formatOrderNumber(
                  order,
                  String(orderId),
                )} ($${(chargedCents / 100).toFixed(2)})`,
              },
            })
          }
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
        // AGL-1711: the line item and totals used to be fabricated from
        // `amount_total` alone — one unit, priced at the whole charge, with tax
        // and discount recorded as 0. `computeBuyNowOrder` rebuilds the real
        // decomposition from Stripe's `total_details` plus the two components
        // our own session shape hides from it (the manual tax line item and the
        // coupon priced into the unit amount), both carried in the metadata.
        const liftedForSnapshot = CommerceModel.liftLegacyProduct(
          (productForSnapshot.data() as any) ?? { name: snapshotName },
        )
        const soldVariant = object.metadata?.variantId
          ? liftedForSnapshot.variants.find(
              (item) => item.id === String(object.metadata.variantId),
            )
          : liftedForSnapshot.variants[0]
        const variantOptions = Object.values(soldVariant?.options ?? {})
        const { lineItems: buyNowLineItems, totals: buyNowTotals } =
          CommerceModel.computeBuyNowOrder(object, {
            name: snapshotName,
            ...(variantOptions.length
              ? { variantLabel: variantOptions.join(' / ') }
              : {}),
            ...(soldVariant?.sku ? { sku: soldVariant.sku } : {}),
            ...(liftedForSnapshot.type
              ? { productType: liftedForSnapshot.type }
              : {}),
            ...(liftedForSnapshot.supplierId
              ? { supplierId: liftedForSnapshot.supplierId }
              : {}),
          })
        const soldQuantity = buyNowLineItems[0]?.quantity ?? 1
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
            lineItems: buyNowLineItems,
            totals: buyNowTotals,
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
              // AGL-1711: the supplier was told to ship one unit however many
              // the buyer paid for.
              quantity: soldQuantity,
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
            if (supplier.email) {
              await sendEmail({
                to: supplier.email,
                subject: `New order to fulfill: ${payload.productName}`,
                text:
                  `${payload.quantity}× ${payload.productName}\n` +
                  `Ship to: ${payload.shippingName ?? payload.customerEmail ?? 'see order'}\n\n` +
                  `Add tracking: ${payload.updateUrl}&trackingNumber=TRACKING&carrier=CARRIER`,
                fromName: (await brandFor(hostId)).fromName,
                context: 'dropship supplier notice',
              })
              // Cost meter (AGL-1438). Transactional: without it the order is
              // never fulfilled.
              await meterHostEmail(String(hostId))
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
            // AGL-1711: `-1` regardless of how many units were bought, so a
            // 3-unit buy-now sale decremented stock by one and the difference
            // was silently oversellable. `canPurchase` already gated the full
            // quantity at checkout, so this is the only place it was dropped.
            const variants = CommerceModel.adjustVariantInventory(
              lifted,
              soldVariantId,
              -soldQuantity,
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
                delta: -soldQuantity,
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
        if (isEmailConfigured()) {
          const productName = String(
            productSnapshot.get('name') ?? 'your purchase',
          )
          const amount = (Number(object?.amount_total ?? 0) / 100).toFixed(2)
          const buyerEmail = object?.customer_details?.email
          const orderTotal = `$${amount}`
          if (buyerEmail) {
            const fallbackText =
              `Thanks for your purchase!\n\n${productName} — $${amount}` +
              `\nOrder reference: ${object.id}`
            // Site-owner-designed template when published (AGL-771).
            const designed = await renderHostEmailWithTokens(
              firebaseAdmin.app().firestore(),
              String(hostId),
              'order-receipt',
              {
                'order.summary': productName,
                'order.total': orderTotal,
                'order.ref': String(object.id),
              },
            )
            await sendEmail({
              to: String(buyerEmail),
              subject: designed?.subject ?? `Receipt: ${productName}`,
              text: designed?.text || fallbackText,
              ...(designed?.html ? { html: designed.html } : {}),
              fromName: (await brandFor(hostId)).fromName,
              context: 'receipt',
            })
            // Cost meter (AGL-1438). Transactional, as the cart receipt above.
            await meterHostEmail(String(hostId))
          }
          const hostSnapshot = await hostRef.get()
          const sellerUid = (await getOrgForHost(String(hostId)))?.org
            ?.ownerUid
          if (sellerUid) {
            // Across pools (AGL-1144/AGL-1122). This was a project-level
            // `getUser`, which THROWS `auth/user-not-found` for a seller who
            // signs in through SSO — their record lives in their org's GCIP
            // tenant. The `.catch(() => null)` then skipped the block
            // entirely, so an SSO merchant was never told they had made a
            // sale, on any order, ever, with nothing logged.
            //
            // The order itself was never at risk: this runs after payment,
            // the buyer's receipt above uses the address from the order, and
            // no payout logic reads this. It is a notification, and it was
            // silently absent for exactly the customers on the plan that has
            // SSO.
            const seller = (await findUserByUidAcrossPools(sellerUid).catch(
              () => null,
            ))?.record
            if (seller?.email) {
              const siteName = String(
                hostSnapshot.get('displayName') ?? hostId,
              )
              const fallbackText =
                `You made a sale on ${siteName}!\n\n${productName} — $${amount}` +
                (buyerEmail ? `\nBuyer: ${buyerEmail}` : '') +
                `\nOrder reference: ${object.id}`
              // Site-owner-designed template when published (AGL-771).
              const designed = await renderHostEmailWithTokens(
                firebaseAdmin.app().firestore(),
                String(hostId),
                'sale-notification',
                {
                  'site.name': siteName,
                  'order.summary': `${productName} — $${amount}`,
                  'order.total': orderTotal,
                  'buyer.email': String(buyerEmail ?? ''),
                  'order.ref': String(object.id),
                },
              )
              await sendEmail({
                to: seller.email,
                subject: designed?.subject ?? `New order: ${productName}`,
                text: designed?.text || fallbackText,
                ...(designed?.html ? { html: designed.html } : {}),
                fromName: (await brandFor(hostId)).fromName,
                context: 'seller order notice',
              })
              // Cost meter (AGL-1438). Transactional: the seller learns about
              // the order here.
              await meterHostEmail(String(hostId))
            }
          }
        }
      }
    }
}
