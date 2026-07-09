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
  firebaseAdmin,
  resolveOrgMembership,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
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
        const billing = {
          plan,
          stripeCustomerId: object?.customer ?? null,
          subscription: {
            status: canceled ? 'canceled' : (object?.status ?? 'active'),
            priceId: object?.items?.data?.[0]?.price?.id ?? null,
            currentPeriodEnd: object?.current_period_end
              ? new Date(object.current_period_end * 1000)
              : null,
          },
        }
        await firebaseAdmin
          .app()
          .firestore()
          .collection('tenants')
          .doc(tenantId)
          .set(billing, { merge: true })
        // Org mirror (AGL-237): orgs are becoming the entitlement source.
        // New checkouts carry orgId in metadata; older subscriptions
        // resolve through the owner's membership. The tenants write above
        // stays until the legacy path is removed (AGL-238).
        const orgId =
          object?.metadata?.orgId ??
          (await resolveOrgMembership(tenantId))?.orgId ??
          null
        if (orgId) {
          await firebaseAdmin
            .app()
            .firestore()
            .collection('orgs')
            .doc(String(orgId))
            .set(billing, { merge: true })
        }
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
    // Paid bookings (AGL-170): payment confirms the pendingPayment hold.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'booking-payment' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, bookingId } = object.metadata ?? {}
      if (hostId && bookingId) {
        const bookingRef = firebaseAdmin
          .app()
          .firestore()
          .collection('hosts')
          .doc(String(hostId))
          .collection('bookings')
          .doc(String(bookingId))
        await bookingRef.set(
          {
            status: 'confirmed',
            paidAmountCents: Number(object?.amount_total ?? 0),
            expiresAtMs: firebaseAdmin.firestore.FieldValue.delete(),
            confirmedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        // Confirmation email now that payment cleared (env-gated).
        const resendKey = process.env.RESEND_API_KEY
        const emailFrom = process.env.USAGE_EMAIL_FROM
        if (resendKey && emailFrom) {
          const booking = (await bookingRef.get()).data() ?? {}
          if (booking['email']) {
            const when = new Date(
              Number(booking['startsAtMs']),
            ).toLocaleString('en-US', {
              dateStyle: 'full',
              timeStyle: 'short',
            })
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: emailFrom,
                to: [booking['email']],
                subject: `Booking confirmed: ${booking['serviceName'] ?? ''}`,
                text:
                  `Hi ${booking['name'] ?? ''},\n\nPayment received — ` +
                  `"${booking['serviceName'] ?? 'your booking'}" is ` +
                  `confirmed for ${when}.\n\nReference: ${bookingId}`,
              }),
            }).catch(() => undefined)
          }
        }
      }
    }
    // Commerce Starter orders (AGL-90): recorded under the selling host.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-order' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, productId, feeCents, couponCode } =
        object.metadata ?? {}
      if (hostId && productId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        await hostRef
          .collection('orders')
          .doc(String(object.id))
          .set({
            productId,
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            customerEmail: object?.customer_details?.email ?? null,
            ...(couponCode ? { couponCode } : {}),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
        // Contacts ingestion (AGL-197): buyers become contacts.
        void upsertHostContact({
          hostId: String(hostId),
          email: object?.customer_details?.email,
          name: object?.customer_details?.name ?? undefined,
          source: 'order',
          interaction: {
            refId: String(object.id),
            summary: `Placed an order ($${(Number(object?.amount_total ?? 0) / 100).toFixed(2)})`,
          },
        })
        const productRef = hostRef.collection('products').doc(String(productId))
        const productSnapshot = await productRef.get()
        // Inventory decrement (AGL-96): only tracked products; the
        // checkout guard makes negative stock a race-window edge, and a
        // floor here keeps the display sane if it happens.
        if (productSnapshot.get('inventory') != null) {
          const remaining = Math.max(
            0,
            Number(productSnapshot.get('inventory')) - 1,
          )
          await productRef
            .set({ inventory: remaining }, { merge: true })
            .catch(() => undefined)
        }
        if (couponCode) {
          await hostRef
            .collection('coupons')
            .doc(String(couponCode))
            .set(
              {
                redemptions: firebaseAdmin.firestore.FieldValue.increment(1),
              },
              { merge: true },
            )
            .catch(() => undefined)
        }
        // Receipt + seller notification (AGL-96): env-gated like every
        // other outbound email; failures never fail the webhook.
        const resendKey = process.env.RESEND_API_KEY
        const emailFrom = process.env.USAGE_EMAIL_FROM
        if (resendKey && emailFrom) {
          const productName = String(
            productSnapshot.get('name') ?? 'your purchase',
          )
          const amount = (Number(object?.amount_total ?? 0) / 100).toFixed(2)
          const sendEmail = (to: string, subject: string, text: string) =>
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ from: emailFrom, to: [to], subject, text }),
            }).catch(() => undefined)
          const buyerEmail = object?.customer_details?.email
          if (buyerEmail) {
            await sendEmail(
              String(buyerEmail),
              `Receipt: ${productName}`,
              `Thanks for your purchase!\n\n${productName} — $${amount}` +
                `\nOrder reference: ${object.id}`,
            )
          }
          const hostSnapshot = await hostRef.get()
          const sellerUid = Object.keys(hostSnapshot.get('admins') ?? {})[0]
          if (sellerUid) {
            const seller = await firebaseAdmin
              .app()
              .auth()
              .getUser(sellerUid)
              .catch(() => null)
            if (seller?.email) {
              await sendEmail(
                seller.email,
                `New order: ${productName}`,
                `You made a sale on ${String(
                  hostSnapshot.get('displayName') ?? hostId,
                )}!\n\n${productName} — $${amount}` +
                  (buyerEmail ? `\nBuyer: ${buyerEmail}` : '') +
                  `\nOrder reference: ${object.id}`,
              )
            }
          }
        }
      }
    }
    return res.status(200).json({ received: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Webhook handling failed' })
  }
}
