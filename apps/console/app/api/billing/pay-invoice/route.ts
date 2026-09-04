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
  logOrgActivity,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { platformPaymentsConfigured } from '../../../../utils/server/payments-platform'

// lockdown-423: exempt — this IS the recovery path. A billing-locked, past-due or
// dunning-cancelled org is precisely the org that needs to pay, and precisely the org
// whose console access is being restricted; refusing here would make the lock
// permanent. Part of the surface AGL-1501 keeps sessions alive for.

/**
 * Pay an open invoice, natively — the gap the Stripe Portal was covering.
 *
 * ## Why this route had to exist before the Portal button could go
 *
 * `apps/console/app/api/billing/` had `addons`, `checkout`, `invoices`,
 * `subscription` and `webhook` — and nothing that pays. The only way a
 * customer could settle an overdue invoice or retry a failed payment was the
 * Stripe Billing Portal button, which is why that button stays until this is
 * wired into the UI: removing it while no native path existed would have
 * turned an inconsistent visual into the whole recovery story being gone.
 *
 * ## What makes this different from every other billing route
 *
 * **It must work for orgs the rest of billing refuses.**
 *
 *  - No live subscription is required. Dunning cancels subscriptions; the
 *    invoice is still owed and still payable, so there is deliberately no
 *    `isOrgSubscriptionLive` check here.
 *  - No plan is required, for the same reason.
 *  - `billing.manage`, not `billing.view`: paying moves money.
 *
 * ## Tax is NOT recomputed
 *
 * An invoice is paid at the amount it was issued for. Its tax was computed and
 * fixed at issue, and re-running `automatic_tax` against a customer whose
 * address has since changed would charge a different number from the one on
 * the document the customer is looking at. This route reads `amount_due` and
 * prices nothing.
 *
 * ## The browser does not decide that it was paid
 *
 * `pay` reports what Stripe said about the ATTEMPT. The paid state itself
 * comes from `invoice.payment_succeeded` through the webhook, exactly as it
 * does for a first purchase — a page that says "paid" because a redirect came
 * back is the same class of bug as a quote that omits tax.
 */

interface StripeResult {
  ok: boolean
  status: number
  payload: any
}

async function stripeRequest(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: URLSearchParams,
): Promise<StripeResult> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: body.toString() } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

/** Invoice statuses a customer can still act on. */
const PAYABLE_STATUSES = ['open', 'draft', 'uncollectible']

function describeInvoice(invoice: any) {
  return {
    id: String(invoice?.id ?? ''),
    number: invoice?.number ?? null,
    status: invoice?.status ?? null,
    // The AMOUNT AS ISSUED. Never recomputed — see the note above.
    amountDueCents: Number(invoice?.amount_due ?? 0),
    currency: String(invoice?.currency ?? 'usd'),
    created: invoice?.created
      ? new Date(invoice.created * 1000).toISOString()
      : null,
    hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null,
    invoicePdf: invoice?.invoice_pdf ?? null,
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!platformPaymentsConfigured(secretKey)) {
    return Response.json({ error: 'Stripe is not configured' }, { status: 501 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(body?.orgId ?? '').trim()
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
  const action = String(body?.action ?? '').trim()

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
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId as
      | string
      | undefined
    if (!customerId) {
      return Response.json({ invoices: [] }, { status: 200 })
    }

    if (action === 'get') {
      // OPEN invoices only. A paid history is what `/api/billing/invoices` is
      // for; this route answers "what do I owe right now".
      const result = await stripeRequest(
        secretKey as string,
        'GET',
        `invoices?customer=${encodeURIComponent(customerId)}&status=open&limit=10`,
      )
      if (!result.ok) {
        console.error('[billing/pay-invoice] list failed', result.payload?.error?.code)
        return Response.json(
          { error: 'We could not read your invoices just now.' },
          { status: 502 },
        )
      }
      const invoices = (
        Array.isArray(result.payload?.data) ? result.payload.data : []
      ).map(describeInvoice)
      return Response.json({ invoices }, { status: 200 })
    }

    if (action === 'pay') {
      const invoiceId = String(body?.invoiceId ?? '').trim()
      if (!invoiceId) {
        return Response.json({ error: 'Missing invoice' }, { status: 400 })
      }
      // Read it first, and check it belongs to THIS org's customer. The
      // invoice id comes from the browser, and an id from another customer
      // would otherwise let one workspace pay — or probe — another's bill.
      const invoice = await stripeRequest(
        secretKey as string,
        'GET',
        `invoices/${encodeURIComponent(invoiceId)}`,
      )
      const invoiceCustomer =
        typeof invoice.payload?.customer === 'string'
          ? invoice.payload.customer
          : (invoice.payload?.customer?.id ?? null)
      if (!invoice.ok || invoiceCustomer !== customerId) {
        return Response.json(
          { error: 'That invoice is not on this workspace.' },
          { status: 404 },
        )
      }
      if (invoice.payload?.status === 'paid') {
        // Already settled — by a retry, by the webhook, or in another tab.
        return Response.json({ alreadyPaid: true }, { status: 200 })
      }
      if (!PAYABLE_STATUSES.includes(String(invoice.payload?.status))) {
        return Response.json(
          { error: 'That invoice cannot be paid.' },
          { status: 409 },
        )
      }

      const paid = await stripeRequest(
        secretKey as string,
        'POST',
        `invoices/${encodeURIComponent(invoiceId)}/pay`,
      )
      if (paid.ok) {
        void logOrgActivity(
          orgId,
          { uid: decoded.uid, email: decoded.email },
          'Paid an open invoice',
          { type: 'org', id: orgId },
        )
        // "Submitted", not "paid". The paid STATE arrives through
        // `invoice.payment_succeeded` on the webhook; this only reports that
        // Stripe accepted the attempt.
        return Response.json(
          { submitted: true, status: paid.payload?.status ?? null },
          { status: 200 },
        )
      }

      // The issuer wants authentication. Same shape as a first purchase: the
      // client secret goes back so the page can run `handleNextAction`, and
      // the challenge is the bank's rather than a payment page of Stripe's.
      //
      // ⚠️ THE SECRET IS NOT IN THE ERROR, and reading it from there is why
      // this branch never fired. On the pinned API version `invoices/{id}/pay`
      // answers a 3DS-required card with `code:
      // invoice_payment_intent_requires_action` and NO `payment_intent`
      // object attached — driven against a real test-mode invoice, the whole
      // error carried nothing but the code. So `intent?.client_secret` was
      // always undefined, the branch fell through to the decline below, and a
      // customer whose bank wanted authentication was told their payment did
      // not go through and offered no way to authenticate it.
      //
      // The intent is on the INVOICE, so it is read from there: a second GET,
      // made only on this one error, expanding the field the pay response
      // omits. `requires_action` is asserted rather than assumed, so a
      // genuinely declined card still reaches the decline branch below with
      // Stripe's own reason.
      let intent = paid.payload?.error?.payment_intent ?? null
      if (
        !intent?.client_secret &&
        paid.payload?.error?.code === 'invoice_payment_intent_requires_action'
      ) {
        const expanded = await stripeRequest(
          secretKey as string,
          'GET',
          `invoices/${encodeURIComponent(invoiceId)}?expand[]=payment_intent`,
        )
        if (expanded.ok) intent = expanded.payload?.payment_intent ?? null
      }
      if (intent?.client_secret && intent?.status === 'requires_action') {
        return Response.json(
          { requiresAction: true, paymentClientSecret: intent.client_secret },
          { status: 200 },
        )
      }
      console.error(
        '[billing/pay-invoice] payment failed',
        orgId,
        paid.payload?.error?.code ?? null,
      )
      return Response.json(
        {
          // Stripe's own decline reason — the customer needs to know whether
          // to try another card.
          error:
            paid.payload?.error?.message ??
            'That payment did not go through. Nothing has been charged.',
          declined: true,
        },
        { status: 402 },
      )
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[billing/pay-invoice]', error)
    return Response.json({ error: 'Invoice payment failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
