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
 * `Accept` header negotiation, per RFC 9110 §12.5.1 — the one rule that
 * decides whether a request gets HTML or Markdown.
 *
 * ## Why this is a parser and not a substring test
 *
 * The tempting implementation is `accept.includes('text/markdown')`. It is
 * wrong in both directions, and the wrong answers are the ones that matter:
 *
 * - `Accept: text/markdown;q=0` CONTAINS the string and means *anything but
 *   markdown*. A substring test serves markdown to a client that explicitly
 *   refused it.
 * - Every browser sends the full wildcard range with a low q alongside its
 *   real preferences — Chrome's document `Accept` ends in `image/webp` and
 *   then that range at `q=0.8`. A test for the full wildcard — the obvious
 *   "they will take anything" shortcut — matches it, and a browser gets a wall
 *   of raw Markdown.
 *
 * So the header is parsed into ranked entries and matched by the algorithm the
 * RFC actually specifies: sort by q descending, break ties by specificity (an
 * exact type beats a subtype wildcard beats the full wildcard), and treat
 * `q=0` as a refusal rather than a low score.
 *
 * ## The absent-header rule is load-bearing
 *
 * No `Accept` at all means NO CONSTRAINT, not "nothing works", and the full
 * wildcard means the same. Both serve the caller's default — which for a web
 * page is HTML. Getting this backwards is how a site starts answering `curl`
 * and every link-preview crawler with Markdown.
 *
 * ## 406 is rare on purpose
 *
 * {@link negotiateMediaType} returns `null` only when EVERY representation the
 * caller can produce is either unmatched or explicitly refused with `q=0`.
 * That is the only case where RFC 9110 §15.5.7 asks for a 406, and answering
 * one more eagerly than that breaks ordinary clients for no gain.
 */

/** One parsed entry of an `Accept` header, in the order it was written. */
export interface AcceptEntry {
  /** Lowercased type, `*` for a wildcard. */
  type: string
  /** Lowercased subtype, `*` for a wildcard. */
  subtype: string
  /** Quality factor, 0–1. Absent `q` is 1. */
  q: number
}

/** How well an accept entry matches a concrete media type. Higher is better. */
const SPECIFICITY_EXACT = 3
const SPECIFICITY_SUBTYPE_WILDCARD = 2
const SPECIFICITY_FULL_WILDCARD = 1
const SPECIFICITY_NONE = 0

/**
 * Parse `q`, defaulting to 1 and clamping to [0, 1].
 *
 * A malformed `q` (`q=abc`, `q=`) is treated as ABSENT rather than as zero.
 * Zero is a refusal, and inferring a refusal from a typo would let one bad
 * character turn a normal request into a 406.
 */
function parseQuality(raw: string | undefined): number {
  if (raw == null) return 1
  const value = Number.parseFloat(raw.trim())
  if (!Number.isFinite(value)) return 1
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Parse an `Accept` header into entries.
 *
 * Entries whose media range is unparseable are dropped rather than defaulted:
 * a range we cannot read cannot be honored, and widening it to the full
 * wildcard would silently grant more than the client asked for.
 */
export function parseAcceptHeader(header: string | null | undefined): AcceptEntry[] {
  if (typeof header !== 'string' || header.trim() === '') return []
  const entries: AcceptEntry[] = []
  for (const part of header.split(',')) {
    const [rangeRaw, ...paramParts] = part.split(';')
    const range = rangeRaw.trim().toLowerCase()
    if (!range) continue
    const slash = range.indexOf('/')
    if (slash <= 0 || slash === range.length - 1) continue
    const type = range.slice(0, slash)
    const subtype = range.slice(slash + 1)
    // A wildcard TYPE with a concrete subtype is not a range any client
    // means, and nothing can satisfy it. Dropped rather than matched.
    if (type === '*' && subtype !== '*') continue
    let q: string | undefined
    for (const param of paramParts) {
      const equals = param.indexOf('=')
      if (equals === -1) continue
      if (param.slice(0, equals).trim().toLowerCase() !== 'q') continue
      q = param.slice(equals + 1)
      // RFC 9110: parameters AFTER `q` are response parameters, not media-range
      // parameters, so the first `q` wins and the rest are not `q` at all.
      break
    }
    entries.push({ type, subtype, q: parseQuality(q) })
  }
  return entries
}

/**
 * How specifically `entry` names `mediaType`; {@link SPECIFICITY_NONE} when it
 * does not name it at all.
 *
 * `mediaType` is matched on its TYPE ONLY — parameters such as
 * `;charset=utf-8` are stripped first. A client that writes
 * `Accept: text/markdown` is asking for the markdown representation whatever
 * charset it comes in, and treating the parameters as part of the name would
 * make every such request a 406.
 */
function specificity(entry: AcceptEntry, mediaType: string): number {
  const bare = mediaType.split(';')[0].trim().toLowerCase()
  const slash = bare.indexOf('/')
  if (slash <= 0) return SPECIFICITY_NONE
  const type = bare.slice(0, slash)
  const subtype = bare.slice(slash + 1)
  if (entry.type === type && entry.subtype === subtype) return SPECIFICITY_EXACT
  if (entry.type === type && entry.subtype === '*') {
    return SPECIFICITY_SUBTYPE_WILDCARD
  }
  if (entry.type === '*' && entry.subtype === '*') return SPECIFICITY_FULL_WILDCARD
  return SPECIFICITY_NONE
}

/**
 * The best `Accept` entry for one media type — the MOST SPECIFIC match, not
 * the highest-q one.
 *
 * RFC 9110 is explicit that precedence goes to the most specific range, and
 * the difference is exactly what makes `q=0` work: given
 * `text/markdown;q=0, text/*` the exact range refuses markdown even though a
 * wildcard beside it would have scored 1. Picking by q would read that header
 * as an acceptance.
 */
function bestEntryFor(
  entries: readonly AcceptEntry[],
  mediaType: string,
): AcceptEntry | null {
  let best: AcceptEntry | null = null
  let bestScore = SPECIFICITY_NONE
  for (const entry of entries) {
    const score = specificity(entry, mediaType)
    if (score === SPECIFICITY_NONE) continue
    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }
  return best
}

/**
 * Pick which representation to serve.
 *
 * @param header - the raw `Accept` request header, or null/absent
 * @param available - the media types this resource can produce, DEFAULT FIRST.
 *   The order is the server's own preference and breaks ties — for a web page
 *   that means HTML first, so a browser sending the full wildcard gets HTML.
 * @returns the chosen media type, or `null` when the request must be answered
 *   `406 Not Acceptable`.
 */
export function negotiateMediaType(
  header: string | null | undefined,
  available: readonly string[],
): string | null {
  if (available.length === 0) return null
  const entries = parseAcceptHeader(header)
  // No usable Accept at all — no constraint. Serve the default.
  if (entries.length === 0) return available[0]

  /*
    A header made of NOTHING BUT REFUSALS states no positive preference, so it
    constrains rather than selects: `Accept: text/markdown;q=0` means *anything
    except markdown*, not *markdown or nothing*. The two published vectors that
    pin this are a pair, and only this branch satisfies both —

      text/markdown;q=0  produces md + html  →  html   (a refusal, not a demand)
      text/markdown;q=0  produces md only    →  406    (the one type, refused)

    — where scoring every unlisted type as zero would 406 the first, and
    ignoring q=0 would serve markdown to a client that just said not to.
  */
  if (entries.every((entry) => entry.q <= 0)) {
    for (const candidate of available) {
      const refusal = bestEntryFor(entries, candidate)
      if (!refusal || refusal.q > 0) return candidate
    }
    return null
  }

  let chosen: string | null = null
  let chosenQ = 0
  let chosenSpecificity = SPECIFICITY_NONE
  for (const candidate of available) {
    const entry = bestEntryFor(entries, candidate)
    if (!entry || entry.q <= 0) continue
    const candidateSpecificity = specificity(entry, candidate)
    // Strictly greater on q, then on specificity: equal on both leaves the
    // EARLIER candidate standing, which is how `available` order expresses the
    // server's own preference.
    if (
      entry.q > chosenQ ||
      (entry.q === chosenQ && candidateSpecificity > chosenSpecificity)
    ) {
      chosen = candidate
      chosenQ = entry.q
      chosenSpecificity = candidateSpecificity
    }
  }
  return chosen
}

/** `text/markdown`, the media type RFC 7763 registers. */
export const MARKDOWN_MEDIA_TYPE = 'text/markdown'

/** What a markdown response actually sends, charset included. */
export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

/** `text/html`, the default representation of every page on a site. */
export const HTML_MEDIA_TYPE = 'text/html'

/**
 * What a tenant page can produce, DEFAULT FIRST.
 *
 * HTML leads because a page whose visitor is a browser must stay a page: every
 * client that sends no `Accept`, or only the full wildcard, lands on the
 * first entry.
 */
export const PAGE_MEDIA_TYPES: readonly string[] = [
  HTML_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
]

/**
 * Whether a request asked for the markdown representation of a page.
 *
 * The single door every surface uses, so the middleware's routing decision and
 * the handler's `Content-Type` can never disagree about one header.
 */
export function wantsMarkdown(header: string | null | undefined): boolean {
  return negotiateMediaType(header, PAGE_MEDIA_TYPES) === MARKDOWN_MEDIA_TYPE
}

/**
 * Whether a request refuses EVERY representation a page can produce, i.e. the
 * one case that earns a 406.
 */
export function isPageUnacceptable(header: string | null | undefined): boolean {
  return negotiateMediaType(header, PAGE_MEDIA_TYPES) === null
}

/**
 * The plain-text body RFC 9110 §15.5.7 recommends a 406 carry: the list of
 * representations the client could have asked for.
 *
 * A body rather than an empty response because the client is an agent, and an
 * agent that is told what IS available can retry correctly on its next call
 * instead of giving up on the URL.
 */
export function notAcceptableBody(
  requested: string | null | undefined,
  available: readonly string[] = PAGE_MEDIA_TYPES,
): string {
  const lines = ['This resource is available in:']
  for (const type of available) lines.push(`- ${type}`)
  const asked = typeof requested === 'string' ? requested.trim() : ''
  if (asked) lines.push('', `You requested: ${asked}`)
  return `${lines.join('\n')}\n`
}

/**
 * Add `Accept` to a `Vary` header without disturbing what is already there.
 *
 * Written as a merge rather than an assignment because the tenant already
 * varies on Next's router headers (`rsc`, `next-router-state-tree`, …). An
 * overwrite would drop those and serve an RSC payload to a document request;
 * a blind append would list `Accept` twice on a response that already had it.
 *
 * `Vary: *` is left ALONE. It already means "do not cache this by any key",
 * which is stricter than anything adding `Accept` could express, and rewriting
 * it to a list would WEAKEN the response's caching contract.
 */
export function varyWithAccept(existing: string | null | undefined): string {
  const current = typeof existing === 'string' ? existing.trim() : ''
  if (!current) return 'Accept'
  if (current === '*') return '*'
  const names = current
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.some((name) => name.toLowerCase() === 'accept')) return names.join(', ')
  return [...names, 'Accept'].join(', ')
}
