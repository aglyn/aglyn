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
} from '@aglyn/aglyn/server'
import {
  estimateMonthlyUsageCost,
  type HostUsageSnapshot,
} from '../../../../utils/usage-metering'
import {
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

/** Approximate persisted size of one version doc's node payload. */
function nodesBytes(nodes: unknown): number {
  if (nodes == null) return 0
  if (ArrayBuffer.isView(nodes)) return (nodes as Uint8Array).byteLength
  try {
    return JSON.stringify(nodes).length
  } catch {
    return 0
  }
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

/** Published-version refs for one collection, paged to the ceiling. */
async function publishedVersionRefs(
  collectionRef: FirebaseFirestore.CollectionReference,
  ceiling: number,
): Promise<{ refs: FirebaseFirestore.DocumentReference[]; truncated: boolean }> {
  const refs: FirebaseFirestore.DocumentReference[] = []
  let scanned = 0
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  for (;;) {
    // `select('versionId')` — the only field read. Projecting keeps a page of
    // 500 screens from dragging their whole documents across the wire.
    let query = collectionRef
      .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
      .select('versionId')
      .limit(SITE_SIZE_PAGE_SIZE)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    for (const doc of page.docs) {
      const versionId = doc.get('versionId')
      if (versionId) {
        refs.push(doc.ref.collection('versions').doc(String(versionId)))
      }
    }
    scanned += page.size
    // A short page is the end of the collection — the only proof the sweep is
    // complete. Anything else and we cannot claim it is.
    if (page.size < SITE_SIZE_PAGE_SIZE) return { refs, truncated: false }
    if (scanned >= ceiling) return { refs, truncated: true }
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
): Promise<{ bytes: number; truncated: boolean }> {
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
      if (!versionRefs.length) return { bytes: 0, truncated }
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
      return { bytes, truncated }
    }),
  )
  return {
    bytes: perHost.reduce((sum, host) => sum + host.bytes, 0),
    truncated: perHost.some((host) => host.truncated),
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
 * page views, month form submissions), prices whatever exceeds the plan's
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
    for (const host of hosts.docs) {
      const orgId = host.get('orgId')
      if (orgId) (byOrg[orgId] ??= []).push(host.ref)
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
      // Six INDEPENDENT round trips, previously awaited one after another
      // (AGL-1141). None consumes another's result — the quota checks below
      // combine them, but only once all six are in hand — so the sequencing
      // was incidental, and it made an org cost the SUM of its reads rather
      // than the slowest of them. That is most of why four orgs took ~10s.
      const [
        usage,
        orgSnapshot,
        datasetBytes,
        siteSize,
        apiUsageSnap,
        contactsSnap,
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
      ])
      // One read of the org doc for every quota decision below — the four
      // meters must agree about which plan they are pricing against.
      const orgData = orgSnapshot.data() as any
      // Only usage BEYOND the plan's included storage/bandwidth/form bands
      // is billed (AGL-1280) — `billedCents` is the excess; `costUsd` stays
      // the gross figure the COGS model and staff views read.
      const estimate = estimateMonthlyUsageCost(usage, orgData)
      const dataStorageMb =
        Math.round((datasetBytes / (1024 * 1024)) * 10) / 10
      const siteSizeMb = Math.round((siteSize.bytes / (1024 * 1024)) * 10) / 10
      const dataQuota = checkDataStorageQuota(orgData, dataStorageMb)
      const apiRequests = Number(apiUsageSnap.get('count') ?? 0)
      const apiQuota = checkApiRequestQuota(orgData, apiRequests)
      const contactsCount = Number(contactsSnap.data().count ?? 0)
      const contactQuota = checkContactQuota(orgData, contactsCount)
      const billedCents =
        estimate.billedCents +
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
          // number marked up, plus the three plan-priced overages.
          billableCostUsd: estimate.billableCostUsd,
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
