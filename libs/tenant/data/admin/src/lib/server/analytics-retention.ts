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

/**
 * Retention for the AGL-82 analytics day docs (AGL-1844).
 *
 * Day docs accumulated forever: every pageview, media serve and redirect hit
 * left a `{hosts|orgs}/{id}/analytics/{YYYY-MM-DD}` (or
 * `hosts/{id}/screenAnalytics/{screenId}:{day}`) document behind, and
 * nothing ever deleted one. Every WRITER now stamps `expiresAt`, and a
 * Firestore TTL policy on that field (declared as `fieldOverrides` in
 * `cloud/firebase-firestore.indexes.json`, on the `analytics` and
 * `screenAnalytics` collection groups) sweeps the old ones.
 *
 * ## Why 400 days
 *
 * Long enough that every reader's window closes with room to spare:
 *
 * - the console's widest range is 90 days;
 * - /api/billing/report-usage meters `analytics/{day}.total` for the CURRENT
 *   period — an invoice dispute a year later still finds its days;
 * - a year-over-year comparison (no surface does one yet) would still have
 *   both years.
 *
 * Short enough that storage is bounded: ~400 docs per host (plus per-screen
 * and per-org docs) at steady state, instead of unbounded growth.
 *
 * ## Why TTL and NOT monthly rollups (the AGL-1844 decision)
 *
 * Rollups were considered and deliberately not built: no console surface
 * reads more than 90 dailies (bounded, and blunted by the AGL-1440 cache),
 * so a monthly doc would be written by a scheduled job — new moving part,
 * new failure mode — to serve a view nothing renders. If a >90-day console
 * range ever ships, rollups become that feature's first commit.
 *
 * TTL deletion is Firestore's own sweeper: typically within 24h of expiry,
 * no code of ours runs. Docs written BEFORE this shipped carry no
 * `expiresAt` and are never swept — the trickle of writes to a live site
 * stamps its recent days naturally, and old unstamped days are exactly the
 * ones nothing reads.
 */

/** See the module doc for why 400. */
export const ANALYTICS_DAY_RETENTION_DAYS = 400

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When the day doc named `day` (YYYY-MM-DD, UTC) may be swept. Anchored on
 * the day itself, not the write clock, so every write to one doc agrees on
 * one expiry. An unparsable day anchors on "now", which only ever shortens
 * retention.
 */
export function analyticsDayExpiresAt(day: string): Date {
  const dayStart = Date.parse(`${day}T00:00:00Z`)
  const base = Number.isFinite(dayStart) ? dayStart : Date.now()
  return new Date(base + ANALYTICS_DAY_RETENTION_DAYS * DAY_MS)
}
