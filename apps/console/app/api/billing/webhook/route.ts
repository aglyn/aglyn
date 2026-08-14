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
  sendGa4Purchase,
  notifyOrgAdmins,
  writeOrgBilling,
} from '@aglyn/tenant-data-admin'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'
import { stripeCustomerIdentityParams } from '../../../../utils/stripe-customer-identity'
import {
  addonQuantitiesFromItems,
  findPlanItem,
  planFromPriceId,
} from '../../../../utils/server/billing-addons'
import {
  backfillMeteredItem,
  meteredBackfillDecision,
} from '../../../../utils/server/metered-backfill'
// The annual-mix metric's only input (AGL-1640) — three-state on purpose, and
// specced per branch, because a wrong `billing_interval` is indistinguishable
// from a right one in every report that reads it.
import {
  billingIntervalFromInvoice,
  selectSubscriptionLine,
} from '../../../../utils/server/billing-interval'
// Signature verification lives in `utils/server/stripe-signature` so it can be
// driven directly by spec — it is the security boundary this whole route sits
// behind, and it must handle the MULTIPLE `v1` signatures a secret roll sends
// (AGL-1552).
import { verifyStripeSignature } from '../../../../utils/server/stripe-signature'

// lockdown-423: exempt — Stripe server callback, no user caller — and the very path a lapsed
// org PAYS through; a 423 here would block the recovery it needs.



/**
 * `planFromPriceId` (AGL-68 — the fallback for subscriptions whose metadata
 * lacks `plan`, e.g. ones edited in the Stripe dashboard) used to be a
 * second copy of the price→plan map right here, with its own hand-written
 * plan list. It now comes from `utils/server/billing-addons`, which is the
 * one place the `STRIPE_PRICE_*` env names are spelled out (AGL-1340), so a
 * new tier cannot be added to one list and forgotten in the other.
 */

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
        // longer necessarily the plan item — `findPlanItem` matches a known
        // plan price id first and only then falls back (AGL-1340), so a
        // metered or add-on item can never supply the `priceId` and
        // `interval` mirrored below. metadata.plan (set at checkout/switch)
        // still wins for the plan itself.
        const planItem = findPlanItem<any>(items)
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

        // Back-fill the metered usage item (AGL-1352).
        //
        // Checkout and the in-app switch both attach it; NOTHING that changes
        // a subscription on Stripe's side does — the customer portal, a hand
        // edit in the dashboard, and every subscription created before the
        // metered prices were configured. Such a subscription is paying,
        // entitled, and bills no usage overage at all, with no visible
        // symptom, so the webhook is the only place that sees every path.
        //
        // Deferred to the period boundary by default: a mid-period attach
        // retroactively prices the whole period, history included. The policy
        // — including that default and its `STRIPE_METERED_BACKFILL` override
        // — lives in `metered-backfill.ts`, not here.
        //
        // Best-effort, exactly like the two Stripe writes around it: a throw
        // would 500 the webhook and make Stripe redeliver the whole event,
        // re-applying every mirror above for nothing. It re-runs on every
        // subscription event and at each renewal, so it self-heals.
        //
        // No loop: the attach emits another `customer.subscription.updated`,
        // and that delivery sees the item present and stops.
        if (object?.id && process.env.STRIPE_SECRET_KEY) {
          const decision = meteredBackfillDecision({
            items,
            plan,
            status: object?.status,
            canceled,
            currentPeriodStart: object?.current_period_start,
          })
          if (decision.warning) {
            console.warn('[billing/webhook] metered usage item not attached', {
              orgId,
              plan,
              interval: decision.interval,
              reason: decision.warning,
            })
          }
          if (decision.attach && decision.priceId) {
            await backfillMeteredItem({
              secretKey: process.env.STRIPE_SECRET_KEY,
              subscriptionId: String(object.id),
              priceId: decision.priceId,
              orgId: String(orgId),
            })
          }
        }

        // Stamp the workspace onto the CUSTOMER (AGL-941).
        //
        // The subscription has carried `metadata.orgId` since AGL-445, but the
        // customer — the row the Stripe dashboard actually lists — carried
        // only an email. With one person owning several orgs that list is
        // unreadable, and nothing can be grouped by workspace.
        //
        // Done here rather than at checkout because this is the one place the
        // customer id is known for certain, and it re-runs on every
        // subscription event, so it self-heals a customer created before this
        // shipped or renamed since. Best-effort and non-blocking: a cosmetic
        // PATCH must never fail a billing webhook, because Stripe retries the
        // whole event and the mirrors above would be re-applied for nothing.
        if (stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
          try {
            const orgSnapshot = await orgRef.get()
            const identity = stripeCustomerIdentityParams({
              orgId: String(orgId),
              name: orgSnapshot.get('name') as string | undefined,
              slug: orgSnapshot.get('slug') as string | undefined,
            })
            if (Object.keys(identity).length) {
              await fetch(
                `https://api.stripe.com/v1/customers/${stripeCustomerId}`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams(identity).toString(),
                },
              )
            }
          } catch (error) {
            console.error(
              '[billing/webhook] stamping org identity on the Stripe customer failed',
              orgId,
              stripeCustomerId,
              error,
            )
          }
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
          // GA4 revenue (AGL-1561), sent server-side because this is where the
          // authoritative money is. `invoice.paid` ONLY — `finalized` is a
          // bill, not a payment, and `payment_failed` is neither.
          //
          // Fired on EVERY paid invoice, renewals included, which is correct
          // for a subscription business: GA's `purchase` IS revenue, and its
          // built-in "first time purchasers" metric is what answers the GTM
          // plan's "paid conversions". Reporting only first payments would
          // make ARPA and the annual mix unreadable.
          //
          // `transaction_id` is the invoice id, so GA de-duplicates: a Stripe
          // redelivery cannot inflate revenue even if the idempotency claim
          // above is ever bypassed.
          //
          // Fire-and-forget and never allowed to throw — a throw here would
          // un-claim the Stripe event and cause a redelivery, turning a missed
          // analytics hit into a repeated billing side effect.
          if (type === 'invoice.paid') {
            const paidCents = Number(object?.amount_paid ?? amount)
            // The line that describes the SUBSCRIPTION, not whatever sorted
            // first: an invoice carries proration lines, credits and one-off
            // items, and a mid-cycle switch bills the proration against the
            // OLD price ahead of the new plan (AGL-1640). Falls back to
            // index 0 purely so the item keeps a name when no line states a
            // cadence — the interval itself stays absent in that case.
            const line = selectSubscriptionLine(object) ?? object?.lines?.data?.[0]
            void sendGa4Purchase({
              transactionId: String(object?.id ?? ''),
              value: paidCents / 100,
              currency: String(object?.currency ?? 'usd'),
              // Omitted entirely when the invoice does not say, rather than
              // defaulted to monthly — an invoice excluded from the annual
              // mix beats one miscounted in it.
              billingInterval: billingIntervalFromInvoice(object),
              items: [
                {
                  item_id: String(line?.price?.id ?? 'subscription'),
                  item_name: String(line?.price?.nickname ?? 'Subscription'),
                  item_category: 'subscription',
                  price: paidCents / 100,
                  quantity: 1,
                },
              ],
              // Captured in the browser when checkout started and carried on
              // the subscription metadata; absent on renewals, where the
              // sender falls back to a synthetic id and the revenue is
              // recorded without campaign attribution.
              clientId: object?.subscription_details?.metadata?.ga_client_id,
              stripeCustomerId: customerId,
            }).catch(() => undefined)
          }
          // Billing is org-scoped now (AGL-621/644). Links are frozen at write
          // time, so emit the canonical path; the reader normalizes anything
          // legacy that predates this.
          const orgSlug = (
            await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
          ).get('slug') as string | undefined
          // Tag the INVOICE itself with the workspace (AGL-941).
          //
          // Checkout cannot do this: `subscription_data[metadata]` reaches
          // only the subscription, and a session has no invoice-metadata
          // param at all — which is why the issue's third bullet needed an
          // event rather than a parameter. Doing it here means revenue can be
          // grouped by workspace in the Stripe dashboard, not merely traced
          // back one customer at a time.
          //
          // Invoice metadata stays writable after finalization, so
          // `invoice.finalized` is safe and every invoice gets tagged
          // regardless of which of the three events arrives first (Stripe
          // sends them in an order this must not depend on). Re-tagging an
          // already-tagged invoice writes the same values.
          if (process.env.STRIPE_SECRET_KEY && object?.id) {
            const invoiceTags = new URLSearchParams({
              'metadata[orgId]': orgId,
              ...(orgSlug ? { 'metadata[orgSlug]': orgSlug } : {}),
            })
            // Best-effort, exactly like the customer stamping above: a
            // notification webhook must not 500 over a metadata write, or
            // Stripe redelivers and the admins get notified twice.
            void fetch(`https://api.stripe.com/v1/invoices/${object.id}`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: invoiceTags.toString(),
            }).catch((error) =>
              console.error(
                '[billing/webhook] tagging the invoice with the org failed',
                orgId,
                object.id,
                error,
              ),
            )
          }
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
