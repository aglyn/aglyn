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
  EXTRA_HOSTS_ADDON_MAX,
  isLiveSubscriptionStatus,
  pluginRequestFromWeb,
  POS_REGISTERS_ADDON_MAX,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  ADDON_KINDS,
  addonPriceId,
  addonQuantitiesFromItems,
  addonUnitUsd,
  findPlanItem,
  meteredPriceId,
  planAndIntervalFromPriceId,
  planPriceId,
  type AddonKind,
  type BillingInterval,
} from '../../../../utils/server/billing-addons'
import {
  buildTargetItems,
  restateExistingPhase,
  subscriptionItemsAsPhaseItems,
} from '../../../../utils/server/billing-schedule'

// lockdown-423: exempt — self-serve billing surface. AGL-1501 keeps billing/maintenance-locked
// sessions alive PRECISELY so members can reach billing and pay; a 423
// here would break the page they need. Security/manual locks revoke
// tokens at lock time, which closes this surface within the token hour.

/**
 * Kinds without a per-plan hard max get sane purchase ceilings. These now
 * live in `plan-entitlements.ts` beside the bands and the resolver they
 * bound (AGL-1738) — as two private literals here they were invisible to
 * anyone reading `resolveOrgEntitlements`, which is how that add came to be
 * read as unbounded.
 */

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
 * The org's live subscription, if any — the one add-on items are attached to.
 *
 * "Live" is `isLiveSubscriptionStatus`, the single list in `org-billing-doc.ts`
 * (AGL-1715). Add-ons re-price onto whichever subscription this finds, so if
 * this narrowed relative to checkout's copy the purchase would miss the org's
 * real subscription rather than fail loudly.
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
 * Re-derives a pending downgrade schedule's TARGET phase from the
 * subscription's items as they are RIGHT NOW (AGL-2150).
 *
 * A subscription schedule's phases are ABSOLUTE item lists, snapshotted when
 * the downgrade was requested. This route changes the subscription's items and
 * knew nothing about `subscription.schedule`, so the sequence "schedule a
 * downgrade, then buy five more seats" charged for the seats, prorated them,
 * and then deleted them at the period end when phase 1 applied its stale list.
 * Recurring revenue, gone on a timer, with nothing on any screen saying so.
 *
 * Refreshing from the subscription's CURRENT items is correct whatever Stripe
 * does with a schedule mid-phase, which is the point: it makes the snapshot
 * match reality at the one moment reality changed, rather than depending on an
 * answer only a live account could give. Phase 0 is restated from the live
 * subscription for the same reason — if Stripe already amended it the write is
 * a no-op, and if it did not, the schedule stops disagreeing with the
 * subscription the customer is actually being billed for.
 *
 * The target phase's PLAN comes from its own `metadata[plan]` (written by the
 * downgrade path, and what the webhook mirror reads at the flip), falling back
 * to whichever plan its base price sells. An unclassifiable phase is left
 * strictly alone: a schedule this route does not understand is safer stale
 * than rewritten wrong.
 */
async function refreshScheduleTargetPhase(options: {
  secretKey: string
  scheduleId: string
  /** The subscription's items AFTER the add-on change. */
  items: any[]
}): Promise<void> {
  const { secretKey, scheduleId, items } = options
  const schedule = await stripeRequest(
    secretKey,
    'GET',
    `subscription_schedules/${encodeURIComponent(scheduleId)}`,
  )
  const phases: any[] = Array.isArray(schedule?.phases) ? schedule.phases : []
  // Nothing pending: a released/canceled schedule, or one with no future
  // phase, has no snapshot to go stale.
  if (phases.length < 2) return
  if (schedule?.status !== 'active' && schedule?.status !== 'not_started') return
  const targetIndex = phases.length - 1
  const targetPhase = phases[targetIndex]
  const basePrice = (targetPhase?.items ?? [])
    .map((item: any) =>
      typeof item?.price === 'string' ? item.price : item?.price?.id,
    )
    .map((priceId: string) => planAndIntervalFromPriceId(priceId))
    .find((match: unknown) => match) as
    | ReturnType<typeof planAndIntervalFromPriceId>
    | undefined
  const targetPlan = (targetPhase?.metadata?.plan ?? basePrice?.plan) as
    | Parameters<typeof planPriceId>[0]
    | undefined
  const targetInterval: BillingInterval = basePrice?.interval ?? 'month'
  if (!targetPlan) return
  const targetPlanPrice = planPriceId(targetPlan, targetInterval)
  if (!targetPlanPrice) return
  const rebuilt = buildTargetItems(items, {
    targetPlan,
    targetInterval,
    targetPlanPrice,
    meteredPrice: meteredPriceId(targetInterval),
  })
  const params = new URLSearchParams({
    end_behavior: String(schedule?.end_behavior ?? 'release'),
    // The items already match the live subscription, so there is nothing to
    // prorate — and a downgrade schedule never prorates by design (AGL-1862).
    proration_behavior: 'none',
  })
  phases.forEach((phase, index) => {
    restateExistingPhase(
      params,
      index,
      phase,
      index === targetIndex
        ? rebuilt.items
        : index === 0
          ? subscriptionItemsAsPhaseItems(items)
          : undefined,
    )
  })
  await stripeRequest(
    secretKey,
    'POST',
    `subscription_schedules/${encodeURIComponent(scheduleId)}`,
    params,
  )
}

/**
 * Max purchasable quantity per kind, from a purchases-free entitlement
 * resolution (plan defaults + staff overrides only) so the ceiling
 * doesn't drift as the org buys: seat/dataset kinds stop at the plan's
 * hard max, hosts/registers use flat ceilings, the Event Calendar is a
 * 0/1 toggle. POS registers additionally require the `pos` feature.
 */
function addonMax(
  kind: AddonKind,
  baseline: ReturnType<typeof resolveOrgEntitlements>,
): number {
  const bounded = (included: number, max: number) =>
    Number.isFinite(max) ? Math.max(0, max - included) : EXTRA_HOSTS_ADDON_MAX
  switch (kind) {
    case 'managers':
      return bounded(baseline.managersPerOrg, baseline.maxManagersPerOrg)
    case 'members':
      return bounded(baseline.membersPerHost, baseline.maxMembersPerHost)
    case 'datasets':
      return bounded(baseline.datasetsPerOrg, baseline.maxDatasetsPerOrg)
    case 'hosts':
      return baseline.hostLimit === UNLIMITED ? 0 : EXTRA_HOSTS_ADDON_MAX
    case 'posRegisters':
      return baseline.features.pos ? POS_REGISTERS_ADDON_MAX : 0
    case 'eventCalendar':
      return 1
  }
}

/**
 * Self-serve add-on management (AGL-526), billing.manage-gated. Add-ons
 * are items on the org's one Stripe subscription (interval-matched to
 * the base plan item), so quantity changes prorate like plan switches:
 * - `get`     → current quantities + per-kind catalog for the org's plan
 * - `preview` → prorated amount for a quantity change today
 * - `set`     → create/update/delete the item with prorations, then
 *   mirror `org.seatAddons` immediately (the webhook confirms; AGL-527)
 * Free/dead-subscription orgs get `upgrade_required` — add-ons need a
 * live subscription to bill on. 501 without Stripe env.
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
  if (!orgId || !['get', 'preview', 'set'].includes(action)) {
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
    // Release gate (AGL-1653). The Billing page drops the "Plan add-ons"
    // card on `useReleaseFlag('release_addon_store').visible`, and until
    // now that was the ONLY gate — with the flag off the card vanished
    // while this route kept accepting POSTs and kept reaching Stripe. A
    // flag whose name says "add-on store" has to close the purchase path,
    // not just the surface that describes it; that is the whole point of
    // holding it as a kill switch.
    //
    // The staff bypass mirrors `visible` (`released || isStaff`) exactly,
    // so the one audience that still SEES the card is the one that can
    // still use it. 404 rather than 403: a released-off feature does not
    // exist, which is what both plugin API dispatchers and the edit-access
    // token route already answer.
    if (
      !isStaff &&
      !(await isServerReleaseFlagOnForOrg('release_addon_store', orgId))
    ) {
      return Response.json({ error: 'Not available' }, { status: 404 })
    }
    const orgSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .get()
    const org = (orgSnapshot.data() ?? {}) as any
    const plan = resolveEffectivePlan(org)
    // Purchase ceilings come from the purchases-free resolution so a
    // bought quantity never raises its own cap.
    const baseline = resolveOrgEntitlements({ ...org, seatAddons: {} })

    // AGL-1028: moved to `orgs/{orgId}/billing/stripe`, org doc as fallback.
    // `seatAddons` stays inline on `org` — it is an entitlement input, so
    // `resolveOrgEntitlements` above still reads it straight off the org doc.
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId
    let subscription: any = null
    if (customerId) {
      try {
        subscription = await activeSubscription(secretKey, String(customerId))
      } catch (error) {
        // A read-only `get` degrades to "no subscription" rather than failing
        // the whole card: a stale/invalid Stripe customer or a transient
        // Stripe outage shouldn't spam a warning on every billing-page load
        // (the UI already handles `hasSubscription: false`). Write actions
        // (`preview`/`set`) still surface the error — they need a live
        // subscription to bill on.
        if (action !== 'get') throw error
        console.warn('addons: subscription lookup failed for get', error)
      }
    }
    const items: any[] = subscription?.items?.data ?? []
    // The base plan item, matched on its known plan price id (AGL-1340) —
    // not "the item no add-on price claims", which would happily pick the
    // metered item and then read the whole page's billing interval off it.
    // That interval decides which add-on variants attach (Stripe allows one
    // interval per subscription), so getting it wrong sells a monthly add-on
    // onto an annual subscription.
    const planItem = findPlanItem<any>(items)
    const interval: BillingInterval =
      planItem?.price?.recurring?.interval === 'year' ? 'year' : 'month'

    if (action === 'get') {
      const quantities = addonQuantitiesFromItems(items)
      const catalog = Object.fromEntries(
        ADDON_KINDS.map((kind) => {
          const unitUsd = addonUnitUsd(kind, plan)
          const max = addonMax(kind, baseline)
          return [kind, {
            unitUsd,
            max,
            configured: Boolean(addonPriceId(kind, plan, interval)),
            upgradeRequired: unitUsd === null || max <= 0,
          }]
        }),
      )
      return Response.json({
        hasSubscription: Boolean(subscription),
        plan,
        interval,
        quantities,
        catalog,
      }, { status: 200 })
    }

    if (!subscription) {
      return Response.json({
        error: 'Add-ons need an active plan subscription',
        code: 'upgrade_required',
      }, { status: 409 })
    }

    const kind = String(body?.kind ?? '') as AddonKind
    if (!ADDON_KINDS.includes(kind)) {
      return Response.json({ error: 'Unknown add-on' }, { status: 400 })
    }
    const quantity = Math.floor(Number(body?.quantity))
    const max = addonMax(kind, baseline)
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > max) {
      return Response.json({
        error: max <= 0
          ? 'This add-on needs a plan upgrade'
          : `Quantity must be between 0 and ${max}`,
        code: max <= 0 ? 'upgrade_required' : 'invalid_quantity',
      }, { status: max <= 0 ? 409 : 400 })
    }
    const unitUsd = addonUnitUsd(kind, plan)
    if (unitUsd === null) {
      return Response.json({
        error: 'Your plan does not sell this add-on — upgrade to add it',
        code: 'upgrade_required',
      }, { status: 409 })
    }
    const priceId = addonPriceId(kind, plan, interval)
    if (!priceId) {
      return Response.json({
        error: 'This add-on price is not configured yet',
      }, { status: 501 })
    }

    const existing = items.find((item) => item?.price?.id === priceId)
    if (!existing && quantity === 0) {
      // Nothing to remove; report the no-op instead of calling Stripe.
      return Response.json(
        action === 'preview'
          ? { amountDueCents: 0, currency: 'usd' }
          : { ok: true, quantities: addonQuantitiesFromItems(items) },
        { status: 200 },
      )
    }

    // One modified line item, shared by preview and set. Stripe treats
    // quantity 0 as an explicit deletion flag on updates.
    const itemParams: Array<[string, string]> = existing
      ? quantity === 0
        ? [['id', String(existing.id)], ['deleted', 'true']]
        : [['id', String(existing.id)], ['quantity', String(quantity)]]
      : [['price', priceId], ['quantity', String(quantity)]]

    if (action === 'preview') {
      const query = itemParams
        .map(([key, value]) =>
          `&subscription_items[0][${key}]=${encodeURIComponent(value)}`)
        .join('')
      const preview = await stripeRequest(
        secretKey,
        'GET',
        `invoices/upcoming?customer=${encodeURIComponent(String(customerId))}` +
          `&subscription=${encodeURIComponent(subscription.id)}` +
          query +
          '&subscription_proration_behavior=create_prorations' +
          // Preview under the same tax setting the set-action applies
          // (AGL-1537), so the quoted proration matches the invoice.
          '&automatic_tax[enabled]=true',
      )
      // amount_due is the WHOLE next invoice (renewal included); the cost
      // of this change is its proration lines — negative on removals
      // (credit). Nothing is charged today with create_prorations
      // (AGL-535).
      const prorationCents = (preview?.lines?.data ?? [])
        .filter((line: any) => line?.proration)
        .reduce(
          (sum: number, line: any) => sum + Number(line?.amount ?? 0),
          0,
        )
      return Response.json({
        amountDueCents: preview?.amount_due ?? 0,
        prorationCents,
        currency: preview?.currency ?? 'usd',
      }, { status: 200 })
    }

    const params = new URLSearchParams({
      proration_behavior: 'create_prorations',
      // Stripe Tax (AGL-1537): an add-on purchase is a subscription update,
      // and updates are where subscriptions created before automatic tax
      // gain it — same rule as the plan-switch route. No-op when already on.
      'automatic_tax[enabled]': 'true',
    })
    for (const [key, value] of itemParams) {
      params.set(`items[0][${key}]`, value)
    }
    const updated = await stripeRequest(
      secretKey,
      'POST',
      `subscriptions/${subscription.id}`,
      params,
    )
    // A pending downgrade holds an item list snapshotted when it was
    // requested (AGL-2150) — refresh it, or the seats just bought and
    // prorated disappear at the period end.
    const scheduleId =
      typeof subscription?.schedule === 'string'
        ? subscription.schedule
        : subscription?.schedule?.id
    let scheduleRefreshFailed = false
    if (scheduleId) {
      try {
        await refreshScheduleTargetPhase({
          secretKey,
          scheduleId: String(scheduleId),
          items: updated?.items?.data ?? [],
        })
      } catch (error) {
        // The purchase itself already succeeded and the card was charged.
        // Failing the request now would tell the customer nothing happened
        // while their invoice says otherwise, so this reports rather than
        // throws — loudly, because the consequence is silent and deferred.
        scheduleRefreshFailed = true
        console.error(
          '[billing/addons] pending plan change NOT refreshed — its item list is stale and will drop this purchase at the period end',
          { orgId, subscriptionId: subscription.id, scheduleId, kind, quantity, error },
        )
      }
    }
    // Mirror the full quantity map (explicit zeros) so removals converge;
    // the webhook re-derives the same map on the subscription event.
    const quantities = addonQuantitiesFromItems(updated?.items?.data ?? [])
    await orgSnapshot.ref.set({ seatAddons: quantities }, { merge: true })
    return Response.json(
      { ok: true, quantities, ...(scheduleRefreshFailed ? { scheduleRefreshFailed: true } : {}) },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Add-on operation failed' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
