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

import * as Aglyn from '@aglyn/aglyn/server'
import {
  analyticsDayExpiresAt,
  checkRateLimit,
  firebaseAdmin,
  getOrgForHost,
  getSiteLockdown,
  notifyHostManagers,
  notifyStaff,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

/**
 * The map key a path is counted under. MOVED to `@aglyn/aglyn` (AGL-2498) —
 * the console's per-entry traffic card has to build the same key to look one
 * path up, and a hand-copied character class that drifts by one character
 * reports a real page as zero views. This alias keeps the call sites below
 * reading the way they always have.
 */
const pathKey = Aglyn.analyticsPathKey

const noContent = () => new Response(null, { status: 204 })

// Best-effort per-instance rate limit (AGL-510): this endpoint is
// unauthenticated and fires host automations via emitHostEvent, so cap bursts
// from one client. Instances are ephemeral, so this only blunts spikes. The
// store is private and size-capped (AGL-1844) because its keys come from
// `x-forwarded-for` — the old timestamp-array map grew one entry per distinct
// IP forever, an unbounded map reachable by anyone with a spoofable header.
// Cleared wholesale like the CSP collector's keyStore: the failure mode is a
// briefly widened limit, strictly better than an OOM on a long-lived
// instance.
const ipStore = new Map<string, { count: number; windowStartMs: number }>()
const MAX_TRACKED_IPS = 10_000
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120

function rateLimited(ip: string): boolean {
  if (ipStore.size > MAX_TRACKED_IPS) ipStore.clear()
  return !checkRateLimit(`analytics:${ip}`, {
    limit: RATE_MAX,
    windowMs: RATE_WINDOW_MS,
    store: ipStore,
  }).allowed
}

// ---------------------------------------------------------------------------
// Spoofed-host gate (AGL-1844)
// ---------------------------------------------------------------------------

/**
 * A plain Firestore document id: the charset every real host id uses, the
 * reserved `__name__`-style ids refused. Anything else never reaches
 * Firestore at all — neither as a doc path nor as an existence probe.
 */
const HOST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const RESERVED_ID_PATTERN = /^__.*__$/

/**
 * Per-instance host-existence cache. AGL-510 noted that a spoofed hostId
 * still wrote counters and fired host automations — the host-existence
 * guard existed only on the forms honeypot path. The beacon now pays ONE
 * read per host per instance-hour for the same wall, instead of a read per
 * beacon (this endpoint's cost discipline) or no wall at all.
 *
 * A missing host is cached for only a minute: a just-published site's first
 * visitors must start counting promptly on every instance. A present host
 * is cached for an hour — a deleted host's stale positive writes orphan
 * counters for at most that long, which is noise, not spend. Size-capped
 * like every attacker-keyed map here.
 */
const hostExistence = new Map<string, { exists: boolean; at: number }>()
const HOST_EXISTS_TTL_MS = 60 * 60_000
const HOST_MISSING_TTL_MS = 60_000
const MAX_TRACKED_HOSTS = 5_000

async function hostExists(hostId: string): Promise<boolean> {
  const now = Date.now()
  const hit = hostExistence.get(hostId)
  if (
    hit &&
    now - hit.at < (hit.exists ? HOST_EXISTS_TTL_MS : HOST_MISSING_TTL_MS)
  ) {
    return hit.exists
  }
  if (hostExistence.size > MAX_TRACKED_HOSTS) hostExistence.clear()
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .get()
  hostExistence.set(hostId, { exists: snapshot.exists, at: now })
  return snapshot.exists
}

// ---------------------------------------------------------------------------
// Lockdown gate (AGL-1627)
// ---------------------------------------------------------------------------

/**
 * How much of this beacon a lockdown freezes.
 *
 *  - `none` — no active lock. Everything runs.
 *  - `automations` — a READ-ONLY lock. The counters still count; the
 *    `pageView` host event does NOT fire.
 *  - `all` — a FULL lock. Nothing here writes anything.
 *
 * A string union rather than the boolean this started as, because the answer
 * is genuinely three-valued, and because `strictNullChecks` is off in this
 * repo: an absent boolean folds to `false` silently, whereas every comparison
 * below is written so that an absent verdict falls to the OPEN side by
 * construction (see `beaconFreeze`).
 */
type BeaconFreeze = 'none' | 'automations' | 'all'

/**
 * THE AGL-1627 DECISION, and why it is a split rather than the single
 * "does telemetry count as a frozen write?" the issue posed.
 *
 * The issue framed one question and offered two answers — freeze the beacon
 * under a read-only lock, or exempt it. Both are wrong here, because this
 * route does two unrelated things and they belong on opposite sides of the
 * line. What sorts them is not "is this telemetry?" but **what does the mode
 * actually promise?**
 *
 * ## `full` — everything freezes. Settled, and shipped in 850c1b827.
 *
 * `/api` sits outside the tenant middleware matcher, so a page already cached
 * in a visitor's browser keeps beaconing after the site itself has gone dark
 * and started answering 503 from `/api/locked`. Counting those as page views
 * records traffic for a site we deliberately took offline — and because
 * `/api/billing/report-usage` meters the SAME `hosts/{id}/analytics/{day}`
 * documents this route increments (the invariant the bandwidth ceiling above
 * is built on: one set of counters, so the ceiling and the invoice can never
 * disagree), that false count does not stop at the dashboard. It reaches an
 * invoice. Billing a customer for views of a site we switched off is a defect
 * on any reading of the product.
 *
 * ## `read-only` — the COUNTERS keep counting.
 *
 * Read-only exists so the customer's site "stays up and earning" while we
 * repair something (AGL-1511; `tenant-write-lockdown.ts` says it in those
 * words). If the site is serving, we are paying the egress for it — and these
 * counters are not a private analytics nicety, they are the meter: the free
 * plan's bandwidth band (AGL-2413) and the abuse ceiling (AGL-2155) are both
 * computed from `total` on these very documents, by the code directly above.
 *
 * So freezing them does not buy a quiet migration. It buys a window in which
 * a site serves traffic that is **unmetered, unbilled and outside the abuse
 * ceiling** — and `billing` and `security` are two of the four reasons a lock
 * is armed for. A read-only lock must not be a way to serve for free, and a
 * containment control that switches off the containment meter is the wrong
 * shape. The counter is the record that we served; the mode says we chose to
 * keep serving. Those cannot disagree.
 *
 * The freeze case is real and is not dismissed: these counters are exactly
 * the shape a counter reconciliation repairs. But `FieldValue.increment` is
 * commutative — a repair that cannot tolerate concurrent increments needs the
 * site off the air, which is what `full` is for, and `full` now freezes this.
 * "Read-only, plus stop the meter" is not a mode we offer, and it should not
 * be one this route invents for itself.
 *
 * ## `read-only` — the HOST EVENT does not fire. This half was a defect.
 *
 * The last line of the handler is `emitHostEvent(hostId, 'pageView')`, and
 * that is not telemetry at all. It fans out to the workflow and action
 * runners, whose steps create records, merge values onto contacts,
 * `arrayUnion` people into campaigns, send email and call outbound webhooks
 * (`libs/tenant/runtime/src/lib/run-event-actions.ts`). Those are customer
 * content writes and outbound messages, triggered by an anonymous visitor.
 *
 * Every sibling visitor write on this runtime already refuses under read-only
 * through `visitorWriteRefusal` — forms, cart, checkout, reviews, newsletter,
 * membership, bookings — and each of those refuses *before* it emits its own
 * host event. This one evaded that gate only because it rides inside a route
 * named "analytics". It is the same class of write, so it gets the same
 * answer, and a migration or repair now genuinely has nothing racing it
 * except a commutative counter.
 *
 * ## Still open for Zach, and cheap to change
 *
 * If the intended reading of read-only is "the meter stops too", this is one
 * line: return `'all'` for read-only instead of `'automations'`. The tests in
 * `analytics-collect.spec.ts` assert the split explicitly in both directions,
 * so that flip is a deliberate act with red tests attached, not a drift.
 */
function freezeForMode(state: unknown): BeaconFreeze {
  // `lockdownMode` applies the absent-means-`full` fail-safe, so a carrier
  // document written before the field existed freezes everything.
  return Aglyn.lockdownMode(state as never) === 'full' ? 'all' : 'automations'
}

/**
 * Per-instance memo of the freeze verdict, because this is the platform's
 * highest-volume endpoint and `getSiteLockdown` is three reads.
 *
 * Sixty seconds, deliberately NOT the hour `hostExistence` uses: existence is
 * a fact that effectively never flips back, whereas a lockdown is an incident
 * control whose entire value is engaging promptly. A minute bounds the cost
 * at one verdict per host per instance per minute — negligible beside the
 * per-view read the bandwidth ceiling above spends 0.155 of and agonises
 * over — while bounding the lag at a minute, comfortably inside the 30 s the
 * middleware's own verdict memo already accepts on the page path.
 *
 * Size-capped and cleared wholesale like every other attacker-keyed map in
 * this file; `hostExists` has already refused unknown hosts by the time
 * anything reaches here, so the keys are real host ids.
 */
const lockdownFreeze = new Map<string, { freeze: BeaconFreeze; at: number }>()
const LOCKDOWN_FREEZE_TTL_MS = 60_000

/**
 * How much of this beacon the active lock freezes.
 *
 * Fails OPEN, like every other lockdown reader: `getSiteLockdown` swallows
 * its own errors and answers null, and an unreachable Firestore is an outage,
 * not a lockdown. Losing a page view to a freeze that never happened is the
 * cheap direction; refusing every beacon on the platform because one read
 * timed out is not.
 */
async function beaconFreeze(hostId: string): Promise<BeaconFreeze> {
  const now = Date.now()
  const hit = lockdownFreeze.get(hostId)
  if (hit && now - hit.at < LOCKDOWN_FREEZE_TTL_MS) return hit.freeze
  if (lockdownFreeze.size > MAX_TRACKED_HOSTS) lockdownFreeze.clear()
  let freeze: BeaconFreeze
  try {
    const state = await getSiteLockdown(hostId, now)
    freeze = state ? freezeForMode(state) : 'none'
  } catch (error) {
    // Belt and braces. `getSiteLockdown` already answers null rather than
    // throwing, but this gate sits in front of EVERY write on the platform's
    // busiest endpoint, and the cost of being wrong about that contract is
    // dropping every beacon on the fleet. Caught here rather than left to the
    // route's outer try/catch, which would abandon the pageview as well.
    console.error('[analytics] lockdown verdict failed', hostId, error)
    freeze = 'none'
  }
  lockdownFreeze.set(hostId, { freeze, at: now })
  return freeze
}

// ---------------------------------------------------------------------------
// UTM capture (AGL-1844)
// ---------------------------------------------------------------------------

/**
 * The three campaign-attribution params the beacon reports. Deliberately not
 * `utm_term`/`utm_content`: keyword- and variant-level labels multiply
 * cardinality for detail the console has no surface for, and terms are the
 * one UTM field that routinely carries user-typed search strings.
 */
const UTM_PARAMS = ['source', 'medium', 'campaign'] as const

/**
 * Values are opaque components: clamped, Firestore-hostile characters
 * stripped (same rule as `pathKey`/referrer hosts), never parsed or echoed.
 */
const utmKey = (value: unknown): string =>
  String(value ?? '').slice(0, 80).replace(/[.$#[\]/]/g, '_')

/**
 * Distinct-value cap, per (host x day x param) — the CSP collector's
 * distinct-origin cap (AGL-1799) restated for a map whose key space the
 * VISITOR'S URL chooses: without it, a crawler cycling `?utm_source=<junk>`
 * grows the day doc without bound. Known values keep counting; new values
 * beyond the cap are dropped (the pageview itself is never dropped). Per
 * instance like every limiter on this route — fleet-wide worst case is
 * (instances x cap), bounded and small.
 */
const UTM_MAX_DISTINCT_PER_DAY = 50
const utmMinted = new Map<string, Set<string>>()
const MAX_TRACKED_UTM_GROUPS = 512

function utmAdmitted(
  hostId: string,
  day: string,
  param: string,
  value: string,
): boolean {
  if (utmMinted.size > MAX_TRACKED_UTM_GROUPS) utmMinted.clear()
  const groupKey = `${hostId}|${day}|${param}`
  let minted = utmMinted.get(groupKey)
  if (!minted) {
    minted = new Set()
    utmMinted.set(groupKey, minted)
  }
  if (minted.has(value)) return true
  if (minted.size >= UTM_MAX_DISTINCT_PER_DAY) return false
  minted.add(value)
  return true
}

/**
 * The `utm` merge fragment for the day doc, or null when the beacon carried
 * no attribution. Host-level only, deliberately — mirroring it onto every
 * screen day doc would multiply the capped cardinality by the screen count
 * for a breakdown no surface asks for.
 */
function utmFragment(
  body: Record<string, any>,
  hostId: string,
  day: string,
): Record<string, Record<string, FieldValue>> | null {
  const fragment: Record<string, Record<string, FieldValue>> = {}
  for (const param of UTM_PARAMS) {
    const key = utmKey(
      body[`utm${param[0].toUpperCase()}${param.slice(1)}`],
    )
    if (!key) continue
    if (!utmAdmitted(hostId, day, param, key)) continue
    fragment[param] = { [key]: FieldValue.increment(1) }
  }
  return Object.keys(fragment).length ? fragment : null
}

// ---------------------------------------------------------------------------
// Bandwidth abuse ceiling (AGL-2155)
// ---------------------------------------------------------------------------

/**
 * THE ONLY PLACE A PAGE VIEW IS EVER COUNTED, AND THEREFORE THE ONLY PLACE
 * THE CEILING CAN BE EVALUATED WITHOUT COSTING THE RENDER ANYTHING.
 *
 * The hole (`free-tier-never-billed.spec.ts` names it in its own table):
 * every other free dimension had a runtime brace and bandwidth had none, so a
 * viral free site served a million views — ~$100 of real COGS at
 * `METERED_UNIT_RATES_USD.perPageView` — with no wall, no throttle and no
 * alert. Free never got *billed* for it, which was the point of the
 * structural zero; it also never got *stopped*, which was the hole.
 *
 * Three things had to be true at once, and this is the arrangement that makes
 * them true:
 *
 * 1. **No Firestore read in the render path.** The counter is written HERE,
 *    after the render, so the ceiling is evaluated here too. Crossing it
 *    stamps `hosts/{id}.bandwidthCeiling`, and the render path reads that
 *    field off a host document it already loads for the lockdown branch
 *    (`load-page-data.ts` → `hostRes.host`). Zero extra reads on the happy
 *    path — verified by reading that loader, not assumed.
 * 2. **No extra write, and no second counter, on the beacon.** The month sum
 *    is taken over the SAME `analytics/{day}` documents
 *    `/api/billing/report-usage` meters, with the same query, so the ceiling
 *    and the invoice can never disagree about how much traffic a site served.
 *    A dedicated `counters/pageViews` document was the obvious alternative
 *    and was rejected: it is +1 write on the platform's highest-volume
 *    endpoint (a 50% increase), and it would be a second, divergent truth
 *    about the same number.
 * 3. **Bounded cost.** Sampled per host per instance — the first beacon an
 *    instance sees for a host, then every {@link BANDWIDTH_SAMPLE_EVERY}th.
 *    ~31 reads per 200 views ≈ 0.155 reads/view ≈ $4.7e-8/view, against the
 *    $1e-4/view this is containing. A cold instance under a spike evaluates
 *    immediately, which is exactly when it matters.
 *
 * The slop is real and deliberate: the ceiling can be crossed by up to
 * (SAMPLE × instances) views before it trips. An abuse ceiling is containment,
 * not a quota — being late by a few hundred views on a ceiling of 100,000 is
 * not a failure mode, and paying a read per view to remove it would cost more
 * than the traffic does.
 */
const BANDWIDTH_SAMPLE_EVERY = 200
const bandwidthSeen = new Map<string, number>()
const MAX_TRACKED_BANDWIDTH_HOSTS = 5_000

/**
 * Per-instance memo of hosts already tripped THIS month, so a contained site
 * still receiving beacons from cached pages does not re-run the month query
 * (and re-notify) on every sample. Keyed by month, so it releases itself at
 * the boundary like the flag it mirrors.
 */
const bandwidthTripped = new Map<string, string>()

/**
 * The same memo for the PLAN CAP (AGL-2413), kept separate from the ceiling's
 * on purpose. The two settle at wildly different traffic — free's band is
 * ~8,700 views and its abuse ceiling is 100,000 — so one shared flag would let
 * whichever settled first suppress the evaluation of the other.
 */
const bandwidthCapMemo = new Map<string, string>()

/** True on the instance's first beacon for a host, then every Nth. */
function bandwidthSampleDue(hostId: string): boolean {
  if (bandwidthSeen.size > MAX_TRACKED_BANDWIDTH_HOSTS) bandwidthSeen.clear()
  const seen = bandwidthSeen.get(hostId) ?? 0
  bandwidthSeen.set(hostId, seen + 1)
  return seen % BANDWIDTH_SAMPLE_EVERY === 0
}

/**
 * Engage the free plan's bandwidth cap for this org, if this month's traffic
 * has passed its band (AGL-2413).
 *
 * The SECOND writer of `orgs/{id}.bandwidthCap`, alongside the daily
 * `api/billing/usage-alerts` sweep, and deliberately identical to it in every
 * observable way: the same `bandwidthCapShouldEngage` predicate (the writer's
 * half of `bandwidthCapEngaged`, kept beside the reader so the two cannot
 * drift), the same marker fields, the same UTC month key, the same
 * engage-once-per-month guard, and the same `{ merge: true }` write. A reader
 * cannot tell which writer stamped a marker, and must not be able to.
 *
 * ## It needs no `plan` field, which is the entire point
 *
 * `resolveEffectivePlan` answers `'free'` for an org with no `plan`, an
 * unknown plan, or a dead subscription — so `bandwidthCapShouldEngage` already
 * treated a never-subscribed org correctly. It was never asked. This asks it.
 *
 * ## Own try/catch
 *
 * So a failure here cannot cost the abuse ceiling its evaluation, and vice
 * versa. Both are best-effort bookkeeping on a beacon that always 204s.
 */
async function engageFreePlanBandwidthCap(options: {
  hostId: string
  orgId: string
  org: Record<string, unknown> | null
  pageViews: number
}): Promise<void> {
  const { hostId, orgId, org, pageViews } = options
  const month = Aglyn.bandwidthCapMonthKey()
  if (bandwidthCapMemo.get(hostId) === month) return
  try {
    const entitlements = Aglyn.resolveOrgEntitlements(org as never)
    if (
      !Aglyn.bandwidthCapShouldEngage({
        org: org as never,
        usedBandwidthGb: Aglyn.bandwidthGbFromPageViews(pageViews),
        includedBandwidthGb: entitlements.bandwidthGb,
      })
    ) {
      return
    }
    // Memoized on the ENGAGE decision, not on the write, and only once the
    // band is actually crossed — an org still inside its band must keep being
    // evaluated on every sample or the cap would only ever fire on the one
    // beacon that happened to straddle the boundary.
    if (bandwidthCapMemo.size > MAX_TRACKED_BANDWIDTH_HOSTS) {
      bandwidthCapMemo.clear()
    }
    bandwidthCapMemo.set(hostId, month)
    // Already engaged this month, by either writer. Nothing to do and nothing
    // to re-notify: the marker names its month, so the sweep's own guard and
    // this one are the same guard reading the same field.
    const existing = org?.['bandwidthCap'] as { month?: string } | undefined
    if (existing?.month === month) return
    await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .set(
        {
          // Byte-identical to what `usage-alerts` writes. `merge: true`
          // because this is one field on a document that carries `plan`,
          // `subscription`, `entitlements` and `hosts` — a non-merging `set`
          // here would delete the org.
          bandwidthCap: {
            month,
            engagedAt: Date.now(),
            pageViews: Math.round(pageViews),
            includedPageViews: Math.round(
              Aglyn.pageViewsFromBandwidthGb(entitlements.bandwidthGb),
            ),
          },
        },
        { merge: true },
      )
    // The owner has to hear it from us. The sweep pairs its cap with a 100%
    // bandwidth alert email — but the sweep is exactly what never ran for
    // these orgs, so without this the first a never-subscribed owner would
    // know of their site being paused is a visitor telling them.
    await notifyHostManagers(hostId, {
      type: 'system.bandwidthCapEngaged',
      title: 'Site paused — monthly traffic limit reached',
      body: `This site has used the ${Math.round(
        Aglyn.pageViewsFromBandwidthGb(entitlements.bandwidthGb),
      ).toLocaleString()} page views included with the free plan this month, so it is serving a temporary notice until the start of next month. Upgrade in Billing to bring it straight back.`,
      link: `/${hostId}`,
    })
  } catch (error) {
    console.error('bandwidth cap evaluation failed', error)
  }
}

/**
 * Sum the month once, then ask BOTH bandwidth questions of it (AGL-2413).
 *
 * 1. the free plan's **band** — `bandwidthCapShouldEngage`, ~8,700 views; and
 * 2. the **abuse ceiling** — 10x the band, floor 100,000 views.
 *
 * ## Why the plan cap moved here (AGL-2413)
 *
 * The cap's marker (`orgs/{id}.bandwidthCap`) had exactly ONE writer: the
 * daily `api/billing/usage-alerts` sweep. That sweep skips every org with no
 * `plan` field — a guard written for *alerting*, which the cap block inherited
 * ~650 lines further down the same loop body — and `createOrganization` writes
 * no `plan`. So the cap had never engaged for a single never-subscribed org:
 * the entire organic free tier.
 *
 * ZACH's fix, and the reason it is here rather than in the sweep's skip
 * condition: **a cap that lives only in a scheduled sweep stops existing the
 * moment the sweep does not run, is skipped, or errors.** Every other free
 * dimension — media ingress, form submissions, contacts, datasets, API
 * requests — refuses at the point of use. Bandwidth now does too. The sweep
 * keeps its writer; this is a second, independent one that needs no cron, no
 * `plan` field and no backfill, and the month guard on the marker means
 * whichever runs first simply wins.
 *
 * ## Why this is the right chokepoint, and why it costs nothing
 *
 * `bandwidth-cap.ts` argues at length against reading the page-view counter in
 * the RENDER path, and that argument still holds — it would put a Firestore
 * read on the hot path of every public page on the platform to answer a
 * question only free orgs can fail. This is not the render path. It is the
 * beacon that WRITES the counter, already sampled 1-in-200, and it already
 * sums exactly this month with exactly this query and already loads exactly
 * this org doc for the ceiling. The plan cap therefore adds **zero reads** —
 * only a write, and only on the beacon that engages it.
 *
 * ## Per-host sum vs the org-wide band
 *
 * The band is org-wide and this sums ONE host. That is exact for every org the
 * cap can apply to: `PLAN_ENTITLEMENTS.free.hostLimit` is 1, and every plan
 * that allows a second site meters its infra overage, which
 * `bandwidthCapShouldEngage` refuses first. An org carrying an `entitlements`
 * override that raises `hostLimit` while leaving it on free is the one shape
 * this under-counts, and it under-counts in the safe direction: a per-host sum
 * is never larger than the org's, so this can be LATE but can never refuse a
 * site that is inside its band. The sweep remains the org-wide backstop.
 *
 * Best-effort throughout, and it must stay that way: this runs after the
 * pageview has already been recorded, on a fire-and-forget beacon that always
 * 204s. A bookkeeping failure here must never cost the customer their
 * analytics.
 */
async function evaluateBandwidthLimits(hostId: string): Promise<void> {
  const month = Aglyn.bandwidthCeilingMonthKey()
  const capMonth = Aglyn.bandwidthCapMonthKey()
  // Both, not either: a host whose ceiling tripped must still be evaluated for
  // the cap, and vice versa. Deriving this from one flag was the shape of the
  // bug this whole change exists to close.
  if (
    bandwidthTripped.get(hostId) === month &&
    bandwidthCapMemo.get(hostId) === capMonth
  ) {
    return
  }
  try {
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
    // The SAME query `report-usage`'s `hostUsage` runs. Deliberately not a
    // differently-derived month key or range: a ceiling that counted
    // differently from the invoice would refuse traffic nobody was ever
    // charged for, or miss traffic that was.
    const [days, orgForHost] = await Promise.all([
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
      getOrgForHost(hostId),
    ])
    const pageViews = days.docs.reduce(
      (sum, day) => sum + Number(day.get('total') ?? 0),
      0,
    )
    const org = orgForHost?.org ?? null
    // THE PLAN BAND FIRST (AGL-2413), because it is the lower of the two by an
    // order of magnitude — free's band is ~8,700 views against a 100,000-view
    // ceiling — so a host that reaches the ceiling has always crossed the band
    // first, and evaluating the ceiling first would let its `return` below
    // suppress the cap forever on a site that is already past it.
    if (orgForHost) {
      await engageFreePlanBandwidthCap({
        hostId,
        orgId: orgForHost.orgId,
        org,
        pageViews,
      })
    }
    const ceiling = Aglyn.checkBandwidthAbuseCeiling(org as any, pageViews)
    if (!ceiling.exceeded) return
    bandwidthTripped.set(hostId, month)
    // Whether the trip DEGRADES what visitors see is decided once, here, and
    // stored — not re-derived at render time. A host that upgrades mid-month
    // must not keep being degraded by a flag written while it was free.
    const degraded = Aglyn.bandwidthCeilingDegradesRender(org as any)
    await hostRef.set(
      {
        bandwidthCeiling: {
          month,
          ceiling: ceiling.ceiling,
          used: ceiling.used,
          trippedAtMs: Date.now(),
          degraded,
        },
      },
      { merge: true },
    )
    // Staff first: this is an incident, not a quota (AGL-1655's distinction,
    // applied to the other meter). The existing detection — the 10x
    // month-over-month spike flag on /api/admin/overview — has a month of
    // latency and no action attached; this is the same signal at beacon
    // latency with containment already applied.
    await notifyStaff({
      type: 'system.bandwidthCeilingTripped',
      title: `Bandwidth ceiling tripped — ${hostId}`,
      body: `${hostId} served ${ceiling.used.toLocaleString()} page views in ${month}, past its ${ceiling.ceiling.toLocaleString()} ceiling. ${
        degraded
          ? 'The site is now serving the capped notice.'
          : 'The plan meters the overage, so the site keeps serving and the traffic bills.'
      }`,
      link: `/admin/hosts`,
    })
    await notifyHostManagers(hostId, {
      type: 'system.bandwidthCeilingTripped',
      title: degraded
        ? 'Site paused — traffic past the free plan'
        : 'Unusual traffic on this site',
      body: degraded
        ? `This site served ${ceiling.used.toLocaleString()} page views this month, past the ${ceiling.ceiling.toLocaleString()} the free plan allows. It is serving a temporary notice until next month. Upgrade to bring it straight back.`
        : `This site served ${ceiling.used.toLocaleString()} page views this month, well past its plan's included bandwidth. It is still serving normally and the overage bills as usual — contact support if this is not real traffic.`,
      link: `/${hostId}`,
    })
  } catch (error) {
    console.error('bandwidth ceiling evaluation failed', error)
  }
}

/**
 * Privacy-friendly pageview collector (AGL-82): no cookies, no user ids —
 * one increment per view into a per-day counter doc the console dashboard
 * (and later the AGL-41 metering pipeline) reads. Fire-and-forget from a
 * sendBeacon, so errors just 204.
 */
export async function POST(request: Request): Promise<Response> {
  const ip = String(request.headers.get('x-forwarded-for') ?? 'unknown')
    .split(',')[0]
    .trim()
  if (rateLimited(ip)) return noContent()
  try {
    const raw = await request.text()
    const body = raw ? (JSON.parse(raw) as Record<string, any>) : {}
    const hostId = String(body.hostId ?? '')
    const path = String(body.path ?? '/')
    const screenId = String(body.screenId ?? '')
    if (!HOST_ID_PATTERN.test(hostId) || RESERVED_ID_PATTERN.test(hostId)) {
      return noContent()
    }
    // The spoof gate (AGL-1844): before ANY write on either branch, and
    // before emitHostEvent — an invented hostId must not mint counter docs
    // or fire host automations (AGL-510's open half).
    if (!(await hostExists(hostId))) return noContent()

    // The lockdown gate (AGL-1627), beside the spoof gate because it answers
    // the same question — may this beacon mint counters at all — and has to
    // hold for BOTH branches below, not just the pageview one. Refuses
    // SILENTLY, with the same 204 every other path returns: nothing renders
    // this response, so a 423 would buy a visitor's browser a retry and tell
    // nobody anything.
    //
    // `=== 'all'` rather than a truthiness test on purpose: `strictNullChecks`
    // is off repo-wide, so an absent verdict must fall to the OPEN side by
    // construction rather than by luck.
    const freeze = await beaconFreeze(hostId)
    if (freeze === 'all') return noContent()

    // Overlay events (AGL-200): impressions/dismissals/clicks for the
    // announcement bar and popup count into the same day doc under an
    // `overlays` map — they are NOT pageviews, so return early.
    const overlay = String(body.overlay ?? '')
    if (overlay) {
      const OVERLAY_EVENTS = [
        'barImpression',
        'popupImpression',
        'popupDismiss',
        'popupClick',
        'barClick',
        'barDismiss',
      ]
      if (OVERLAY_EVENTS.includes(overlay)) {
        const day = new Date().toISOString().slice(0, 10)
        await firebaseAdmin
          .app()
          .firestore()
          .collection('hosts')
          .doc(hostId)
          .collection('analytics')
          .doc(day)
          .set(
            {
              overlays: { [overlay]: FieldValue.increment(1) },
              // Retention (AGL-1844): a day doc created by overlay events
              // alone must still carry its expiry stamp.
              expiresAt: analyticsDayExpiresAt(day),
            },
            { merge: true },
          )
        // Per-overlay attribution (AGL-271): marketing-hub overlay docs
        // carry their own lifetime counters so the console can show
        // engagement per bar/popup, not just the host-wide totals.
        const overlayId = String(body.overlayId ?? '')
        if (overlayId && overlayId.length <= 64) {
          const statKey = overlay.endsWith('Impression')
            ? 'impressions'
            : overlay.endsWith('Click')
              ? 'clicks'
              : 'dismissals'
          // update(), not set(): beacons from stale cached pages must not
          // resurrect a deleted overlay as a stats-only stray doc.
          await firebaseAdmin
            .app()
            .firestore()
            .collection('hosts')
            .doc(hostId)
            .collection('overlays')
            .doc(overlayId)
            .update({ [`stats.${statKey}`]: FieldValue.increment(1) })
            .catch(() => undefined)
        }
      }
      return noContent()
    }

    /*
     * Dwell time (AGL-2182). `/product/analytics`'s per-screen mockup
     * shows `Avg. time 2m 04s / on this screen`, and nothing in the
     * pipeline recorded duration of any kind — the metric was not
     * under-reported, it was unmeasurable.
     *
     * Its own beacon, sent on `pagehide`, and its own early return: it is
     * NOT a pageview, and folding it into the one above would double every
     * count on every visit.
     *
     * Only ever a SUM and a SAMPLE COUNT. Storing per-visit durations
     * would make the day doc unbounded and turn a coarse engagement
     * measure into a behavioural record; two integers answer the question
     * the mockup asks and nothing finer.
     */
    const dwellMs = Number(body.dwellMs ?? 0)
    if (dwellMs > 0) {
      // A dwell without a screen has nowhere to go — the host-wide day doc
      // has no time dimension and the console reads this per screen.
      if (!screenId || screenId.length > 64) return noContent()
      // Clamped both ends. Under a second is a bounce or a prefetch and
      // says nothing; over half an hour is a tab left open, and one of
      // those would drag a screen's average past every real reading.
      // Clamped rather than dropped: a long visit IS a visit, and
      // discarding it would bias the mean downward on exactly the screens
      // people read.
      const bounded = Math.min(Math.max(Math.round(dwellMs), 0), 30 * 60_000)
      if (bounded < 1000) return noContent()
      await firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('screenAnalytics')
        .doc(`${screenId}:${new Date().toISOString().slice(0, 10)}`)
        .set(
          {
            screenId,
            day: new Date().toISOString().slice(0, 10),
            dwellMs: FieldValue.increment(bounded),
            dwellSamples: FieldValue.increment(1),
            expiresAt: analyticsDayExpiresAt(
              new Date().toISOString().slice(0, 10),
            ),
          },
          { merge: true },
        )
      return noContent()
    }

    // Referrer host (AGL-138): external sources only — same-host and
    // unparsable referrers are dropped.
    let referrerHost = ''
    try {
      const referrer = String(body.referrer ?? '')
      if (referrer) {
        const referrerUrl = new URL(referrer)
        const requestHost = String(request.headers.get('host') ?? '')
        if (referrerUrl.host && referrerUrl.host !== requestHost) {
          referrerHost = referrerUrl.host.slice(0, 100).replace(/[.$#[\]]/g, '_')
        }
      }
    } catch {
      // Ignore junk referrers.
    }
    // Coarse device class from the UA (AGL-138) — no fingerprinting.
    const userAgent = String(request.headers.get('user-agent') ?? '')
    const device = /ipad|tablet/i.test(userAgent)
      ? 'tablet'
      : /mobi|android|iphone/i.test(userAgent)
        ? 'mobile'
        : 'desktop'

    const day = new Date().toISOString().slice(0, 10)
    // Campaign attribution (AGL-1844): utm_source/medium/campaign, reported
    // by the beacon from the landing URL's query string. Query params, not
    // cookies — nothing here identifies a visitor.
    const utm = utmFragment(body, hostId, day)
    await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('analytics')
      .doc(day)
      .set(
        {
          total: FieldValue.increment(1),
          paths: { [pathKey(path)]: FieldValue.increment(1) },
          devices: { [device]: FieldValue.increment(1) },
          ...(referrerHost && {
            referrers: { [referrerHost]: FieldValue.increment(1) },
          }),
          ...(utm && { utm }),
          // Visitor approximation (AGL-1844): the client claims "first
          // pageview this tab has sent today" via a day-scoped
          // sessionStorage flag (see `visit-claim.ts` for exactly what
          // `visitors` does and does not mean — one count per tab per UTC
          // day, no identifier anywhere). Strict boolean: this is a client
          // claim on an unauthenticated endpoint, bounded by the same
          // rate limit as the pageview itself.
          ...(body.newVisit === true && {
            visitors: FieldValue.increment(1),
          }),
          // Retention (AGL-1844): every writer of a day doc stamps the same
          // day-anchored expiry; the TTL policy on `expiresAt` sweeps it.
          expiresAt: analyticsDayExpiresAt(day),
        },
        { merge: true },
      )
    // Per-screen attribution (AGL-151): same day-doc shape, one doc per
    // screen per day. Always collected; DISPLAY is what the paid
    // `screenAnalytics` flag gates (AGL-150 decision) — keeps the beacon
    // cheap and the history ready the moment a tenant upgrades.
    if (screenId && screenId.length <= 64) {
      await firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('screenAnalytics')
        .doc(`${screenId}:${day}`)
        .set(
          {
            screenId,
            day,
            total: FieldValue.increment(1),
            devices: { [device]: FieldValue.increment(1) },
            ...(referrerHost && {
              referrers: { [referrerHost]: FieldValue.increment(1) },
            }),
            expiresAt: analyticsDayExpiresAt(day),
          },
          { merge: true },
        )
    }
    // Bandwidth limits — the free plan's BAND (AGL-2413) and the abuse
    // ceiling (AGL-2155). AFTER the counter write, so the view being
    // evaluated is included, and awaited only on the sampled beacon —
    // 1-in-200 pays ~31 reads, the other 199 pay nothing. Never before the
    // write: a limit evaluated on a stale count would refuse a view it had
    // not yet counted.
    if (bandwidthSampleDue(hostId)) {
      await evaluateBandwidthLimits(hostId)
    }
    // Event trigger (AGL-128/148): fire-and-forget — never delays the
    // beacon; alerts have no response channel here and are dropped.
    //
    // NOT under a read-only lock (AGL-1627). This is where the beacon stops
    // being telemetry: the runners behind it create records, merge values
    // onto contacts, add people to campaigns, send email and call webhooks.
    // Those are visitor-triggered customer-content writes, which is exactly
    // what read-only freezes everywhere else on this runtime. `!== 'auto…'`
    // rather than `=== 'none'` so an absent verdict emits — the same
    // fail-open direction as the gate above.
    if (freeze !== 'automations') void emitHostEvent(hostId, 'pageView', { path })
  } catch (error) {
    console.error(error)
  }
  return noContent()
}
