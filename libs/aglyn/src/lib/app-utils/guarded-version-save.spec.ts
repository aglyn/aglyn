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
  hasConcurrentWrite,
  versionStamp,
} from './guarded-version-save'

describe('versionStamp (AGL-674)', () => {
  it('reads a Firestore Timestamp', () => {
    const timestamp = { seconds: 1_700_000_000, nanoseconds: 123 }
    expect(versionStamp(timestamp)).toBe('ts:1700000000.123')
  })

  it('prefers toMillis when the SDK provides it', () => {
    expect(versionStamp({ toMillis: () => 1_700_000_000_123 })).toBe(
      'ms:1700000000123',
    )
  })

  it('distinguishes stamps that differ only in nanoseconds', () => {
    // Two saves inside the same second are exactly the case a
    // seconds-only comparison would miss.
    const a = versionStamp({ seconds: 1_700_000_000, nanoseconds: 1 })
    const b = versionStamp({ seconds: 1_700_000_000, nanoseconds: 2 })
    expect(a).not.toBe(b)
  })

  it('returns null for a doc that has never been stamped', () => {
    expect(versionStamp(undefined)).toBeNull()
    expect(versionStamp(null)).toBeNull()
    expect(versionStamp({})).toBeNull()
  })
})

describe('hasConcurrentWrite (AGL-674)', () => {
  it('detects a write that landed since load', () => {
    expect(hasConcurrentWrite('ms:1', 'ms:2')).toBe(true)
  })

  it('allows a save when nothing moved', () => {
    expect(hasConcurrentWrite('ms:1', 'ms:1')).toBe(false)
  })

  /**
   * The load-bearing degradation. If we never established a base — a failed
   * read, a doc that had no stamp — refusing every save would break editing
   * outright to guard against something we cannot confirm. Editing must
   * keep working; this is detection, not a lock.
   */
  it('does not block when no base was established', () => {
    expect(hasConcurrentWrite(null, 'ms:2')).toBe(false)
  })

  it('does not block when the stored doc has no stamp', () => {
    expect(hasConcurrentWrite('ms:1', null)).toBe(false)
  })

  /**
   * Clock skew must not read as a conflict on its own — but note the
   * comparison is equality, so a LOWER stored stamp still counts as a
   * change. That is intended: someone wrote, regardless of whose clock
   * says what.
   */
  it('treats any difference as a conflict, in either direction', () => {
    expect(hasConcurrentWrite('ms:5', 'ms:2')).toBe(true)
    expect(hasConcurrentWrite('ms:2', 'ms:5')).toBe(true)
  })
})
