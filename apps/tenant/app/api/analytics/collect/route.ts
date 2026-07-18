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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
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
// from a spoofed hostId. Instances are ephemeral, so this only blunts spikes.
const recentByIp = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentByIp.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  hits.push(now)
  recentByIp.set(ip, hits)
  return hits.length > RATE_MAX
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
    if (!hostId || hostId.length > 64) return noContent()

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
            { overlays: { [overlay]: FieldValue.increment(1) } },
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
