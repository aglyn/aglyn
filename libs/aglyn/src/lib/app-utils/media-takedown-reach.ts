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
 * WHAT A MEDIA TAKEDOWN ACTUALLY REACHES (AGL-1615).
 *
 * ## The problem this module exists to fix
 *
 * AGL-1615 is only half a code issue. The mechanism behaves exactly as
 * designed — quarantine and lockdown both refuse at the ORIGIN — and the
 * runbook has said so accurately since AGL-1520. What was wrong is what the
 * PRODUCT said. The staff quarantine page told an operator that a takedown
 * "takes ONE uploaded file off the CDN worldwide", full stop, and the abuse
 * triage queue repeated it. A rights-holder given that sentence, or a
 * merchant told their leaked pricing sheet is down, reasonably concludes the
 * file is unreachable. It is not.
 *
 * A takedown that is described as a recall, and is not one, is not a
 * technical shortfall — it is a false assurance handed to someone making a
 * legal or safety decision on the strength of it. That is the part worth
 * fixing, and the fix is precision, not a purge that does not exist.
 *
 * ## What can genuinely be invalidated, and what cannot
 *
 * Costed honestly rather than listed as options:
 *
 * * **The origin.** Yes, ~15 s. The deny list and the lockdown verdict share
 *   one TTL, so a warm process refuses within that of the write. This is the
 *   whole of what the CDN gate does, and it is not nothing.
 * * **The raw Storage URL.** Yes, immediately — by rotating the object's
 *   download token, which is the ONLY lever that works there, because no
 *   code of ours runs on `firebasestorage.googleapis.com`. AGL-1526 built it
 *   for security lockdowns; AGL-1615 wires it to per-asset quarantine, where
 *   the exposure is sharper: a free-tier org, a private asset and every
 *   pre-AGL-829 embed are all delivered from that URL, and for those the CDN
 *   deny list is not merely slow, it is never consulted.
 * * **A Vercel edge purge.** Rejected, and this is the option AGL-1615
 *   floated first. Purge is path-based and the key set is enumerable, but it
 *   would put a credentialled call to a third-party API on the takedown
 *   path — so a Vercel outage becomes a takedown outage unless it fails
 *   soft, and a purge that fails soft is a purge you cannot rely on, which
 *   is the same position as not having one while believing you do. The
 *   window it would close is at most an hour, on IMAGES only, and only
 *   those already edge-cached: non-image types have been `private` since
 *   AGL-1515 and are never edge-held.
 * * **Shortening the image `s-maxage`.** Rejected. AGL-1515 measured that
 *   hit rate as real on the DAM grid's hot path; trading it for a faster
 *   worst case buys an hour in a rare event at a cost paid on every request.
 * * **Bytes already delivered.** No. Not by any mechanism, at any price.
 *   A browser cache, a corporate proxy, a downstream CDN, a scraper's disk,
 *   an archive snapshot — nothing we can build reaches those, and no vendor
 *   sells the ability either. This is the sentence the console was missing.
 *
 * ## Why the numbers live here
 *
 * Copy that quotes a cache window goes stale the moment someone tunes a
 * header, and specific-and-wrong is worse than vague. So the windows are
 * constants here, one place, and `media-takedown-reach.spec.ts` reads the
 * real `Cache-Control` values out of `serve-media-cdn.ts` and fails when
 * they drift apart.
 */

/**
 * How long a warm origin can keep serving after the write.
 *
 * The deny list's TTL and the lockdown verdict's cache TTL, which are
 * deliberately the same 15 s so both levers converge on one clock.
 */
export const MEDIA_TAKEDOWN_ORIGIN_MS = 15_000

/** `max-age` on the stable CDN URL — one browser's worst-case stale read. */
export const MEDIA_TAKEDOWN_BROWSER_STABLE_MS = 60_000

/** `s-maxage` on an image response — the shared edge's worst case. */
export const MEDIA_TAKEDOWN_EDGE_IMAGE_MS = 3_600_000

/** `max-age` on the immutable content-hashed URL: a year, in one browser. */
export const MEDIA_TAKEDOWN_BROWSER_IMMUTABLE_MS = 31_536_000_000

export type MediaTakedownSurface =
  | 'origin'
  | 'browser-stable'
  | 'edge-image'
  | 'raw-url'
  | 'browser-immutable'
  | 'delivered'

export interface MediaTakedownReachEntry {
  surface: MediaTakedownSurface
  /** Does a takedown stop this surface serving at all? */
  stopped: boolean
  /**
   * Worst-case delay before it stops, or `null` when it never does.
   *
   * `null` rather than a very large number on purpose. Writing a year here
   * for the immutable URL would read as "and then it is fine", which is a
   * different and false claim — a copy on a scraper's disk has no expiry at
   * all, and the immutable URL's year is per-client and unbounded in
   * aggregate.
   */
  worstCaseMs: number | null
  /** The sentence an operator reads. Plain, specific, no hedging. */
  statement: string
}

/**
 * Every surface an asset can be delivered from, including the ones a
 * takedown cannot touch.
 *
 * Completeness is the property that matters: an omitted surface is
 * indistinguishable from a covered one, and the omissions are exactly what
 * made the old copy misleading.
 */
export const MEDIA_TAKEDOWN_REACH: readonly MediaTakedownReachEntry[] = [
  {
    surface: 'origin',
    stopped: true,
    worstCaseMs: MEDIA_TAKEDOWN_ORIGIN_MS,
    statement:
      'Our origin stops serving the file within about 15 seconds. Every new ' +
      'request that reaches us after that is refused, and the refusal itself ' +
      'is never cached, so lifting the takedown is just as fast.',
  },
  {
    surface: 'raw-url',
    stopped: true,
    worstCaseMs: 1,
    statement:
      "The raw Storage download URL is killed immediately, by rotating the " +
      'object’s token. That URL is served by Google, not by us, so nothing ' +
      'else could have stopped it — and it is how free-tier workspaces, ' +
      'private files and older embeds are delivered. Rotation is permanent: ' +
      'lifting the takedown does not bring that particular link back.',
  },
  {
    surface: 'browser-stable',
    stopped: true,
    worstCaseMs: MEDIA_TAKEDOWN_BROWSER_STABLE_MS,
    statement:
      'A browser that fetched the ordinary file URL in the last minute may ' +
      'keep showing it for up to 60 seconds before it asks us again.',
  },
  {
    surface: 'edge-image',
    stopped: true,
    worstCaseMs: MEDIA_TAKEDOWN_EDGE_IMAGE_MS,
    statement:
      'For IMAGES, the CDN edge may keep serving a copy it already stored ' +
      'for up to an hour, plus one further serve while it revalidates. ' +
      'Video, PDFs and other files are never held at the edge, so they stop ' +
      'as soon as the origin does.',
  },
  {
    surface: 'browser-immutable',
    stopped: false,
    worstCaseMs: null,
    statement:
      'The content-hashed permanent URL stays pinned in any browser that ' +
      'already fetched it — that form is promised never to change, so ' +
      'nothing can expire it early. There is no per-file purge for it.',
  },
  {
    surface: 'delivered',
    stopped: false,
    worstCaseMs: null,
    statement:
      'Anything already downloaded is gone from our reach entirely: a ' +
      'browser cache, a corporate proxy, a downstream CDN, a scraper, an ' +
      'archive snapshot. No mechanism we have or could buy recalls those.',
  },
]

/** The reach, as lines to render. Order is the order operators need it in. */
export function mediaTakedownReachLines(): string[] {
  return MEDIA_TAKEDOWN_REACH.map((entry) => entry.statement)
}

/**
 * The one sentence that must never be dropped, whatever surface renders the
 * rest. If a page has room for a single line about this, it is this one.
 */
export function mediaTakedownUnreachableLine(): string {
  return (
    'A takedown stops new delivery; it is NOT a recall. Bytes that have ' +
    'already been served — into a browser cache, a downstream CDN, a ' +
    'scraper or an archive — stay where they are. Treat a public file as ' +
    'already distributed and act accordingly.'
  )
}

/**
 * The short form, for a surface with no room for six lines: the two bounded
 * numbers and the limit, in one sentence.
 */
export function mediaTakedownReachSummary(): string {
  return (
    'Stops at our origin in ~15s and kills the raw download link ' +
    'immediately; an already-cached image can serve from the CDN edge for ' +
    'up to an hour and from one browser for up to a minute. It is not a ' +
    'recall — anything already downloaded stays downloaded.'
  )
}
