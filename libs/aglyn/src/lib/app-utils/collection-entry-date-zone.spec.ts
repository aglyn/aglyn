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
 * AGL-3237: which calendar day an entry is attributed to is the PUBLISHER's,
 * not the server's.
 *
 * AGL-1926 pinned the zone to UTC to stop a hydration mismatch, and that was
 * right about the mismatch and wrong about the day: a release served at
 * 00:30 UTC went out at half past seven the previous evening in Chicago, and
 * `aglyn.com/changelog` dated it tomorrow. What that fix needed was a zone
 * BOTH SIDES AGREE ON, which a per-org zone resolved once on the server and
 * passed down still is.
 */
import {
  formatCollectionEntryDate,
  isSupportedTimeZone,
  resolveSiteTimeZone,
} from './collection-entry-date'

/** v1.0.0-beta.152's real publish instant: 7:30 PM on the 21st in Chicago. */
const EVENING_RELEASE = { seconds: Date.UTC(2026, 8, 22, 0, 30) / 1000 }

describe('an entry is dated in the publisher’s zone (AGL-3237)', () => {
  it('dates an evening release the day it was actually published', () => {
    expect(
      formatCollectionEntryDate(
        EVENING_RELEASE,
        'default',
        'en-US',
        'America/Chicago',
      ),
    ).toBe('9/21/2026')
    // The reading this replaces, and the one every site still gets by
    // default: a day that had not started for any reader in the Americas.
    expect(formatCollectionEntryDate(EVENING_RELEASE, 'default')).toBe(
      '9/22/2026',
    )
  })

  it('moves every shape together, so one entry names one day', () => {
    const inChicago = (format: Parameters<typeof formatCollectionEntryDate>[1]) =>
      formatCollectionEntryDate(EVENING_RELEASE, format, 'en-US', 'America/Chicago')
    // The `iso` shape read UTC accessors and so would have stayed on the
    // 22nd while the three visible shapes moved to the 21st — an entry whose
    // machine-readable day disagreed with its printed one.
    expect(inChicago('iso')).toBe('2026-09-21')
    expect(inChicago('longDate')).toBe('September 21, 2026')
    expect(inChicago('mediumDate')).toBe('Sep 21, 2026')
    expect(inChicago('monthYear')).toBe('Sep 2026')
  })

  it('keeps UTC for a site that has never named a zone', () => {
    // The whole back-compat claim: every published archive reads exactly as
    // it did before this field existed until somebody sets one.
    expect(resolveSiteTimeZone(null)).toBe('UTC')
    expect(resolveSiteTimeZone({})).toBe('UTC')
    expect(formatCollectionEntryDate(EVENING_RELEASE)).toBe('9/22/2026')
  })

  it('falls back rather than throwing on a zone it cannot use', () => {
    // A stored zone can predate an IANA rename or be hand-edited nonsense,
    // and `toLocaleDateString` raises a RangeError on one it does not know —
    // inside a composing page, that is a site that does not render.
    expect(isSupportedTimeZone('Mars/Olympus_Mons')).toBe(false)
    expect(resolveSiteTimeZone({ timeZone: 'Mars/Olympus_Mons' })).toBe('UTC')
    expect(() =>
      formatCollectionEntryDate(EVENING_RELEASE, 'default', 'en-US', 'nonsense'),
    ).not.toThrow()
    expect(
      formatCollectionEntryDate(EVENING_RELEASE, 'default', 'en-US', 'nonsense'),
    ).toBe('9/22/2026')
  })

  it('resolves the org’s zone when it names a usable one', () => {
    expect(resolveSiteTimeZone({ timeZone: 'America/Chicago' })).toBe(
      'America/Chicago',
    )
    expect(resolveSiteTimeZone({ timeZone: '  Europe/Berlin  ' })).toBe(
      'Europe/Berlin',
    )
  })

  it('is still a pure function of its inputs, which is what AGL-1926 needed', () => {
    // Two "runtimes" formatting the same instant with the same resolved zone
    // must produce the same string — that, and not UTC specifically, is the
    // property that keeps the server render and the client re-render equal.
    const zone = resolveSiteTimeZone({ timeZone: 'America/Chicago' })
    const server = formatCollectionEntryDate(EVENING_RELEASE, 'default', 'en-US', zone)
    const client = formatCollectionEntryDate(EVENING_RELEASE, 'default', 'en-US', zone)
    expect(server).toBe(client)
  })
})
