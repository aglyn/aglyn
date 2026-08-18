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

import {
  analyticsDayExpiresAt,
  checkRateLimit,
  firebaseAdmin,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

/** Firestore map keys can't be parsed as field paths on read anyway, but
 * keep them tame: strip characters that complicate querying/exporting. */
const pathKey = (path: string) =>
  (path || '/').slice(0, 200).replace(/[.$#[\]]/g, '_')

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
    // Event trigger (AGL-128/148): fire-and-forget — never delays the
    // beacon; alerts have no response channel here and are dropped.
    void emitHostEvent(hostId, 'pageView', { path })
  } catch (error) {
    console.error(error)
  }
  return noContent()
}
