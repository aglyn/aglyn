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
import { isCronAuthorized } from '../../../../utils/cron-auth'
import {
  checkApiRequestQuota,
  checkContactQuota,
  checkDataStorageQuota,
  decodeStoredNodes,
  nodeMapBytes,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  billsOrgLibraryStorage,
  estimateMonthlyUsageCost,
  type HostUsageSnapshot,
} from '../../../../utils/usage-metering'
import { measureScreenCaps } from '../../../../utils/screen-cap-reconciliation'
import type { BillableScreenSource } from '../../hosts/resources/count-billable-screens'
import { orgCounterTotals } from '../../../../utils/org-counter-totals'
import {
  emailSendsOverage,
  firebaseAdmin,
  readOrgBilling,
} from '@aglyn/tenant-data-admin'
import { CRON_CHUNK_SIZE, selectCronChunk } from '../../../../utils/cron-chunk'

/** Previous calendar month as YYYY-MM (the default rollup target). */
function previousMonth(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

/**
 * Approximate aggregate dataset bytes for an org (AGL-240): per dataset,
 * an aggregate record count × the average serialized size of a small
 * sample — O(datasets) reads instead of O(records), good enough for
 * metering (the billing export replaces this when it lands).
 */
async function orgDatasetBytes(
  orgRef: FirebaseFirestore.DocumentReference,
): Promise<number> {
  const datasets = await orgRef.collection('datasets').get()
  // Datasets in parallel (AGL-1141). Each is two independent reads and the
  // results are summed, so walking them in sequence cost the sum of the
  // latencies for no ordering benefit — an org with 20 datasets paid 20
  // round trips end to end.
  const perDataset = await Promise.all(
    datasets.docs.map(async (dataset) => {
      const records = dataset.ref.collection('records')
      const [countSnapshot, sample] = await Promise.all([
        records.count().get(),
        records.limit(50).get(),
      ])
      const count = Number(countSnapshot.data().count ?? 0)
      const sampleBytes = sample.docs.reduce(
        (sum, record) => sum + JSON.stringify(record.data() ?? {}).length,
        0,
      )
      const average = sample.size > 0 ? sampleBytes / sample.size : 0
      return (
        JSON.stringify(dataset.data() ?? {}).length + Math.round(average * count)
      )
    }),
  )
  return perDataset.reduce((sum, bytes) => sum + bytes, 0)
}

/**
 * Size of one version doc's node payload, in **msgpack bytes of the DECODED
 * node map** (AGL-1402).
 *
 * That is the answer to "which of the two", and it is the decoded one: the
 * document is decoded, then re-measured with the encoder used at rest. The
 * number therefore describes the TREE, not the storage form the tree happens
 * to be sitting in.
 *
 * It has to. `nodes` has three live storage forms — a plain Firestore map, a
 * msgpack `Bytes`/`Buffer`, and the `{type:'Buffer',data:[…]}` envelope that
 * pre-AGL-1391 export bundles carry — and which one a document is in is a
 * function of HOW IT WAS LAST SAVED, nothing more. This function used to
 * measure the first in `JSON.stringify(...).length` and the second in
 * `byteLength`, so the same page read ~20-45% smaller once the besigner had
 * compressed it. Two smaller errors rode along on the JSON arm and did not
 * cancel: `String.length` counts UTF-16 code units rather than bytes, so
 * non-ASCII copy undercounted, while JSON punctuation the document does not
 * store pushed the same arm the other way.
 *
 * The alternative was cheaper — `byteLength` for the bytes arm,
 * `Buffer.byteLength(JSON.stringify(nodes), 'utf8')` for the plain one — and
 * was rejected because it is still two units (msgpack vs JSON), just two units
 * that are both honestly named bytes. A compressed site would still read
 * smaller than the identical plain one.
 *
 * **The cost is real and it is affordable.** The decode + re-encode is O(size)
 * per document where the bytes arm used to be O(1), across a 5,000-document
 * ceiling per collection. At the ceiling that is a couple of seconds of CPU —
 * against a sweep that is already paying up to **34 sequential `getAll` round
 * trips per HOST** for the same documents.
 *
 * That figure was previously written here as "~17 per collection", which was
 * wrong in the optimistic direction and therefore the worst way to be wrong.
 * `orgSiteSizeBytes` concatenates the screen refs and the layout refs into ONE
 * list before chunking it at 300 (see the loop), so the ceiling is
 * `(5,000 + 5,000) / 300 = 34` awaited round trips for a host at both caps —
 * 17 was the floor, reached only by a host that has screens and no layouts.
 * Hosts run in parallel, so 34 is the per-host depth, not the org's.
 *
 * Network dominates by an order of magnitude, so the honest number still fits
 * inside the 60 s budget; a site large enough for the decode to be the binding
 * constraint would have blown the budget on reads long before.
 *
 * Decoding uniformly — including re-encoding bytes that arrived as msgpack
 * already — is deliberate. Short-circuiting the bytes arm back to `byteLength`
 * would reintroduce exactly the two-paths problem this fixes, for a saving on
 * the one arm that is already cheapest.
 *
 * Same unit as `NODE_MAP_MAX_BYTES`, the per-document save ceiling, so the
 * total and the cap can finally be reasoned about together.
 */
function nodesBytes(nodes: unknown): number {
  // `decodeStoredNodes` is the only reader that knows all three forms, and it
  // returns null for undecodable as well as absent — which must stay 0 rather
  // than becoming some incidental measurement of the encoded blob.
  return nodeMapBytes(decodeStoredNodes<Record<string, unknown>>(nodes))
}

/**
 * Ceiling on published documents measured per host, and the page size the
 * sweep walks them in.
 *
 * This replaced a `.limit(200)` on screens and `.limit(50)` on layouts, which
 * SILENTLY truncated (AGL-1371): Business and above have
 * `screensPerHost: UNLIMITED`, so any site past 200 screens had its size
 * undercounted with nothing anywhere to say so. Harmless while only an alert
 * reads it — an undercount can only under-warn — but a lower bound presented
 * as a total is a billing bug the moment anything prices from it.
 *
 * A ceiling is still needed: this is the most expensive thing the rollup does
 * and it runs inside a 60 s function. So the cap stays, ~25× higher (past any
 * real site), and hitting it now sets `siteSizeTruncated` on the rollup
 * instead of quietly shrinking the number.
 */
const SITE_SIZE_DOC_CEILING = 5_000
const SITE_SIZE_PAGE_SIZE = 500

/**
 * Published-version refs for one collection, paged to the ceiling — and the
 * screen-cap fields off the same documents (AGL-1440).
 *
 * `kind` and `deletedAt` ride along because this walk ALREADY pays a read for
 * every screen document, and the screen-cap detector was paying a second one
 * for the same documents on the same sweep. Adding two projected fields costs
 * nothing (a `select()` bills per document, not per field) and removes a whole
 * unbounded scan per host from this cron.
 */
async function publishedVersionRefs(
  collectionRef: FirebaseFirestore.CollectionReference,
  ceiling: number,
): Promise<{
  refs: FirebaseFirestore.DocumentReference[]
  truncated: boolean
  rows: BillableScreenSource[]
}> {
  const refs: FirebaseFirestore.DocumentReference[] = []
  const rows: BillableScreenSource[] = []
  let scanned = 0
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  for (;;) {
    // Projecting keeps a page of 500 screens from dragging their whole
    // documents across the wire. It does NOT reduce the read count.
    let query = collectionRef
      .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
      .select('versionId', 'kind', 'deletedAt')
      .limit(SITE_SIZE_PAGE_SIZE)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    for (const doc of page.docs) {
      const versionId = doc.get('versionId')
      if (versionId) {
        refs.push(doc.ref.collection('versions').doc(String(versionId)))
      }
      rows.push({
        id: doc.id,
        kind: doc.get('kind'),
        deletedAt: doc.get('deletedAt'),
      })
    }
    scanned += page.size
    // A short page is the end of the collection — the only proof the sweep is
    // complete. Anything else and we cannot claim it is.
    if (page.size < SITE_SIZE_PAGE_SIZE) return { refs, truncated: false, rows }
    if (scanned >= ceiling) return { refs, truncated: true, rows }
    cursor = page.docs[page.size - 1]
  }
}

/**
 * Aggregate published-site-size bytes for an org (AGL-1107): the published
 * screen/layout version node payloads across the org's hosts, summed so the
 * `totalSiteSizeMb` cap can be alerted on (it was measured + displayed but
 * never enforced). O(hosts × published docs) reads; the monthly rollup is the
 * right place to pay for it — and since AGL-1371 it is the ONLY place that
 * measures it, so the console meter and the usage-alerts cron read one figure
 * rather than computing two.
 *
 * Returns the truncation flag as well as the bytes: see
 * `SITE_SIZE_DOC_CEILING`.
 */
async function orgSiteSizeBytes(
  firestore: FirebaseFirestore.Firestore,
  hostRefs: FirebaseFirestore.DocumentReference[],
): Promise<{
  bytes: number
  truncated: boolean
  /**
   * Each host's screen rows, keyed by host id — but ONLY where the walk ran to
   * the end (AGL-1440). A truncated host is absent, so the screen-cap detector
   * scans it properly rather than counting a lower bound and calling it a
   * total. Under-reporting is the one failure mode a cap detector cannot have.
   */
  screenRowsByHost: Record<string, BillableScreenSource[]>
}> {
  // Hosts in parallel (AGL-1141). This is the most expensive thing the
  // rollup does — O(hosts × published docs) — and it ran host after host, so
  // an org's site-size measurement alone took as long as all its hosts put
  // together. The per-host work is unchanged; only the waiting is shared.
  const perHost = await Promise.all(
    hostRefs.map(async (hostRef) => {
      const [screens, layouts] = await Promise.all([
        publishedVersionRefs(
          hostRef.collection('screens'),
          SITE_SIZE_DOC_CEILING,
        ),
        publishedVersionRefs(
          hostRef.collection('layouts'),
          SITE_SIZE_DOC_CEILING,
        ),
      ])
      const versionRefs = [...screens.refs, ...layouts.refs]
      const truncated = screens.truncated || layouts.truncated
      // Only a COMPLETE screen walk may stand in for the cap detector's scan.
      const screenRows = screens.truncated ? undefined : screens.rows
      if (!versionRefs.length) {
        return { hostId: hostRef.id, bytes: 0, truncated, screenRows }
      }
      // `getAll` takes the refs as varargs, so a 5,000-document site would
      // spread one call across 5,000 arguments; chunked to keep the call —
      // and the response held in memory — a bounded size.
      let bytes = 0
      for (let index = 0; index < versionRefs.length; index += 300) {
        const versions = await firestore.getAll(
          ...versionRefs.slice(index, index + 300),
        )
        bytes += versions.reduce(
          (sum, version) => sum + nodesBytes(version.get('nodes')),
          0,
        )
      }
      return { hostId: hostRef.id, bytes, truncated, screenRows }
    }),
  )
  const screenRowsByHost: Record<string, BillableScreenSource[]> = {}
  for (const host of perHost) {
    if (host.screenRows) screenRowsByHost[host.hostId] = host.screenRows
  }
  return {
    bytes: perHost.reduce((sum, host) => sum + host.bytes, 0),
    truncated: perHost.some((host) => host.truncated),
    screenRowsByHost,
  }
}

async function hostUsage(
  hostRef: FirebaseFirestore.DocumentReference,
  month: string,
): Promise<HostUsageSnapshot> {
  const [media, forms, analytics] = await Promise.all([
    hostRef.collection('counters').doc('media').get(),
    hostRef.collection('counters').doc('formSubmissions').get(),
    hostRef
      .collection('analytics')
      .where(
        firebaseAdmin.firestore.FieldPath.documentId(),
        '>=',
        `${month}-01`,
      )
      .where(
        firebaseAdmin.firestore.FieldPath.documentId(),
        '<=',
        `${month}-31`,
      )
      .get(),
  ])
  return {
    storageBytes: Number(media.get('bytes') ?? 0),
    formSubmissions: Number(forms.get(month) ?? 0),
    pageViews: analytics.docs.reduce(
      (sum, day) => sum + Number(day.get('total') ?? 0),
      0,
    ),
  }
}

/**
 * Monthly usage rollup + metered billing report (AGL-41, org-keyed since
 * the AGL-238 cutover). Invoke from a scheduler (Vercel cron / GitHub
 * Action) with `x-cron-secret`: sums host counters (storage bytes, month
 * page views, month form submissions) plus the ORG LIBRARY's stored bytes
 * (AGL-1473 — an org DAM upload counts against `orgs/{id}/counters/media` and
 * belongs to no site), prices whatever exceeds the plan's
 * included bands at cost × 1.30 (AGL-1280), writes audit
 * rollups per tenant (legacy) and per org, and — when Stripe is
 * configured — sends one idempotent Billing Meter event per ORG-month
 * against the org's mirrored Stripe customer. Re-runs skip
 * already-reported org-months. Validate rates against a real invoice
 * month before enabling live billing.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Usage rollup is not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const month = /^\d{4}-\d{2}$/.test(String(body?.month ?? ''))
    ? String(body.month)
    : previousMonth()
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const meterEventName =
    process.env.STRIPE_METER_EVENT_NAME ?? 'aglyn_metered_usage'

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hosts = await firestore.collection('hosts').limit(1000).get()

    // Group hosts by org — the sole billing subject (AGL-238; the legacy
    // per-tenant rollups retired with the tenants collection).
    const byOrg: Record<string, FirebaseFirestore.DocumentReference[]> = {}
    // The `screens` routing map per host, kept from this sweep so the AGL-1390
    // screen-cap reconciliation below re-reads nothing: the documents are
    // already in hand here, and the map is what decides which screens count.
    const routingByHost: Record<string, unknown> = {}
    for (const host of hosts.docs) {
      const orgId = host.get('orgId')
      if (orgId) (byOrg[orgId] ??= []).push(host.ref)
      routingByHost[host.id] = host.get('screens')
    }

    const usageCache = new Map<string, Promise<HostUsageSnapshot>>()
    const usageFor = (hostRef: FirebaseFirestore.DocumentReference) => {
      let pending = usageCache.get(hostRef.path)
      if (!pending) {
        pending = hostUsage(hostRef, month)
        usageCache.set(hostRef.path, pending)
      }
      return pending
    }

    // Org rollups + metering (AGL-238 cutover): orgs are the billing
    // subject — the meter event uses the org's mirrored Stripe customer
    // and an org-month identifier, idempotent via the usage doc's
    // reportedAt on our side and the identifier on Stripe's.
    // Bounded, resumable sweep (AGL-1141). Walking every org in one
    // invocation is what produced the 504; `maxDuration` buys headroom but
    // the ceiling is fixed and the org count is not, so the sweep is chunked
    // and the caller loops on the cursor.
    const chunk = selectCronChunk(
      Object.keys(byOrg),
      typeof body?.cursor === 'string' ? body.cursor : null,
      Number(body?.limit) || CRON_CHUNK_SIZE,
    )
    const orgResults: Record<string, any> = {}
    const failures: Record<string, string> = {}
    // The cursor must name the last org FINISHED, never the last attempted —
    // handing back a failed org's id skips it forever, which is the
    // partial-month bug wearing a cursor.
    for (const orgId of chunk.items) {
      const hostRefs = byOrg[orgId] ?? []
      try {
      const orgRef = firestore.collection('orgs').doc(orgId)
      // Seven INDEPENDENT round trips, previously awaited one after another
      // (AGL-1141). None consumes another's result — the quota checks below
      // combine them, but only once all seven are in hand — so the sequencing
      // was incidental, and it made an org cost the SUM of its reads rather
      // than the slowest of them. That is most of why four orgs took ~10s.
      const [
        usage,
        orgSnapshot,
        datasetBytes,
        siteSize,
        apiUsageSnap,
        contactsSnap,
        counterTotals,
      ] = await Promise.all([
        Promise.all(hostRefs.map(usageFor)),
        orgRef.get(),
        // Dataset storage overage (AGL-240): plan-priced (not cost-plus),
        // metered on top of the infra estimate.
        orgDatasetBytes(orgRef),
        // Published-site size (AGL-1107): stored on the rollup so the daily
        // usage-alerts cron — and, since AGL-1371, the console meter — can
        // read the `totalSiteSizeMb` figure cheaply, without re-reading every
        // version payload themselves. One measurement, three readers.
        orgSiteSizeBytes(firestore, hostRefs),
        // Customer REST API request overage (AGL-635): plan-priced per 1,000
        // requests over the included quota. The durable counter is written
        // per-request by the API auth chokepoint.
        orgRef.collection('apiUsage').doc(month).get(),
        // Contacts audience-band overage (AGL-890): one aggregate count per
        // org — contacts are org-scoped (AGL-237).
        orgRef.collection('contacts').count().get(),
        // Email sends and workflow/action runs (AGL-1134) — counted per host
        // all along, enforced per org by `usage-alerts`, and never once
        // written down. RECORDED, NOT PRICED: see the rollup write below.
        //
        // `orgRef` since AGL-1438: invites, member-added mail, the welcome
        // email and these very usage summaries belong to the org and to no
        // site, so they are counted at `orgs/{id}/counters` and were invisible
        // to a sum taken over hosts alone. Since AGL-1473 it also carries the
        // org LIBRARY's stored bytes, which had the identical defect.
        orgCounterTotals(firestore, hostRefs, month, orgRef),
      ])
      // One read of the org doc for every quota decision below — the four
      // meters must agree about which plan they are pricing against.
      const orgData = orgSnapshot.data() as any
      // The ORG LIBRARY as one more storage snapshot (AGL-1473).
      //
      // `resolveMediaScope` sends an org DAM upload to
      // `orgs/{id}/counters/media` and a site upload to
      // `hosts/{id}/counters/media`. Both are enforced against
      // `storagePerHostMb`; only the host side was ever summed here, so
      // org-library bytes were gated and then dropped before pricing.
      //
      // It is a SNAPSHOT rather than an addition to some host's, because the
      // org library belongs to no site — the same reason `orgCounterTotals`
      // reads one ref for the whole org rather than one per host. Page views
      // and form submissions are zero: a library serves no pages.
      const orgLibrary: HostUsageSnapshot = {
        storageBytes: counterTotals.orgLibraryBytes,
        pageViews: 0,
        formSubmissions: 0,
      }
      // Only usage BEYOND the plan's included storage/bandwidth/form bands
      // is billed (AGL-1280) — `billedCents` is the excess; `costUsd` stays
      // the gross figure the COGS model and staff views read.
      //
      // TWO estimates, and the difference between them is exactly the org
      // library. `estimate` is the TRUTH — every byte the org stores — and is
      // what `storageGb` and `costUsd` are written from, because those feed
      // `orgMonthlyCogsUsd`: org-library bytes cost us real money whether or
      // not we pass the cost on, and under-reporting our own COGS makes the
      // discount guardrail more generous, which is the direction that loses
      // money silently.
      //
      // `billedEstimate` is what an INVOICE may see, and it excludes the org
      // library until `BILL_ORG_LIBRARY_STORAGE_FROM` names a month at or
      // before this one. Charging for bytes stored for months is Zach's call,
      // not a side effect of fixing the sum. Once the switch is set the two
      // estimates are the same figure and the branch costs nothing — it is a
      // pure function over numbers already in hand, no extra read.
      const estimate = estimateMonthlyUsageCost([...usage, orgLibrary], orgData)
      const orgLibraryBilled = billsOrgLibraryStorage(
        month,
        process.env.BILL_ORG_LIBRARY_STORAGE_FROM,
      )
      const billedEstimate = orgLibraryBilled
        ? estimate
        : estimateMonthlyUsageCost(usage, orgData)
      const dataStorageMb =
        Math.round((datasetBytes / (1024 * 1024)) * 10) / 10
      // Msgpack bytes of the decoded node maps — see `nodesBytes`. One unit
      // for all three storage forms, so this figure is comparable BETWEEN
      // sites rather than only with itself.
      const siteSizeMb = Math.round((siteSize.bytes / (1024 * 1024)) * 10) / 10
      const dataQuota = checkDataStorageQuota(orgData, dataStorageMb)
      const apiRequests = Number(apiUsageSnap.get('count') ?? 0)
      const apiQuota = checkApiRequestQuota(orgData, apiRequests)
      const contactsCount = Number(contactsSnap.data().count ?? 0)
      const contactQuota = checkContactQuota(orgData, contactsCount)
      // Screen-cap reconciliation (AGL-1390). Not priced and not enforced —
      // recorded, so that a site past the plan's screen allowance leaves a
      // dated trace somebody can find. `screensPerHost` is otherwise only ever
      // asked at the moment of a write, and three separate ways past that gate
      // were found in one night with nothing anywhere the wiser. Sequenced
      // after the batch above because it needs `orgData` to know the plan.
      //
      // It re-reads NOTHING (AGL-1440). The site-size walk above already paid
      // one read per screen document for these very hosts; those rows are
      // handed over here, so the second unbounded `screens` scan this cron used
      // to do is gone. A host whose walk hit `SITE_SIZE_DOC_CEILING` is absent
      // from the map and falls back to a real scan — a cap detector reporting a
      // lower bound as a total is worse than one that costs a read.
      const screenCaps = await measureScreenCaps(
        hostRefs.map((hostRef) => ({
          id: hostRef.id,
          ref: hostRef,
          routingMap: routingByHost[hostRef.id],
          ...(siteSize.screenRowsByHost[hostRef.id] && {
            screens: siteSize.screenRowsByHost[hostRef.id],
          }),
        })),
        orgData,
      )
      // Email overage (AGL-1438). Transactional mail is never refused, so an
      // org CAN and does finish a month above the band its plan included —
      // that is the overage the cap deliberately did not enforce, and writing
      // it down is what keeps it from being a surprise at invoicing.
      //
      // RECORDED, NOT PRICED, exactly like the counts it derives from: it is
      // deliberately absent from `billedCents` below and from `costUsd`, and
      // `ORG_COGS_UNIT_RATES_USD` still has no per-email rate to price it
      // with. No guardrail verdict moves by a cent because of this field.
      const emailOverage = emailSendsOverage(
        counterTotals.emailSends,
        resolveOrgEntitlements(orgData).emailSendsPerMonth,
      )
      const billedCents =
        billedEstimate.billedCents +
        Math.round(dataQuota.overageMonthlyUsd * 100) +
        Math.round(apiQuota.overageMonthlyUsd * 100) +
        Math.round(contactQuota.overageMonthlyUsd * 100)
      const usageRef = orgRef.collection('usage').doc(month)
      const existing = await usageRef.get()
      if (existing.get('reportedAt')) {
        orgResults[orgId] = { billedCents, skipped: true }
        continue
      }

      let reported = false
      if (stripeKey && billedCents > 0) {
        // AGL-1028: reads the manager-gated billing doc, org doc as fallback.
        const customerId = (await readOrgBilling(orgId)).stripeCustomerId
        if (customerId) {
          const response = await fetch(
            'https://api.stripe.com/v1/billing/meter_events',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${stripeKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                event_name: meterEventName,
                identifier: `${orgId}-${month}`,
                'payload[stripe_customer_id]': String(customerId),
                'payload[value]': String(billedCents),
              }).toString(),
            },
          )
          if (response.ok) reported = true
          else console.error('meter event failed', await response.json())
        }
      }

      await usageRef.set(
        {
          month,
          hostCount: hostRefs.length,
          storageGb: estimate.storageGb,
          pageViews: estimate.pageViews,
          formSubmissions: estimate.formSubmissions,
          costUsd: estimate.costUsd,
          // The excess only, at cost (AGL-1280) — `billedCents` is this
          // number marked up, plus the three plan-priced overages. Read off
          // `billedEstimate` so it stays the pre-markup twin of what was
          // actually charged; `storageGb` and `costUsd` above are the truth.
          billableCostUsd: billedEstimate.billableCostUsd,
          // The org LIBRARY's share of `storageGb` (AGL-1473), so the split is
          // legible on the audit doc rather than something you rederive by
          // subtracting host counters. RECORDED ALWAYS — a month that did not
          // bill for these bytes still has to say how many there were, which
          // is what makes the first billed month a comparison rather than a
          // surprise.
          orgLibraryStorageGb:
            Math.max(0, counterTotals.orgLibraryBytes) / (1024 * 1024 * 1024),
          // Whether THIS month's `billedCents` included them. The audit doc
          // has to answer "was this month charged for the org library" without
          // anyone having to know what an environment variable held at the
          // moment the cron ran.
          orgLibraryBilled,
          siteSizeMb,
          // A LOWER BOUND when true — the sweep hit `SITE_SIZE_DOC_CEILING`
          // (AGL-1371). Nothing prices from site size today; anything that
          // ever does must refuse to bill from a truncated figure, and this
          // is how it can tell.
          siteSizeTruncated: siteSize.truncated,
          dataStorageMb,
          dataOverageUsd: dataQuota.overageMonthlyUsd,
          apiRequests,
          apiOverageUsd: apiQuota.overageMonthlyUsd,
          contactsCount,
          contactsOverageUsd: contactQuota.overageMonthlyUsd,
          // Email sends and workflow/action runs (AGL-1134), summed across
          // the org's hosts. COUNTS for this month — see `orgCounterTotals`
          // for the unit and the double-count argument.
          //
          // RECORDED, NOT PRICED, and deliberately so. There is no per-email
          // or per-run rate anywhere in the platform, and inventing one here
          // would put a made-up number into `billedCents` and into the
          // discount guardrail's COGS on the same day it first had data to
          // check it against. So these fields do NOT enter `billedCents`,
          // `costUsd`, or `ORG_COGS_UNIT_RATES_USD` — the guardrail's verdicts
          // are byte-for-byte unchanged by this commit. What changes is that
          // the inputs now exist and accumulate a history, which is what a
          // rate has to be derived FROM. Pricing them is a decision with an
          // invoice behind it, not a default.
          emailSends: counterTotals.emailSends,
          // Volume above the plan's included band, in emails (AGL-1438). Not
          // a failed send and not a charge — see the note where it is
          // computed.
          emailSendsOverage: emailOverage,
          workflowRuns: counterTotals.workflowRuns,
          actionRuns: counterTotals.actionRuns,
          // AGL-1390: the org's worst host, and every host past its cap. An
          // empty array is the answer we expect every month; a non-empty one
          // means a screen was created through something the create-time gate
          // does not sit on, and names where to look.
          maxBillableScreens: screenCaps.maxBillable,
          screensOverCapHostIds: screenCaps.overCapHostIds,
          billedCents,
          computedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          ...(reported && {
            reportedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          }),
        },
        { merge: true },
      )
      orgResults[orgId] = { billedCents, reported }
      } catch (error) {
        // One org's bad data must not abandon the rest of the month. Recorded
        // and surfaced in the response, so a partial sweep is visible rather
        // than silent — being silent is what made the original timeout hard
        // to notice.
        console.error(`[report-usage] org ${orgId} failed`, error)
        failures[orgId] = (error as Error)?.message ?? 'unknown'
      }
    }
    // The cursor ALWAYS advances past what was attempted, including failures.
    // Holding it back to retry a failed org sounds kinder and is not: an org
    // that fails deterministically would pin the sweep on it forever and the
    // months behind it would never be rolled up at all.
    //
    // A failed org is therefore skipped for THIS pass and picked up by the
    // next daily run — and `failures` in the response makes the workflow exit
    // non-zero, so the skip is loud instead of quiet. A cron should finish
    // what it can and complain, not spin.
    const failed = Object.keys(failures)
    return Response.json(
      {
        month,
        orgs: orgResults,
        ...(failed.length ? { failures } : {}),
        processed: chunk.items.length,
        total: chunk.total,
        nextCursor: chunk.nextCursor,
        done: chunk.done,
      },
      { status: failed.length ? 207 : 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Rollup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }

/**
 * Cron routes run long: this one sweeps every org (AGL-1141).
 *
 * Vercel Hobby defaults a function to 10s, and nothing here set a duration —
 * so `report-usage` 504d with FUNCTION_INVOCATION_TIMEOUT at 10.2s on
 * 2026-07-31 having succeeded the day before. A pass sitting right on the
 * boundary fails intermittently, which reads as flaky rather than as a limit.
 */
export const maxDuration = 60
