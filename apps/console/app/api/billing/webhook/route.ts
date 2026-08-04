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

import { buildRoute, Route, runBillingWebhookHandlers } from '@aglyn/aglyn/server'
import {
  findOrgIdByStripeCustomer,
  firebaseAdmin,
  notifyOrgAdmins,
  writeOrgBilling,
} from '@aglyn/tenant-data-admin'
import { createHmac, timingSafeEqual } from 'crypto'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'
import {
  addonQuantitiesFromItems,
} from '../../../../utils/server/billing-addons'

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
  // Replay window (AGL-499): reject deliveries whose signed timestamp is more
  // than 5 minutes from now — matching Stripe's constructEvent default — so a
  // captured, once-valid payload cannot be replayed indefinitely.
  const timestampSeconds = Number(timestamp)
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 300
  ) {
    return false
  }
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
  for (const plan of ['starter', 'pro', 'business', 'scale', 'advanced', 'agency']) {
    const key = `STRIPE_PRICE_${plan.toUpperCase()}`
    if (
      priceId === process.env[key] ||
      priceId === process.env[`${key}_YEARLY`]
    ) {
      return plan
    }
  }
  return undefined
}

/**
 * The coupon riding a subscription, from either the legacy single `discount`
 * or the newer `discounts[]` array (AGL-1105). Returns the coupon object and
 * the promotion-code id, or null when the subscription carries no discount —
 * which is also how a removed coupon converges (the mirror is cleared).
 */
function subscriptionCoupon(object: any): {
  coupon: any
  promotionCodeId: string | null
} | null {
  const discount =
    object?.discount ??
    (Array.isArray(object?.discounts)
      ? object.discounts.find(
          (entry: any) => entry && typeof entry === 'object' && entry.coupon,
        )
      : null)
  const coupon = discount?.coupon
  if (!coupon || typeof coupon !== 'object' || !coupon.id) return null
  const promo = discount?.promotion_code
  return {
    coupon,
    promotionCodeId:
      typeof promo === 'string' ? promo : (promo?.id ?? null),
  }
}

/**
 * Stripe webhook: syncs subscription lifecycle onto the org doc
 * (`orgs/{orgId}.plan/subscription/stripeCustomerId`). The org id travels
 * in the subscription metadata set at checkout (`metadata[orgId]`,
 * AGL-445). Entitlements resolve from the plan at read time
 * (`resolveOrgEntitlements`), so no entitlement fan-out is needed here.
 */
async function handler(request: Request): Promise<Response> {
  // Stripe signs the RAW body: read the exact bytes off the Web request
  // (nothing else may consume the stream first) — no bodyParser config
  // needed on the App Router.
  const method = request.method
  const headers = Object.fromEntries(request.headers) as Partial<
    Record<string, string>
  >
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  // Test-mode fallback (AGL-547): the test-mode webhook endpoint signs with
  // its own secret, so deliveries for test-mode tenant checkouts verify
  // against STRIPE_WEBHOOK_SECRET_TEST when the live secret rejects (or is
  // unset). Secrets are never logged.
  const testSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST
  if (!secret && !testSecret) {
    return Response.json({ error: 'Billing is not configured.' }, { status: 501 })
  }

  const payload = Buffer.from(await request.arrayBuffer())
  const signatureHeader = String(headers['stripe-signature'] ?? '')
  const verified =
    (secret
      ? verifyStripeSignature(payload, signatureHeader, secret)
      : false) ||
    (testSecret
      ? verifyStripeSignature(payload, signatureHeader, testSecret)
      : false)
  if (!verified) {
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: any
  try {
    event = JSON.parse(payload.toString('utf8'))
  } catch {
    return Response.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const type = String(event?.type ?? '')
  const object = event?.data?.object ?? {}

  // Idempotency (AGL-498): claim the Stripe event id before running any side
  // effects so a redelivery (or a replayed request) can't re-apply the
  // non-idempotent handlers (inventory / gift-card / coupon decrements).
  // create() is atomic, so a concurrent duplicate loses the race; on failure
  // below we delete the marker so Stripe's retry still re-runs.
  const eventId = String(event?.id ?? '')
  const eventRef = eventId
    ? firebaseAdmin.app().firestore().collection('stripeEvents').doc(eventId)
    : null
  if (eventRef) {
    try {
      await eventRef.create({ type, receivedAt: new Date() })
    } catch {
      return Response.json({ received: true, duplicate: true }, { status: 200 })
    }
  }

  try {
    if (
      type === 'customer.subscription.created' ||
      type === 'customer.subscription.updated' ||
      type === 'customer.subscription.deleted'
    ) {
      const orgId = object?.metadata?.orgId
      if (orgId) {
        const canceled = type === 'customer.subscription.deleted'
        const items: any[] = object?.items?.data ?? []
        // With add-on items on the subscription (AGL-526), items[0] is no
        // longer necessarily the plan item — find the one whose price maps
        // to a plan; metadata.plan (set at checkout/switch) still wins.
        const planItem = items.find(
          (item: any) => planFromPriceId(item?.price?.id),
        ) ?? items[0]
        const priceId = planItem?.price?.id
        const plan = canceled
          ? 'free'
          : (object?.metadata?.plan ?? planFromPriceId(priceId) ?? 'free')
        const orgRef = firebaseAdmin
          .app()
          .firestore()
          .collection('orgs')
          .doc(String(orgId))
        // Discount mirror (AGL-1105): reflect the coupon on the subscription
        // onto org.discount so the net-of-discount billing figure is right
        // whether the discount was staff-applied or self-serve-redeemed at
        // checkout (`orgMonthlyRevenueUsd` reads org.discount). A
        // canceled or coupon-less subscription clears it (like the add-on
        // zeros). Staff-set `appliedBy`/`reason` survive a resync — Stripe
        // does not carry them — so the audit context is not overwritten by
        // the periodic subscription.updated events.
        const del = firebaseAdmin.firestore.FieldValue.delete()
        let discountField: unknown = del
        const found = canceled ? null : subscriptionCoupon(object)
        if (found) {
          const existing = (await orgRef.get()).get('discount') ?? {}
          const { coupon, promotionCodeId } = found
          discountField = {
            couponId: String(coupon.id),
            percentOff:
              coupon.percent_off != null ? Number(coupon.percent_off) : del,
            amountOffUsd:
              coupon.amount_off != null ? Number(coupon.amount_off) / 100 : del,
            code: coupon.name ? String(coupon.name) : del,
            promotionCodeId: promotionCodeId ?? del,
            appliedBy: existing.appliedBy ?? 'system',
            appliedAt:
              existing.appliedAt ??
              firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            ...(existing.reason ? { reason: existing.reason } : {}),
          }
        }
        // Custom enterprise price mirror (AGL-1110): an enterprise deal bills
        // on an ad-hoc Stripe price, not a plan SKU, so PLAN_PRICING would
        // under-report its MRR. The staff provisioning flow stamps
        // `metadata.custom='true'`; when set, mirror the plan item's recurring
        // amount as a monthly-normalized figure (annual ÷ 12) onto
        // `subscription.customMonthlyUsd` so `orgMonthlyRevenueUsd` reads the
        // real number. A standard plan or a cancellation clears it.
        const isYearly = planItem?.price?.recurring?.interval === 'year'
        const unitAmount = Number(planItem?.price?.unit_amount ?? 0)
        const del2 = firebaseAdmin.firestore.FieldValue.delete()
        const customMonthlyUsd =
          !canceled &&
          object?.metadata?.custom === 'true' &&
          unitAmount > 0
            ? Math.round((unitAmount / 100 / (isYearly ? 12 : 1)) * 100) / 100
            : del2
        // Normalized to a string id: Stripe sends `customer` as an id here,
        // but an expanded object would otherwise be stored verbatim — and the
        // `stripeCustomers` reverse index below is keyed by the id, so an
        // object would silently produce no index entry (AGL-1028).
        const stripeCustomerId =
          typeof object?.customer === 'string'
            ? object.customer
            : ((object?.customer as { id?: string } | null)?.id ?? null)
        // What stays on the org doc: the plan every console surface gates
        // features on, and the discount the MRR roll-up reads.
        await orgRef.set({ plan, discount: discountField }, { merge: true })
        // What moved behind `canManageOrg()` (AGL-1028). This also mirrors a
        // bare `billingStatus` string back onto the org doc for the dunning
        // banner, and maintains the customer -> org index the
        // `invoice.payment_failed` branch below resolves through.
        await writeOrgBilling(String(orgId), {
          stripeCustomerId,
          // Add-on quantities sync from the items (AGL-527): Stripe is
          // the source of truth; explicit zeros make removals, dashboard
          // edits, and full cancellations all converge.
          seatAddons: addonQuantitiesFromItems(canceled ? [] : items),
          subscription: {
            status: canceled ? 'canceled' : (object?.status ?? 'active'),
            priceId: priceId ?? null,
            // Billing interval (AGL-532): the Billing page's monthly/
            // annual toggle initializes from this mirror.
            interval: isYearly ? 'year' : 'month',
            customMonthlyUsd,
            currentPeriodEnd: object?.current_period_end
              ? new Date(object.current_period_end * 1000)
              : null,
          },
        } as never)
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
        // Was `.where('stripeCustomerId', '==', …)` on the orgs collection.
        // That field lives in a subcollection now (AGL-1028), where the same
        // query would need a collection-group index — one the emulator never
        // asks for and production does. This resolves through the
        // `stripeCustomers` mapping doc instead: an O(1) get, no index, and it
        // stops the webhook scanning `orgs` at all.
        const orgId = await findOrgIdByStripeCustomer(customerId)
        if (orgId) {
          const amount = Number(object?.amount_due ?? object?.amount_paid ?? 0)
          const dollars = (amount / 100).toFixed(2)
          // Billing is org-scoped now (AGL-621/644). Links are frozen at write
          // time, so emit the canonical path; the reader normalizes anything
          // legacy that predates this.
          const orgSlug = (
            await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
          ).get('slug') as string | undefined
          void notifyOrgAdmins(orgId, {
            type:
              type === 'invoice.payment_failed'
                ? 'billing.paymentFailed'
                : 'billing.invoice',
            title:
              type === 'invoice.payment_failed'
                ? `Payment failed for your $${dollars} invoice`
                : `Your $${dollars} invoice is available`,
            orgId,
            link: orgSlug
              ? buildRoute(Route.MANAGE_BILLING, { orgSlug })
              : '/org/billing',
          })
        }
      }
    }


    // Plugin-owned sections (AGL-418): commerce orders/carts/drafts/
    // reservations/subscriptions, booking payments, and marketplace
    // purchases now live in their plugins and register through
    // registerBillingWebhookHandler. Handlers self-select on the event
    // metadata and errors propagate — a throw still 500s so Stripe
    // redelivers, matching the old inline behavior.
    await serverPluginLoader.ensureAll(['consoleApi'])
    await runBillingWebhookHandlers({
      type,
      object,
      event,
      requestHost: headers['host'],
    })
    return Response.json({ received: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    // Let Stripe retry: drop the idempotency marker so the redelivery isn't
    // skipped as a duplicate (AGL-498).
    if (eventRef) await eventRef.delete().catch(() => undefined)
    return Response.json({ error: 'Webhook handling failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
