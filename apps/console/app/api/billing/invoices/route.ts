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
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/**
 * Org invoice history (AGL-248, AGL-534): the subscription page's billing
 * history table. Returns finalized invoices (drafts excluded) with the
 * Stripe-hosted view URL, direct PDF download, and the paid charge's
 * receipt URL, cursor-paginated via `startingAfter`/`hasMore`.
 * billing.view-gated (AGL-243); 501 without Stripe env.
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
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'billing.view'))
    ) {
      return Response.json({ error: 'billing.view required' }, { status: 403 })
    }
    const org = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .get()
    const customerId = org.get('stripeCustomerId')
    if (!customerId) {
      return Response.json({ invoices: [], hasMore: false }, { status: 200 })
    }
    // Drafts are excluded server-side: they have no number, hosted page,
    // or PDF yet, and Stripe may still discard them.
    const startingAfter = String(query.startingAfter ?? '')
    const response = await fetch(
      `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(
        String(customerId),
      )}&limit=24&expand[]=data.charge` +
        (startingAfter
          ? `&starting_after=${encodeURIComponent(startingAfter)}`
          : ''),
      {
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          // Pinned: 2025-03-31.basil removed `invoice.charge`, so an
          // account on a newer default would reject the expand. Only
          // fields stable in this version are read below.
          'Stripe-Version': '2024-06-20',
        },
      },
    )
    const payload = await response.json()
    if (!response.ok) {
      console.error('Stripe invoice list error', payload?.error)
      return Response.json({ error: 'Invoice lookup failed' }, { status: 502 })
    }
    const invoices = Array.isArray(payload?.data)
      ? payload.data
          .filter((invoice: any) => invoice.status !== 'draft')
          .map((invoice: any) => ({
            id: invoice.id,
            number: invoice.number ?? null,
            status: invoice.status ?? null,
            amountDueCents: invoice.amount_due ?? 0,
            totalCents: invoice.total ?? invoice.amount_due ?? 0,
            currency: invoice.currency ?? 'usd',
            created: invoice.created
              ? new Date(invoice.created * 1000).toISOString()
              : null,
            paidAt: invoice.status_transitions?.paid_at
              ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
              : null,
            periodEnd: invoice.period_end
              ? new Date(invoice.period_end * 1000).toISOString()
              : null,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            invoicePdf: invoice.invoice_pdf ?? null,
            receiptUrl: invoice.charge?.receipt_url ?? null,
          }))
      : []
    // The cursor is the last *fetched* invoice (pre-filter) so paging
    // never re-reads a page that was all drafts.
    const lastFetched = Array.isArray(payload?.data)
      ? payload.data[payload.data.length - 1]
      : null
    return Response.json({
      invoices,
      hasMore: payload?.has_more === true,
      nextCursor: payload?.has_more === true ? (lastFetched?.id ?? null) : null,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Invoice lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
