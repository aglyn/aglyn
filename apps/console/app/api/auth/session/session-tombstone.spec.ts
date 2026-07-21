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
  SESSION_SIGNED_OUT,
  parseSignedOut,
  signedOutTombstone,
  tombstoneEndsSession,
} from './session-tombstone'

describe('session tombstone (AGL-624)', () => {
  describe('signedOutTombstone / parseSignedOut round-trip', () => {
    it('encodes and parses a timestamp', () => {
      const value = signedOutTombstone(1_700_000_000_000)
      expect(value).toBe('signed-out:1700000000000')
      expect(parseSignedOut(value)).toEqual({ at: 1_700_000_000_000 })
    })

    it('treats a legacy bare tombstone as the oldest possible (at: 0)', () => {
      expect(parseSignedOut(SESSION_SIGNED_OUT)).toEqual({ at: 0 })
    })

    it('is null for a real session cookie or absent value', () => {
      expect(parseSignedOut('eyJhbGciOi.some.cookie')).toBeNull()
      expect(parseSignedOut(undefined)).toBeNull()
      expect(parseSignedOut('')).toBeNull()
    })

    it('falls back to at: 0 for a malformed timestamp', () => {
      expect(parseSignedOut('signed-out:not-a-number')).toEqual({ at: 0 })
      expect(parseSignedOut('signed-out:-5')).toEqual({ at: 0 })
    })
  })

  describe('tombstoneEndsSession', () => {
    it('ends the session when the sign-out is newer than the last sign-in', () => {
      // Signed out on another subdomain AFTER this tab logged in.
      expect(tombstoneEndsSession(2_000, 1_000)).toBe(true)
    })

    it('heals (does not end) when the tombstone predates the last sign-in', () => {
      // A stale tombstone from a prior sign-out; the user has since
      // re-authenticated on this origin — a refresh must NOT log them out.
      expect(tombstoneEndsSession(1_000, 2_000)).toBe(false)
      expect(tombstoneEndsSession(1_000, 1_000)).toBe(false)
    })

    it('heals a legacy untimestamped tombstone (at: 0)', () => {
      expect(tombstoneEndsSession(0, 0)).toBe(false)
      expect(tombstoneEndsSession(0, 1_700_000_000_000)).toBe(false)
    })

    it('never ends the session on non-finite inputs', () => {
      expect(tombstoneEndsSession(Number.NaN, 1_000)).toBe(false)
      expect(tombstoneEndsSession(2_000, Number.NaN)).toBe(true)
    })
  })
})
