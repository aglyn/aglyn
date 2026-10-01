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
  listPluginUsageMeters,
  unregisteredPluginUsageMeters,
  type PluginUsageMeterContext,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import {
  countedPluginBands,
  meteredBandField,
  meteredBandVerdictFields,
  type ResolvedPluginMeteredBand,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  checkApiRequestQuota,
  decodeStoredNodes,
  isReleaseFlagOnForOrg,
  nodeMapBytes,
  parseOrgReleaseFlagOverrides,
  priceEmailSendOverage,
  resolveEffectivePlan,
  formatOperatorAlertAmount,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  billsEmailSendOverage,
  billsOrgLibraryStorage,
  estimateMonthlyUsageCost,
  hostMeterReadings,
  type HostUsageSnapshot,
  meteredBands,
} from '../../../../utils/usage-metering'
import { measureScreenCaps } from '../../../../utils/screen-cap-reconciliation'
import type { BillableScreenSource } from '../../hosts/resources/count-billable-screens'
import { orgCounterTotals } from '../../../../utils/org-counter-totals'
import {
  emailSendsOverage,
  firebaseAdmin,
  getServerReleaseFlagValues,
  raiseOperatorAlert,
  readOrgBilling,
} from '@aglyn/tenant-data-admin'
import { CRON_CHUNK_SIZE, selectCronChunk } from '../../../../utils/cron-chunk'
import {
  isMeteredPriceId,
  meteredPriceId,
} from '@aglyn/tenant-data-admin/server/billing-addons'
import {
  currentMonth,
  monthIsClosed,
  previousMonth,
} from '../../../../utils/billing-month'

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; metering must
// keep running under a lock so billing stays truthful.

// `previousMonth` / `currentMonth` / `monthIsClosed` moved to
// `utils/billing-month.ts` (AGL-2219). `previousMonth` had three byte-identical
// private copies across this route, `billing/usage-email` and `admin/overview`,
// and `monthIsClosed` is a rule about which months may be invoiced — neither
// belongs inline in the route that sends the meter event.

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

/**
 * Subscription statuses that can still produce an invoice (AGL-1878).
 *
 * A meter event is priced by the SUBSCRIPTION ITEM that carries the metered
 * price, on that subscription's next invoice. So the question "will this event
 * be charged" is the question "does this customer have a live subscription
 * item on our meter", and these are the statuses for which "live" is true.
 *
 * `canceled`, `incomplete`, `incomplete_expired` and `paused` are excluded: no
 * further invoice is generated for any of them, so an event reported against
 * one is an event nobody pays. Excluding a status is the SAFE direction —
 * `reportedAt` is then not stamped, the org-month stays re-sweepable, and the
 * next day's cron reports it if the subscription recovered. Including one
 * wrongly is the direction that forfeits the money for good.
 *
 * AGL-1715-EXEMPT: a deliberate SUPERSET of the canonical live-subscription
 * triple in `org-billing-doc.ts` — it adds `unpaid`. That triple answers "may
 * this org open a SECOND subscription", and it leaves `unpaid` out because
 * there is no live subscription left to protect and a new one is the buyer's
 * only way forward. This set answers the opposite, forward-looking question:
 * "will this subscription bill AGAIN". `unpaid` is a schedule Stripe still
 * retries, so a meter item under it can still reach an invoice — and
 * answering with the canonical triple would withhold from exactly the orgs in
 * dunning, who are the ones carrying an outstanding balance, re-sweeping and
 * 207-ing them every day for as long as the dunning lasts. Same question, and
 * the same superset, as `tools/scripts/lib/money-back-book.mjs`.
 */
const BILLABLE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
])

/**
 * Why the meter event could not be charged, or `null` when it can (AGL-1878).
 *
 * ## The defect this exists for
 *
 * `report-usage` treated "Stripe returned 200 for the meter event" as "the
 * customer was charged", and stamped `reportedAt` on that basis — which makes
 * the org-month permanently skipped. But `POST /v1/billing/meter_events`
 * returns 200 for ANY valid customer id. It has no idea whether that customer
 * has a subscription item priced on the meter, and if they do not, the event
 * lands on the meter, reaches **no invoice line**, and the `reportedAt` stamp
 * then guarantees nothing will ever re-report it.
 *
 * That is not hypothetical. On live Stripe, customer `cus_UuQjDdd1oxPMNH`
 * carries a meter event of **3 units on 2026-08-01** (the July rollup) while
 * its subscription `sub_1TubsJ…` carries a plan item and no metered item at
 * all — so those 3¢ were measured, accepted by Stripe, and invoiced to nobody.
 * The invoice for the OTHER live subscription, which does carry the yearly
 * metered item, shows the line ("Aglyn metered usage (at $0.01 / year)"), so
 * the difference is exactly the item and nothing else.
 *
 * Nothing self-heals it: `checkout/route.ts` attaches the metered item on a
 * NEW subscription and `subscription/route.ts` back-fills it only on a plan or
 * interval switch, and both routes already log a warning for the case where
 * the interval's `STRIPE_PRICE_METERED*` env is unset — a subscription created
 * in that window never gains the item by itself.
 *
 * ## Why this refuses to send rather than sending and flagging
 *
 * Sending an event that reaches no invoice makes the METER lie too — the
 * platform's own usage figures would carry volume nobody was billed for, and
 * the natural repair (attach the item later) would then retroactively price
 * everything already sitting in the period, which is the AGL-1875 hazard. So
 * the event is withheld, `reportedAt` is not stamped, and the org-month stays
 * re-sweepable: the money becomes RECOVERABLE instead of forfeited.
 *
 * ## Failing to ASK is treated the same as a "no"
 *
 * A Stripe read that errors returns `'check-failed'`, which withholds exactly
 * like a missing item. Same reasoning: an unreported month reports late and
 * visibly, a wrongly-stamped one is silent and permanent.
 *
 * Matched on `price.recurring.meter` first — the meter id is what actually
 * prices the event, so this keeps working if the price ids are re-minted — and
 * on the two configured price ids as a fallback for a deployment with no
 * `STRIPE_METER_ID` set.
 */
async function meterReportBlockedReason(
  stripeKey: string,
  customerId: string,
): Promise<'meter-not-configured' | 'no-metered-item' | 'check-failed' | null> {
  const meterId = process.env.STRIPE_METER_ID
  // Resolved through the required-argument price helper and
  // `isMeteredPriceId` rather than by reading `STRIPE_PRICE_METERED*` here.
  // Those two env names are spelled in exactly one module on purpose
  // (AGL-1340) — a second reading is a copy that can drift from the one the
  // attach paths use, and `metered-coverage.spec.ts` fails the build over it
  // (AGL-1352). The membership question below is also already answered,
  // interval-agnostically, by `isMeteredPriceId`; re-implementing it inline
  // was the duplication.
  //
  // Deliberately do NOT spell the helper's name with its opening paren
  // anywhere in this file's prose: that spec matches METERS against raw
  // source, comments included, so a comment that did would satisfy the guard
  // on its own and keep it green after the real call below was gone.
  const meteredPriceConfigured = Boolean(
    meteredPriceId('month') || meteredPriceId('year'),
  )
  // NOTHING TO MATCH AGAINST is its own answer, and it must not be reported as
  // the customer's fault. With no `STRIPE_METER_ID` and neither metered price
  // id set, this deployment cannot tell a billable subscription from an
  // unbillable one — so it withholds (recoverable, and 207 says so daily)
  // rather than reporting into the dark, and names the ENVIRONMENT as the
  // reason so the fix is one variable rather than a customer investigation.
  if (!meterId && !meteredPriceConfigured) return 'meter-not-configured'
  try {
    // `status=all` and filter here: Stripe's filter takes ONE status, and the
    // set above is four. A customer has a handful of subscriptions at most, so
    // one page is the whole answer.
    const query = new URLSearchParams({
      customer: customerId,
      status: 'all',
      limit: '100',
    })
    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions?${query.toString()}`,
      { headers: { Authorization: `Bearer ${stripeKey}` } },
    )
    if (!response.ok) {
      console.error(
        '[report-usage] could not read subscriptions',
        await response.json(),
      )
      return 'check-failed'
    }
    const payload = await response.json()
    const billable = (payload?.data ?? []).some(
      (subscription: any) =>
        BILLABLE_SUBSCRIPTION_STATUSES.has(String(subscription?.status)) &&
        (subscription?.items?.data ?? []).some((item: any) => {
          const price = item?.price
          if (!price) return false
          if (meterId && price?.recurring?.meter === meterId) return true
          return isMeteredPriceId(price?.id)
        }),
    )
    return billable ? null : 'no-metered-item'
  } catch (error) {
    console.error('[report-usage] subscription check failed', error)
    return 'check-failed'
  }
}

/** A meter's dollars as a finite, positive figure — anything else bills nothing. */
function finiteUsd(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

async function hostUsage(
  hostRef: FirebaseFirestore.DocumentReference,
  month: string,
): Promise<HostUsageSnapshot> {
  // Each metered band's per-site counter, beside the platform's two.
  const counterNames = meteredBands().map((band) => band.hostCounter)
  const [media, analytics, ...counters] = await Promise.all([
    hostRef.collection('counters').doc('media').get(),
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
    ...counterNames.map((name) => hostRef.collection('counters').doc(name).get()),
  ])
  return {
    storageBytes: Number(media.get('bytes') ?? 0),
    meters: hostMeterReadings((name) =>
      counters[counterNames.indexOf(name)]?.get(month),
    ),
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
  const {
    method,
    body,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
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
  /*==========================================
   * WHICH MONTH THIS SWEEP IS ABOUT (AGL-2219).
   *
   * The default is still `previousMonth()` — the CLOSED month, the one an
   * invoice is about, and the only shape this route had until now.
   *
   * `?month=current` is the second, in-progress sweep, and it exists because
   * the entire usage-budget feature (AGL-1528) was structurally silent
   * without it. `report-usage` is the ONLY writer of `orgs/{id}/usage/{month}`
   * and it only ever wrote the closed month, so during August the document
   * for August did not exist. Every consumer that asks "what has this org
   * spent THIS month" — the budget cron, the Billing card — got a missing
   * document, read it as `meteredFresh: false`, and correctly declined to
   * say anything. A guard doing its job over an input nobody supplied.
   *
   * ## Why the QUERY STRING and not the body
   *
   * The chunked-sweep protocol (AGL-1141) has the caller re-POST with
   * `{"cursor": "..."}` and NOTHING ELSE — see the loop in
   * `scheduled-crons.yml`. A month passed in the body would therefore apply
   * to the first chunk and silently revert to `previousMonth()` for every
   * chunk after it, so a resumed sweep would write half one month and half
   * another. The URL survives the loop; the body does not.
   *
   * Both spellings are accepted for a literal `YYYY-MM` because the body form
   * predates this and manual backfills use it.
   *=========================================*/
  const monthParam = String(query?.['month'] ?? body?.month ?? '')
  const month =
    monthParam === 'current'
      ? currentMonth()
      : /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : previousMonth()
  /*==========================================
   * THE MARK THIS SWEEP LEAVES (AGL-1955).
   *
   * TWO jobs share this route and they fail independently: the 02:00 run
   * rolls up the CLOSED month and is the only run that ever reaches Stripe,
   * and the 07:00 `?month=current` run writes the in-progress figure every
   * usage budget reads. One can stop while the other keeps going, so they
   * stamp separate ids — folding them into one row would hide exactly that.
   *
   * A manual backfill naming a literal `YYYY-MM` stamps NEITHER. It is not
   * the schedule, and letting a hand-run curl stand in for the cron is how a
   * dead job reads healthy for another day.
   *=========================================*/
  if (method === 'POST' && (monthParam === '' || monthParam === 'current')) {
    await recordCronBeat(
      monthParam === 'current' ? 'report-usage-current' : 'report-usage',
    )
  }
  // Computed ONCE for the sweep, not per org: a run straddling midnight UTC
  // on the 1st must not decide that August is open for one org and closed for
  // the next, which would report half the platform and freeze the other half.
  const closed = monthIsClosed(month)
  /*==========================================
   * THE PLUGINS' METERS (AGL-3080).
   *
   * A plugin's usage — its storage, its band, its price past the band — is
   * measured by the plugin's own meter (`plugin-usage-meters.ts`), which this
   * sweep asks once per workspace for the fields it writes onto the rollup
   * and the dollars it adds to the billed figure. The plugins' declarations
   * are loaded first because this is a core cron that never touches a
   * plugin's own doors.
   *
   * Listed ONCE for the sweep, like `closed` above and for the same reason:
   * every workspace in one run is measured by the same meters. A meter a
   * plugin DECLARED and did not register refuses every workspace below —
   * each fails loudly for this pass and is swept again tomorrow, where a
   * month billed without the meter would be short and final.
   *=========================================*/
  try {
    await registerPluginServerDeclarations()
  } catch (error) {
    console.error('[report-usage] plugin declarations failed', error)
  }
  const usageMeters = listPluginUsageMeters()
  const missingUsageMeters = unregisteredPluginUsageMeters()
  // Each plugin usage band measured by a per-site counter and not metered:
  // the sweep sums it with the platform's own counters and records it on the
  // rollup. A metered band's counter is read with each host's usage instead.
  const counterBands = countedPluginBands()
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

    // The release-flag verdicts, once for the whole sweep (AGL-1604). The
    // template read is cached with its own TTL, so this costs nothing per org,
    // and every org in one invocation is then priced against the same verdict.
    const releaseFlagValues = await getServerReleaseFlagValues()

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
    /**
     * Closed org-months that MEASURED billable usage and put none of it on an
     * invoice (AGL-1878) — the money we did not charge, named and counted.
     *
     * Separate from `failures` because the two need different responses: a
     * failure is one org skipped for this pass and picked up tomorrow, while
     * this is real revenue sitting unclaimed until somebody attaches a metered
     * subscription item. Both make the run 207, which is what fails the
     * workflow — see the note on the status below.
     */
    const unbilled: Record<string, { billedCents: number; reason: string }> = {}
    // The cursor must name the last org FINISHED, never the last attempted —
    // handing back a failed org's id skips it forever, which is the
    // partial-month bug wearing a cursor.
    for (const orgId of chunk.items) {
      const hostRefs = byOrg[orgId] ?? []
      try {
      const orgRef = firestore.collection('orgs').doc(orgId)
      // INDEPENDENT round trips, previously awaited one after another
      // (AGL-1141). None consumes another's result — the quota checks below
      // combine them, but only once all are in hand — so the sequencing was
      // incidental, and it made an org cost the SUM of its reads rather than
      // the slowest of them. That is most of why four orgs took ~10s.
      const usageRef = orgRef.collection('usage').doc(month)
      const [
        usage,
        orgSnapshot,
        siteSize,
        apiUsageSnap,
        counterTotals,
        offlineFeesSnap,
        existing,
      ] = await Promise.all([
        Promise.all(hostRefs.map(usageFor)),
        orgRef.get(),
        // Published-site size (AGL-1107): stored on the rollup so the daily
        // usage-alerts cron — and, since AGL-1371, the console meter — can
        // read the `totalSiteSizeMb` figure cheaply, without re-reading every
        // version payload themselves. One measurement, three readers.
        orgSiteSizeBytes(firestore, hostRefs),
        // Customer REST API request overage (AGL-635): plan-priced per 1,000
        // requests over the included quota. The durable counter is written
        // per-request by the API auth chokepoint.
        orgRef.collection('apiUsage').doc(month).get(),
        // Email sends, action runs and every host counter a plugin's usage
        // band is measured by (AGL-1134) — counted per host all along,
        // enforced per org by `usage-alerts`, and never once written down.
        // RECORDED, NOT PRICED: see the rollup write below.
        //
        // `orgRef` since AGL-1438: invites, member-added mail, the welcome
        // email and these very usage summaries belong to the org and to no
        // site, so they are counted at `orgs/{id}/counters` and were invisible
        // to a sum taken over hosts alone. Since AGL-1473 it also carries the
        // org LIBRARY's stored bytes, which had the identical defect.
        orgCounterTotals(
          firestore,
          hostRefs,
          month,
          orgRef,
          counterBands.map((band) => band.hostCounter),
        ),
        // Platform fee on POS sales that never touched Stripe (AGL-2111).
        // Cash and folio tenders have no charge to net an
        // `application_fee_amount` out of, so `pos-order.ts` accrues the fee
        // here — in the same transaction as the order — and this is the only
        // place it can reach an invoice. PRICED: this is not a cost we
        // absorb, it is the platform fee the merchant's own plan already
        // charges, collected on the one channel where Stripe cannot collect it
        // for us.
        orgRef.collection('offlineFees').doc(month).get(),
        // THE ROLLUP DOCUMENT ITSELF (AGL-2399), moved into this batch from a
        // sequential read further down.
        //
        // Two readers now. It has always answered "was this org-month already
        // reported" (`reportedAt`); since AGL-2399 it also carries the last
        // reading of the two STOCK meters taken INSIDE the month, which is
        // what a closed sweep bills them on. Both questions are asked before
        // anything is written, and the document is not touched in between, so
        // the read belongs beside the other independent ones rather than on
        // its own round trip per org.
        usageRef.get(),
      ])
      // One read of the org doc for every quota decision below — the four
      // meters must agree about which plan they are pricing against.
      const orgData = orgSnapshot.data() as any
      // The tier every release-flag verdict below is evaluated against
      // (AGL-2486), off the document already in hand — no extra read.
      //
      // `null` when the document is ABSENT, deliberately not
      // `resolveEffectivePlan(undefined)`: that answers `'free'`, and a
      // Free-targeted flag would then switch on for every org whose read
      // came back empty. An unknown tier must refuse; a KNOWN `'free'` must
      // match. Those are different facts, so they are spelled differently.
      const releaseFlagPlan = orgData ? resolveEffectivePlan(orgData) : null
      // THE PLUGINS' METERS, one pass per workspace after the batch above,
      // because each measures against the workspace document it read. A
      // missing declared meter or a meter that throws fails this workspace
      // for the pass — see where they are listed.
      if (missingUsageMeters.length) {
        throw new Error(
          `usage meters declared and not registered: ${missingUsageMeters.join(', ')}`,
        )
      }
      const meterContext: PluginUsageMeterContext = {
        orgId,
        org: (orgData ?? {}) as Record<string, unknown>,
        month,
        closed,
        previous: (existing.data() ?? {}) as Record<string, unknown>,
        releaseFlagOn: (key) =>
          isReleaseFlagOnForOrg(
            key,
            releaseFlagValues[key],
            orgId,
            parseOrgReleaseFlagOverrides(orgData?.['releaseFlags']),
            releaseFlagPlan,
          ),
      }
      const meterReadings = await Promise.all(
        usageMeters.map((meter) => meter.measure(meterContext)),
      )
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
      // and every metered band are zero: a library serves no pages and
      // receives nothing.
      const orgLibrary: HostUsageSnapshot = {
        storageBytes: counterTotals.orgLibraryBytes,
        pageViews: 0,
      }
      // Only usage BEYOND the plan's included storage/bandwidth/metered bands
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
      // before this one. Starting to charge for bytes an org has stored for
      // months is a pricing decision and must be made deliberately, never as
      // a side effect of correcting the sum. Once the switch is set the two
      // estimates are the same figure and the branch costs nothing — it is a
      // pure function over numbers already in hand, no extra read.
      const estimate = estimateMonthlyUsageCost([...usage, orgLibrary], orgData)
      const orgLibraryBilled = billsOrgLibraryStorage(
        month,
        process.env.BILL_ORG_LIBRARY_STORAGE_FROM,
      )
      // A metered band's overage is WITHHELD while the release flag its
      // declaration names is off for the workspace (`metered.withheldUntil`).
      // The forms plugin's submissions wait behind `release_inbox` (AGL-1688):
      // the flag gates the console Inbox page and its nav tab, while
      // `/api/forms/submit` keeps counting submissions and
      // `GET /v1/sites/{id}/form-submissions` keeps serving them. So they
      // accrue past the plan's band and would bill at cost x 1.3, for a lead
      // list the customer has no console way to read, mark read, or export.
      // Nobody may be charged for what they cannot reach.
      //
      // Same construction as `contactsOverageBilled` and for the same
      // reasons (`meterContext.releaseFlagOn`): bucketed by `orgId` so an org
      // inside a partial rollout CAN reach the page and so is billed; per-org
      // overrides read off `orgData`, already in hand, so a staff grant
      // reaches the invoice too (AGL-1635) at no extra read; and conditional
      // on the flag rather than zeroed, so the day the page ships the same
      // expression bills again on its own.
      const withheldBands = meteredBands().filter(
        (band) =>
          band.metered.withheldUntil &&
          !meterContext.releaseFlagOn(band.metered.withheldUntil),
      )
      // WHAT REACHES THE INVOICE, not what is counted. The snapshots feeding
      // `estimate` are untouched, so `costUsd`, each recorded band count and
      // every COGS reader stay truthful — under-reporting our own cost is the
      // direction that silently loosens the discount guardrail.
      const billedEstimateBeforeWithholding = orgLibraryBilled
        ? estimate
        : estimateMonthlyUsageCost(usage, orgData)
      const estimateWithholding = (
        bands: readonly ResolvedPluginMeteredBand[],
      ) => {
        const billedHosts = usage.map((host) => ({
          ...host,
          meters: Object.fromEntries(
            Object.entries(host.meters ?? {}).map(([id, count]) => [
              id,
              bands.some((band) => band.id === id) ? 0 : count,
            ]),
          ),
        }))
        return estimateMonthlyUsageCost(
          orgLibraryBilled ? [...billedHosts, orgLibrary] : billedHosts,
          orgData,
        )
      }
      const billedEstimate = withheldBands.length
        ? estimateWithholding(withheldBands)
        : billedEstimateBeforeWithholding
      // Each withheld band's verdict, and what was forgone, so a withheld
      // month is distinguishable from a month with no overage on that band at
      // all — the first question anyone re-reading a beta invoice will ask.
      // Pre-markup, matching `billableCostUsd` beside which it is recorded.
      const meteredVerdicts = Object.fromEntries(
        meteredBands()
          .filter((band) => band.metered.withheldUntil)
          .flatMap((band) => {
            const fields = meteredBandVerdictFields(band)
            const withheld = withheldBands.includes(band)
            return [
              [fields.billed, !withheld],
              [
                fields.withheldUsd,
                withheld
                  ? billedEstimateBeforeWithholding.billableCostUsd -
                    estimateWithholding([band]).billableCostUsd
                  : 0,
              ],
            ]
          }),
      )
      /*==========================================
       * STOCK METERS ARE READ AT THE END OF THE MONTH THEY BILL (AGL-2399).
       *
       * API requests and form submissions are FLOWS: they accumulate inside
       * the period and nothing done afterwards can move them. A plugin's
       * records or a workspace's dataset bytes are STOCKS — a level, not a
       * total — and the closed-month sweep runs after the month is over, so a
       * level read "now" would charge August for September's behaviour.
       *
       * The convention, decided as the narrowest of the candidates because
       * pricing is locked: a stock bills the LAST READING TAKEN INSIDE the
       * month. Every in-progress sweep stamps its reading as the period-end
       * one, a closed sweep bills that stamp and never writes it, so every
       * re-run of a closed month reads the same input and bills the same
       * amount — and the invoice equals the last figure the console showed.
       * Peak would close deleting on the 30th to duck the band and is left
       * open deliberately: it would RAISE bills, which needs a decision. The
       * daily series this reads is the one a peak would need.
       *
       * Each stock meter applies the convention to its own reading — the
       * stamp rides `periodEndFields`, written below only while the month is
       * open — and says when it billed a stamp. `stockBasis` names which
       * instant this month's stocks describe:
       *
       * `in-progress` — an OPEN month, measured now, which is inside it.
       * `period-end` — a CLOSED month billing the last reading inside it.
       * `sweep-time` — a CLOSED month with no in-period reading, measured
       *   after the fact: months before the in-progress sweep existed, and
       *   orgs created after the month's last run. Named rather than silent,
       *   so which months are comparable is answerable from the audit rows.
       *=========================================*/
      const stockBasis: 'in-progress' | 'period-end' | 'sweep-time' = !closed
        ? 'in-progress'
        : meterReadings.some((reading) => reading.periodEndBasis)
          ? 'period-end'
          : 'sweep-time'
      // Msgpack bytes of the decoded node maps — see `nodesBytes`. One unit
      // for all three storage forms, so this figure is comparable BETWEEN
      // sites rather than only with itself.
      const siteSizeMb = Math.round((siteSize.bytes / (1024 * 1024)) * 10) / 10
      const apiRequests = Number(apiUsageSnap.get('count') ?? 0)
      const apiQuota = checkApiRequestQuota(orgData, apiRequests)
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
      // The COUNT, measured against the resolved band. It is not the COGS
      // input: what the org costs us is every send on the cost meter, priced
      // by `orgMonthlyCogsUsd`, because the provider charges for the first
      // message of the month as much as the last.
      const emailOverage = emailSendsOverage(
        counterTotals.emailSends,
        resolveOrgEntitlements(orgData).emailSendsPerMonth,
      )
      // …and what it costs the customer, at the plan's retail per-1,000 rate.
      // NOT the infrastructure pass-through: email is not billed at cost x
      // 1.3, it is a tiered price beside contacts and API requests.
      //
      // WITHHELD until `BILL_EMAIL_SEND_OVERAGE_FROM` names a month at or
      // before this one, for the reason `billsOrgLibraryStorage` exists: this
      // volume has been counted and never charged, the included bands moved
      // in the same change as the rate, and the daily cron re-sweeps any
      // org-month that has not reported. Without the gate the first run after
      // deploy would invoice a month whose mail was sent under a larger
      // allowance — and most of that mail is transactional, which no cap was
      // ever allowed to refuse.
      const emailOveragePrice = priceEmailSendOverage(orgData, emailOverage)
      const emailOverageBilled = billsEmailSendOverage(
        month,
        process.env.BILL_EMAIL_SEND_OVERAGE_FROM,
      )
      const emailOverageUsd = emailOverageBilled
        ? emailOveragePrice.overageMonthlyUsd
        : 0
      /*==========================================
       * THE POS FEE THAT STRIPE CANNOT COLLECT (AGL-2111).
       *
       * Already cents, already the plan's own rate, already floored — the
       * register computed it per line by product type at the moment of sale
       * (`pos-order.ts`), which is the only place the basket exists. Nothing
       * is re-derived here: a second fee model would drift from the first, and
       * the figure on the order document is what the merchant was told.
       *
       * Defensive read because this document is written by a different
       * service: a negative, a NaN or a stringly-typed value must bill zero
       * rather than reduce a real invoice. `Math.round` because a cent is the
       * unit the meter is priced in ($0.01/unit), and a fractional value would
       * be handed to Stripe as a string it would round differently.
       *=========================================*/
      const offlineFeeRaw = Number(offlineFeesSnap.get('feeCents') ?? 0)
      const offlinePosFeeCents =
        Number.isFinite(offlineFeeRaw) && offlineFeeRaw > 0
          ? Math.round(offlineFeeRaw)
          : 0
      const offlinePosFeeOrders = Number(offlineFeesSnap.get('orders') ?? 0)
      const billedCents =
        billedEstimate.billedCents +
        Math.round(apiQuota.overageMonthlyUsd * 100) +
        Math.round(emailOverageUsd * 100) +
        // Each plugin meter's line, rounded to cents on its own like every
        // plan-priced line above.
        meterReadings.reduce(
          (sum, reading) => sum + Math.round(finiteUsd(reading.billedUsd) * 100),
          0,
        ) +
        offlinePosFeeCents
      // `usageRef` / `existing` come from the batch above (AGL-2399) — the
      // stock basis needs the same document this guard does, and reading it
      // twice per org bought nothing.
      // THE PLUGINS' CLOSE-OUTS, before the already-reported skip below: what
      // a plugin bills on its own is settled whether or not the meter reported
      // for this workspace, and a month that has reported is exactly the month
      // whose remainder is due. Awaited and isolated — a plugin's Stripe call
      // failing must not cost the platform's own metering.
      //
      // The billing document is read only when a close-out asks for it, so a
      // month with nothing of a plugin's to settle adds no read per org.
      if (closed) {
        let customerId: Promise<string | null> | undefined
        const stripeCustomerId = () =>
          (customerId ??= readOrgBilling(orgId).then((billing) =>
            billing.stripeCustomerId ? String(billing.stripeCustomerId) : null,
          ))
        for (const meter of usageMeters) {
          if (!meter.closeMonth) continue
          try {
            await meter.closeMonth({ ...meterContext, stripeCustomerId })
          } catch (error) {
            console.error(
              `[report-usage] ${meter.pluginId}:${meter.id} failed to close ${month} for ${orgId}`,
              error,
            )
          }
        }
      }
      if (existing.get('reportedAt')) {
        orgResults[orgId] = { billedCents, skipped: true }
        continue
      }

      let reported = false
      /**
       * Why a closed month's `billedCents` did not reach an invoice, or `null`
       * when it did (AGL-1878). `'no-customer'` and `'meter-event-failed'` are
       * decided here; the other two come from `meterReportBlockedReason`.
       */
      let meterReportBlocked:
        | 'no-customer'
        | 'meter-not-configured'
        | 'no-metered-item'
        | 'check-failed'
        | 'meter-event-failed'
        | null = null
      // `closed` FIRST, and it is the whole point of AGL-2219's guard: an
      // in-progress sweep computes and stores the running figure the budget
      // card and the budget alert read, and it must not — cannot — put that
      // partial figure on an invoice. See `monthIsClosed`.
      if (closed && stripeKey && billedCents > 0) {
        // AGL-1028: reads the manager-gated billing doc, org doc as fallback.
        const customerId = (await readOrgBilling(orgId)).stripeCustomerId
        if (!customerId) {
          meterReportBlocked = 'no-customer'
        } else {
          // A 200 from `meter_events` is NOT a charge — see
          // `meterReportBlockedReason`. Asked BEFORE the POST so an event that
          // would reach no invoice is never sent and `reportedAt` is never
          // stamped, which is what keeps the money recoverable.
          meterReportBlocked = await meterReportBlockedReason(
            stripeKey,
            String(customerId),
          )
        }
        if (customerId && !meterReportBlocked) {
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
                // ONE event per org-month, and the only reason a re-run cannot
                // double-charge inside Stripe's own dedupe window. Beyond it,
                // `reportedAt` above is the durable guard — the two are not
                // redundant, they cover different spans.
                identifier: `${orgId}-${month}`,
                'payload[stripe_customer_id]': String(customerId),
                'payload[value]': String(billedCents),
              }).toString(),
            },
          )
          if (response.ok) reported = true
          else {
            meterReportBlocked = 'meter-event-failed'
            console.error('meter event failed', await response.json())
          }
        }
        if (meterReportBlocked) {
          // LOUD. A closed month that measured real money and put it on no
          // invoice is the one outcome nobody may learn about from a silence.
          console.error('[report-usage] billable usage NOT reported', {
            orgId,
            month,
            billedCents,
            reason: meterReportBlocked,
          })
          // And said to the operator, once per workspace and month: a log
          // line is read by nobody on an install without log alerting
          // (AGL-3377).
          await raiseOperatorAlert('billing.usageNotReported', {
            dedupeKey: `${orgId}:${month}`,
            context: {
              orgId,
              // Off the org document this loop already holds (AGL-3432);
              // blank when it has no name, and the template keeps the id.
              orgName: String(orgData?.name ?? '').trim(),
              month,
              amount: formatOperatorAlertAmount(billedCents),
              reason: meterReportBlocked,
            },
            orgId,
          })
        }
      }

      await usageRef.set(
        {
          // Each plugin meter's fields FIRST, so a field the platform writes
          // below can never be overwritten by one; its period-end stamp only
          // while the month is open, for the reason the platform's own stock
          // readings below are.
          ...Object.assign(
            {},
            ...meterReadings.map((reading) => ({
              ...reading.fields,
              ...(closed ? {} : (reading.periodEndFields ?? {})),
            })),
          ),
          month,
          hostCount: hostRefs.length,
          storageGb: estimate.storageGb,
          pageViews: estimate.pageViews,
          // Each metered band's count, under the band's field. COUNTED ALWAYS
          // (AGL-1688), like `contactsCount` below: the units are real, the
          // count is what the abuse ceiling and the plan quota are evaluated
          // against, and it stays truthful whatever a flag says. Only the
          // figure that reaches `billedCents` moves.
          ...Object.fromEntries(
            meteredBands().map((band) => [
              meteredBandField(band),
              estimate.meters[band.id] ?? 0,
            ]),
          ),
          // Whether THIS month charged for each withheld band's overage, and
          // what was forgone if it did not. Same pair, same reason, as
          // `contactsOverageBilled` / `contactsOverageWithheldUsd`: without
          // the second field a withheld month is indistinguishable from a
          // month that simply stayed inside the band.
          ...meteredVerdicts,
          costUsd: estimate.costUsd,
          // The excess only, at cost (AGL-1280) — `billedCents` is this
          // number marked up, plus the five plan-priced overages. Read off
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
          // THE SEMANTICS, on the document rather than in a commit message
          // (AGL-1473 asked for this; AGL-1886 is when it started to matter).
          //
          // `BILL_ORG_LIBRARY_STORAGE_FROM` is a START MONTH, not a boolean,
          // and NOT RETROACTIVE: no org is ever billed for bytes that were
          // stored before the month named here. That is a property of the
          // mechanism, not of anyone's care — `report-usage` takes `month` in
          // its body and the daily cron re-sweeps any org-month lacking
          // `reportedAt`, so a boolean flipped mid-September would bill a
          // re-run of January at January's accumulated bytes, against a month
          // already invoiced. A start month cannot reach backwards whenever
          // it is set.
          //
          // Recorded VERBATIM, unparsed, so this document answers "why was
          // this month billed (or not)" without anyone having to know what an
          // environment variable held when the cron ran — and so a malformed
          // value is legible as malformed rather than as absent.
          // `orgLibraryBilled` above is the same env var after
          // `billsOrgLibraryStorage`, which FAILS CLOSED on anything that is
          // not `YYYY-MM`.
          orgLibraryBilledFrom:
            process.env.BILL_ORG_LIBRARY_STORAGE_FROM ?? null,
          siteSizeMb,
          // A LOWER BOUND when true — the sweep hit `SITE_SIZE_DOC_CEILING`
          // (AGL-1371). Nothing prices from site size today; anything that
          // ever does must refuse to bill from a truncated figure, and this
          // is how it can tell.
          siteSizeTruncated: siteSize.truncated,
          apiRequests,
          apiOverageUsd: apiQuota.overageMonthlyUsd,
          /*==========================================
           * THE STOCK BASIS, WRITTEN DOWN (AGL-2399).
           *
           * `stockBasis` names WHICH INSTANT the stock meters' billed figures
           * describe — see where it is computed. Without it, a month billed on
           * the last in-period reading and a month that fell back to a
           * post-period one are indistinguishable, and "is this month
           * comparable to that one" becomes a question about deploy dates.
           * Each stock meter records what this run measured beside what it
           * billed, so the size of the correction stays recoverable.
           *
           * The period-end stamps — each meter's `periodEndFields`, spread at
           * the top of this write — and `stockMeasuredAt` are written ONLY
           * while the month is open, and that conditional is the whole
           * idempotency guarantee. A closed sweep that re-runs must read the
           * same input it read yesterday; if it stamped its own post-period
           * measurement, the second re-sweep would bill from the first
           * re-sweep's reading and the figure would walk forward a day at a
           * time.
           *=========================================*/
          stockBasis,
          ...(closed
            ? {}
            : {
                stockMeasuredAt:
                  firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              }),
          // The cash/folio POS platform fee this month (AGL-2111), and the
          // number of sales it came from. Recorded ALWAYS, including at zero,
          // so "this store took no cash" is legible as a fact rather than as
          // a missing field — and so a merchant querying why their invoice
          // moved has the count beside the amount. It IS inside
          // `billedCents`.
          offlinePosFeeCents,
          offlinePosFeeOrders:
            Number.isFinite(offlinePosFeeOrders) && offlinePosFeeOrders > 0
              ? Math.round(offlinePosFeeOrders)
              : 0,
          // Email sends, action runs and each plugin band's host counter
          // (AGL-1134), summed across the org's hosts. COUNTS for this month
          // — see `orgCounterTotals` for the unit and the double-count
          // argument.
          //
          // `emailSends` is PRICED INTO COGS, at
          // `ORG_COGS_UNIT_RATES_USD.perEmailSend` — every message the
          // provider charged for, campaigns and transactional alike — and its
          // OVERAGE is priced onto the invoice at the plan's retail
          // per-1,000 rate. Runs are PRICED INTO COGS at
          // `ORG_COGS_UNIT_RATES_USD.perRun` (2026-09-07) and never reach the
          // invoice: no plan sells runs past its band, so there is no overage
          // line for them to become.
          emailSends: counterTotals.emailSends,
          // Volume above the plan's included band, in emails (AGL-1438).
          // Mostly transactional, because that is the mail no cap may refuse
          // — see the note where it is computed.
          emailSendsOverage: emailOverage,
          // What actually entered `billedCents`: zero until
          // `BILL_EMAIL_SEND_OVERAGE_FROM` names this month or an earlier one.
          emailSendsOverageUsd: emailOverageUsd,
          // Whether THIS month charged for it, and what was forgone if not:
          // a withheld month must not read as a month that stayed inside its
          // band.
          emailSendsOverageBilled: emailOverageBilled,
          emailSendsOverageWithheldUsd: emailOverageBilled
            ? 0
            : emailOveragePrice.overageMonthlyUsd,
          actionRuns: counterTotals.actionRuns,
          // Each plugin band measured by a host counter, recorded under the
          // band's own field so its cost axis and utilization read it.
          ...Object.fromEntries(
            counterBands.map((band) => [
              band.fields[0]!,
              counterTotals.counters[band.hostCounter] ?? 0,
            ]),
          ),
          // AGL-1390: the org's worst host, and every host past its cap. An
          // empty array is the answer we expect every month; a non-empty one
          // means a screen was created through something the create-time gate
          // does not sit on, and names where to look.
          maxBillableScreens: screenCaps.maxBillable,
          screensOverCapHostIds: screenCaps.overCapHostIds,
          billedCents,
          /**
           * WHY a closed month reached no invoice, and HOW MUCH went with it
           * (AGL-1878).
           *
           * `billedCents` alone cannot answer "were we paid for this": it is
           * what the month MEASURED, and until now the only trace of whether
           * anything was charged was the presence of `reportedAt` — which was
           * stamped on a Stripe 200 that does not mean charged. These two
           * fields make the gap countable: sum `meterUnbilledCents` across
           * every org's `usage` subcollection and that is money measured and
           * never invoiced.
           *
           * Both are written on EVERY sweep, `null`/0 included, so a month
           * that billed cleanly is distinguishable from one written by an
           * older deployment that did not know to say.
           *
           * Only a CLOSED month can be unbilled — an open one is not supposed
           * to reach an invoice at all (AGL-2219), so counting its running
           * figure as owed would make every in-progress rollup look like a
           * leak.
           */
          meterReportBlocked,
          meterUnbilledCents: closed && !reported ? billedCents : 0,
          computedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          ...(reported && {
            reportedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          }),
        },
        { merge: true },
      )
      orgResults[orgId] = { billedCents, reported }
      if (meterReportBlocked) {
        unbilled[orgId] = { billedCents, reason: meterReportBlocked }
      }
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
    const unclaimed = Object.keys(unbilled)
    return Response.json(
      {
        month,
        // Which of the two daily sweeps this was (AGL-2219). Without it the
        // two runs are indistinguishable in a workflow log, and "the meter
        // events stopped" and "the in-progress sweep ran twice" look the
        // same. `false` means nothing here reached Stripe, by construction.
        closed,
        orgs: orgResults,
        ...(failed.length ? { failures } : {}),
        // AGL-1878. Present only when there is something to say, so a clean
        // sweep's body is unchanged and the key's presence IS the signal.
        ...(unclaimed.length ? { unbilled } : {}),
        processed: chunk.items.length,
        total: chunk.total,
        nextCursor: chunk.nextCursor,
        done: chunk.done,
      },
      // 207 ALSO for unbilled usage, not only for failures. The workflow exits
      // non-zero on 207 and that is the platform's one alerting channel for
      // this cron; a month that measured money and charged none of it is
      // exactly "the sweep finished and something in it needs a person". It
      // cannot become daily noise on its own: a dead subscription resolves to
      // the free plan (`resolveEffectivePlan`), which meters nothing, so
      // `billedCents` is 0 and no report is attempted. Reaching here means a
      // LIVE paid subscription with no item on the meter.
      { status: failed.length || unclaimed.length ? 207 : 200 },
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
