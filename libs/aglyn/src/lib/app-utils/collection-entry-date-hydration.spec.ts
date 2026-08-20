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
 * AGL-1926: an entry's published date must be a pure function of the
 * timestamp, not of the runtime that formats it.
 *
 * `formatCollectionEntryDate` is reachable from the client barrel and IS
 * called from a client component (`catch-all-client.tsx`, the legacy
 * collection surface), which Next also renders on the server. Two runtimes,
 * one prop: unless the locale and the zone are pinned, the ISR HTML carries
 * the server's reading and the browser computes the visitor's, and React
 * reports the difference as a hydration mismatch — minified error #418, the
 * live production group this issue is about.
 *
 * ## How the runtime difference is driven
 *
 * NOT through `process.env.TZ`. V8 caches the zone, and under jest a
 * reassignment does not move the clock at all — a spec written that way
 * asserts against the machine's own zone and passes or fails by accident of
 * where it runs. `installVisitorRuntime` instead replaces the DEFAULTS the
 * ambient runtime supplies, which is the real difference between a Vercel
 * server and a browser: a call that NAMES its locale and zone is passed
 * through untouched, and a bare call gets the visitor's. That distinction is
 * exactly the one under test.
 *
 * ## How these go red
 *
 * `restores the runtime it stubbed` and the planted case below are the
 * negative controls: they prove the stub really does change what a bare call
 * returns, so a green result from the pinned cases means the pin held rather
 * than that nothing was ever varied. Drop the `timeZone` from any branch of
 * `formatCollectionEntryDate`, or restore the implicit `locale`, and that
 * branch's case fails.
 */

import {
  COLLECTION_ENTRY_DATE_LOCALE,
  COLLECTION_ENTRY_DATE_TIME_ZONE,
  formatCollectionEntryDate,
} from './collection-entries'

/**
 * 2026-08-10T02:30:00Z. The 10th in UTC, the 9th in every US zone — so a
 * formatter that reads the ambient zone disagrees with one that does not by
 * a full day, which is the failure a visitor actually sees.
 */
const BOUNDARY_SECONDS = Date.UTC(2026, 7, 10, 2, 30, 0) / 1000
const publishedAt = { seconds: BOUNDARY_SECONDS }

/** A perfectly ordinary visitor: not our locale, not our zone. */
const VISITOR_LOCALE = 'en-GB'
const VISITOR_ZONE = 'America/Los_Angeles'

/** What the pinned answer is, spelled out rather than derived from the code. */
const EXPECTED = {
  default: '8/10/2026',
  monthYear: 'Aug 2026',
  mediumDate: 'Aug 10, 2026',
  longDate: 'August 10, 2026',
  iso: '2026-08-10',
} as const

/**
 * Make the ambient runtime behave like the visitor's browser: bare calls and
 * the local-calendar getters answer in `en-GB`/Los Angeles, pinned calls are
 * untouched. Returns the undo.
 */
function installVisitorRuntime(): () => void {
  const realFormat = Date.prototype.toLocaleDateString
  const realFullYear = Date.prototype.getFullYear
  const realMonth = Date.prototype.getMonth
  const realDate = Date.prototype.getDate

  const visitorParts = (value: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: VISITOR_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value)
    const read = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value)
    return { year: read('year'), month: read('month') - 1, day: read('day') }
  }

  Date.prototype.toLocaleDateString = function (
    this: Date,
    locale?: any,
    options?: any,
  ) {
    // A call that pins both is a pure function of the instant — the whole
    // point of the fix — so it must survive this stub unchanged.
    if (locale != null && options?.timeZone != null) {
      return realFormat.call(this, locale, options)
    }
    return realFormat.call(this, locale ?? VISITOR_LOCALE, {
      ...(options ?? {}),
      timeZone: VISITOR_ZONE,
    })
  } as typeof Date.prototype.toLocaleDateString
  Date.prototype.getFullYear = function (this: Date) {
    return visitorParts(this).year
  }
  Date.prototype.getMonth = function (this: Date) {
    return visitorParts(this).month
  }
  Date.prototype.getDate = function (this: Date) {
    return visitorParts(this).day
  }

  return () => {
    Date.prototype.toLocaleDateString = realFormat
    Date.prototype.getFullYear = realFullYear
    Date.prototype.getMonth = realMonth
    Date.prototype.getDate = realDate
  }
}

describe('collection entry dates are runtime-independent (AGL-1926)', () => {
  let restore: () => void

  beforeEach(() => {
    restore = installVisitorRuntime()
  })

  afterEach(() => {
    restore()
  })

  it('really does change what an unpinned call returns (negative control)', () => {
    // Without this, every expectation below could pass on a machine that
    // happens to sit in UTC whether or not the fix is present — the shape of
    // a check that cannot fail.
    const boundary = new Date(BOUNDARY_SECONDS * 1000)
    expect(boundary.toLocaleDateString()).toBe('09/08/2026')
    expect(boundary.toLocaleDateString()).not.toBe(EXPECTED.default)
    expect(boundary.getDate()).toBe(9)
  })

  it('reads the calendar day in the pinned zone, not the runtime zone', () => {
    expect(formatCollectionEntryDate(publishedAt)).toBe(EXPECTED.default)
  })

  it.each([
    ['monthYear', EXPECTED.monthYear],
    ['mediumDate', EXPECTED.mediumDate],
    ['longDate', EXPECTED.longDate],
    ['iso', EXPECTED.iso],
  ] as const)('pins the %s format too', (format, expected) => {
    expect(formatCollectionEntryDate(publishedAt, format)).toBe(expected)
  })

  it('gives the visitor the string the server rendered', () => {
    // The hydration contract stated directly: the string the ISR HTML was
    // built with, and the string the browser computes, have to be equal.
    restore()
    const server = formatCollectionEntryDate(publishedAt, 'longDate')
    restore = installVisitorRuntime()
    const visitor = formatCollectionEntryDate(publishedAt, 'longDate')
    expect(visitor).toBe(server)
  })

  it('keeps the bytes production already serves', () => {
    // The pin is only safe because it is what Vercel was picking implicitly:
    // every entry date served from aglyn.com today reads like `8/9/2026`.
    // If either constant is ever retuned, this says so out loud.
    expect(COLLECTION_ENTRY_DATE_LOCALE).toBe('en-US')
    expect(COLLECTION_ENTRY_DATE_TIME_ZONE).toBe('UTC')
    expect(
      formatCollectionEntryDate({ seconds: Date.UTC(2026, 7, 9, 12) / 1000 }),
    ).toBe('8/9/2026')
  })

  it('still honours a caller that asks for a different locale', () => {
    expect(formatCollectionEntryDate(publishedAt, 'longDate', 'de-DE')).toBe(
      '10. August 2026',
    )
  })

  it('still returns an empty string for an unpublished entry', () => {
    expect(formatCollectionEntryDate(null)).toBe('')
    expect(formatCollectionEntryDate(undefined)).toBe('')
    expect(formatCollectionEntryDate({ seconds: 0 })).toBe('')
  })
})
