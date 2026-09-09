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
 * The zone the calendar day is read in. Entry timestamps are absolute
 * instants; the day they are ATTRIBUTED to has to be one both sides agree on,
 * and UTC is the only zone a server and an unknown visitor share.
 */
export const COLLECTION_ENTRY_DATE_TIME_ZONE = 'UTC'

export function formatCollectionEntryDate(
  publishedAt: { seconds: number } | null | undefined,
  format?: CollectionEntryDateFormat,
  locale: string = COLLECTION_ENTRY_DATE_LOCALE,
): string {
  const seconds = publishedAt?.seconds
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  const timeZone = COLLECTION_ENTRY_DATE_TIME_ZONE
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
    case 'iso':
      // The calendar day in the pinned zone, not `toISOString()`'s slice by
      // luck and not the RUNTIME's local day: `getFullYear`/`getMonth`/
      // `getDate` read the host's zone, so this branch moved an entry by a
      // day depending on who rendered it. The UTC accessors are the same
      // reading the three `toLocaleDateString` branches above now take.
      return (
        `${date.getUTCFullYear()}-` +
        `${String(date.getUTCMonth() + 1).padStart(2, '0')}-` +
        `${String(date.getUTCDate()).padStart(2, '0')}`
      )
    default:
      return date.toLocaleDateString(locale, { timeZone })
  }
}
