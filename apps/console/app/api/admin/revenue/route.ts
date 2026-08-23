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

import { ORG_BILLING_SUBCOLLECTION, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { taxPeriodRange } from '../../../../utils/server/tx-return'
import {
  commerceSettledSummary,
  contractedSummary,
  marketplaceSettledSummary,
  revenueGap,
  subscriptionSettledSummary,
  totalEarnedCents,
  type CommerceOrderRowInput,
  type ContractedOrgInput,
  type MarketplaceRevenueRowInput,
  type PlatformRevenueRowInput,
  type RevenueReport,
} from '../../../../utils/server/revenue-report'

/**
 * Staff revenue reporting on both bases at once (AGL-2486).
 *
 * `GET ?period=2026-08` (a month) or `?period=2026-Q3` (a quarter). READ-ONLY:
 * every query below is a Firestore `get()`, nothing here writes to Firestore
 * and nothing here calls Stripe at all — the settled figures come from the
 * `platformRevenue` / `marketplacePurchases` / `orders` mirrors the billing
 * webhooks already maintain, not from a live Stripe read. That is deliberate
 * beyond politeness: this repo runs the LIVE secret key on localhost, so a
 * reporting page that reached for the Stripe API would be one typo away from
 * touching real money.
 *
 * Staff-gated exactly like `/api/admin/overview` and `/api/admin/tax-return`
 * — the `staff` custom claim, the same trust anchor as the Firestore rules.
 *
 * ## Why two bases and not one
 *
 * Asked whether revenue meant settled cash or contracted plan value, Zach
 * answered "Both, side by side". They answer different questions — contracted
 * reflects a signup the instant its subscription mirror lands, settled is
 * what the bank saw — and the DIFFERENCE between them is the operationally
 * useful number: dunning, failed cards, trials, comps. `gap` decomposes it so
 * the page can name causes instead of showing two totals and a subtraction.
 *
 * ## The period reuses the tax return's parser
 *
 * `taxPeriodRange` already accepts exactly the two shapes wanted here and is
 * already tested. A second copy of "what does 2026-Q3 mean" is precisely the
 * artifact that drifts and makes two staff pages disagree about a quarter.
 */

/**
 * Bound on every ranged sweep. Beyond this the summary is a LOWER BOUND and
 * says so — `truncated` on the response — rather than being filed from.
 * Matches the tax return's cap for the same reason: a route must be bounded,
 * and a silently-clipped revenue total is worse than a loud one.
 */
const ROW_CAP = 2000

/**
 * Bound on the ORDERS sweep specifically, which is a collection-group query
 * across every merchant's storefront rather than one platform-level
 * collection. Lower than `ROW_CAP` on purpose: storefront orders are the
 * highest-cardinality source here and the least of Aglyn's own money.
 */
const ORDER_ROW_CAP = 1000

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // Verified in its OWN try, so a rejected token answers 401 and a Firestore
  // failure below answers 500. One combined catch reports every backend fault
  // as "Unauthenticated", which sends whoever is debugging it to the wrong
  // half of the system.
  let decoded: Awaited<
    ReturnType<ReturnType<ReturnType<typeof firebaseAdmin.app>['auth']>['verifyIdToken']>
  >
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const period = new URL(request.url).searchParams.get('period') ?? ''
    const range = taxPeriodRange(period)
    if (!range) {
      return Response.json(
        { error: 'period must be YYYY-MM or YYYY-Q[1-4]' },
        { status: 400 },
      )
    }

    const firestore = firebaseAdmin.app().firestore()
    const revenue = firestore.collection('platformRevenue')
    const marketplace = firestore.collection('marketplacePurchases')

    const [
      orgsSnapshot,
      billingSnapshot,
      revenueInPeriod,
      revenueUndated,
      marketplaceInPeriod,
      ordersInPeriod,
    ] = await Promise.all([
      // Contracted is a POINT-IN-TIME figure — what the book bills right now
      // — so it is deliberately NOT ranged on the period. A past period's
      // contracted MRR is not recoverable from current org docs and
      // pretending otherwise by filtering on `createdAt` would report today's
      // prices against yesterday's customers.
      firestore.collection('orgs').get(),
      // `subscription` lives at `orgs/{orgId}/billing/stripe` since AGL-1028,
      // so the revenue signal is not on the org doc. One unfiltered
      // collection-group read rather than a get per org inside the loop,
      // matching `/api/admin/overview`. No composite index needed: no filter,
      // no ordering.
      firestore.collectionGroup(ORG_BILLING_SUBCOLLECTION).get(),
      revenue
        .where('paidAt', '>=', range.start)
        .where('paidAt', '<', range.end)
        .limit(ROW_CAP + 1)
        .get(),
      // Rows a range query can NEVER match: a Firestore inequality cannot see
      // a null field, so an invoice with no readable timestamp is invisible
      // to the sweep above and the settled figure is short by it. Counted so
      // the page can say so instead of quietly under-reporting.
      revenue.where('paidAt', '==', null).limit(50).get(),
      // Ranged on `createdAt` — a SINGLE-FIELD inequality, served by
      // Firestore's automatic index, so this cannot be the query that 500s
      // the page over a composite index nobody deployed.
      marketplace
        .where('createdAt', '>=', range.start)
        .where('createdAt', '<', range.end)
        .limit(ROW_CAP + 1)
        .get(),
      // Storefront orders live per host (`hosts/{hostId}/orders`), so this is
      // the one collection-GROUP range here. Single-field inequality again,
      // and capped lower than the rest.
      firestore
        .collectionGroup('orders')
        .where('createdAt', '>=', range.start)
        .where('createdAt', '<', range.end)
        .limit(ORDER_ROW_CAP + 1)
        .get()
        // A collection-group index this deployment has not built answers with
        // FAILED_PRECONDITION. That must degrade to "commerce not counted",
        // loudly, rather than 500 the whole page and take the subscription
        // and marketplace figures down with it.
        .catch(() => null),
    ])

    const billingByOrgId = new Map<string, Record<string, unknown>>()
    for (const billingDoc of billingSnapshot.docs) {
      const parentOrgId = billingDoc.ref.parent.parent?.id
      if (parentOrgId) billingByOrgId.set(parentOrgId, billingDoc.data())
    }
    const contractedInput: ContractedOrgInput[] = orgsSnapshot.docs.map(
      (doc) => ({
        orgId: doc.id,
        // Org doc FIRST so a stale inline `subscription` left over from before
        // the AGL-1028 backfill loses to the authoritative billing doc.
        billing: { ...doc.data(), ...(billingByOrgId.get(doc.id) ?? {}) },
      }),
    )
    const contracted = contractedSummary(contractedInput)

    const subscriptionRows: PlatformRevenueRowInput[] = revenueInPeriod.docs
      .slice(0, ROW_CAP)
      .map((doc) => ({ id: doc.id, ...(doc.data() as object) }))
    const marketplaceRows: MarketplaceRevenueRowInput[] =
      marketplaceInPeriod.docs
        .slice(0, ROW_CAP)
        .map((doc) => ({ id: doc.id, ...(doc.data() as object) }))
    const orderDocs = ordersInPeriod?.docs ?? []
    const commerceRows: CommerceOrderRowInput[] = orderDocs
      .slice(0, ORDER_ROW_CAP)
      .map((doc) => ({ id: doc.id, ...(doc.data() as object) }))

    const subscriptions = subscriptionSettledSummary(subscriptionRows)
    const marketplaceSettled = marketplaceSettledSummary(marketplaceRows)
    const commerce = commerceSettledSummary(
      commerceRows,
      // `null` means the query could not run at all, which is also a state in
      // which the figures are not a total.
      ordersInPeriod === null || orderDocs.length > ORDER_ROW_CAP,
    )

    // Metered usage that was MEASURED and never invoiced (AGL-1878) — a gap
    // cause, and deliberately NOT added to settled revenue. Metered usage
    // that DID bill arrives inside `platformRevenue.grossCents` as an invoice
    // line, so summing the usage rollup beside it would double-count every
    // billed month. Only the unbilled remainder is read, and only for a
    // single-month period, because that is the granularity the rollup keys
    // on; a quarter reports it as not applicable rather than as zero.
    let unbilledMeteredCents = 0
    let unbilledMeteredApplies = false
    if (/^\d{4}-\d{2}$/.test(period.trim())) {
      unbilledMeteredApplies = true
      const usageSnapshot = await firestore
        .collectionGroup('usage')
        .where('month', '==', period.trim())
        .limit(ROW_CAP)
        .get()
        .catch(() => null)
      for (const doc of usageSnapshot?.docs ?? []) {
        const value = Number(doc.get('meterUnbilledCents') ?? 0)
        if (Number.isFinite(value) && value > 0) unbilledMeteredCents += value
      }
    }

    const settled = {
      subscriptions,
      marketplace: marketplaceSettled,
      commerce,
      totalEarnedCents: totalEarnedCents({
        subscriptions,
        marketplace: marketplaceSettled,
        commerce,
      }),
    }
    const report: RevenueReport = {
      period: period.trim(),
      periodStart: range.start.toISOString(),
      periodEnd: range.end.toISOString(),
      contracted,
      settled,
      gap: revenueGap({ contracted, subscriptions, unbilledMeteredCents }),
      attention: {
        rowsOutsideEveryPeriod: revenueUndated.size,
        commerceTruncated: commerce.truncated,
      },
    }
    return Response.json({
      ...report,
      // Stated rather than implied: a quarter cannot answer the unbilled-meter
      // question, and reporting 0 would read as "nothing was missed".
      unbilledMeteredApplies,
      // Loud when the collection-group index is absent, so a $0 commerce row
      // is never mistaken for "no storefront sales".
      commerceQueryFailed: ordersInPeriod === null,
      subscriptionsTruncated: revenueInPeriod.size > ROW_CAP,
      marketplaceTruncated: marketplaceInPeriod.size > ROW_CAP,
    })
  } catch (error) {
    console.error('[admin/revenue]', error)
    return Response.json({ error: 'Revenue report failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
