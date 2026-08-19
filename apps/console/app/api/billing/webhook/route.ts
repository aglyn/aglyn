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
  sendGa4Refund,
  sendGa4SubscriptionCancelled,
  notifyOrgAdmins,
  updateExisting,
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
import { platformInvoiceRevenue } from '../../../../utils/server/platform-revenue'
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
// The ENVIRONMENT gate (AGL-2040). Signature verification proves an event came
// from Stripe; it says nothing about WHICH Stripe. Both destinations point
// here on purpose (AGL-547), so this route must ask separately.
import {
  deploymentLivemode,
  eventLivemode,
  livemodeDecision,
} from '../../../../utils/server/stripe-livemode'

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
 * Refuse-and-record (AGL-1763): a subscription whose `metadata.orgId` names no
 * workspace we hold.
 *
 * Refusing is the whole point — the alternative is what this fixed. A merge-set
 * against a missing `orgs/{orgId}` CREATES it, holding a paid `plan` and
 * nothing else: no owner, no members, no slug, invisible to every console list
 * that filters on them, and yet counted by the MRR roll-up and honoured by
 * every feature gate, all of which read `org.plan`.
 *
 * But a silent refusal is the AGL-1760 failure shape in the other direction:
 * the subscription is REAL and billing on Stripe's side, so dropping the event
 * without a trace leaves a customer paying for a workspace that does not
 * exist, with nothing anywhere to reconcile against. So the event is recorded
 * where staff already look — `adminAudit`, the append-only surface the audit
 * page (AGL-203) lists newest-first — with a system actor, the form
 * `reap-plugin-artifacts` and `sso-jit` already write from non-staff paths.
 *
 * The caller still answers 200. This is a PERMANENT condition, not a transient
 * one: the org id is stamped at checkout, which requires an existing org, so a
 * miss means the workspace was erased or the metadata is wrong — and neither
 * heals on a redelivery. A 500 would un-claim the event (AGL-498) and buy
 * several days of identical retries that all end here, then silence.
 *
 * Best-effort, like every other write on this path: the `console.error` is the
 * floor, and a failed audit append must not 500 a billing webhook.
 */
async function recordOrphanedSubscription(entry: {
  orgId: string
  reason: 'no-such-org' | 'erased-mid-handler'
  eventType: string
  subscriptionId: string | null
  stripeCustomerId: string | null
  plan: string
}): Promise<void> {
  console.error(
    '[billing/webhook] subscription metadata names no workspace',
    entry,
  )
  await firebaseAdmin
    .app()
    .firestore()
    .collection('adminAudit')
    .add({
      actorUid: 'system:stripe-webhook',
      action: 'billing.orphanedSubscription',
      target: `orgs/${entry.orgId}`,
      before: null,
      after: { ...entry },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
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

  // THE ENVIRONMENT GATE (AGL-2040), and its position is the point.
  //
  // Here — after JSON.parse, BEFORE the idempotency claim below — so a
  // refused event leaves NO TRACE. Placed after the claim it would still
  // stamp a document, and `stripeEvents` would go on accumulating test-mode
  // rehearsals; placed after dispatch it would not be a gate at all.
  //
  // On 2026-08-18 five test-mode dispute/refund events reached this route and
  // ran the money-reversal dispatch against production Firestore. They moved
  // nothing only because `marketplacePurchases`, `platformRevenue` and the
  // order collections are still empty pre-launch. Both of the joins that
  // matter are payment-intent-keyed, so once those collections fill, a
  // rehearsal carrying a copied payment-intent id would revoke a paid
  // install, reverse a real order, write a false row into the AGL-1811 tax
  // record and send a real merchant a chargeback alert.
  //
  // 200, not 4xx: an event's `livemode` never changes, so a retry would
  // re-reach this same refusal for days and then leave the destination
  // looking broken. `ignored` names the reason for the Stripe dashboard and
  // for the AGL-1906 audit.
  const decision = livemodeDecision({
    deploymentLivemode: deploymentLivemode(process.env),
    eventLivemode: eventLivemode(event),
  })
  if (decision.outcome === 'refuse') {
    // The only trace a refusal leaves, and deliberately not a Firestore
    // write: the collection must stay clean for the guard to mean anything.
    console.warn('[billing/webhook] refusing an event from the other Stripe environment', {
      eventId: String(event?.id ?? ''),
      type,
      eventLivemode: eventLivemode(event),
      deploymentLivemode: deploymentLivemode(process.env),
    })
    return Response.json({ received: true, ignored: decision.reason }, { status: 200 })
  }

  // Idempotency (AGL-498): claim the Stripe event id before running any side
  // effects so a redelivery (or a replayed request) can't re-apply the
  // non-idempotent handlers (inventory / gift-card / coupon decrements).
  // create() is atomic, so a concurrent duplicate loses the race; on failure
  // below we delete the marker so Stripe's retry still re-runs.
  //
  // The collection is environment-scoped (AGL-2040): a test-mode deployment
  // claims into `stripeEventsTest`, so `stripeEvents` stays a pure record of
  // LIVE traffic for anything that scans it rather than joining by id. That
  // is bookkeeping — the gate above is the control.
  const eventId = String(event?.id ?? '')
  const eventRef = eventId
    ? firebaseAdmin
        .app()
        .firestore()
        .collection(decision.claimCollection)
        .doc(eventId)
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
      const orgRef = orgId
        ? firebaseAdmin
            .app()
            .firestore()
            .collection('orgs')
            .doc(String(orgId))
        : null
      // THE EXISTENCE CHECK (AGL-1763), and it is ONE read, hoisted rather
      // than added. `metadata.orgId` is caller data: Stripe echoes back
      // whatever checkout stamped, and a dashboard-edited, hand-migrated or
      // stale subscription can name a workspace that is gone or never was.
      // `if (orgId)` only proved the string was non-empty.
      //
      // The block below already read this document twice — for the existing
      // `discount` and for the customer-identity stamp — each conditionally,
      // neither checking `.exists`. Both now come off this snapshot, so a
      // subscription event costs at most one org read where it used to cost up
      // to two. Reading before the writes is safe because nothing here touches
      // `name`, `slug` or `discount`.
      const orgSnapshot = orgRef ? await orgRef.get() : null
      if (orgRef && !orgSnapshot?.exists) {
        await recordOrphanedSubscription({
          orgId: String(orgId),
          reason: 'no-such-org',
          eventType: type,
          subscriptionId: object?.id ? String(object.id) : null,
          stripeCustomerId:
            typeof object?.customer === 'string' ? object.customer : null,
          plan: String(object?.metadata?.plan ?? ''),
        })
      }
      if (orgRef && orgSnapshot?.exists) {
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
        // Discount mirror (AGL-1105): reflect the coupon on the subscription
        // onto org.discount so the net-of-discount billing figure is right
        // whether the discount was staff-applied or self-serve-redeemed at
        // checkout (`orgMonthlyRevenueUsd` reads org.discount). A
        // canceled or coupon-less subscription clears it (like the add-on
        // zeros). Staff-set `appliedBy`/`reason` survive a resync — Stripe
        // does not carry them — so the audit context is not overwritten by
        // the periodic subscription.updated events.
        //
        // Written as DOTTED FIELD PATHS rather than a nested `discount` map,
        // because the write below is now an `update()`. A merge-set accepts a
        // delete sentinel at any depth; `update()` accepts one only at the top
        // level of its patch (`@google-cloud/firestore` validates with
        // `allowDeletes: 'root'`, and a nested one throws INVALID_ARGUMENT — a
        // 500, not a silent miss). A dotted path IS top-level, and it merges
        // field-by-field exactly as the nested map under `{ merge: true }`
        // did, so the staff-set keys still survive a resync.
        const del = firebaseAdmin.firestore.FieldValue.delete()
        let discountUpdate: Record<string, unknown> = { discount: del }
        const found = canceled ? null : subscriptionCoupon(object)
        if (found) {
          const existing = (orgSnapshot.get('discount') as any) ?? {}
          const { coupon, promotionCodeId } = found
          discountUpdate = {
            'discount.couponId': String(coupon.id),
            'discount.percentOff':
              coupon.percent_off != null ? Number(coupon.percent_off) : del,
            'discount.amountOffUsd':
              coupon.amount_off != null ? Number(coupon.amount_off) / 100 : del,
            'discount.code': coupon.name ? String(coupon.name) : del,
            'discount.promotionCodeId': promotionCodeId ?? del,
            'discount.appliedBy': existing.appliedBy ?? 'system',
            'discount.appliedAt':
              existing.appliedAt ??
              firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            ...(existing.reason ? { 'discount.reason': existing.reason } : {}),
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
        //
        // SECOND LINE OF DEFENCE (AGL-1763), for the window the read above
        // cannot close: a GDPR erasure landing between the check and the
        // write. `update()` rejects on a missing document where a merge-set
        // creates one, so the phantom is unreachable by any argument, race
        // included. `updateExisting` distinguishes that rejection from every
        // other failure — a `.catch(() => …)` here would read a permission or
        // transport error as "the org is gone" and record a lie.
        const mirrored = await updateExisting(orgRef, { plan, ...discountUpdate })
        if (!mirrored) {
          await recordOrphanedSubscription({
            orgId: String(orgId),
            reason: 'erased-mid-handler',
            eventType: type,
            subscriptionId: object?.id ? String(object.id) : null,
            stripeCustomerId,
            plan: String(plan),
          })
        }
        // What moved behind `canManageOrg()` (AGL-1028). This also mirrors a
        // bare `billingStatus` string back onto the org doc for the dunning
        // banner, and maintains the customer -> org index the
        // `invoice.payment_failed` branch below resolves through.
        //
        // Gated on the mirror having landed, because these are the only other
        // FIRESTORE writes in this block and both re-open the hole otherwise:
        // `writeOrgBilling` merge-sets `billingStatus` straight back onto the
        // org doc, and it stamps `stripeCustomers/{customerId} -> orgId`,
        // which is what the invoice branch below resolves through — so an
        // index entry pointing at an erased workspace would keep sending every
        // later invoice event back to it. The two Stripe-side steps that
        // follow write nothing here and are left to run: they are best-effort
        // and self-healing by contract.
        // A downgrade that has LANDED must stop being "pending" (AGL-2144).
        // `writeOrgBilling` merge-sets, and a merge preserves nested keys it
        // does not mention — so `subscription.pendingDowngrade` survived the
        // flip verbatim and nothing else ever cleared it: the two clears in
        // /api/billing/subscription cover release and "keep my plan", and no
        // `subscription_schedule.*` event is handled anywhere. The org doc was
        // left reading `plan: 'starter'` AND `pendingDowngrade: { plan:
        // 'starter', effectiveAt: <a date now in the past> }`, forever, which
        // the billing page renders as a warning chip saying it "moves to
        // starter" on an org already on Starter, next to a prominent
        // "Keep my current plan" button offering to undo something that
        // already happened.
        //
        // Detected by a POSITIVE signal rather than the absence of a schedule.
        // Phase 1 stamps `metadata[plan]` with the target tier, so once the
        // phase flips the mirrored plan EQUALS the pending target and the
        // downgrade is provably done. Keying on `!object.schedule` instead
        // would clear on any out-of-order `subscription.updated` that predates
        // the schedule being attached — dropping a downgrade the customer had
        // actually scheduled, silently, in the wrong direction.
        // Read off the nested `subscription` map rather than through a dotted
        // field path: dot notation is a DocumentSnapshot nicety, and depending
        // on it here would make this branch untestable against any double that
        // models `get()` as the plain field lookup it mostly is.
        const pendingDowngradePlan =
          ((orgSnapshot.get('subscription') as any)?.pendingDowngrade?.plan as
            | string
            | undefined) ?? null
        // A cancellation clears it too: there is no subscription left to
        // move down.
        const downgradeLanded =
          pendingDowngradePlan !== null && (canceled || pendingDowngradePlan === plan)
        if (mirrored) {
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
              ...(downgradeLanded ? { pendingDowngrade: null } : {}),
            },
          } as never)
        }

        // GA4 churn (AGL-1851): the funnel instruments every step INTO
        // revenue and, until this, nothing on the way out —
        // `customer.subscription.deleted` mirrored `plan: 'free'` onto the
        // org and told GA nothing, so churn rate, plan-tier churn mix and
        // tenure-at-cancellation were unanswerable. Server-side for the same
        // reason `purchase` is: a subscription ends with no browser present
        // (period-end portal cancellations, dunning exhaustion).
        //
        // Inside the org-resolved block deliberately — the same claiming
        // rule as revenue. A tenant shopper's product subscription carries
        // no `metadata.orgId` naming one of OUR workspaces, so it never
        // reaches here and a merchant's churn cannot report as ours.
        //
        // The params describe the subscription being LEFT: `plan` from the
        // metadata/price (never the `'free'` the mirror writes), the
        // interval from the plan item, and whole-day tenure from `created`
        // to when it actually ended. Fire-and-forget, like every analytics
        // call on this route.
        if (canceled) {
          const createdAt = Number(object?.created ?? 0)
          const endedAt = Number(
            object?.ended_at ?? object?.canceled_at ?? Math.floor(Date.now() / 1000),
          )
          const interval = planItem?.price?.recurring?.interval
          void sendGa4SubscriptionCancelled({
            plan: String(
              object?.metadata?.plan ?? planFromPriceId(priceId) ?? 'unknown',
            ),
            ...(interval === 'year'
              ? { billingInterval: 'annual' as const }
              : interval === 'month'
                ? { billingInterval: 'monthly' as const }
                : {}),
            ...(createdAt > 0 && endedAt >= createdAt
              ? { tenureDays: Math.round((endedAt - createdAt) / 86400) }
              : {}),
            // Checkout stamps the browser's GA client id on the
            // subscription's own metadata; a dashboard-created or pre-AGL-1561
            // subscription falls back to the synthesized customer id, exactly
            // as a renewal's `purchase` does.
            clientId: object?.metadata?.ga_client_id,
            stripeCustomerId,
          }).catch(() => undefined)
        }

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
            // Reads off the hoisted snapshot (AGL-1763) rather than a second
            // get. Nothing written above touches `name` or `slug`, so the
            // values are the same ones this read here.
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
          // The filable tax record (AGL-1811): gross / tax / net /
          // jurisdiction per transaction, keyed by INVOICE id so a Stripe
          // redelivery restamps one document rather than duplicating a row —
          // the Texas return is the sum of these.
          //
          // `invoice.paid` is the one event authoritative for EVERY charge
          // on Aglyn's own account — initial subscribe, renewal, proration,
          // add-on change, enterprise net-30 — which is why the session's
          // `checkout.session.completed` is deliberately NOT a second
          // source: a subscription checkout always produces an invoice, and
          // recording both would count the sale twice.
          //
          // Scoped to this branch because `findOrgIdByStripeCustomer`
          // resolving IS the "whose charge is this" test: the index is
          // stamped only by `writeOrgBilling`, so a tenant shopper's or
          // marketplace buyer's invoice — same endpoint, same event type —
          // never lands here. AWAITED, unlike the cosmetic writes around
          // it: a lost row here is a wrong tax return, and the doc id makes
          // the redelivery this may cause converge instead of duplicate.
          // ONE decomposition for both consumers below: the tax record and
          // the GA `purchase` read the same gross/tax split, so the two can
          // never drift apart (AGL-1872).
          const revenue =
            type === 'invoice.paid' ? platformInvoiceRevenue(object) : null
          if (type === 'invoice.paid') {
            if (revenue) {
              const { invoiceId, ...recorded } = revenue
              await firebaseAdmin
                .app()
                .firestore()
                .collection('platformRevenue')
                .doc(invoiceId)
                .set({
                  ...recorded,
                  orgId,
                  recordedAt:
                    firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                })
            }
          }
          if (type === 'invoice.paid') {
            // NET of tax (AGL-1872): `amount_paid` became tax-INCLUSIVE the
            // day AGL-1811 landed, and the tax is the Comptroller's money,
            // not revenue — GA reporting it as revenue would overstate by
            // exactly the amount held for the state. Same settlement as the
            // marketplace's AGL-1639: `value` is the platform's own take,
            // and no `tax` param beside it. An untaxed invoice has
            // `taxCents: 0`, so nothing moves for pre-tax history.
            const paidCents = Math.max(
              0,
              Number(object?.amount_paid ?? amount) - (revenue?.taxCents ?? 0),
            )
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


    // GA4 `refund` for OUR subscription revenue (AGL-1850). The `purchase`
    // above fires on every paid invoice, so without this GA revenue could
    // only ever go up — a refunded invoice stayed on the books forever and
    // GA drifted from Stripe by exactly the refund volume.
    //
    // The claiming discrimination is the same double test the `purchase`
    // uses, because `charge.refunded` arrives on this endpoint for tenant
    // storefront orders and marketplace sales too: the charge must belong to
    // an INVOICE (a subscription charge carries one; a storefront session's
    // or marketplace sale's does not), and its customer must resolve through
    // the `stripeCustomers` index that only `writeOrgBilling` stamps. The
    // marketplace's own full-refund reversal lives in its webhook section
    // and reports platform-net under the session id — different id space,
    // no double count.
    //
    // `transaction_id` is the INVOICE id — the same id the original
    // `purchase` reported — which is what tells GA to net the two rather
    // than record a second transaction.
    //
    // Stripe's `amount_refunded` is CUMULATIVE across partial refunds, and
    // GA refund values are additive, so sending it verbatim would
    // double-report every earlier partial. The AGL-1811 `platformRevenue`
    // row for the invoice carries the running `refundedCents`, making the
    // DELTA computable and the tax record refund-aware in the same write.
    // An invoice from before AGL-1811 has no row: for those, only a FULL
    // refund reports (`refunded: true`, the cumulative total, once) — a
    // partial-only refund on a pre-AGL-1811 invoice stays unreported rather
    // than guessed.
    if (type === 'charge.refunded') {
      const invoiceId =
        typeof object?.invoice === 'string'
          ? object.invoice
          : String(object?.invoice?.id ?? '')
      const customerId = String(object?.customer ?? '')
      const refundedCents = Number(object?.amount_refunded ?? 0)
      if (invoiceId && customerId && refundedCents > 0) {
        const orgId = await findOrgIdByStripeCustomer(customerId)
        if (orgId) {
          const revenueRef = firebaseAdmin
            .app()
            .firestore()
            .collection('platformRevenue')
            .doc(invoiceId)
          const revenueSnapshot = await revenueRef.get()
          const previousCents = Number(
            revenueSnapshot.get('refundedCents') ?? 0,
          )
          const deltaCents = refundedCents - previousCents
          if (revenueSnapshot.exists && deltaCents > 0) {
            // AWAITED like the revenue row itself: a lost stamp here means
            // the next partial refund re-reports this one.
            await revenueRef.set(
              {
                refundedCents,
                refundRecordedAt:
                  firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
            // The delta is a GROSS delta — Stripe refunds tax alongside the
            // charge — while the `purchase` reported NET of tax (AGL-1872).
            // Scale by the row's own net/gross ratio so a full refund nets
            // exactly what the purchase put in; a pre-tax row has
            // `taxCents: 0` and scales by 1.
            const rowGrossCents = Number(revenueSnapshot.get('grossCents') ?? 0)
            const rowTaxCents = Number(revenueSnapshot.get('taxCents') ?? 0)
            const netDeltaCents =
              rowGrossCents > 0 && rowTaxCents > 0
                ? Math.round(
                    (deltaCents * (rowGrossCents - rowTaxCents)) /
                      rowGrossCents,
                  )
                : deltaCents
            void sendGa4Refund({
              transactionId: invoiceId,
              value: netDeltaCents / 100,
              currency: String(object?.currency ?? 'usd'),
              items: [],
              // No browser is present at refund time and the charge carries
              // no ga_client_id; the synthesized customer id keeps the
              // reversal on the same synthetic user a renewal's purchase
              // falls back to.
              stripeCustomerId: customerId,
            }).catch(() => undefined)
          } else if (!revenueSnapshot.exists && object?.refunded === true) {
            void sendGa4Refund({
              transactionId: invoiceId,
              value: refundedCents / 100,
              currency: String(object?.currency ?? 'usd'),
              items: [],
              stripeCustomerId: customerId,
            }).catch(() => undefined)
          }
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
