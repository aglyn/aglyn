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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  describeStripePaymentMethod,
  selectSubscriptionPaymentMethod,
} from '../../_lib/stripe-payment-method'

/**
 * Staff org billing detail (AGL-245): the org's Stripe invoice history
 * and default payment method, straight from Stripe by the mirrored
 * customer id. Read-only; plan/entitlement overrides stay on the audited
 * staff org endpoints. 501 without Stripe env.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return Response.json({ error: 'Stripe is not configured' }, { status: 501 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const org = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .get()
    const customerId = org.get('stripeCustomerId')
    if (!customerId) {
      // Never subscribed — distinct from "lookup failed" (AGL-940), which the
      // UI has to be able to tell apart.
      return Response.json(
        { invoices: [], paymentMethod: null, hasCustomer: false },
        { status: 200 },
      )
    }
    const headers = { Authorization: `Bearer ${stripeKey}` }
    const [invoicesResponse, customerResponse] = await Promise.all([
      fetch(
        `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(
          String(customerId),
        )}&limit=24`,
        { headers },
      ),
      fetch(
        `https://api.stripe.com/v1/customers/${encodeURIComponent(
          String(customerId),
        )}?expand[]=invoice_settings.default_payment_method`,
        { headers },
      ),
    ])
    const invoicesPayload = await invoicesResponse.json()
    const customerPayload = await customerResponse.json()

    // AGL-940: these used to be read straight through. A Stripe failure —
    // wrong-mode key, deleted customer, restricted key, rate limit — yields
    // `{error}` instead of `{data}`, so `invoices` fell to [] and
    // `paymentMethod` to null and the endpoint returned 200. Staff saw "No
    // invoices yet" for an org with a paid invoice, indistinguishable from an
    // account that had never subscribed. Surface it instead of swallowing it.
    if (!invoicesResponse.ok || !customerResponse.ok) {
      const detail =
        invoicesPayload?.error?.message ?? customerPayload?.error?.message ?? null
      console.error('Stripe billing lookup failed', {
        orgId,
        customerId,
        invoicesStatus: invoicesResponse.status,
        customerStatus: customerResponse.status,
        detail,
      })
      return Response.json(
        { invoices: [], paymentMethod: null, hasCustomer: true, stripeError: detail ?? 'Stripe lookup failed' },
        { status: 200 },
      )
    }

    const invoices = Array.isArray(invoicesPayload?.data)
      ? invoicesPayload.data.map((invoice: any) => ({
          id: invoice.id,
          number: invoice.number ?? null,
          status: invoice.status ?? null,
          amountDueCents: invoice.amount_due ?? 0,
          amountPaidCents: invoice.amount_paid ?? 0,
          currency: invoice.currency ?? 'usd',
          periodStart: invoice.period_start
            ? new Date(invoice.period_start * 1000).toISOString()
            : null,
          periodEnd: invoice.period_end
            ? new Date(invoice.period_end * 1000).toISOString()
            : null,
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        }))
      : []
    // AGL-940, second pass. The first fix made the DESCRIPTION type-agnostic
    // (Link and the wallets have no `.card`), which was a real bug — but it
    // left the LOOKUP reading only the customer, and Test Org still showed
    // "No payment method" beside a paid invoice.
    //
    // Stripe stores the effective default in more than one place, and
    // Checkout commonly sets it on the SUBSCRIPTION while leaving
    // `customer.invoice_settings` untouched. The dashboard shows the
    // resolved value, which is why it disagreed with this endpoint. Walk the
    // same order Stripe bills in, and stop at the first hit.
    let paymentMethod = describeStripePaymentMethod(
      customerPayload?.invoice_settings?.default_payment_method,
    )
    let paymentMethodSource: 'customer' | 'subscription' | null = paymentMethod
      ? 'customer'
      : null
    if (!paymentMethod) {
      // Only when the customer has none — this is the uncommon path and does
      // not need to cost every staff page view a third round trip.
      const subscriptionsResponse = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(
          String(customerId),
        )}&limit=10&expand[]=data.default_payment_method`,
        { headers },
      )
      const subscriptionsPayload = await subscriptionsResponse.json()
      if (!subscriptionsResponse.ok) {
        // Soft-fail: the invoices above are the primary data and they
        // arrived. Degrading to "no payment method" is wrong but survivable;
        // throwing away a good invoice list to report it is worse.
        console.error('Stripe subscription lookup failed', {
          orgId,
          customerId,
          status: subscriptionsResponse.status,
          detail: subscriptionsPayload?.error?.message ?? null,
        })
      } else {
        const described = selectSubscriptionPaymentMethod(
          subscriptionsPayload?.data,
        )
        if (described) {
          paymentMethod = described
          paymentMethodSource = 'subscription'
        }
      }
    }
    return Response.json({
      invoices,
      paymentMethod,
      // Which record answered. Staff-visible debugging: "no payment method"
      // and "we only asked the customer record" are different claims, and
      // the first fix could not tell them apart.
      paymentMethodSource,
      hasCustomer: true,
      delinquent: customerPayload?.delinquent === true,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Billing lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
