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
  getReleaseFlagDefinition,
  isReleaseFlagKey,
  isReleaseFlagOn,
  parseReleaseFlagValue,
  RELEASE_FLAGS,
  releaseFlagBucket,
} from './release-flags'

describe('release flags (AGL-227)', () => {
  it('registers unique keys and nav-tab ids', () => {
    const keys = RELEASE_FLAGS.map((flag) => flag.key)
    expect(new Set(keys).size).toBe(keys.length)
    const tabIds = RELEASE_FLAGS.map((flag) => flag.navTabId).filter(Boolean)
    expect(new Set(tabIds).size).toBe(tabIds.length)
    expect(isReleaseFlagKey('release_contacts')).toBe(true)
    expect(isReleaseFlagKey('release_nonsense')).toBe(false)
    expect(getReleaseFlagDefinition('release_contacts').navTabId).toBe(
      'nav-tab-contacts',
    )
  })

  it('parses JSON payloads and clamps rollout percent', () => {
    expect(
      parseReleaseFlagValue(
        '{"enabled":false,"rolloutPercent":25,"note":"AGL-199"}',
        true,
      ),
    ).toEqual({ enabled: false, rolloutPercent: 25, note: 'AGL-199' })
    expect(
      parseReleaseFlagValue('{"enabled":true,"rolloutPercent":250}', false),
    ).toEqual({ enabled: true, rolloutPercent: 100, note: undefined })
    expect(
      parseReleaseFlagValue('{"enabled":false,"rolloutPercent":-4}', false),
    ).toEqual({ enabled: false, rolloutPercent: 0, note: undefined })
  })

  it('accepts bare booleans and falls back on junk', () => {
    expect(parseReleaseFlagValue('true', false)).toEqual({ enabled: true })
    expect(parseReleaseFlagValue('false', true)).toEqual({ enabled: false })
    expect(parseReleaseFlagValue('  ', true)).toEqual({ enabled: true })
    expect(parseReleaseFlagValue(undefined, false)).toEqual({ enabled: false })
    expect(parseReleaseFlagValue('{oops', true)).toEqual({ enabled: true })
    expect(parseReleaseFlagValue('"str"', false)).toEqual({ enabled: false })
  })

  it('buckets deterministically per flag and subject', () => {
    const first = releaseFlagBucket('release_contacts', 'tenant-a')
    expect(releaseFlagBucket('release_contacts', 'tenant-a')).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(100)
    // Different flags should not all share the subject's bucket.
    const buckets = RELEASE_FLAGS.map((flag) =>
      releaseFlagBucket(flag.key, 'tenant-a'),
    )
    expect(new Set(buckets).size).toBeGreaterThan(1)
  })

  it('gates fully on/off regardless of subject', () => {
    expect(isReleaseFlagOn('release_contacts', { enabled: true }, null)).toBe(
      true,
    )
    expect(
      isReleaseFlagOn('release_contacts', { enabled: false }, 'tenant-a'),
    ).toBe(false)
    expect(
      isReleaseFlagOn(
        'release_contacts',
        { enabled: false, rolloutPercent: 50 },
        null,
      ),
    ).toBe(false)
  })

  it('honors rollout boundaries and stays stable per subject', () => {
    const value = { enabled: false, rolloutPercent: 100 }
    expect(isReleaseFlagOn('release_contacts', value, 'anyone')).toBe(true)
    const zero = { enabled: false, rolloutPercent: 0 }
    expect(isReleaseFlagOn('release_contacts', zero, 'anyone')).toBe(false)

    const half = { enabled: false, rolloutPercent: 50 }
    const verdict = isReleaseFlagOn('release_contacts', half, 'tenant-a')
    for (let index = 0; index < 5; index += 1) {
      expect(isReleaseFlagOn('release_contacts', half, 'tenant-a')).toBe(
        verdict,
      )
    }
    // The verdict should track the bucket exactly.
    expect(verdict).toBe(releaseFlagBucket('release_contacts', 'tenant-a') < 50)
  })

  it('spreads subjects roughly according to the rollout percent', () => {
    const value = { enabled: false, rolloutPercent: 30 }
    let enabled = 0
    for (let index = 0; index < 1000; index += 1) {
      if (isReleaseFlagOn('release_contacts', value, `tenant-${index}`)) {
        enabled += 1
      }
    }
    expect(enabled).toBeGreaterThan(200)
    expect(enabled).toBeLessThan(400)
  })
})
