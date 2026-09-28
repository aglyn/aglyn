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
  readOrgBilling,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { describeStripeModeSplit } from '../../_lib/stripe-customer-mode-notice'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  invoiceAnswers,
  readInvoiceQueryParams,
  stripeInvoiceSearchQuery,
} from '../../../../utils/billing-invoice-query'

// lockdown-423: exempt — a billing-locked org must be able to SEE what it owes to pay it;
// part of the recovery surface AGL-1501 keeps sessions alive for.

/**
 * Org invoice history (AGL-248, AGL-534): the subscription page's billing
 * history table. Returns finalized invoices (drafts excluded) with the
 * Stripe-hosted view URL, direct PDF download, and the paid charge's
 * receipt URL, cursor-paginated via `cursor`/`hasMore` (the older
 * `startingAfter` is still read). Filtered and searched by Stripe itself
 * (`planInvoiceQuery`, AGL-3321).
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
    // `stripeCustomerId` moved to `orgs/{orgId}/billing/stripe` (AGL-1028).
    // `readOrgBilling` falls back to the org doc, so this keeps working for orgs
    // the backfill has not reached.
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId
    if (!customerId) {
      // Empty is not necessarily "never billed" (AGL-2486). The stored customer
      // id is mode-scoped, so a test-mode deployment reading a live-only org
      // gets nothing — and the card said "No invoices yet." over an intact
      // history. Say which silence this is; the ids themselves stay behind.
      return Response.json(
        {
          invoices: [],
          hasMore: false,
          ...(await describeStripeModeSplit(orgId)),
        },
        { status: 200 },
      )
    }
    // Drafts are excluded server-side: they have no number, hosted page,
    // or PDF yet, and Stripe may still discard them.
    //
    // THE FILTERS ARE STRIPE'S (AGL-3321). The page's Filters panel and
    // search arrive as the parameters `planInvoiceQuery` wrote, and each is
    // asked of Stripe itself — the list's `status` and `created` filters, the
    // invoice search for a number, a retrieve for an id — so an older invoice
    // is found as readily as this month's, and nothing is matched over a
    // page after it is fetched. `cursor` is the list's `starting_after` or
    // the search's `page`, whichever answered the last page.
    const params = readInvoiceQueryParams(query)
    const cursor = String(query.cursor ?? query.startingAfter ?? '')
    const stripeHeaders = {
      Authorization: `Bearer ${stripeKey}`,
      // Pinned: 2025-03-31.basil removed `invoice.charge`, so an
      // account on a newer default would reject the expand. Only
      // fields stable in this version are read below.
      'Stripe-Version': '2024-06-20',
    }
    let url: string
    if (params.id) {
      url = `https://api.stripe.com/v1/invoices/${encodeURIComponent(params.id)}?expand[]=charge`
    } else if (params.number) {
      url =
        `https://api.stripe.com/v1/invoices/search?query=${encodeURIComponent(
          stripeInvoiceSearchQuery(String(customerId), params),
        )}&limit=24&expand[]=data.charge` +
        (cursor ? `&page=${encodeURIComponent(cursor)}` : '')
    } else {
      url =
        `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(
          String(customerId),
        )}&limit=24&expand[]=data.charge` +
        (params.status ? `&status=${encodeURIComponent(params.status)}` : '') +
        (params.createdGte !== undefined ? `&created[gte]=${params.createdGte}` : '') +
        (params.createdLt !== undefined ? `&created[lt]=${params.createdLt}` : '') +
        (cursor ? `&starting_after=${encodeURIComponent(cursor)}` : '')
    }
    const response = await fetch(url, { headers: stripeHeaders })
    const raw = await response.json()
    if (params.id && response.status === 404) {
      // No such invoice: an empty answer, not a fault.
      return Response.json({ invoices: [], hasMore: false, nextCursor: null }, { status: 200 })
    }
    if (!response.ok) {
      console.error('Stripe invoice list error', raw?.error)
      return Response.json({ error: 'Invoice lookup failed' }, { status: 502 })
    }
    // One invoice by id is the whole answer to "which invoice is this": it
    // is this organization's, and it answers the other clauses, or there is
    // no match.
    const payload = params.id
      ? {
          data:
            raw?.customer === customerId && invoiceAnswers(raw, params) ? [raw] : [],
          has_more: false,
        }
      : raw
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
    // An EMPTY first page needs the same explanation the missing-customer
    // branch gets, and for a reason that branch cannot see: a workspace that
    // transacted live and was then opened in test has BOTH ids, so the
    // customer is not missing — this mode's customer is simply empty while
    // the other mode holds the history. Without this the card printed "No
    // invoices yet." over an intact one.
    //
    // First page only. On a cursor the emptiness means "no older invoices",
    // which is an observation about paging and not about the mode.
    // Nor under a filter: an empty filtered answer is about the filter.
    const filtered = Object.keys(params).length > 0
    const emptyFirstPage = invoices.length === 0 && !cursor && !filtered
    return Response.json({
      invoices,
      hasMore: payload?.has_more === true,
      nextCursor:
        payload?.has_more === true
          ? params.number
            ? (payload?.next_page ?? null)
            : (lastFetched?.id ?? null)
          : null,
      ...(emptyFirstPage ? await describeStripeModeSplit(orgId) : {}),
    }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Invoice lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
