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
  addonMaxForBaseline,
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
  phaseItemsOf,
  preservePhaseTerms,
  restateExistingPhase,
  subscriptionItemsAsPhaseItems,
  writePhaseItems,
  type PhaseItem,
} from '../../../../utils/server/billing-schedule'
import {
  capacityReductionRefusal,
  includedCapacity,
  isCapacityAddonKind,
  readCapacityCounts,
} from '../../../../utils/server/capacity-in-use'

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
 * Move an add-on DOWN at the period end instead of now.
 *
 * Capacity that has been paid for runs to the end of the period it was paid
 * for, exactly as a cancelled plan does. Reducing an add-on therefore changes
 * nothing today: the item keeps its quantity, the site keeps working, and the
 * smaller quantity starts at the renewal.
 *
 * Nothing is credited, and that is the point rather than an omission. An
 * immediate reduction under `always_invoice` would refund unused time for
 * capacity the customer can still use for the rest of the period — paying them
 * back for something they have not stopped having. Deferring the reduction and
 * crediting nothing are two halves of one decision.
 *
 * `proration_behavior: 'none'` on the schedule is what keeps it that way. The
 * phase boundary is a clean period start, so there is no partial period for
 * Stripe to price on either side of it.
 *
 * Returns the period end the change lands on, or null when the subscription
 * cannot carry a schedule.
 */
async function scheduleAddonReduction(options: {
  secretKey: string
  subscription: any
  /** The subscription's items as they stand TODAY, unchanged. */
  items: readonly any[]
  /** The add-on price being reduced, at the plan the org is on TODAY. */
  priceId: string
  /**
   * The add-on being reduced, as a kind rather than a price.
   *
   * A price id identifies "datasets ON STARTER", not "datasets". A phase
   * belonging to a pending downgrade prices its add-ons at the TARGET plan, so
   * the line to move there has a different id from the one the org holds now —
   * and matching by id alone silently matches nothing, restating the phase
   * verbatim while the response still promises the reduction.
   */
  kind: AddonKind
  /** Its quantity from the period end; 0 removes the item entirely. */
  quantity: number
}): Promise<{ effectiveAt: string; scheduleId: string } | null> {
  const { secretKey, subscription, items, priceId, kind, quantity } = options
  /**
   * One line moved on an otherwise untouched item list.
   *
   * Built from whichever list already describes the future, because a phase is
   * an ABSOLUTE list: anything not written back is deleted at the flip, and
   * that has already cost this codebase a customer's unclassified items once.
   */
  const withAddonMoved = (
    base: readonly PhaseItem[],
    matchPrice: string,
  ): PhaseItem[] =>
    base
      .map((item) =>
        item.price === matchPrice
          ? quantity === 0
            ? null
            : { ...item, quantity }
          : item,
      )
      .filter((item): item is PhaseItem => item !== null)

  /**
   * The id this add-on carries ON a given phase.
   *
   * Derived from the phase's own base price rather than from the subscription,
   * because those disagree exactly when it matters: a pending downgrade's phase
   * is already priced at the plan it moves to. Falls back to today's id when
   * the phase names no plan this route sells — a phase it cannot classify is
   * safer restated than rewritten against a guess.
   */
  const addonPriceOnPhase = (phase: any): string => {
    const base = (phase?.items ?? [])
      .map((item: any) =>
        typeof item?.price === 'string' ? item.price : item?.price?.id,
      )
      .map((id: string) => planAndIntervalFromPriceId(id))
      .find((match: unknown) => match) as
      | ReturnType<typeof planAndIntervalFromPriceId>
      | undefined
    const phasePlan = (phase?.metadata?.plan ?? base?.plan) as
      | Parameters<typeof addonPriceId>[1]
      | undefined
    if (!phasePlan) return priceId
    return addonPriceId(kind, phasePlan, base?.interval ?? 'month') ?? priceId
  }

  const existingScheduleId =
    typeof subscription?.schedule === 'string'
      ? subscription.schedule
      : subscription?.schedule?.id
  const schedule = existingScheduleId
    ? await stripeRequest(
        secretKey,
        'GET',
        `subscription_schedules/${encodeURIComponent(String(existingScheduleId))}`,
      )
    : await stripeRequest(
        secretKey,
        'POST',
        'subscription_schedules',
        new URLSearchParams({ from_subscription: subscription.id }),
      )
  if (!schedule?.id) return null

  const phases: any[] = Array.isArray(schedule?.phases) ? schedule.phases : []
  if (!phases.length) return null
  const params = new URLSearchParams({
    end_behavior: String(schedule?.end_behavior ?? 'release'),
    proration_behavior: 'none',
  })
  // A schedule freshly created `from_subscription` has ONE phase — the
  // present. An existing one already carries a future phase, from a pending
  // plan change, and that phase is the one to edit: two futures cannot both
  // be the future, and appending a second would silently extend the
  // subscription by a period.
  if (phases.length === 1) {
    // No future yet: the future is a copy of the present with the line moved.
    restateExistingPhase(params, 0, phases[0])
    preservePhaseTerms(params, 1, phases[0], { current: false })
    writePhaseItems(
      params,
      1,
      withAddonMoved(subscriptionItemsAsPhaseItems(items), priceId),
    )
    params.set('phases[1][iterations]', '1')
    params.set('phases[1][automatic_tax][enabled]', 'true')
    // Carried so the webhook's mirror still reads a plan at the flip; without
    // it the phase replaces the subscription's metadata with nothing.
    const plan = subscription?.metadata?.plan
    const orgId = subscription?.metadata?.orgId
    if (plan) params.set('phases[1][metadata][plan]', String(plan))
    if (orgId) params.set('phases[1][metadata][orgId]', String(orgId))
  } else {
    /*
     * A future phase already exists — a pending plan change — and it is the
     * one to edit. Its OWN items are the base, never the live subscription's.
     *
     * That distinction is the whole correctness of this branch. A pending
     * downgrade's target phase carries the TARGET plan's prices, while the
     * live subscription still carries the current plan's. Rebuilding the phase
     * from the live items would quietly replace the downgrade's prices with
     * today's and leave `metadata[plan]` still naming the target — a phase
     * that bills the old plan while telling the webhook to mirror the new one,
     * with nothing on any screen disagreeing.
     *
     * Editing the phase in place also means the plan change keeps every term
     * it was scheduled with; only the add-on line moves.
     */
    const targetIndex = phases.length - 1
    phases.forEach((phase, index) => {
      restateExistingPhase(
        params,
        index,
        phase,
        index === targetIndex
          ? withAddonMoved(phaseItemsOf(phase), addonPriceOnPhase(phase))
          : undefined,
      )
    })
  }
  const updated = await stripeRequest(
    secretKey,
    'POST',
    `subscription_schedules/${encodeURIComponent(String(schedule.id))}`,
    params,
  )
  const periodEnd = Number(subscription?.current_period_end ?? 0)
  return {
    scheduleId: String(updated?.id ?? schedule.id),
    effectiveAt: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : '',
  }
}

/**
 * How many seats of a POOLED add-on are currently assigned to sites.
 *
 * `null` for kinds that are not pools — manager seats, datasets, extra sites
 * and the Event Calendar are org-wide capacity with no per-site allocation, so
 * there is nothing an assignment could contradict and no reduction to refuse.
 * Returning `null` rather than `0` keeps "not a pool" distinct from "a pool
 * with nothing assigned"; the second is a real state a reduction may proceed
 * against.
 */
function allocatedSeatTotal(
  kind: AddonKind,
  org: Record<string, unknown> | null | undefined,
): number | null {
  const field =
    kind === 'posRegisters'
      ? 'registerAllocations'
      : kind === 'members'
        ? 'collaboratorAllocations'
        : null
  if (!field) return null
  const map = (org?.[field] ?? {}) as Record<string, unknown>
  return Object.values(map).reduce<number>((sum, value) => {
    const seats = Number(value)
    return sum + (Number.isFinite(seats) && seats > 0 ? Math.floor(seats) : 0)
  }, 0)
}

/**
 * The per-kind ceiling. Delegates to the shared definition so this route and
 * `buildTargetItems` — which needs the same ceiling for the TARGET plan on a
 * plan change — cannot answer differently.
 */
const addonMax = addonMaxForBaseline


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
    // REDUCING below what is already ASSIGNED is refused.
    //
    // `posRegisters` and `members` are org-level POOLS, and a separate
    // allocation map says which site each seat sits on. The only check here
    // was `0 <= quantity <= max`, so shrinking the pool below the assigned
    // count was accepted silently — the map kept every row, and the pool
    // arbiter then resolved the shortfall BY SORTED HOST ID. Capacity moved to
    // a site the merchant did not choose, and re-buying re-granted from the
    // stale map, so a merchant removing one seat could take a register off a
    // different store.
    //
    // Refused rather than auto-released: which site loses a seat is a business
    // decision with a consequence at that site, and picking one by id sort is
    // exactly the arbitrary answer this replaces. The error names how many to
    // free, so the next step is obvious.
    const assigned = allocatedSeatTotal(kind, org)
    if (assigned !== null && quantity < assigned) {
      return Response.json(
        {
          error:
            `${assigned} of these are assigned to sites. Unassign ` +
            `${assigned - quantity} first, then reduce the total — otherwise ` +
            'a site would lose capacity without anyone choosing which.',
          code: 'assigned_seats_exceed_quantity',
          assigned,
        },
        { status: 409 },
      )
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
    /**
     * This add-on's quantity RIGHT NOW: 0 when no item exists, and `null`
     * when an item exists but Stripe reports no quantity on it at all
     * (metered variants carry none).
     *
     * Deliberately not folded to 0. `strictNullChecks` is off repo-wide, so
     * nothing here would flag `Number(existing.quantity) || 0` — and that
     * reads a MISSING quantity as "already zero", which would short-circuit
     * a removal into never happening. 0 is a legitimate quantity; absent is
     * not the same value, and the no-op test below has to tell them apart.
     */
    const currentQuantity: number | null = existing
      ? Number.isFinite(Number(existing.quantity))
        ? Math.floor(Number(existing.quantity))
        : null
      : 0
    if (currentQuantity === quantity) {
      // Nothing changes; report the no-op instead of calling Stripe.
      //
      // Two shapes of no-op: nothing to remove (no item, quantity 0), and
      // AGL-2486 — setting the quantity to the one it already has. Stripe
      // answers ANY subscription-item update under `create_prorations` with
      // the proration pair, whether or not the quantity moved: a credit for
      // unused time and a charge for remaining time, same item, same price,
      // same period, cancelling exactly. They land as pending invoice items
      // and surface on the next invoice as two lines totalling $0.00
      // (invoice #3VKIUCFB-0002), which reads to a customer as a charge
      // nobody can explain.
      //
      // Real changes still prorate: `create_prorations` below is deliberate
      // (AGL-535, nothing charged today, it rides the next invoice). The
      // defect was issuing the update at all when nothing changed.
      //
      // No `seatAddons` mirror write, same as every no-op here has always
      // done: the map this answers with IS the subscription's current one,
      // and the webhook owns convergence (AGL-527).
      return Response.json(
        action === 'preview'
          ? { amountDueCents: 0, prorationCents: 0, currency: 'usd' }
          : { ok: true, quantities: addonQuantitiesFromItems(items) },
        { status: 200 },
      )
    }

    // REDUCING below what the org-wide capacity is CARRYING is refused too.
    //
    // The pool gate above covers the two kinds with an allocation map. These
    // three have none — extra sites, datasets and manager seats are org-wide,
    // and each was checked at CREATE time and nowhere else. So "buy the seat,
    // invite the person, drop the seat" cost nothing, and `hostLimit` is worse
    // still: it is consulted at exactly one moment in a site's life, the
    // transaction that mints it.
    //
    // Refused at the reduction rather than re-checked at use, for the reason
    // `capacity-in-use.ts` sets out at length: use-time enforcement here means
    // ejecting a teammate or locking a dataset, which lands on customers who
    // merely downgraded. The clamp inside `capacityReductionRefusal` is what
    // keeps an org that is over a cap for reasons it did not choose out of
    // this branch entirely.
    //
    // Counted only on an actual reduction of a gated kind. Each count is an
    // aggregation or a roster list, and this route is hit on every billing
    // page load.
    if (
      isCapacityAddonKind(kind) &&
      currentQuantity !== null &&
      quantity < currentQuantity
    ) {
      const refusal = capacityReductionRefusal({
        kind,
        quantity,
        currentQuantity,
        included: includedCapacity(kind, baseline),
        counts: await readCapacityCounts({ orgId, org, kinds: [kind] }),
      })
      if (refusal) return Response.json(refusal, { status: 409 })
    }

    // One modified line item, shared by preview and set. Stripe treats
    // quantity 0 as an explicit deletion flag on updates.
    const itemParams: Array<[string, string]> = existing
      ? quantity === 0
        ? [['id', String(existing.id)], ['deleted', 'true']]
        : [['id', String(existing.id)], ['quantity', String(quantity)]]
      : [['price', priceId], ['quantity', String(quantity)]]

    /*
     * A REDUCTION is quoted as what it is: nothing today.
     *
     * Answered here rather than by pricing it, because there is nothing to
     * price. `invoices/upcoming` under `always_invoice` returns the credit a
     * reduction WOULD raise if it applied now — and it no longer applies now,
     * so that figure describes a refund the customer will never receive. A
     * confirm quoting money back for a change that returns none is the same
     * defect as a confirm quoting a discount that never reaches the charge;
     * it just points the other way.
     *
     * Placed above the priced preview so the two can never disagree: there is
     * one branch for reductions and it is this one.
     */
    if (
      action === 'preview' &&
      currentQuantity !== null &&
      quantity < currentQuantity
    ) {
      const periodEnd = Number(subscription?.current_period_end ?? 0)
      return Response.json(
        {
          amountDueCents: 0,
          prorationCents: 0,
          taxCents: 0,
          chargedNowCents: 0,
          taxComplete: true,
          currency: String(subscription?.currency ?? 'usd'),
          // What the caller needs to describe the change honestly: it happens,
          // but later, and it costs nothing either way.
          defersToPeriodEnd: true,
          effectiveAt: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
        },
        { status: 200 },
      )
    }

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
          // The SAME behaviour the set-action applies, so the quote and the
          // charge are computed the same way. Under `always_invoice` the
          // preview is the proration-only invoice that would be raised now,
          // rather than the whole next renewal with the proration buried in
          // it — which is what makes a tax-inclusive "charged now" figure
          // readable off it at all.
          '&subscription_proration_behavior=always_invoice' +
          // Preview under the same tax setting the set-action applies
          // (AGL-1537), so the quoted proration matches the invoice.
          '&automatic_tax[enabled]=true',
      )
      // The cost of this change is its proration lines — negative on removals
      // (credit).
      const prorationCents = (preview?.lines?.data ?? [])
        .filter((line: any) => line?.proration)
        .reduce(
          (sum: number, line: any) => sum + Number(line?.amount ?? 0),
          0,
        )
      // What is actually taken today, tax included.
      //
      // Quoted separately from `prorationCents` rather than instead of it: the
      // proration is the figure that explains WHY the amount is what it is
      // (part of a period, or a credit), and the total is the figure that
      // leaves the account. A confirm that showed only the pre-tax proration
      // would name a number no invoice uses, which is the defect this same
      // page carries on its plan card.
      const taxCents = Number(preview?.tax ?? 0)
      const chargedNowCents = Number(preview?.amount_due ?? 0)
      return Response.json({
        amountDueCents: chargedNowCents,
        prorationCents,
        taxCents,
        chargedNowCents,
        // Whether Stripe finished resolving tax for this address. A zero tax
        // is legitimate in some jurisdictions and meaningless in others, and
        // the caller cannot tell them apart without this.
        taxComplete: preview?.automatic_tax?.status === 'complete',
        currency: preview?.currency ?? 'usd',
      }, { status: 200 })
    }

    /*
     * A REDUCTION waits for the period end. Nothing is charged, nothing is
     * credited, and the capacity keeps working until then.
     *
     * Only an increase is immediate. The two directions are not symmetric and
     * treating them alike is what made the earlier behaviour wrong in both:
     * an addition the customer wants now was deferred a month, and a removal
     * would refund unused time for a site they can still publish to.
     *
     * `seatAddons` is deliberately NOT written here. It mirrors what the
     * subscription is carrying, and the subscription is still carrying the old
     * quantity — the webhook rewrites it when the phase flips. Writing the
     * smaller number today would tell every entitlement check the capacity was
     * already gone, which is the opposite of what was just promised.
     */
    if (currentQuantity !== null && quantity < currentQuantity) {
      const scheduled = await scheduleAddonReduction({
        secretKey,
        subscription,
        items,
        priceId,
        kind,
        quantity,
      })
      if (!scheduled) {
        return Response.json(
          {
            error:
              'We could not schedule that change. Nothing has changed and ' +
              'nothing has been charged.',
          },
          { status: 502 },
        )
      }
      return Response.json(
        {
          ok: true,
          // The CURRENT map, unchanged: what the workspace may use until the
          // period ends is what it has now.
          quantities: addonQuantitiesFromItems(items),
          pendingAddonChange: {
            kind,
            quantity,
            effectiveAt: scheduled.effectiveAt,
            scheduleId: scheduled.scheduleId,
          },
        },
        { status: 200 },
      )
    }

    const params = new URLSearchParams({
      /*
       * Capacity bought now is INVOICED now.
       *
       * `create_prorations` files the proration as a pending invoice item and
       * settles it on the next renewal, so a customer who bought a site at the
       * start of a period waited a month to be charged for it and the console
       * had nothing to show them in between. `always_invoice` draws the
       * proration onto an invoice immediately and charges the default payment
       * method, which is what "buy capacity" already implies to the person
       * clicking it.
       *
       * The charge is what changes, not the proration arithmetic: the amount
       * is the same figure either behaviour computes for the remainder of the
       * period. `automatic_tax` below applies to that invoice, so the amount
       * taken is tax-inclusive and the confirm has to quote it that way.
       */
      proration_behavior: 'always_invoice',
      // Stripe Tax (AGL-1537): an add-on purchase is a subscription update,
      // and updates are where subscriptions created before automatic tax
      // gain it — same rule as the plan-switch route. No-op when already on.
      'automatic_tax[enabled]': 'true',
    })
    for (const [key, value] of itemParams) {
      params.set(`items[0][${key}]`, value)
    }
    // The invoice `always_invoice` raises, expanded on the same call that
    // causes it. Under `create_prorations` there was nothing to report — the
    // proration sat as a pending item and no money moved — so `ok: true` was
    // the whole truth. It is not any more: this request now charges a card,
    // and a charge that fails has to reach the customer as a failure rather
    // than as a purchase that quietly did not get paid for.
    params.set('expand[]', 'latest_invoice.payment_intent')
    const updated = await stripeRequest(
      secretKey,
      'POST',
      `subscriptions/${subscription.id}`,
      params,
    )
    const addonInvoice = updated?.latest_invoice ?? null
    const addonIntent = addonInvoice?.payment_intent ?? null
    // `paid` is the only affirmative. An invoice can be `open` because the
    // card was declined, or because the issuer wants authentication — the
    // second is recoverable from the browser and the first is not, so they are
    // named apart rather than collapsed into "something went wrong".
    const chargePaid = addonInvoice ? addonInvoice.status === 'paid' : true
    const chargeRequiresAction = addonIntent?.status === 'requires_action'
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
      {
        ok: true,
        quantities,
        // The capacity is granted either way — Stripe applied the item, and
        // the webhook mirrors it — so this reports the CHARGE, not the change.
        // A customer whose card failed still has the seats and now has an
        // unpaid invoice, and the page has to be able to say so.
        chargedNowCents: Number(addonInvoice?.amount_due ?? 0),
        chargeCurrency: String(addonInvoice?.currency ?? 'usd'),
        chargePaid,
        ...(chargeRequiresAction && addonIntent?.client_secret
          ? {
              chargeRequiresAction: true,
              chargeClientSecret: String(addonIntent.client_secret),
            }
          : {}),
        ...(scheduleRefreshFailed ? { scheduleRefreshFailed: true } : {}),
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Add-on operation failed' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
