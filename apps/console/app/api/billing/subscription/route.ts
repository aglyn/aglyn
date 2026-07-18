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

import { pluginRequestFromWeb, type OrgPlan } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  addonKindFromPriceId,
  addonPriceId,
  addonQuantitiesFromItems,
  type AddonKind,
} from '../../../../utils/server/billing-addons'

const PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
  advanced: process.env.STRIPE_PRICE_ADVANCED,
}

/** Annual prices (AGL-269/532); switches honor the page's toggle. */
const YEARLY_PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER_YEARLY,
  pro: process.env.STRIPE_PRICE_PRO_YEARLY,
  business: process.env.STRIPE_PRICE_BUSINESS_YEARLY,
  advanced: process.env.STRIPE_PRICE_ADVANCED_YEARLY,
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
 * Subscription management (AGL-269), billing.manage-gated:
 * - `cancel`   → cancel_at_period_end (plan runs out at renewal)
 * - `resume`   → clears a pending cancelation
 * - `preview`  → prorated amount for switching to another plan today,
 *   via Stripe's upcoming-invoice preview
 * - `switch`   → updates the subscription item to the target plan's
 *   price with prorations (an existing subscription never goes through
 *   Checkout again); per-plan add-on items re-price to the target plan
 *   in the same update, dropping kinds it doesn't sell (AGL-528).
 *   501 without Stripe env.
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
    const customerId = org.get('stripeCustomerId')
    if (!customerId) {
      return Response.json({ error: 'No billing account yet' }, { status: 409 })
    }

    if (action === 'portal') {
      // Billing portal (AGL-275): no subscription requirement — orgs fix
      // failing cards here even after a subscription dies.
      const origin = headers.origin ?? `https://${headers.host}`
      const session = await stripeRequest(
        secretKey,
        'POST',
        'billing_portal/sessions',
        new URLSearchParams({
          customer: String(customerId),
          return_url: `${origin}/org/billing`,
        }),
      )
      return Response.json({ url: session.url }, { status: 200 })
    }

    const subscription = await activeSubscription(secretKey, String(customerId))
    if (!subscription) {
      return Response.json({ error: 'No active subscription' }, { status: 409 })
    }

    if (action === 'cancel' || action === 'resume') {
      const updated = await stripeRequest(
        secretKey,
        'POST',
        `subscriptions/${subscription.id}`,
        new URLSearchParams({
          cancel_at_period_end: action === 'cancel' ? 'true' : 'false',
        }),
      )
      // Mirror onto the org doc so the plan card reflects it immediately
      // (the webhook confirms on the next event).
      await org.ref.set(
        {
          subscription: {
            status: updated.status ?? subscription.status,
            cancelAtPeriodEnd: updated.cancel_at_period_end === true,
          },
        },
        { merge: true },
      )
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
    const items: any[] = subscription.items?.data ?? []
    // The base plan item is the one no add-on price claims (AGL-528) —
    // with add-on items on the subscription it need not be items[0].
    const planItem =
      items.find((item: any) => !addonKindFromPriceId(item?.price?.id)) ??
      items[0]
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

    // Per-plan add-on items (seats/members/datasets/hosts) re-price to
    // the target plan in the same update (AGL-528); kinds the target
    // doesn't sell are dropped and reported. Flat add-ons re-resolve too
    // so every item follows the target interval (one per subscription).
    const itemChanges: Array<Array<[string, string]>> = [
      [['id', String(itemId)], ['price', targetPrice]],
    ]
    const dropped: AddonKind[] = []
    for (const item of items) {
      const kind = addonKindFromPriceId(item?.price?.id)
      if (!kind) continue
      const target = addonPriceId(kind, targetPlan as OrgPlan, targetInterval)
      if (target === item?.price?.id) continue
      if (target) {
        itemChanges.push([['id', String(item.id)], ['price', target]])
      } else {
        itemChanges.push([['id', String(item.id)], ['deleted', 'true']])
        dropped.push(kind)
      }
    }

    if (action === 'switch') {
      const params = new URLSearchParams({
        proration_behavior: 'create_prorations',
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
      // Mirror immediately; the webhook confirms on the next event.
      await org.ref.set(
        {
          plan: targetPlan,
          seatAddons: addonQuantitiesFromItems(updated?.items?.data ?? []),
          subscription: {
            status: updated.status ?? subscription.status,
            priceId: targetPrice,
            interval: targetInterval,
          },
        },
        { merge: true },
      )
      return Response.json({
        ok: true,
        plan: targetPlan,
        droppedAddons: dropped,
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
        `&subscription_proration_behavior=create_prorations`,
    )
    return Response.json({
      amountDueCents: preview?.amount_due ?? 0,
      currency: preview?.currency ?? 'usd',
      periodEnd: preview?.period_end
        ? new Date(preview.period_end * 1000).toISOString()
        : null,
      droppedAddons: dropped,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Subscription operation failed' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
