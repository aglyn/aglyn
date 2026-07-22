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
  encodeActivity,
  isSessionIdle,
  parseActivity,
} from './session-activity'

describe('session activity (AGL-697)', () => {
  describe('encodeActivity / parseActivity round-trip', () => {
    it('encodes and parses a timestamp', () => {
      expect(encodeActivity(1_700_000_000_000)).toBe('1700000000000')
      expect(parseActivity('1700000000000')).toBe(1_700_000_000_000)
    })

    it('reads 0 for an absent or empty value', () => {
      expect(parseActivity(undefined)).toBe(0)
      expect(parseActivity('')).toBe(0)
    })

    it('reads 0 for a malformed or non-positive value', () => {
      expect(parseActivity('not-a-number')).toBe(0)
      expect(parseActivity('0')).toBe(0)
      expect(parseActivity('-5')).toBe(0)
    })

    it('tolerates trailing junk the way parseInt does', () => {
      expect(parseActivity('1700000000000; Path=/')).toBe(1_700_000_000_000)
    })
  })

  describe('isSessionIdle', () => {
    const timeout = 60 * 60_000 // 60 minutes

    it('is idle once the last-seen is older than the timeout', () => {
      const now = 10_000_000
      expect(isSessionIdle(now - timeout - 1, now, timeout)).toBe(true)
    })

    it('is NOT idle within the timeout window', () => {
      const now = 10_000_000
      expect(isSessionIdle(now - timeout + 1, now, timeout)).toBe(false)
      expect(isSessionIdle(now, now, timeout)).toBe(false)
    })

    it('never expires when the timeout is disabled (<= 0)', () => {
      const now = 10_000_000
      expect(isSessionIdle(1, now, 0)).toBe(false)
      expect(isSessionIdle(1, now, -1)).toBe(false)
    })

    it('fails open (not idle) when there is no server record', () => {
      // A single tab must not perform the GLOBAL sign-out with no evidence
      // of a session-wide idle window — AGL-697.
      const now = 10_000_000
      expect(isSessionIdle(0, now, timeout)).toBe(false)
      expect(isSessionIdle(Number.NaN, now, timeout)).toBe(false)
    })
  })
})
