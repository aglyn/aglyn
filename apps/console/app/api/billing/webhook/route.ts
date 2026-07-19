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

import { runBillingWebhookHandlers } from '@aglyn/aglyn/server'
import { firebaseAdmin, notifyOrgAdmins } from '@aglyn/tenant-data-admin'
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
  for (const plan of ['starter', 'pro', 'business', 'advanced']) {
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
        const billing = {
          plan,
          stripeCustomerId: object?.customer ?? null,
          // Add-on quantities sync from the items (AGL-527): Stripe is
          // the source of truth; explicit zeros make removals, dashboard
          // edits, and full cancellations all converge.
          seatAddons: addonQuantitiesFromItems(canceled ? [] : items),
          subscription: {
            status: canceled ? 'canceled' : (object?.status ?? 'active'),
            priceId: priceId ?? null,
            // Billing interval (AGL-532): the Billing page's monthly/
            // annual toggle initializes from this mirror.
            interval:
              planItem?.price?.recurring?.interval === 'year'
                ? 'year'
                : 'month',
            currentPeriodEnd: object?.current_period_end
              ? new Date(object.current_period_end * 1000)
              : null,
          },
        }
        await firebaseAdmin
          .app()
          .firestore()
          .collection('orgs')
          .doc(String(orgId))
          .set(billing, { merge: true })
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
        const orgs = await firebaseAdmin
          .app()
          .firestore()
          .collection('orgs')
          .where('stripeCustomerId', '==', customerId)
          .limit(1)
          .get()
        const orgId = orgs.docs[0]?.id
        if (orgId) {
          const amount = Number(object?.amount_due ?? object?.amount_paid ?? 0)
          const dollars = (amount / 100).toFixed(2)
          void notifyOrgAdmins(orgId, {
            type:
              type === 'invoice.payment_failed'
                ? 'billing.paymentFailed'
                : 'billing.invoice',
            title:
              type === 'invoice.payment_failed'
                ? `Payment failed for your $${dollars} invoice`
                : `Your $${dollars} invoice is available`,
            link: '/org/billing',
          })
        }
      }
    }


    // Plugin-owned sections (AGL-418): commerce orders/carts/drafts/
    // reservations/subscriptions, booking payments, and community
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
