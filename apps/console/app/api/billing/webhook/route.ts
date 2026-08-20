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

// `after()`, never a bare `void promise` (AGL-2346). AGL-1133 measured on
// production that fire-and-forget work scheduled in a route handler simply does
// not run: the serverless function can be frozen the moment the response is
// sent. Every GA4 beacon below is revenue reporting, so a silent drop is a
// wrong number rather than a missing nicety.
import { after } from 'next/server'

// DID THIS DELIVERY DO ANYTHING? (AGL-1954) Every other signal on this route
// describes the REQUEST — the 200, Stripe's `delivery_success`, the
// idempotency claim — and all three read green for a handler that answers 200
// and drops the work. The ledger records what actually COMMITTED, and the
// classifier separates "moved nothing" from "correctly moved nothing".
import {
  buildRoute,
  classifyWebhookDelivery,
  createWebhookEffectLedger,
  observeWrites,
  Route,
  runBillingWebhookHandlers,
} from '@aglyn/aglyn/server'
import {
  findOrgIdByStripeCustomer,
  firebaseAdmin,
  sendGa4Purchase,
  sendGa4Refund,
  sendGa4SubscriptionCancelled,
  notifyOrgAdmins,
  notifyStaff,
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
  // The CONNECT destination signs with its OWN secret (AGL-2122). Stripe
  // delivers connected-account events (`account.updated` — the input to
  // AGL-1997's Connect-readiness refresh) only to a destination created with
  // `connect: true`, and that destination has a separate signing key. Without
  // this arm, standing the destination up would 400 every one of its
  // deliveries on signature — the exact AGL-1551 shape, behind a green
  // "Active" badge, for the one event stream nothing else can supply.
  const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret && !testSecret && !connectSecret) {
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
      : false) ||
    (connectSecret
      ? verifyStripeSignature(payload, signatureHeader, connectSecret)
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
      // A held claim from a PARTIAL failure is not an ordinary duplicate
      // (AGL-2157): it means an earlier delivery of this event ran side
      // effects and then threw, and the claim is being kept on purpose so a
      // redelivery cannot re-apply them. Still a 200 — Stripe must stop
      // retrying an event no automatic retry can make safe — but it says so
      // in the log rather than reading as a routine replay.
      const held = await eventRef
        .get()
        .then((snapshot) => snapshot.get('failedAfterEffects') === true)
        .catch(() => false)
      if (held) {
        console.warn(
          '[billing/webhook] refusing a redelivery of a PARTIALLY APPLIED event',
          { eventId, type },
        )
      }
      return Response.json(
        { received: true, duplicate: true, ...(held ? { held: true } : {}) },
        { status: 200 },
      )
    }
  }

  /**
   * Has anything irreversible been able to land yet? (AGL-2157)
   *
   * The bug: the catch below deleted the idempotency marker on EVERY throw,
   * including a throw raised after a non-idempotent side effect had already
   * been applied (an inventory decrement, a gift-card balance, a coupon
   * redemption counter). Deleting the claim un-claims the event, so Stripe's
   * redelivery re-runs the whole dispatch and re-applies it. The marker is
   * the only thing standing between a retry and a double decrement, and it
   * was being dropped precisely when it was doing its job.
   *
   * NOT every throw is like that, which is why this is a flag and not a
   * blanket "never release". A failure raised before any dispatch began —
   * `serverPluginLoader.ensureAll` unable to load the console API surfaces,
   * for instance — landed nothing at all, and for those the redelivery path
   * must keep working exactly as it does today.
   *
   * Flipped at the TOP of each branch rather than beside each write, and
   * that is deliberate: once control is inside a handling branch this route
   * cannot know which of its writes committed before the throw, so "a branch
   * was entered" is the honest granularity. Erring toward holding the claim
   * is the safe direction — a held claim is a visible incident, an
   * unclaimed one is a silent duplicate charge.
   */
  let dispatchEntered = false

  /**
   * WHAT THIS DELIVERY ACTUALLY COMMITTED (AGL-1954).
   *
   * `dispatchEntered` above answers "did control reach a branch", which is
   * the AGL-2157 question and deliberately coarse. It is NOT the question
   * here: in the AGL-1798 shape control reached everything it was supposed
   * to and there was simply no work registered, so "a branch was entered"
   * reads exactly as it does on a healthy delivery.
   *
   * So each branch reports one of two things and never neither:
   *
   * * `effect(name)` — AFTER a durable write commits, so a throw between the
   *   two cannot claim an effect that never landed.
   * * `skip(reason)` — when the branch consciously decides the event is not
   *   its business. This is the half that stops the alarm firing on every
   *   tenant shopper's subscription and every marketplace refund, i.e. the
   *   half that stops it being muted.
   *
   * Falling off the end having said neither is `inert`, and inert is the
   * defect: an event we went out of our way to subscribe to arrived, and
   * nothing in this process can account for it.
   */
  const ledger = createWebhookEffectLedger()

  /**
   * The route's own Firestore handle, wrapped so every write it COMMITS
   * lands in the ledger (AGL-1954).
   *
   * Deliberately not the same handle the idempotency claim above is made
   * through: the claim is written on every delivery, so counting it would
   * make every delivery look like it did something — the exact blindness
   * this is here to remove.
   *
   * A function rather than a value because the branches below each open
   * their own handle inline, and rewriting them into one shared const would
   * be a far larger diff across a file that is the security boundary for
   * every Stripe delivery.
   */
  const observed = () =>
    observeWrites(firebaseAdmin.app().firestore(), ledger)

  /**
   * Did any branch on THIS ROUTE take the event? (AGL-1954)
   *
   * `checkout.session.completed` is subscribed, required, and has no branch
   * here at all — commerce, marketplace and bookings own it end to end
   * inside their own handlers, writing through their own Firestore handles
   * that this route cannot see. A delivery of one is not evidence of
   * anything from where this code stands, in either direction.
   *
   * So it is recorded as a deliberate skip rather than left to fall through
   * into `inert`, which would fire the alarm on the single most common event
   * we receive. The honest close for that half is `claimed` on the plugin
   * handlers — the AGL-2429 mechanism exists but is wired only for
   * `charge.dispute.*` today — and it belongs in those plugins, not here.
   */
  let routeHandled = false

  try {
    if (
      type === 'customer.subscription.created' ||
      type === 'customer.subscription.updated' ||
      type === 'customer.subscription.deleted'
    ) {
      dispatchEntered = true // AGL-2157
      routeHandled = true // AGL-1954
      const orgId = object?.metadata?.orgId
      const orgRef = orgId
        ? observed().collection('orgs').doc(String(orgId))
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
      // NOT OURS, and it says so (AGL-1954). A tenant shopper's product
      // subscription carries no `metadata.orgId` naming one of OUR
      // workspaces, so this branch correctly moves nothing — and an alarm
      // that could not tell that from a broken mirror would fire on ordinary
      // merchant traffic until somebody muted it.
      if (!orgRef) ledger.skip('subscription-names-no-workspace')
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
        // An orphan record IS an effect — the delivery produced a durable,
        // readable statement about an unreconcilable paying customer. Naming
        // it here is also what keeps the AGL-1954 alarm off a shape the
        // route already handles deliberately.
        ledger.effect('orphan-recorded')
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
        // NOT noted here, deliberately (AGL-1954). `updateExisting` writes
        // through the OBSERVED handle above, so `orgs.update` reaches the
        // ledger from inside the call that commits it. A note beside this
        // line would survive the write being removed — and a mirror that
        // silently stops landing while `updateExisting` still answers true
        // is precisely the 200-that-did-nothing this is trying to catch.
        if (!mirrored) {
          await recordOrphanedSubscription({
            orgId: String(orgId),
            reason: 'erased-mid-handler',
            eventType: type,
            subscriptionId: object?.id ? String(object.id) : null,
            stripeCustomerId,
            plan: String(plan),
          })
          ledger.effect('orphan-recorded')
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
              // WHY it ended (AGL-1877). Stripe states it on the deleted
              // event and nothing here read it, so a workspace Stripe gave
              // up on after a month of failed retries and one that clicked
              // Cancel were the same row: same `status: 'canceled'`, same
              // `plan: 'free'`, no way to tell them apart afterwards.
              //
              // Measured on the test account with a test clock rather than
              // assumed: a failed renewal retries five times over 21.08 days
              // and then Stripe CANCELS, sending
              // `cancellation_details.reason: 'payment_failed'`. It never
              // passes through `unpaid`, which is why the delinquent state
              // this field names could not be observed any other way.
              //
              // Explicitly `null` when not cancelled so a resubscribe
              // CONVERGES — `writeOrgBilling` merge-sets, and a stale
              // `'payment_failed'` surviving a new subscription would make
              // the auto-lock predicate read a paying org as delinquent.
              canceledReason: canceled
                ? (typeof object?.cancellation_details?.reason === 'string'
                    ? object.cancellation_details.reason
                    : null)
                : null,
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
          after(() => sendGa4SubscriptionCancelled({
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
          }).catch(() => undefined))

          // TELL THEM (AGL-1877). A dunning-exhaustion cancellation was the
          // one lifecycle transition that reached the customer through no
          // channel at all: the `past_due` banner reads `billingStatus ===
          // 'past_due'` and therefore DISAPPEARS the moment Stripe cancels,
          // the org silently drops to Free entitlements in the same write
          // above, and `notifyOrgAdmins` was never called on this branch.
          // Measured end to end on a test clock: five failed attempts over
          // 21.08 days, then the plan is simply gone.
          //
          // Only for `payment_failed`. A customer who cancelled on purpose
          // has already been told — by themselves — and mailing them "your
          // subscription was canceled" as if it were news is the shape that
          // trains people to mute the billing category.
          //
          // Fire-and-forget through `after()`, like every other notification
          // on this route: a notification failure must never 500 the webhook
          // into redelivering the mirrors above.
          if (object?.cancellation_details?.reason === 'payment_failed') {
            const canceledSlug = orgSnapshot.get('slug') as string | undefined
            after(() => notifyOrgAdmins(String(orgId), {
              type: 'billing.subscriptionCanceled',
              title: 'Your subscription was canceled — payment kept failing',
              orgId: String(orgId),
              link: canceledSlug
                ? buildRoute(Route.MANAGE_BILLING, { orgSlug: canceledSlug })
                : '/org/billing',
            }))
          }
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
      dispatchEntered = true // AGL-2157
      routeHandled = true // AGL-1954
      const customerId = String(object?.customer ?? '')
      // NOT OURS, and it says so (AGL-1954). An invoice with no customer, or
      // one whose customer does not resolve through the `stripeCustomers`
      // index only `writeOrgBilling` stamps, belongs to a tenant storefront
      // or a marketplace sale — the plugins below own those. Naming the
      // reason is what keeps this off the alarm; leaving it unnamed would
      // fire on the most common invoice event we receive.
      if (!customerId) ledger.skip('invoice-has-no-customer')
      if (customerId) {
        // Was `.where('stripeCustomerId', '==', …)` on the orgs collection.
        // That field lives in a subcollection now (AGL-1028), where the same
        // query would need a collection-group index — one the emulator never
        // asks for and production does. This resolves through the
        // `stripeCustomers` mapping doc instead: an O(1) get, no index, and it
        // stops the webhook scanning `orgs` at all.
        const orgId = await findOrgIdByStripeCustomer(customerId)
        if (!orgId) ledger.skip('invoice-customer-is-not-a-workspace')
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
              await observed()
                .collection('platformRevenue')
                .doc(invoiceId)
                .set({
                  ...recorded,
                  orgId,
                  recordedAt:
                    firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                })
            } else {
              // An invoice this deployment cannot decompose into revenue —
              // a $0 or fully-credited invoice, say. Deliberate, and named
              // so it is not mistaken for a dropped write.
              ledger.skip('invoice-carries-no-platform-revenue')
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
            after(() => sendGa4Purchase({
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
            }).catch(() => undefined))
          }
          // Billing is org-scoped now (AGL-621/644). Links are frozen at write
          // time, so emit the canonical path; the reader normalizes anything
          // legacy that predates this.
          const orgSlug = (
            await observed().collection('orgs').doc(orgId).get()
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
            after(() => fetch(`https://api.stripe.com/v1/invoices/${object.id}`, {
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
            ))
          }
          // Reaching the admin notification means the invoice resolved to a
          // workspace and every mirror above ran for it. `after()` defers the
          // send, but the DECISION to notify this workspace about this
          // invoice is the durable consequence of the delivery, and it is the
          // one that stops for all three invoice types at once if this branch
          // ever goes quiet.
          ledger.effect('org-admins-notified')
          after(() => notifyOrgAdmins(orgId, {
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
          }))
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
      dispatchEntered = true // AGL-2157
      routeHandled = true // AGL-1954
      const invoiceId =
        typeof object?.invoice === 'string'
          ? object.invoice
          : String(object?.invoice?.id ?? '')
      const customerId = String(object?.customer ?? '')
      const refundedCents = Number(object?.amount_refunded ?? 0)
      // NOT OURS, and it says so (AGL-1954). The double test below is the
      // claiming rule this branch has always used: a subscription charge
      // carries an INVOICE and a customer that resolves through
      // `stripeCustomers`; a storefront order's or marketplace sale's charge
      // carries neither, and the plugins own those. Refunds are the single
      // most common event type on this endpoint that we correctly do nothing
      // with, so an unnamed no-op here would be the loudest false alarm.
      if (!(invoiceId && customerId && refundedCents > 0)) {
        ledger.skip('refund-is-not-a-subscription-charge')
      }
      if (invoiceId && customerId && refundedCents > 0) {
        const orgId = await findOrgIdByStripeCustomer(customerId)
        if (!orgId) ledger.skip('refund-customer-is-not-a-workspace')
        if (orgId) {
          const revenueRef = observed()
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
            after(() => sendGa4Refund({
              transactionId: invoiceId,
              value: netDeltaCents / 100,
              currency: String(object?.currency ?? 'usd'),
              items: [],
              // No browser is present at refund time and the charge carries
              // no ga_client_id; the synthesized customer id keeps the
              // reversal on the same synthetic user a renewal's purchase
              // falls back to.
              stripeCustomerId: customerId,
            }).catch(() => undefined))
          } else if (!revenueSnapshot.exists && object?.refunded === true) {
            // A pre-AGL-1811 invoice has no row to stamp; the GA reversal IS
            // the whole consequence of this delivery, and it is a real one.
            ledger.effect('ga-refund-reported')
            after(() => sendGa4Refund({
              transactionId: invoiceId,
              value: refundedCents / 100,
              currency: String(object?.currency ?? 'usd'),
              items: [],
              stripeCustomerId: customerId,
            }).catch(() => undefined))
          } else {
            // The row exists and the cumulative total has not moved — a
            // redelivery of a refund already recorded, which SHOULD converge
            // to nothing. Deliberate, named, and not an alarm.
            ledger.skip('refund-already-recorded')
          }
        }
      }
    }

    // Card disputes against AGLYN'S OWN subscription revenue (AGL-2120).
    //
    // `charge.dispute.created` / `.closed` have been SUBSCRIBED since AGL-1787
    // and both were handled only inside the commerce and marketplace plugins,
    // which self-select by finding a storefront order or a marketplace
    // purchase for the charge. A chargeback against an Aglyn *subscription*
    // invoice matches neither, so it fell through every branch on this
    // endpoint and produced nothing: the `platformRevenue` row kept its full
    // `netCents` while the money had been pulled back, so the Texas return
    // over-reported by the disputed amount; GA revenue was never netted; and
    // no surface anywhere told staff a paying customer had disputed a charge.
    // The refund path directly beside this one does all three.
    //
    // WHY A QUERY AND NOT AN OWNERSHIP TEST. A Stripe Dispute carries
    // `charge` and `payment_intent`, and no `customer` and no `invoice`, so
    // `findOrgIdByStripeCustomer` — the discriminator every other branch on
    // this route uses — has nothing to read. `platformRevenue` only ever
    // holds invoices whose customer already resolved through that index, so
    // finding a row there IS the "is this ours" test, and a tenant
    // storefront's or marketplace buyer's dispute finds none and falls
    // through to the plugins exactly as before.
    //
    // WHY `refundedCents` AND `chargedBackCents` BOTH. This mirrors the order
    // model AGL-1787 already established (`utils/site-member-purchases.ts`):
    // the reversal lands in `refundedCents` because that is the field the
    // return reads and a lost dispute reverses money precisely as a refund
    // does, and `chargedBackCents` records how much of it the BANK took
    // rather than the merchant choosing to — the two are not the same event
    // and a return preparer needs to tell them apart.
    //
    // Only `closed` with `status === 'lost'` moves money. `created` moves
    // none — it is recorded purely so staff learn about an open dispute while
    // the evidence window is still open, which is the only window in which
    // anything can be done about it.
    //
    // WHAT THIS BRANCH CANNOT DECIDE ON ITS OWN (AGL-2429). "No
    // `platformRevenue` row matched" has two completely different meanings —
    // a storefront or marketplace chargeback the plugins own (routine, and
    // the overwhelmingly common one), or a dispute that NOTHING handles.
    // Until the handlers could say which, this endpoint answered 200 and
    // wrote nothing for both, so the second was invisible: money left the
    // account, no revenue row moved, no tax figure changed, and no surface
    // said so. A dispute set here is decided AFTER dispatch, where the
    // handlers' claim is finally known.
    let unattributedDispute: Record<string, unknown> | null = null
    if (type === 'charge.dispute.created' || type === 'charge.dispute.closed') {
      dispatchEntered = true // AGL-2157
      routeHandled = true // AGL-1954
      const disputeId = String(object?.id ?? '')
      const paymentIntentId =
        typeof object?.payment_intent === 'string'
          ? object.payment_intent
          : String(object?.payment_intent?.id ?? '')
      const chargeId =
        typeof object?.charge === 'string'
          ? object.charge
          : String(object?.charge?.id ?? '')
      const disputedCents = Math.max(0, Number(object?.amount ?? 0))
      const lost = type === 'charge.dispute.closed' && object?.status === 'lost'
      const revenueCollection = observed().collection('platformRevenue')
      // Payment intent first, charge second — an invoice records both, but a
      // pre-AGL-2120 row records neither, so a miss is expected on history
      // and is reported rather than treated as "not ours".
      let revenueDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null
      for (const [field, value] of [
        ['paymentIntentId', paymentIntentId],
        ['chargeId', chargeId],
      ] as const) {
        if (revenueDoc || !value) continue
        const found = await revenueCollection
          .where(field, '==', value)
          .limit(1)
          .get()
        revenueDoc = found.docs[0] ?? null
      }
      if (revenueDoc) {
        const orgId = String(revenueDoc.get('orgId') ?? '')
        if (lost) {
          // The row's own reversal total, not a blind add: `refundedCents`
          // is CUMULATIVE (the refund branch above maintains it the same
          // way), so a dispute redelivery must converge rather than
          // double-count. Keyed by dispute id so a partially refunded and
          // then disputed invoice sums both without either reversal
          // swallowing the other.
          const alreadyChargedBack = Number(
            revenueDoc.get('chargedBackCents') ?? 0,
          )
          const previousDisputeId = String(revenueDoc.get('disputeId') ?? '')
          const deltaCents =
            previousDisputeId === disputeId
              ? 0
              : disputedCents - alreadyChargedBack
          if (deltaCents > 0) {
            // AWAITED like the revenue row itself — a lost stamp here is a
            // wrong tax return, which is the whole point of this branch.
            await revenueDoc.ref.set(
              {
                refundedCents:
                  Number(revenueDoc.get('refundedCents') ?? 0) + deltaCents,
                chargedBackCents: alreadyChargedBack + deltaCents,
                disputeId,
                disputeReason: String(object?.reason ?? ''),
                refundRecordedAt:
                  firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
            // Net GA by the same GROSS→NET scaling the refund branch uses,
            // so a lost dispute and a full refund of the same invoice move
            // GA revenue by the same amount. `transaction_id` is the INVOICE
            // id — the id the original `purchase` reported — which is what
            // makes GA net the two instead of recording a second sale.
            const rowGrossCents = Number(revenueDoc.get('grossCents') ?? 0)
            const rowTaxCents = Number(revenueDoc.get('taxCents') ?? 0)
            const netDeltaCents =
              rowGrossCents > 0 && rowTaxCents > 0
                ? Math.round(
                    (deltaCents * (rowGrossCents - rowTaxCents)) /
                      rowGrossCents,
                  )
                : deltaCents
            after(() => sendGa4Refund({
              transactionId: revenueDoc.id,
              value: netDeltaCents / 100,
              currency: String(object?.currency ?? 'usd'),
              items: [],
              stripeCustomerId: String(
                revenueDoc.get('stripeCustomerId') ?? '',
              ),
            }).catch(() => undefined))
          }
        }
        // Every platform dispute reaches staff, won or lost — `created` is
        // the actionable one and `closed` is the outcome. Best-effort: a
        // failed audit append must not 500 a billing webhook.
        await observed()
          .collection('adminAudit')
          .add({
            actorUid: 'system:stripe-webhook',
            action:
              type === 'charge.dispute.created'
                ? 'billing.disputeOpened'
                : 'billing.disputeClosed',
            target: orgId
              ? `orgs/${orgId}`
              : `platformRevenue/${revenueDoc.id}`,
            reason:
              type === 'charge.dispute.created'
                ? `Card dispute opened against subscription invoice ${revenueDoc.id} — answer it in Stripe before the evidence deadline; an unanswered dispute is decided for the cardholder.`
                : `Card dispute ${String(object?.status ?? 'closed')} on subscription invoice ${revenueDoc.id}${lost ? ' — the money has been reversed and the revenue row adjusted.' : ' — nothing was reversed.'}`,
            before: null,
            after: {
              disputeId,
              invoiceId: revenueDoc.id,
              orgId: orgId || null,
              status: String(object?.status ?? ''),
              disputeReason: String(object?.reason ?? ''),
              disputedCents,
              chargeId: chargeId || null,
              evidenceDueBy: Number(object?.evidence_details?.due_by ?? 0) || null,
            },
            at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
          .catch(() => undefined)
      } else if (paymentIntentId || chargeId) {
        // No row matched. This is the ORDINARY answer for a storefront or
        // marketplace chargeback — the plugins below own those, and their
        // handlers self-select on the same charge — so nothing is written to
        // `adminAudit` HERE: an entry per storefront chargeback would bury
        // the platform ones this branch exists to surface, and a muted alert
        // is worth less than no alert at all.
        //
        // But one shape here is genuinely ours and gets no owner anywhere:
        // an invoice paid before AGL-2120 stored no `chargeId` /
        // `paymentIntentId` and can never be matched however plainly it is a
        // subscription charge, and a chargeback against a paid BOOKING is
        // claimed by no handler at all (the bookings plugin subscribes no
        // `charge.dispute.*`). Those used to leave nothing but a log line
        // that no alerting reads.
        //
        // So the decision is DEFERRED rather than made here: the plugins now
        // report whether they recognised the event (AGL-2429), and the
        // resolution happens after dispatch, once that answer exists. Only
        // the two ACTIONABLE outcomes are parked — `lost`, where the money
        // is already gone, and `created`, where the evidence window is still
        // open. A `won` or `warning_closed` dispute nobody claimed moved no
        // money and needs no one woken up.
        if (lost || type === 'charge.dispute.created') {
          unattributedDispute = {
            disputeId,
            paymentIntentId: paymentIntentId || null,
            chargeId: chargeId || null,
            disputedCents,
            currency: String(object?.currency ?? 'usd'),
            status: String(object?.status ?? ''),
            disputeReason: String(object?.reason ?? ''),
            evidenceDueBy: Number(object?.evidence_details?.due_by ?? 0) || null,
            lost,
          }
        }
        if (lost) {
          console.warn('[billing/webhook] lost dispute matched no revenue row', {
            disputeId,
            paymentIntentId: paymentIntentId || null,
            chargeId: chargeId || null,
            disputedCents,
          })
        }
        if (!unattributedDispute) {
          // `won` or `warning_closed`, claimed by nobody. The comment above
          // spells out why nobody is woken: no money moved. That is a
          // DECISION, so it is named rather than left to look like a
          // dropped write (AGL-1954).
          ledger.skip('dispute-closed-without-loss')
        }
      } else {
        // A dispute carrying neither a payment intent nor a charge — nothing
        // to join on in any direction. Nothing to do, said out loud.
        ledger.skip('dispute-carries-no-charge-reference')
      }
    }

    // Plugin-owned sections (AGL-418): commerce orders/carts/drafts/
    // reservations/subscriptions, booking payments, and marketplace
    // purchases now live in their plugins and register through
    // registerBillingWebhookHandler. Handlers self-select on the event
    // metadata and errors propagate — a throw still 500s so Stripe
    // redelivers, matching the old inline behavior.
    await serverPluginLoader.ensureAll(['consoleApi'])
    // AGL-2157, and the ORDER here is the point: `ensureAll` throwing means
    // the plugin surfaces never loaded, so no plugin handler ran and the
    // claim is safe to release. The flag flips only once dispatch is about
    // to begin.
    dispatchEntered = true
    const dispatch = await runBillingWebhookHandlers({
      type,
      object,
      event,
      requestHost: headers['host'],
    })

    // THE PLATFORM-FAULT BRANCH (AGL-2429). A dispute that matched no
    // `platformRevenue` row AND that no plugin recognised is money moving
    // with nothing in the system recording it. Every other outcome above is
    // silent by design; this one is the residue after all of them, which is
    // what makes it worth an alert staff will still read in six months.
    //
    // BEST-EFFORT, and awaited rather than deferred: dispatch has already
    // committed its side effects by this point, so a throw here would 500 a
    // webhook whose work is done and — by the AGL-2157 claim rule — would
    // hold the idempotency claim so the redelivery short-circuits. Failing to
    // write a WARNING must never cost a delivery. The `console.error` is the
    // floor under it, so the failure is not itself silent.
    if (unattributedDispute && dispatch?.claimed !== true) {
      const lost = unattributedDispute.lost === true
      const disputeId = String(unattributedDispute.disputeId ?? '')
      const amount = `$${(
        Number(unattributedDispute.disputedCents ?? 0) / 100
      ).toFixed(2)}`
      const reason = lost
        ? `A card dispute was LOST and nothing in the platform claimed it — no revenue row, no storefront order, no marketplace purchase. ${amount} has already been taken back and no ledger records it. Find the charge in Stripe and reconcile it by hand.`
        : `A card dispute was opened and nothing in the platform claimed it — no revenue row, no storefront order, no marketplace purchase. Nobody has been told to answer it, and an unanswered dispute is decided for the cardholder. Find the charge in Stripe and respond before the evidence deadline.`
      // TWO surfaces, because they fail differently. The audit row is the
      // durable record and the one a reconciliation reads back months later;
      // the staff notification is the push, and it is the half that survives
      // `adminAudit` filling its window with high-frequency system actions
      // (AGL-2324). Neither can throw: `notifyStaff` never does, and the
      // audit add is caught.
      await observed()
        .collection('adminAudit')
        .add({
          actorUid: 'system:stripe-webhook',
          action: 'billing.disputeUnattributed',
          target: `disputes/${disputeId}`,
          reason,
          before: null,
          after: { ...unattributedDispute, eventType: type },
          at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
        .catch((error: unknown) => {
          console.error(
            '[billing/webhook] could not record an unattributed dispute',
            { disputeId, error },
          )
          return undefined
        })
      await notifyStaff({
        type: 'system.disputeUnattributed',
        title: lost
          ? `Card dispute LOST with no owner — ${amount}`
          : `Card dispute opened with no owner — ${amount}`,
        body: `${reason} Dispute ${disputeId}${
          unattributedDispute.chargeId
            ? `, charge ${String(unattributedDispute.chargeId)}`
            : ''
        }.`,
        link: buildRoute(Route.ADMIN_OVERVIEW),
      })
    }

    /*==========================================
     * DID ANY OF THAT DO ANYTHING? (AGL-1954)
     *
     * The 200 below is about to satisfy Stripe, the delivery log, the
     * idempotency claim in `stripeEvents` and `/api/health/billing`'s
     * delivery counts — all of them, identically, whether the dispatch above
     * moved a workspace's plan or moved nothing at all. AGL-1798 lived in
     * that gap: `charge.refunded` was not subscribed, the revocation had no
     * trigger, and every signal we had read green.
     *
     * `classifyWebhookDelivery` reads the ledger the branches above filled
     * in. `inert` means: an event type we deliberately asked Stripe to send
     * us arrived, no plugin claimed it, nothing durable was written, and no
     * branch could name a reason. There is no innocent reading of that.
     *
     * THE MARKER goes on the event's OWN claim document rather than into a
     * new collection, which is the AGL-1679 marker pattern adapted to
     * something better: the document already exists (the claim was created
     * at the top), so this needs no new collection, no rules deploy and no
     * second TTL policy — and it carries the event id and type, so the
     * incident is diagnosable rather than merely counted.
     *
     * `inertAtMs` is a NUMBER and the field is new, deliberately: the health
     * probe's existing `processed` aggregation ranges over `receivedAt`, and
     * a marker sharing that field would inflate the count it reads. A range
     * on one field is served by the automatic single-field index, so the
     * reader needs no composite index.
     *
     * BEST-EFFORT, in a try/catch rather than a trailing `.catch()`: by this
     * point the dispatch has committed its side effects, so a throw here
     * would 500 a webhook whose work is done and — by the AGL-2157 rule
     * above — would HOLD the idempotency claim, turning a diagnostic into a
     * lost delivery. A monitoring write must never be able to cost one. The
     * `console.error` is the floor under it, so the failure to record is not
     * itself silent.
     *=========================================*/
    if (!routeHandled) ledger.skip('handled-by-plugins-only')
    const delivery = classifyWebhookDelivery({
      type,
      effects: ledger.effects,
      skips: ledger.skips,
      claimed: dispatch?.claimed === true,
    })
    if (delivery.outcome === 'inert') {
      console.error(
        '[billing/webhook] a delivery we ASKED FOR moved nothing at all',
        { eventId, type },
      )
      if (eventRef) {
        try {
          await eventRef.set(
            { inert: true, inertAtMs: Date.now(), inertType: type },
            { merge: true },
          )
        } catch (markerError) {
          console.error(
            '[billing/webhook] could not record an inert delivery',
            { eventId, type, markerError },
          )
        }
      }
    }
    return Response.json({ received: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    if (eventRef && !dispatchEntered) {
      // NOTHING HAPPENED — retry freely. The failure was raised before any
      // dispatch began, so no side effect can have landed and the redelivery
      // must not be swallowed as a duplicate (AGL-498, preserved).
      await eventRef.delete().catch(() => undefined)
    } else if (eventRef) {
      // SOMETHING MAY HAVE HAPPENED — retry carefully, which means not
      // automatically (AGL-2157). The handlers this route reaches are not
      // all idempotent — inventory decrements, gift-card balances, coupon
      // redemption counters — so re-running the dispatch could apply an
      // effect twice, and the claim is what prevents that. It is KEPT.
      //
      // Keeping it means Stripe's redelivery short-circuits as a duplicate,
      // i.e. this event is not retried at all. That is a real cost and it is
      // chosen with eyes open: a duplicated inventory decrement or a
      // double-spent gift card is money and stock that cannot be un-applied,
      // while a half-applied event that stops is a reconcilable incident.
      // So it is recorded on the marker and escalated to staff — never
      // dropped silently, which would be the worse half of both options.
      //
      // THE REAL FIX IS ELSEWHERE and this does not pretend otherwise:
      // per-EFFECT idempotency inside the plugins' non-idempotent writes
      // would make a redelivery safe and let this branch retry like the one
      // above. Until that sweep lands, a human reconciles.
      await eventRef
        .set(
          {
            failedAfterEffects: true,
            failedAt: new Date(),
            failedType: type,
            failedMessage: String((error as Error)?.message ?? error).slice(0, 500),
          },
          { merge: true },
        )
        .catch(() => undefined)
      await notifyStaff({
        type: 'system.billingWebhookHalfApplied',
        title: `Billing webhook failed mid-dispatch — ${type}`,
        body:
          `Stripe event ${eventId} threw after its handlers had begun, so ` +
          'side effects may be half applied. The idempotency claim is being ' +
          'HELD, which means Stripe will not retry it — reconcile by hand. ' +
          `Error: ${String((error as Error)?.message ?? error).slice(0, 200)}`,
        link: buildRoute(Route.ADMIN_OVERVIEW),
      })
    }
    return Response.json({ error: 'Webhook handling failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
