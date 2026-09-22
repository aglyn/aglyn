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
 * How an entry's published date is spelled, and the one function that spells
 * it.
 *
 * Its own module because a published page's client bundle reads
 * `formatCollectionEntryDate` and nothing else here: `collection-entries.ts`
 * carries the whole collection runtime — routing, pagination, category links,
 * the search index and the four block expanders — and a bundler cannot drop
 * the rest of it around a single named import.
 */

/**
 * How an entry's published date reads (AGL-1459).
 *
 * Named shapes rather than a format string, for the same reason the styles
 * panel offers a unit picker rather than a CSS box: an editor choosing a
 * byline is not choosing a grammar, and a free-typed pattern is a field where
 * every typo renders as itself on a published page.
 */
export type CollectionEntryDateFormat =
  'default' | 'monthYear' | 'mediumDate' | 'longDate' | 'iso'

/**
 * "However the site already renders it" — a REAL value, never absence
 * (AGL-1459).
 *
 * `''` is the shape AGL-1451/AGL-1453 closed repo-wide: an emptied field
 * cannot survive a save, so an author who tried a format and wanted the
 * original back would have no option to pick. So the do-nothing choice is a
 * word, exactly like `COLLECTION_ALL_PILL_NONE` in `collection-entries.ts`.
 */
export const COLLECTION_ENTRY_DATE_FORMAT_DEFAULT: CollectionEntryDateFormat =
  'default'

/**
 * The offered formats, with the labels an author reads (AGL-1459). Lives here
 * rather than in the block's schema so the list and the formatter cannot
 * drift into offering a shape nothing knows how to produce.
 *
 * Example dates in the labels are written the way the default runtime renders
 * them, which is what makes the choice legible without opening a preview.
 */
export const COLLECTION_ENTRY_DATE_FORMAT_OPTIONS: readonly {
  value: CollectionEntryDateFormat
  label: string
}[] = [
  { value: 'default', label: 'Site default — 8/9/2026' },
  { value: 'monthYear', label: 'Month and year — Aug 2026' },
  { value: 'mediumDate', label: 'Short date — Aug 9, 2026' },
  { value: 'longDate', label: 'Long date — August 9, 2026' },
  { value: 'iso', label: 'ISO — 2026-08-09' },
]

/** Any stored value read back as a format this module knows (AGL-1459). */
export function normalizeCollectionEntryDateFormat(
  value: unknown,
): CollectionEntryDateFormat {
  const wanted = String(value ?? '').trim()
  const match = COLLECTION_ENTRY_DATE_FORMAT_OPTIONS.find(
    (option) => option.value === wanted,
  )
  return match?.value ?? COLLECTION_ENTRY_DATE_FORMAT_DEFAULT
}

/**
 * One entry's published date, in the shape the author asked for (AGL-1459).
 *
 * **The formatting lives HERE, beside the timestamp, and deliberately not in
 * the block.** By the time a date reaches the component it is already a
 * formatted string, and re-parsing one is ambiguous by construction: the same
 * `8/9/2026` reads as 9 August under an `en-US` runtime and 8 September under
 * `en-GB`. A byline that silently moves an article by three weeks is far worse
 * than one that is the wrong shape.
 *
 * `default` returns exactly `toLocaleDateString()` — the string this function
 * replaced, character for character — because the block is live on published
 * entries and opening a dropdown must not restyle them.
 *
 * ## Why the runtime gets no say (AGL-1926)
 *
 * Every branch pins BOTH the locale and the time zone, and the answer is a
 * pure function of the timestamp. It used to pass `locale` straight through
 * (normally `undefined`) with no `timeZone` at all, so the output was a
 * function of the RUNTIME: `en-US` + UTC on a Vercel server, the visitor's
 * own locale and zone in their browser. That is fine while only the server
 * ever calls it — the string is stamped into node props at compose time and
 * both sides then agree on it — but it makes the function a hydration
 * mismatch waiting for its first client-side caller, and `catch-all-client`
 * was exactly that caller. A post published at 02:30 UTC is dated the 10th by
 * the server and the 9th by every visitor west of Greenwich; React reports
 * the difference as a text mismatch (the live React #418 on tenant-web,
 * AGL-1926) and then reconciles against a DOM it no longer describes, which
 * is where the `removeChild`/`insertBefore` pair comes from.
 *
 * The pinned values are the ones production already emits, so no published
 * page changes: Vercel runs UTC with an `en-US` ICU default, which is why
 * every entry date served from aglyn.com today reads `8/9/2026`. Pinning
 * makes that byte-for-byte guaranteed instead of a property of the host.
 *
 * `locale` still exists for a caller that must render in a different one; it
 * now defaults to the value the server was picking implicitly rather than to
 * "whatever this runtime happens to be".
 */
export const COLLECTION_ENTRY_DATE_LOCALE = 'en-US'

/**
 * The zone a calendar day is read in when a site has not named one.
 *
 * Entry timestamps are absolute instants; the day they are ATTRIBUTED to is
 * an editorial fact about the PUBLISHER, and `timeZone` below is how a site
 * states it. UTC remains the default because it is the answer every existing
 * site is already rendering — a site that never sets a zone must not have its
 * archive move by a day on deploy.
 *
 * ⚑ What AGL-1926 needed was not UTC, it was a zone BOTH SIDES AGREE ON. A
 * per-site zone is still that: it is resolved once, server-side, and travels
 * in the node props, so the client re-render reads the same string. What
 * would reopen the React #418 crash is reading the VISITOR's zone, because
 * only one side of the render knows it.
 */
export const COLLECTION_ENTRY_DATE_TIME_ZONE = 'UTC'

/**
 * Is this a zone the runtime can actually format in (AGL-3237)?
 *
 * `Intl` is the only authority worth asking — an allowlist of IANA names goes
 * stale, and `toLocaleDateString` throws a RangeError on a name it does not
 * know, which would take down a composing page rather than mis-date one post.
 */
export function isSupportedTimeZone(value: unknown): boolean {
  const name = String(value ?? '').trim()
  if (!name) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

/**
 * The zone a site's dates are read in (AGL-3237).
 *
 * The ORGANIZATION names it and every site it owns inherits it: a customer
 * sets it once for the workspace rather than per site. Unset is UTC — the
 * value every existing site already renders, so nothing moves by a day when
 * this ships.
 *
 * Validated on the way out rather than trusted: a stored zone can predate an
 * IANA rename, or be whatever a hand-edited document holds, and a bad one has
 * to fall back rather than throw inside a page render.
 *
 * ⚑ Org only, deliberately. A per-SITE override is a reasonable thing to want
 * — an agency running sites in several regions — but it would make `timeZone`
 * a field of the host document, and the host write-deny guard (AGL-1361)
 * would then require it classified in the host rules too. That is a second
 * rules change, and rules ship by hand rather than with a promotion, so the
 * override is worth its own issue rather than a free ride on this one.
 */
export function resolveSiteTimeZone(
  org?: { timeZone?: string } | null,
): string {
  const orgZone = String(org?.timeZone ?? '').trim()
  return isSupportedTimeZone(orgZone) ? orgZone : COLLECTION_ENTRY_DATE_TIME_ZONE
}

export function formatCollectionEntryDate(
  publishedAt: { seconds: number } | null | undefined,
  format?: CollectionEntryDateFormat,
  locale: string = COLLECTION_ENTRY_DATE_LOCALE,
  /**
   * The site's zone (AGL-3237) — resolved once per render and passed down, so
   * server and client format the same instant into the same string.
   */
  timeZoneName: string = COLLECTION_ENTRY_DATE_TIME_ZONE,
): string {
  const seconds = publishedAt?.seconds
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  // An unknown zone formats in UTC rather than throwing: this runs while a
  // page composes, and a RangeError here is a site that does not render.
  const timeZone = isSupportedTimeZone(timeZoneName)
    ? timeZoneName
    : COLLECTION_ENTRY_DATE_TIME_ZONE
  switch (normalizeCollectionEntryDateFormat(format)) {
    case 'monthYear':
      return date.toLocaleDateString(locale, {
        month: 'short',
        year: 'numeric',
        timeZone,
      })
    case 'mediumDate':
      return date.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone,
      })
    case 'longDate':
      return date.toLocaleDateString(locale, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone,
      })
    case 'iso': {
      // The calendar day IN THE SITE'S ZONE, not `toISOString()`'s slice by
      // luck and not the RUNTIME's local day: `getFullYear`/`getMonth`/
      // `getDate` read the host's zone, so this branch moved an entry by a
      // day depending on who rendered it. Read through the same formatter the
      // branches above use, so all four shapes name one day.
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date)
      const part = (type: string) =>
        parts.find((entry) => entry.type === type)?.value ?? ''
      return `${part('year')}-${part('month')}-${part('day')}`
    }
    default:
      return date.toLocaleDateString(locale, { timeZone })
  }
}

/**
 * One entry's publish instant for a machine to read: an ISO 8601 date-time in
 * UTC, or `''` for an entry with no date (AGL-2956).
 *
 * {@link formatCollectionEntryDate} writes the date a READER sees, and every
 * one of its shapes is ambiguous or incomplete to a parser: `8/9/2026` is a
 * different day in `en-GB`, and even its `iso` shape is a calendar day with no
 * time or zone. A field that has to be parsed — a Video element's publication
 * date, which the page publishes as `VideoObject.uploadDate` — needs the
 * instant itself, spelled by `toISOString()` as `Article.datePublished` is.
 *
 * It reads the same `publishedAt` and treats a missing or zero `seconds` the
 * same way, so an entry is dated here exactly when it is dated there.
 *
 * A `seconds` no `Date` can hold answers `''` rather than throwing:
 * `toISOString` raises a RangeError on an invalid date, and this runs while a
 * page composes.
 */
export function collectionEntryPublishedAtIso(
  publishedAt: { seconds: number } | null | undefined,
): string {
  const seconds = publishedAt?.seconds
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
