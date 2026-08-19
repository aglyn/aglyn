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

import {
  buildRoute,
  isCustomPricedPlan,
  isLiveSubscriptionStatus,
  pluginRequestFromWeb,
  Route,
  SELF_SERVE_PLANS,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
  writeOrgBilling,
} from '@aglyn/tenant-data-admin'
import {
  addonKindFromPriceId,
  addonPriceId,
  addonQuantitiesFromItems,
  findPlanItem,
  isMeteredPriceId,
  meteredPriceId,
} from '../../../../utils/server/billing-addons'
import {
  buildTargetItems,
  preservePhaseTerms,
  writePhaseItems,
} from '../../../../utils/server/billing-schedule'
import { RETENTION_COLLECTION } from '../../_lib/retention'

// lockdown-423: exempt — managing/reactivating the subscription IS the recovery path out of a
// billing lock; part of the surface AGL-1501 keeps sessions alive for.

const PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
  scale: process.env.STRIPE_PRICE_SCALE,
  advanced: process.env.STRIPE_PRICE_ADVANCED,
  agency: process.env.STRIPE_PRICE_AGENCY,
}

/** Annual prices (AGL-269/532); switches honor the page's toggle. */
const YEARLY_PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER_YEARLY,
  pro: process.env.STRIPE_PRICE_PRO_YEARLY,
  business: process.env.STRIPE_PRICE_BUSINESS_YEARLY,
  scale: process.env.STRIPE_PRICE_SCALE_YEARLY,
  advanced: process.env.STRIPE_PRICE_ADVANCED_YEARLY,
  agency: process.env.STRIPE_PRICE_AGENCY_YEARLY,
}

async function stripeRequest(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: URLSearchParams,
): Promise<any> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
    },
    ...(body ? { body: body.toString() } : {}),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Stripe ${path} failed`)
  }
  return payload
}

/**
 * Reverse of `PRICE_ENV`/`YEARLY_PRICE_ENV`: the self-serve plan a configured
 * price id sells, or null for anything else (add-ons, metered, unknown).
 * The downgrade decision (AGL-1862) keys off the plan the subscription is
 * actually priced at, not the org doc's `plan` field, because the org doc
 * lags the webhook and a mirror-lagged read deciding "downgrade" would give
 * an UPGRADE the end-of-cycle treatment — a paying customer told to wait.
 */
function planFromConfiguredPriceId(priceId?: string): OrgPlan | null {
  if (!priceId) return null
  for (const [plan, id] of Object.entries(PRICE_ENV)) {
    if (id && id === priceId) return plan as OrgPlan
  }
  for (const [plan, id] of Object.entries(YEARLY_PRICE_ENV)) {
    if (id && id === priceId) return plan as OrgPlan
  }
  return null
}

/**
 * True when moving `from` → `to` walks DOWN the self-serve ladder (AGL-1862).
 * Unknown tiers (enterprise, custom, unconfigured) are never "down": the
 * asymmetric-friction rule exists to protect paid value we can see, and the
 * fallback for anything we cannot classify is the instant path that has
 * always worked.
 */
function isLadderDowngrade(from: OrgPlan | null, to: string): boolean {
  if (!from) return false
  const fromIndex = SELF_SERVE_PLANS.indexOf(from)
  const toIndex = SELF_SERVE_PLANS.indexOf(to as OrgPlan)
  return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex
}

/**
 * Releases the subscription's pending downgrade schedule, if one exists.
 * Returns true when something was released — the caller then clears the
 * `pendingDowngrade` mirror. Releasing (not canceling) keeps the subscription
 * alive on its CURRENT phase's items, which is exactly "keep my plan".
 */
async function releasePendingSchedule(
  secretKey: string,
  subscription: any,
): Promise<boolean> {
  const scheduleId =
    typeof subscription?.schedule === 'string'
      ? subscription.schedule
      : subscription?.schedule?.id
  if (!scheduleId) return false
  await stripeRequest(
    secretKey,
    'POST',
    `subscription_schedules/${encodeURIComponent(String(scheduleId))}/release`,
  )
  return true
}

/**
 * The org's live subscription, if any — the one a switch/cancel/resume is
 * legal against.
 *
 * "Live" is `isLiveSubscriptionStatus`, the single list in `org-billing-doc.ts`
 * (AGL-1715), not a local triple: this route and `/api/billing/checkout` are
 * the two halves of one decision, and them narrowing apart is how an org ends
 * up with two subscriptions (AGL-1697).
 */
async function activeSubscription(
  secretKey: string,
  customerId: string,
): Promise<any | null> {
  const subscriptions = await stripeRequest(
    secretKey,
    'GET',
    `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=5`,
  )
  return (
    (subscriptions?.data ?? []).find((subscription: any) =>
      isLiveSubscriptionStatus(subscription?.status),
    ) ?? null
  )
}

/**
 * Subscription management (AGL-269), billing.manage-gated:
 * - `cancel`   → cancel_at_period_end (plan runs out at renewal)
 * - `resume`   → clears a pending cancelation
 * - `preview`  → prorated amount for switching to another plan today,
 *   via Stripe's upcoming-invoice preview
 * - `switch`   → UP the ladder: updates the subscription item to the
 *   target plan's price with prorations, today (an existing subscription
 *   never goes through Checkout again); per-plan add-on items re-price to
 *   the target plan in the same update, dropping kinds it doesn't sell
 *   (AGL-528). DOWN the ladder (AGL-1862): a subscription schedule moves
 *   the org at the CURRENT PERIOD END — no immediate re-price, no
 *   proration credit — and mirrors `subscription.pendingDowngrade`.
 *   Switching to the current plan releases a pending downgrade ("keep my
 *   plan"). 501 without Stripe env.
 * - `portal`   → a Stripe Billing Portal session URL (AGL-275) for
 *   payment-method management; works even without an active
 *   subscription so past-due orgs can fix their card.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return Response.json({ error: 'Billing is not configured' }, { status: 501 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (
    !orgId ||
    !['cancel', 'resume', 'preview', 'switch', 'portal'].includes(action)
  ) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'billing.manage'))
    ) {
      return Response.json({ error: 'billing.manage required' }, { status: 403 })
    }
    const org = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .get()
    // `stripeCustomerId` moved to `orgs/{orgId}/billing/stripe` (AGL-1028).
    // `readOrgBilling` falls back to the org doc, so this keeps working for orgs
    // the backfill has not reached.
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId
    if (!customerId) {
      return Response.json({ error: 'No billing account yet' }, { status: 409 })
    }

    if (action === 'portal') {
      // Billing portal (AGL-275): no subscription requirement — orgs fix
      // failing cards here even after a subscription dies.
      const origin = headers.origin ?? `https://${headers.host}`
      // Billing moved under the org slug (AGL-621), so `/org/billing` is a
      // dead route — returning from the portal landed on a 404.
      const orgSlug = org.get('slug') as string | undefined
      const session = await stripeRequest(
        secretKey,
        'POST',
        'billing_portal/sessions',
        new URLSearchParams({
          customer: String(customerId),
          return_url: `${origin}${
            orgSlug ? buildRoute(Route.MANAGE_BILLING, { orgSlug }) : '/'
          }`,
        }),
      )
      return Response.json({ url: session.url }, { status: 200 })
    }

    const subscription = await activeSubscription(secretKey, String(customerId))
    if (!subscription) {
      return Response.json({ error: 'No active subscription' }, { status: 409 })
    }

    if (action === 'cancel' || action === 'resume') {
      // A pending downgrade schedule and cancel-at-period-end must not race
      // (AGL-1862): a schedule flipping the price at the same instant the
      // subscription ends produces whichever Stripe applied last. Cancel and
      // resume both release it — cancel because the org is leaving, resume
      // because "keep my subscription" should mean the plan they can see.
      const releasedSchedule = await releasePendingSchedule(
        secretKey,
        subscription,
      )
      const updated = await stripeRequest(
        secretKey,
        'POST',
        `subscriptions/${subscription.id}`,
        new URLSearchParams({
          cancel_at_period_end: action === 'cancel' ? 'true' : 'false',
        }),
      )
      // Mirror onto the billing doc so the plan card reflects it immediately
      // (the webhook confirms on the next event). Writes through
      // `writeOrgBilling` (AGL-1028) — writing `subscription` straight onto the
      // org doc here would leave the manager-gated copy stale, which a backfill
      // cannot fix because it only repairs history.
      await writeOrgBilling(org.ref.id, {
        subscription: {
          status: updated.status ?? subscription.status,
          cancelAtPeriodEnd: updated.cancel_at_period_end === true,
          ...(releasedSchedule ? { pendingDowngrade: null } : {}),
        },
      } as never)
      if (action === 'cancel') {
        // Funnel accounting (AGL-1863). The retention funnel is not a wall —
        // a direct API cancel still works, because Stripe-dashboard/support
        // cancellations must keep working — but it is not invisible either:
        // a cancel that did not come through the funnel is RECORDED as
        // funnel-skipped, so the churn numbers can never silently exclude
        // the cancels that bypassed the survey. Best-effort: the marker must
        // never break a cancel.
        const funnelId =
          typeof body?.funnelId === 'string' && body.funnelId
            ? String(body.funnelId)
            : null
        try {
          await firebaseAdmin
            .app()
            .firestore()
            .collection('orgs')
            .doc(orgId)
            .collection(RETENTION_COLLECTION)
            .doc()
            .create({
              kind: 'cancel_completed',
              surface: 'subscription_cancel',
              funnelSkipped: !funnelId,
              ...(funnelId ? { funnelId } : {}),
              plan: (org.get('plan') as string | undefined) ?? null,
              uid: decoded.uid,
              createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            })
        } catch {
          // Marker write failed — the cancel itself already succeeded.
        }
      }
      return Response.json({
        ok: true,
        cancelAtPeriodEnd: updated.cancel_at_period_end === true,
        currentPeriodEnd: updated.current_period_end
          ? new Date(updated.current_period_end * 1000).toISOString()
          : null,
      }, { status: 200 })
    }

    // Preview/switch share the target resolution.
    const targetPlan = String(body?.plan ?? '')
    // Same rule as checkout (AGL-1110/1118): an enterprise agreement is never
    // entered — or previewed — through the self-serve plan switcher. Staff
    // provision it via /api/admin/enterprise-billing.
    if (isCustomPricedPlan(targetPlan as OrgPlan)) {
      return Response.json(
        { error: 'Enterprise is custom-priced — contact sales.' },
        { status: 400 },
      )
    }
    const items: any[] = subscription.items?.data ?? []
    // The base plan item, matched on its known plan price id (AGL-1340).
    // This was "the item no add-on price claims" (AGL-528) — identification
    // by elimination, which hands back an add-on or the metered item as soon
    // as the subscription carries something the add-on map doesn't
    // recognise, and then this route RE-PRICES that item as if it were the
    // plan.
    const planItem = findPlanItem<any>(items)
    const itemId = planItem?.id
    // Billing interval (AGL-532): the page's monthly/annual toggle rides
    // the request; absent, the subscription keeps its current interval.
    const currentInterval: 'month' | 'year' =
      planItem?.price?.recurring?.interval === 'year' ? 'year' : 'month'
    const targetInterval: 'month' | 'year' =
      body?.interval === 'year' || body?.interval === 'month'
        ? body.interval
        : currentInterval
    const targetPrice = (
      targetInterval === 'year' ? YEARLY_PRICE_ENV : PRICE_ENV
    )[targetPlan]
    if (!targetPrice) {
      return Response.json({ error: 'Unknown target plan' }, { status: 400 })
    }

    // Asymmetric friction (AGL-1862): where the target sits relative to the
    // plan the subscription is PRICED at decides the mechanics below —
    // upgrades apply today with prorations, downgrades wait for the period
    // end on a subscription schedule. Priced-at, not org-doc `plan`: the
    // mirror lags the webhook, and misreading an upgrade as a downgrade
    // would make a paying customer wait a cycle for MORE capability.
    const currentPlan =
      planFromConfiguredPriceId(planItem?.price?.id) ??
      ((org.get('plan') as OrgPlan | undefined) ?? null)
    const downgrade = isLadderDowngrade(currentPlan, targetPlan)
    const periodEndIso = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null

    // Switching to the plan you are already on is only meaningful as "keep my
    // plan" — the undo for a pending downgrade. Release the schedule and
    // clear the mirror; without one it is a no-op, said honestly.
    if (action === 'switch' && targetPlan === currentPlan) {
      const released = await releasePendingSchedule(secretKey, subscription)
      if (released) {
        await writeOrgBilling(org.ref.id, {
          subscription: {
            status: subscription.status,
            pendingDowngrade: null,
          },
        } as never)
      }
      return Response.json(
        { ok: true, plan: targetPlan, releasedPendingDowngrade: released },
        { status: 200 },
      )
    }

    // The shared metered price (AGL-635), interval-matched to the target
    // (AGL-1340/1280) — resolved here because BOTH the delta below and the
    // absolute phase list further down need it.
    const metered = meteredPriceId(targetInterval)

    // The absolute item list this subscription becomes on the target plan.
    // ONE derivation (AGL-2150): it is what a schedule phase is written from,
    // and it is also the single place `droppedAddons` and the unrecognised
    // items are named, so the delta below and the phase list cannot report
    // different answers about what a switch costs the customer.
    const targetItems = buildTargetItems(items, {
      targetPlan: targetPlan as OrgPlan,
      targetInterval,
      targetPlanPrice: targetPrice,
      meteredPrice: metered,
    })
    const dropped = targetItems.droppedAddons
    // Items neither path can classify. The instant switch leaves them alone
    // and the schedule now carries them through verbatim — but "carried
    // through" is a claim, and until AGL-2150 the only report on this
    // subscription was `droppedAddons`, which lists RECOGNISED kinds only and
    // therefore read as complete while saying nothing about the line items it
    // could not name. A legacy add-on whose env var was rotated, a price
    // attached by hand in the dashboard, a negotiated line, or the flat
    // POS/event-calendar add-ons in an environment that does not configure
    // those env names all land here. Said out loud, and returned.
    const unrecognizedItems = targetItems.unrecognizedPriceIds
    if (unrecognizedItems.length) {
      console.warn('[billing/subscription] subscription carries items this route cannot classify', {
        orgId,
        subscriptionId: subscription.id,
        currentPlan,
        targetPlan,
        targetInterval,
        priceIds: unrecognizedItems,
        note:
          'carried through unchanged; they are neither the plan item, the ' +
          'metered item, nor a price any STRIPE_PRICE_*_EXTRA_*/flat add-on ' +
          'env currently resolves to',
      })
    }

    // Per-plan add-on items (seats/members/datasets/hosts) re-price to
    // the target plan in the same update (AGL-528); kinds the target
    // doesn't sell are dropped and reported. Flat add-ons re-resolve too
    // so every item follows the target interval (one per subscription).
    // A DELTA, deliberately: anything not named here is left exactly where
    // it is, which is the posture the schedule phase now matches.
    const itemChanges: Array<Array<[string, string]>> = [
      [['id', String(itemId)], ['price', targetPrice]],
    ]
    for (const item of items) {
      const kind = addonKindFromPriceId(item?.price?.id)
      if (!kind) continue
      const target = addonPriceId(kind, targetPlan as OrgPlan, targetInterval)
      if (target === item?.price?.id) continue
      if (target) {
        itemChanges.push([['id', String(item.id)], ['price', target]])
      } else {
        itemChanges.push([['id', String(item.id)], ['deleted', 'true']])
      }
    }

    // Ensure the shared metered price (AGL-635) rides the subscription so
    // usage overage — storage AND API requests, reported to the
    // aglyn_metered_usage Billing Meter — can bill. Subscriptions created
    // before the checkout attachment lack it, so a plan switch is where
    // they gain it. A new item (no id, no quantity) — Stripe adds it; it
    // bills $0 until usage is reported, so it never moves the proration
    // preview. Skipped when already present or Stripe is unprovisioned.
    //
    // INTERVAL-MATCHED (AGL-1340, completed in AGL-1280). Stripe rejects a
    // subscription whose items mix `recurring.interval` — verified read-only
    // against live Stripe: Starter yearly + monthly metered fails with "All
    // prices on a subscription must have the same recurring.interval".
    //
    // So the metered item is re-priced to follow the target interval, exactly
    // as the add-on items above are. Matching on `isMeteredPriceId` rather
    // than on the target id is the whole point: on an interval SWITCH the
    // item present recurs on the OTHER interval, and an equality check
    // against the target would miss it, add a second metered item, and make
    // the update mix intervals — the precise crash this is avoiding.
    const meteredItem = items.find((item: any) =>
      isMeteredPriceId(item?.price?.id),
    )
    if (metered) {
      if (!meteredItem) {
        itemChanges.push([['price', metered]])
      } else if (meteredItem?.price?.id !== metered) {
        itemChanges.push([['id', String(meteredItem.id)], ['price', metered]])
      }
    } else {
      // No metered price configured for the target interval. An item already
      // on the subscription therefore recurs on the other one, and LEAVING
      // it would 502 the switch outright, so it has to go — a customer who
      // cannot change plan is worse than one whose overage stops accruing.
      if (meteredItem) {
        itemChanges.push([['id', String(meteredItem.id)], ['deleted', 'true']])
      }
      // Said out loud, but only when the OTHER interval IS configured — that
      // asymmetry is the real fault, and it is invisible from every screen.
      // Both unset is Stripe simply unprovisioned; warning on it would train
      // everyone to ignore the warning.
      if (meteredPriceId(targetInterval === 'year' ? 'month' : 'year')) {
        console.warn('[billing/subscription] metered usage item not attached', {
          orgId,
          targetPlan,
          targetInterval,
          reason: `${
            targetInterval === 'year'
              ? 'STRIPE_PRICE_METERED_YEARLY'
              : 'STRIPE_PRICE_METERED'
          } is unset while the other interval's metered price IS set, so ${targetInterval}ly subscriptions accrue usage that reaches no invoice`,
          removedMismatchedMeteredItem: Boolean(meteredItem),
        })
      }
    }

    if (action === 'switch' && downgrade) {
      // Downgrades are END-OF-CYCLE (AGL-1862): the customer keeps everything
      // they paid for until renewal, and no proration credit walks the paid
      // amount back out the door. A subscription schedule owns the transition —
      // phase 0 restates the current items for the rest of the paid period,
      // phase 1 is the target plan from the period end. `cancel_at_period_end`
      // semantics, but for a plan move.
      //
      // A fresh schedule per downgrade: releasing any prior one first keeps
      // exactly one owner of the period-end transition.
      await releasePendingSchedule(secretKey, subscription)
      const schedule = await stripeRequest(
        secretKey,
        'POST',
        'subscription_schedules',
        new URLSearchParams({ from_subscription: subscription.id }),
      )
      const params = new URLSearchParams({
        end_behavior: 'release',
        // Nothing prorates: phase 0 is what they already bought, phase 1
        // starts a clean period at the new price.
        proration_behavior: 'none',
      })
      // Phase 0: the current items, verbatim, over the current phase's
      // window. Updating a schedule replaces the whole phase list, so the
      // present has to be restated to be preserved.
      const currentPhase = schedule?.phases?.[0] ?? {}
      const currentItems: any[] = currentPhase.items ?? []
      currentItems.forEach((item: any, index: number) => {
        params.set(`phases[0][items][${index}][price]`, String(item.price))
        if (item.quantity != null) {
          params.set(
            `phases[0][items][${index}][quantity]`,
            String(item.quantity),
          )
        }
      })
      if (currentPhase.start_date) {
        params.set('phases[0][start_date]', String(currentPhase.start_date))
      }
      if (currentPhase.end_date) {
        params.set('phases[0][end_date]', String(currentPhase.end_date))
      }
      // Everything else Stripe put on phase 0 from `from_subscription` has to
      // be restated too (AGL-2146). Replacing the phase list with price,
      // quantity and dates alone silently dropped the customer's DISCOUNT,
      // their trial, and the tax configuration — a downgrade quietly cancelling
      // a coupon nobody said anything about, including the winback the
      // retention funnel had just minted to keep them.
      //
      // Carried onto BOTH phases, which is the parity that matters: an instant
      // upgrade never touches the subscription's discounts, so a downgrade must
      // not end one either. A time-boxed coupon keeps running its remaining
      // months across the plan change, exactly as it would have without one.
      preservePhaseTerms(params, 0, currentPhase, { current: true })
      preservePhaseTerms(params, 1, currentPhase, { current: false })
      // Phase 1: the target plan. Add-ons re-price to the target's rates
      // exactly as an instant switch would (AGL-528); kinds it doesn't sell
      // are dropped and reported. The interval-matched metered item rides
      // along (AGL-635/1340) so overage keeps billing after the flip.
      //
      // Anything else on the subscription is carried through VERBATIM
      // (AGL-2150). A phase is an ABSOLUTE list, so building it from the
      // recognised kinds alone deleted every unclassified item at the flip —
      // at renewal, with no log line and no field in the response naming it.
      writePhaseItems(params, 1, targetItems.items)
      params.set('phases[1][iterations]', '1')
      // The phase metadata is what the webhook's subscription.updated mirror
      // reads (`object.metadata.plan` first) when the phase flips at period
      // end — without it the subscription keeps the OLD metadata and the org
      // doc's plan never moves.
      params.set('phases[1][metadata][plan]', targetPlan)
      params.set('phases[1][metadata][orgId]', orgId)
      // Same tax posture as an instant switch (AGL-1537).
      params.set('phases[1][automatic_tax][enabled]', 'true')
      await stripeRequest(
        secretKey,
        'POST',
        `subscription_schedules/${schedule.id}`,
        params,
      )
      // The org doc's `plan` deliberately does NOT change — entitlements run
      // at the paid tier until the period ends and the webhook mirrors the
      // phase flip. Only the manager-gated pending marker moves.
      await writeOrgBilling(org.ref.id, {
        subscription: {
          status: subscription.status,
          pendingDowngrade: {
            plan: targetPlan,
            interval: targetInterval,
            effectiveAt: periodEndIso,
            scheduleId: String(schedule.id),
          },
        },
      } as never)
      return Response.json({
        ok: true,
        scheduled: true,
        plan: currentPlan,
        pendingPlan: targetPlan,
        effectiveAt: periodEndIso,
        droppedAddons: dropped,
        unrecognizedItems,
      }, { status: 200 })
    }

    if (action === 'switch') {
      // An upgrade lands TODAY (the frictionless direction) — but a pending
      // downgrade schedule would re-flip the price at period end, so it is
      // released first and its mirror cleared below.
      const releasedSchedule = await releasePendingSchedule(
        secretKey,
        subscription,
      )
      const params = new URLSearchParams({
        proration_behavior: 'create_prorations',
        // Stripe Tax (AGL-1537): checkout has created subscriptions with
        // automatic tax since AGL-1133, but a subscription created BEFORE
        // that keeps billing untaxed forever unless an update turns it on —
        // and this route is where existing subscriptions get updated. On a
        // subscription that already has it, this is a no-op.
        'automatic_tax[enabled]': 'true',
        'metadata[plan]': targetPlan,
        'metadata[orgId]': orgId,
      })
      itemChanges.forEach((change, index) => {
        for (const [key, value] of change) {
          params.set(`items[${index}][${key}]`, value)
        }
      })
      const updated = await stripeRequest(
        secretKey,
        'POST',
        `subscriptions/${subscription.id}`,
        params,
      )
      // Mirror immediately; the webhook confirms on the next event. `plan`
      // stays on the org doc (feature gating reads it); the commercial keys go
      // to the manager-gated billing doc (AGL-1028).
      await org.ref.set({ plan: targetPlan }, { merge: true })
      await writeOrgBilling(org.ref.id, {
        seatAddons: addonQuantitiesFromItems(updated?.items?.data ?? []),
        subscription: {
          status: updated.status ?? subscription.status,
          priceId: targetPrice,
          interval: targetInterval,
          ...(releasedSchedule ? { pendingDowngrade: null } : {}),
        },
      } as never)
      return Response.json({
        ok: true,
        plan: targetPlan,
        droppedAddons: dropped,
        unrecognizedItems,
      }, { status: 200 })
    }

    if (downgrade) {
      // A downgrade has no proration preview to fetch: nothing is due today,
      // and quoting Stripe's upcoming invoice here would show the credit an
      // INSTANT switch would have issued — the exact number this flow exists
      // not to offer.
      return Response.json({
        amountDueCents: 0,
        currency: subscription.currency ?? 'usd',
        periodEnd: periodEndIso,
        droppedAddons: dropped,
        unrecognizedItems,
        downgrade: true,
      }, { status: 200 })
    }

    const itemsQuery = itemChanges
      .map((change, index) =>
        change
          .map(([key, value]) =>
            `&subscription_items[${index}][${key}]=` +
              encodeURIComponent(value))
          .join(''))
      .join('')
    const preview = await stripeRequest(
      secretKey,
      'GET',
      `invoices/upcoming?customer=${encodeURIComponent(String(customerId))}` +
        `&subscription=${encodeURIComponent(subscription.id)}` +
        itemsQuery +
        `&subscription_proration_behavior=create_prorations` +
        // Preview under the same tax setting the switch will apply (AGL-1537)
        // — otherwise a taxed customer is quoted one number and charged
        // another.
        `&automatic_tax[enabled]=true`,
    )
    return Response.json({
      amountDueCents: preview?.amount_due ?? 0,
      currency: preview?.currency ?? 'usd',
      periodEnd: preview?.period_end
        ? new Date(preview.period_end * 1000).toISOString()
        : null,
      droppedAddons: dropped,
      unrecognizedItems,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Subscription operation failed' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
