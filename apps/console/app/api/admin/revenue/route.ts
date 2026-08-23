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
  commerceHostAttribution,
  contractedSummary,
  marketplaceListingAttribution,
  marketplacePublisherAttribution,
  orgAttribution,
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
 * How many rows one Firestore round trip fetches while sweeping a period.
 *
 * A page size, NOT a bound on the answer — see `sweepAll`.
 */
const SWEEP_PAGE_SIZE = 500

/**
 * The runaway ceiling on a paged sweep, and deliberately not a "row cap"
 * (AGL-2486).
 *
 * The previous shape was a flat `limit(2000)` (1000 for orders) per source.
 * That is the wrong instrument for a revenue total and it failed in the worst
 * available direction: the 2001st invoice of a good month silently stopped
 * being revenue, and the page said only "at least one total is incomplete"
 * without naming which. "Raise the number" does not survive growth — it just
 * moves the month in which the page starts lying.
 *
 * So the sweeps PAGE with a cursor and fold everything they find, and this
 * exists solely so a pathological query cannot burn unbounded reads inside
 * one serverless request. Reaching it is not a normal operating condition; it
 * means the period holds more rows than a request-time report should be
 * computing at all, and the honest fix at that point is a precomputed monthly
 * rollup, not a bigger number here.
 *
 * When it IS reached the response names the SOURCE that hit it, so a lower
 * bound can never again be reported as an anonymous "some total".
 */
export const SWEEP_CEILING = 50000

/**
 * How many orgs the per-org attribution returns (AGL-2486).
 *
 * A bound on the RESPONSE, not on a sweep: the totals above it are computed
 * from every org regardless. Beyond this the payload carries the remainder as
 * figures (`omittedMrrUsd` / `omittedSettledCents`) so the table still adds
 * up, rather than silently showing a partial accounting — which is the same
 * fault as the row cap this route used to have.
 */
const ATTRIBUTION_ROW_LIMIT = 100

/**
 * Page a query to exhaustion, folding as it goes.
 *
 * Ordering is required for a cursor, and every caller already filters or
 * orders on the field passed here, so the paging rides the SAME index the
 * filter needs and adds no index of its own.
 *
 * Returns `truncated` only when the ceiling above actually stopped the sweep —
 * never for a query that failed, which is a different state with a different
 * remedy and is reported separately. Conflating the two is how the page came
 * to blame a row cap for a missing index.
 */
async function sweepAll(
  base: FirebaseFirestore.Query,
  orderField: string | FirebaseFirestore.FieldPath,
): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[]; truncated: boolean }> {
  const ordered = base.orderBy(orderField)
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = []
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  for (;;) {
    const page = cursor
      ? await ordered.startAfter(cursor).limit(SWEEP_PAGE_SIZE).get()
      : await ordered.limit(SWEEP_PAGE_SIZE).get()
    if (page.empty) return { docs, truncated: false }
    docs.push(...page.docs)
    if (docs.length >= SWEEP_CEILING) return { docs, truncated: true }
    if (page.size < SWEEP_PAGE_SIZE) return { docs, truncated: false }
    cursor = page.docs[page.docs.length - 1]
  }
}

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
      earliestRecorded,
    ] = await Promise.all([
      // Contracted is a POINT-IN-TIME figure — what the book bills right now
      // — so it is deliberately NOT ranged on the period. A past period's
      // contracted MRR is not recoverable from current org docs and
      // pretending otherwise by filtering on `createdAt` would report today's
      // prices against yesterday's customers.
      //
      // PAGED like every other sweep here (AGL-2486). This was a bare `.get()`
      // on the whole collection — no limit at all — which is the same growth
      // cliff as the row caps this change removed, just without even a cap to
      // notice. Ordered by document id because there is no filter to ride:
      // an unfiltered collection ordered by `__name__` needs no index.
      // Leaving one read on the page unbounded is how the next person
      // concludes the paging is optional.
      sweepAll(
        firestore.collection('orgs'),
        firebaseAdmin.firestore.FieldPath.documentId(),
      ),
      // `subscription` lives at `orgs/{orgId}/billing/stripe` since AGL-1028,
      // so the revenue signal is not on the org doc. One collection-group
      // read rather than a get per org inside the loop, matching
      // `/api/admin/overview`. Still no index needed: no filter, and ordering
      // a collection group by `__name__` is served without one.
      sweepAll(
        firestore.collectionGroup(ORG_BILLING_SUBCOLLECTION),
        firebaseAdmin.firestore.FieldPath.documentId(),
      ),
      sweepAll(
        revenue
          .where('paidAt', '>=', range.start)
          .where('paidAt', '<', range.end),
        'paidAt',
      ),
      // Rows a range query can NEVER match: a Firestore inequality cannot see
      // a null field, so an invoice with no readable timestamp is invisible
      // to the sweep above and the settled figure is short by it. Counted so
      // the page can say so instead of quietly under-reporting.
      revenue.where('paidAt', '==', null).limit(50).get(),
      // Ranged on `createdAt` — a SINGLE-FIELD inequality on a TOP-LEVEL
      // collection, served by Firestore's automatic index. Unlike the orders
      // sweep below, this one is not a collection group, which is exactly why
      // the same field name is safe here and was not there.
      sweepAll(
        marketplace
          .where('createdAt', '>=', range.start)
          .where('createdAt', '<', range.end),
        'createdAt',
      ),
      // Storefront orders live per host (`hosts/{hostId}/orders`), so this is
      // the one collection-GROUP range here.
      //
      // Ranged on `createdAtMs` — the NUMBER — and not on the `createdAt`
      // Timestamp beside it, which is the whole reason this page reported
      // nothing (AGL-2486). Orders carry both: `draft-order.ts`, `pos-order.ts`
      // and the renewal webhook each write a `serverTimestamp()` and a
      // `Date.now()` millisecond copy. A collection-group range needs a
      // COLLECTION_GROUP-scoped single-field index — Firestore's automatic
      // single-field indexes are COLLECTION scope only, so a collection group
      // gets no free ride — and the index that exists, is declared in
      // `fieldOverrides` and is deployed, is on `createdAtMs` (AGL-1793).
      // Querying `createdAt` therefore answered FAILED_PRECONDITION on every
      // single request. Verified against production: the `createdAt` form
      // raises `9 FAILED_PRECONDITION … requires a COLLECTION_GROUP_ASC index
      // for collection orders and field createdAt`, the `createdAtMs` form
      // runs. So this is not a missing deploy and must not be "fixed" by
      // declaring a second index for the redundant field: it is one query
      // reading the wrong one of two fields that mean the same thing.
      sweepAll(
        firestore
          .collectionGroup('orders')
          .where('createdAtMs', '>=', range.start.getTime())
          .where('createdAtMs', '<', range.end.getTime()),
        'createdAtMs',
      )
        // A collection-group index this deployment has not built answers with
        // FAILED_PRECONDITION. That must degrade to "commerce not counted",
        // loudly, rather than 500 the whole page and take the subscription
        // and marketplace figures down with it.
        .catch(() => null),
      // The FIRST invoice the mirror ever recorded, which is what makes an
      // honest $0 distinguishable from an unanswerable one (AGL-2486).
      //
      // `platformRevenue` has only existed since AGL-1811 shipped on
      // 2026-08-16; every invoice paid before that was never mirrored and no
      // query can find it. The page offers earlier periods in its dropdown
      // regardless, so without this it reports a confident $0 for months in
      // which Aglyn demonstrably collected money — the exact failure that
      // sent someone looking for a real Starter purchase and finding nothing.
      // One document, ordered on the automatic single-field index.
      revenue.orderBy('paidAt').limit(1).get().catch(() => null),
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

    const subscriptionRows: PlatformRevenueRowInput[] =
      revenueInPeriod.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as object),
      }))
    const marketplaceRows: MarketplaceRevenueRowInput[] =
      marketplaceInPeriod.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as object),
      }))
    const commerceRows: CommerceOrderRowInput[] = (
      ordersInPeriod?.docs ?? []
    ).map((doc) => ({
      id: doc.id,
      // Orders live at `hosts/{hostId}/orders/{orderId}`, so the storefront
      // that earned the take is in the PATH. Lifted from there rather than
      // read from a field: it costs no extra read and cannot disagree with
      // where the document actually is.
      hostId: doc.ref.parent.parent?.id ?? '',
      ...(doc.data() as object),
    }))

    const subscriptions = subscriptionSettledSummary(subscriptionRows)
    const marketplaceSettled = marketplaceSettledSummary(marketplaceRows)
    // TRUNCATION ONLY — a query that could not run at all is a different
    // state, reported as `commerceQueryFailed`, and folding it in here is
    // what made the page blame a row cap for a missing index (AGL-2486).
    const commerce = commerceSettledSummary(
      commerceRows,
      ordersInPeriod?.truncated === true,
    )

    // Metered usage that was MEASURED and never invoiced (AGL-1878) — a gap
    // cause, and deliberately NOT added to settled revenue. Metered usage
    // that DID bill arrives inside `platformRevenue.grossCents` as an invoice
    // line, so summing the usage rollup beside it would double-count every
    // billed month. Only the unbilled remainder is read, and only for a
    // single-month period, because that is the granularity the rollup keys
    // on; a quarter reports it as not applicable rather than as zero.
    //
    // Read by DOCUMENT ID rather than by a collection-group `where` on the
    // `month` field (AGL-2486). The rollup lives at `orgs/{id}/usage/{month}`
    // and its document id IS the month, so a direct `getAll` answers the same
    // question exactly, in one round trip per chunk, and — the part that
    // matters — needs no index at all.
    //
    // The previous form, `collectionGroup('usage').where('month','==',…)`,
    // needed a COLLECTION_GROUP single-field index on `usage.month` that was
    // never declared in `cloud/firebase-firestore.indexes.json` and is not
    // deployed. Verified against production: it raises `9 FAILED_PRECONDITION
    // … requires a COLLECTION_GROUP_ASC index for collection usage and field
    // month`. It was wrapped in `.catch(() => null)`, so it had ALWAYS thrown
    // and this cause had ALWAYS reported $0 — a gap cause that silently could
    // not fire is worse than one that is absent, because the page showed it as
    // a measured zero.
    let unbilledMeteredCents = 0
    let unbilledMeteredApplies = false
    let unbilledMeteredFailed = false
    // Per ORG as well as in total: an unbilled meter is a revenue LOSS and a
    // loss with no name on it is the one nobody chases (AGL-2486).
    const unbilledMeteredByOrg = new Map<string, number>()
    if (/^\d{4}-\d{2}$/.test(period.trim())) {
      unbilledMeteredApplies = true
      const month = period.trim()
      const usageOrgIds = orgsSnapshot.docs.map((org) => org.id)
      const usageRefs = orgsSnapshot.docs.map((org) =>
        org.ref.collection('usage').doc(month),
      )
      try {
        // `getAll` takes the whole list in one call, but a very large org
        // book would make one enormous request; chunked so the cost grows in
        // steps rather than as a single unbounded payload.
        for (let index = 0; index < usageRefs.length; index += 300) {
          const chunk = usageRefs.slice(index, index + 300)
          if (chunk.length === 0) continue
          const docs = await firestore.getAll(...chunk)
          docs.forEach((doc, offset) => {
            const value = Number(doc.get('meterUnbilledCents') ?? 0)
            if (Number.isFinite(value) && value > 0) {
              unbilledMeteredCents += value
              // `getAll` answers in the order asked, so the org id is the one
              // at the same position in the ref list.
              const orgId = usageOrgIds[index + offset]
              if (orgId) unbilledMeteredByOrg.set(orgId, value)
            }
          })
        }
      } catch {
        // Reported, never silently zeroed — see above.
        unbilledMeteredFailed = true
        unbilledMeteredCents = 0
      }
    }

    // WHO produced the numbers, on the dimension each source is actually
    // measured in. All four are built from the same rows the totals folded,
    // so every table reconciles to the figure above it by construction.
    const attribution = orgAttribution(
      contractedInput,
      subscriptionRows,
      ATTRIBUTION_ROW_LIMIT,
      unbilledMeteredByOrg,
    )
    const byListing = marketplaceListingAttribution(
      marketplaceRows,
      ATTRIBUTION_ROW_LIMIT,
    )
    const byPublisher = marketplacePublisherAttribution(
      marketplaceRows,
      ATTRIBUTION_ROW_LIMIT,
    )
    const byHost = commerceHostAttribution(commerceRows, ATTRIBUTION_ROW_LIMIT)

    // Names, read AFTER the fold has capped the rows (AGL-2486).
    //
    // Listings and hosts are collections this page did not previously touch,
    // and the ordering is the whole point: the lookup is bounded by what will
    // be DISPLAYED (at most `ATTRIBUTION_ROW_LIMIT` per table), not by how
    // many sales the period holds. Reading a name per row before capping
    // would have reintroduced an unbounded read from a new direction, one
    // commit after removing the last of them.
    //
    // Publisher names need no read at all: every org is already in
    // `orgNames`, folded from the org sweep above.
    const orgNames = new Map<string, string>()
    for (const doc of orgsSnapshot.docs) {
      const name = String(doc.get('name') ?? '').trim()
      if (name) orgNames.set(doc.id, name)
    }
    async function decorate(
      table: { rows: { key: string; name: string; detail: string }[] },
      collection: string,
      nameField: string,
      detailField: string,
    ): Promise<void> {
      const ids = table.rows
        .map((row) => row.key)
        .filter((key) => key && !key.includes(' '))
      if (ids.length === 0) return
      const docs: FirebaseFirestore.DocumentSnapshot[] = []
      for (let index = 0; index < ids.length; index += 300) {
        const chunk = ids
          .slice(index, index + 300)
          .map((id) => firestore.collection(collection).doc(id))
        docs.push(...(await firestore.getAll(...chunk)))
      }
      const found = new Map(docs.map((doc) => [doc.id, doc]))
      for (const row of table.rows) {
        const doc = found.get(row.key)
        // A row whose entity is GONE keeps its id and says so, rather than
        // rendering a blank cell that reads as a loading bug.
        if (!doc?.exists) {
          if (!row.name || row.name === row.key) {
            row.name = `${row.key} (deleted)`
          }
          continue
        }
        const name = String(doc.get(nameField) ?? '').trim()
        if (name) row.name = name
        const detail = String(doc.get(detailField) ?? '').trim()
        if (detail) row.detail = detail
      }
    }
    await Promise.all([
      decorate(byListing, 'marketplaceListings', 'displayName', 'pluginId'),
      decorate(byHost, 'hosts', 'displayName', 'subdomain'),
    ])
    // Publisher rows resolve from the org sweep — no read.
    for (const row of byPublisher.rows) {
      const name = orgNames.get(row.key)
      if (name) row.name = name
    }
    for (const row of byListing.rows) {
      const publisher = orgNames.get(row.detail)
      if (publisher) row.detail = publisher
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
    // The mirror's own start date, and whether the requested period predates
    // it. `paidAt` is stored as a Firestore Timestamp; `toDate` guards the
    // case where an older row stored something else.
    const earliestPaidAt: Date | null =
      earliestRecorded?.docs?.[0]?.get('paidAt')?.toDate?.() ?? null
    return Response.json({
      ...report,
      // Stated rather than implied: a quarter cannot answer the unbilled-meter
      // question, and reporting 0 would read as "nothing was missed".
      unbilledMeteredApplies,
      unbilledMeteredFailed,
      // Loud when the orders sweep could not run, so a $0 commerce row is
      // never mistaken for "no storefront sales". Kept strictly separate from
      // truncation: one means "we read part of it", the other means "we read
      // none of it", and they have different remedies.
      commerceQueryFailed: ordersInPeriod === null,
      // NAMED per source. "At least one total is incomplete" leaves the
      // reader unable to tell which figure they may still quote.
      subscriptionsTruncated: revenueInPeriod.truncated,
      marketplaceTruncated: marketplaceInPeriod.truncated,
      // The CONTRACTED base can hit the ceiling too, now that its two reads
      // are bounded. Reported rather than left implicit: a clipped org sweep
      // under-reports MRR, which is the same silent-lower-bound fault as a
      // clipped invoice sweep and deserves the same banner.
      contractedTruncated:
        orgsSnapshot.truncated || billingSnapshot.truncated,
      truncatedSources: [
        orgsSnapshot.truncated || billingSnapshot.truncated
          ? 'contracted MRR'
          : null,
        revenueInPeriod.truncated ? 'subscriptions' : null,
        marketplaceInPeriod.truncated ? 'marketplace' : null,
        commerce.truncated ? 'storefront orders' : null,
      ].filter(Boolean),
      /**
       * How far back the SETTLED base can answer at all (AGL-2486).
       *
       * `null` means the mirror is empty. Otherwise any period starting
       * before this date is partly or wholly unrecorded, and its settled
       * figures are unanswerable rather than zero — `platformRevenue` began
       * with AGL-1811 and nothing invoiced before it was ever written. The
       * page states this instead of printing a confident $0 for a month in
       * which money demonstrably arrived.
       */
      settledCoverageStart: earliestPaidAt ? earliestPaidAt.toISOString() : null,
      periodPrecedesCoverage:
        earliestPaidAt !== null && range.start < earliestPaidAt,
      settledMirrorEmpty: earliestPaidAt === null,
      attribution,
      attributionByListing: byListing,
      attributionByPublisher: byPublisher,
      attributionByHost: byHost,
      /**
       * Whether the period has already ended (AGL-2486).
       *
       * The gap compares CONTRACTED — a run-rate measured right now — against
       * SETTLED cash for the selected period. For the month in progress those
       * are roughly the same instant and the difference is meaningful. For a
       * CLOSED period they are not: contracted is measured today, after any
       * subscription that collected during the period may have ended, so the
       * remainder is an artefact of measuring two different instants and not
       * a shortfall or a surplus.
       *
       * A past period's contracted base is NOT recoverable — org documents
       * carry only current state and nothing snapshots MRR per month — so the
       * honest options were to compare against the period's own base
       * (impossible) or to stop presenting a difference (this). The page
       * therefore shows both figures for a closed period and computes no gap,
       * rather than labelling a known, modelled artefact "unexplained".
       */
      periodIsClosed: range.end.getTime() <= Date.now(),
    })
  } catch (error) {
    console.error('[admin/revenue]', error)
    return Response.json({ error: 'Revenue report failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
