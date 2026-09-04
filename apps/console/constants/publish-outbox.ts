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
 * THE PUBLISH OUTBOX (AGL-2575) — the shape both sides agree on.
 *
 * Publishing a screen is a CLIENT Firestore write: the editor registers the
 * path in `hosts/{hostId}.screens` and moves the version pointer from the
 * browser. There is therefore no server operation the cache-drop announce can
 * hang off, and AGL-2573 left it as a `fetch` fired from the same tab. That
 * announce retries a refusing tenant under an 8s budget — but a budget only
 * runs while the tab does. Close it, sleep the laptop, lose the network, and
 * the durable half of the publish has landed while the announce has landed
 * nowhere, leaving the live page serving its old HTML until
 * `PUBLISHED_SITE_DATA_TTL_SECONDS` (3600) lapses.
 *
 * An entry here is that announce, written down. It rides the SAME client
 * batch as the routing-map write, so it cannot be lost independently of the
 * publish it describes: either both documents land or neither does. A
 * scheduled console drain then fires the announce server-side, across process
 * boundaries, for as long as it takes.
 *
 * ## Why absence is the thing being designed out
 *
 * AGL-2573's finding was that a successful announce logged nothing, so six
 * hours of empty logs read identically to six hours of publishes that all
 * worked — which is how an eleven-day outage went unnoticed. A pending entry
 * is the opposite shape: an announce that has not happened is a DOCUMENT
 * somebody can query, count and age, not a line that is missing from a log.
 *
 * ## A TOP-LEVEL collection, deliberately
 *
 * `hosts/{hostId}/publishOutbox/{id}` would read better and would let the
 * rules bind the host from the path. It would also make the drain a
 * collection-group query, and Firestore's automatic single-field indexes are
 * COLLECTION scope only — a collection group gets no free ride however simple
 * the filter, which is exactly how `/admin/revenue` came to answer
 * FAILED_PRECONDITION on every request forever (AGL-2486). A top-level
 * collection ordered by `createdAt` needs no declared index at all, and index
 * deployment is a separately-credentialed step this must not depend on. The
 * host is carried as a FIELD instead, and the rules check it there.
 *
 * Pure data and pure functions: no Firestore handle, no clock, no fetch.
 * Imported by the browser publish seam, by the drain route, and by the specs.
 */

/** The top-level collection. See above for why it is not a subcollection. */
export const PUBLISH_OUTBOX_COLLECTION = 'publishOutbox'

/**
 * The tenant's own `MAX_PATHS`. Sending more would be dropped there anyway,
 * and the rules enforce the same ceiling so a client cannot make the drain
 * assemble an unbounded body.
 */
export const PUBLISH_OUTBOX_MAX_PATHS = 250

/**
 * How long an entry is left alone before the drain touches it.
 *
 * The tab's own announce is the fast path and it is the one that should
 * normally win: it fires immediately, and on success the tab deletes its own
 * entry. Draining an entry that is seconds old would double the tenant
 * traffic of every ordinary publish to buy nothing, since the announce it
 * would duplicate is still in flight. A minute is longer than the 8s budget
 * that announce runs under plus any plausible round trip.
 */
export const PUBLISH_OUTBOX_SETTLE_MS = 60_000

/** Entries examined per run. A ceiling on time and on tenant round trips. */
export const PUBLISH_OUTBOX_DRAIN_LIMIT = 200

/**
 * Attempts before the drain stops spending tenant calls on an entry.
 *
 * At the fifteen-minute sweep this is about two hours of trying. The entry is
 * KEPT rather than deleted once it is reached: the record is the only
 * evidence that a publish never reached the live site, and deleting it would
 * restore the absence-of-evidence shape this exists to remove. It stops being
 * retried, and starts being counted as stalled.
 */
export const PUBLISH_OUTBOX_MAX_ATTEMPTS = 8

/**
 * How old a still-pending entry has to be before it is a SIGNAL rather than
 * an entry in flight.
 *
 * Two sweeps. Below it, a pending entry is ordinary — the tab went away and
 * the next run will pick it up. Above it, something is refusing, and the
 * count is what says so.
 */
export const PUBLISH_OUTBOX_STALE_MS = 30 * 60_000

/** The telemetry tag every drain run emits, success or not. */
export const PUBLISH_OUTBOX_DRAIN_TAG = 'AGL-2575:publish-outbox-drain'

/**
 * One stranded announce.
 *
 * `paths` rather than a `screenId`, for the reason AGL-2573 gave the seam
 * that writes it: an unpublish removes the routing entry FIRST, so by the
 * time anything resolves a screen id the address that needs dropping exists
 * nowhere. The surface that changed the map read the old address before
 * overwriting it, and writes it down here.
 */
export interface PublishOutboxEntry {
  hostId: string
  /** Site-absolute URL paths (`/`, `/pricing`), as `screenRoutePathToUrl` yields. */
  paths: string[]
  /** Server timestamp. The rules pin it to `request.time`, so it cannot be backdated. */
  createdAt: unknown
  /** Drain attempts spent so far. Written 0 by the client; only the drain raises it. */
  attempts: number
}

/**
 * THE FIELD SET, exactly.
 *
 * The rules pin the document to these four keys and nothing else, so a client
 * cannot smuggle extra state into a collection the platform later reads back.
 * Kept here so the rule and the writer are one list rather than two.
 */
export const PUBLISH_OUTBOX_FIELDS = [
  'hostId',
  'paths',
  'createdAt',
  'attempts',
] as const

/**
 * The paths an entry may carry, or an empty list when there are none worth
 * writing down.
 *
 * Applied on BOTH sides. The client uses it so the document it writes can
 * satisfy the rules; the drain uses it because an outbox entry is a
 * client-written document and a path read out of one is no more trustworthy
 * than a path posted to `/api/screens/revalidate`, which validates the same
 * three things.
 */
export function sanitizePublishOutboxPaths(paths: readonly unknown[]): string[] {
  return [
    ...new Set(
      paths
        .map((path) => String(path ?? '').trim())
        .filter((path) => path.startsWith('/') && !path.includes('..')),
    ),
  ].slice(0, PUBLISH_OUTBOX_MAX_PATHS)
}

/**
 * Is this entry old enough to be worth a drain attempt?
 *
 * Split out from the route so the settle window is one rule with one test
 * rather than an inline comparison the specs would have to re-derive.
 */
export function isPublishOutboxDue(ageMs: number): boolean {
  return ageMs >= PUBLISH_OUTBOX_SETTLE_MS
}

/** Has this entry spent its attempts? A stalled entry is kept, never retried. */
export function isPublishOutboxStalled(attempts: number): boolean {
  return attempts >= PUBLISH_OUTBOX_MAX_ATTEMPTS
}
