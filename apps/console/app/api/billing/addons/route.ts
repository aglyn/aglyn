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
  pluginRequestFromWeb,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  ADDON_KINDS,
  addonKindFromPriceId,
  addonPriceId,
  addonQuantitiesFromItems,
  addonUnitUsd,
  type AddonKind,
  type BillingInterval,
} from '../../../../utils/server/billing-addons'

/** Kinds without a per-plan hard max get sane purchase ceilings. */
const EXTRA_HOSTS_MAX = 100
const POS_REGISTERS_MAX = 50

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

/** The org's active (or trialing/past_due) subscription, if any. */
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
      ['active', 'trialing', 'past_due'].includes(subscription.status),
    ) ?? null
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
    Number.isFinite(max) ? Math.max(0, max - included) : EXTRA_HOSTS_MAX
  switch (kind) {
    case 'managers':
      return bounded(baseline.managersPerOrg, baseline.maxManagersPerOrg)
    case 'members':
      return bounded(baseline.membersPerHost, baseline.maxMembersPerHost)
    case 'datasets':
      return bounded(baseline.datasetsPerOrg, baseline.maxDatasetsPerOrg)
    case 'hosts':
      return baseline.hostLimit === UNLIMITED ? 0 : EXTRA_HOSTS_MAX
    case 'posRegisters':
      return baseline.features.pos ? POS_REGISTERS_MAX : 0
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

    const customerId = org?.stripeCustomerId
    const subscription = customerId
      ? await activeSubscription(secretKey, String(customerId))
      : null
    const items: any[] = subscription?.items?.data ?? []
    // The base plan item is the one no add-on price claims; its price's
    // recurring interval decides which add-on variants attach (Stripe
    // allows one interval per subscription).
    const planItem =
      items.find((item) => !addonKindFromPriceId(item?.price?.id)) ?? items[0]
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
          '&subscription_proration_behavior=create_prorations',
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
    // Mirror the full quantity map (explicit zeros) so removals converge;
    // the webhook re-derives the same map on the subscription event.
    const quantities = addonQuantitiesFromItems(updated?.items?.data ?? [])
    await orgSnapshot.ref.set({ seatAddons: quantities }, { merge: true })
    return Response.json({ ok: true, quantities }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Add-on operation failed' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
