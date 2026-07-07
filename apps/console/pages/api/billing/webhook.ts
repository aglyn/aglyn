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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

// Stripe signs the RAW body; Next's default JSON parsing would break it.
export const config = { api: { bodyParser: false } }

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks as any)))
    req.on('error', reject)
  })
}

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
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter'
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro'
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return 'business'
  return undefined
}

/**
 * Stripe webhook: syncs subscription lifecycle onto the tenant doc
 * (`tenants/{tenantId}.plan/subscription/stripeCustomerId`). The tenant id
 * travels in the subscription metadata set at checkout. Entitlements resolve
 * from the plan at read time (`resolveTenantEntitlements`), so no
 * entitlement fan-out is needed here.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return res.status(501).json({ error: 'Billing is not configured.' })
  }

  const payload = await readRawBody(req)
  const signatureHeader = String(req.headers['stripe-signature'] ?? '')
  if (!verifyStripeSignature(payload, signatureHeader, secret)) {
    return res.status(400).json({ error: 'Invalid signature' })
  }

  try {
    const event = JSON.parse(payload.toString('utf8'))
    const type = String(event?.type ?? '')
    const object = event?.data?.object ?? {}

    if (
      type === 'customer.subscription.created' ||
      type === 'customer.subscription.updated' ||
      type === 'customer.subscription.deleted'
    ) {
      const tenantId = object?.metadata?.tenantId
      if (tenantId) {
        const canceled = type === 'customer.subscription.deleted'
        const priceId = object?.items?.data?.[0]?.price?.id
        const plan = canceled
          ? 'free'
          : (object?.metadata?.plan ?? planFromPriceId(priceId) ?? 'free')
        await firebaseAdmin
          .app()
          .firestore()
          .collection('tenants')
          .doc(tenantId)
          .set(
            {
              plan,
              stripeCustomerId: object?.customer ?? null,
              subscription: {
                status: canceled ? 'canceled' : (object?.status ?? 'active'),
                priceId: object?.items?.data?.[0]?.price?.id ?? null,
                currentPeriodEnd: object?.current_period_end
                  ? new Date(object.current_period_end * 1000)
                  : null,
              },
            },
            { merge: true },
          )
      }
    }

    // Marketplace purchases (AGL-46): keyed by session id (idempotent on
    // Stripe redelivery). Install gating and the seller ledger read these.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'community-purchase' &&
      object?.payment_status === 'paid'
    ) {
      const { listingId, buyerUid, sellerUid, feeCents } =
        object.metadata ?? {}
      if (listingId && buyerUid && sellerUid) {
        await firebaseAdmin
          .app()
          .firestore()
          .collection('communityPurchases')
          .doc(String(object.id))
          .set({
            listingId,
            buyerUid,
            sellerUid,
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
      }
    }
    // Commerce Starter orders (AGL-90): recorded under the selling host.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-order' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, productId, feeCents } = object.metadata ?? {}
      if (hostId && productId) {
        await firebaseAdmin
          .app()
          .firestore()
          .collection('hosts')
          .doc(String(hostId))
          .collection('orders')
          .doc(String(object.id))
          .set({
            productId,
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            customerEmail: object?.customer_details?.email ?? null,
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
      }
    }
    return res.status(200).json({ received: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Webhook handling failed' })
  }
}
