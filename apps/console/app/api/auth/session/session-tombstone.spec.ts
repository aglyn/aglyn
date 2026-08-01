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
  SESSION_TOMBSTONE_TTL_MS,
  parseSignedOut,
  signedOutTombstone,
  tombstoneEndsSession,
  tombstoneIsExpired,
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

/**
 * AGL-1142. The tombstone inherited the session cookie's 14-day lifetime,
 * which is far longer than it can be useful for. Measured on production
 * 2026-07-31: a `__session` holding a tombstone from NINE DAYS earlier, on an
 * account that had signed in interactively since, answering `401 signed-out`
 * to every cross-subdomain exchange for all of it.
 */
describe('tombstoneIsExpired (AGL-1142)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 1_785_600_000_000

  it('expires the nine-day-old tombstone that was actually observed', () => {
    expect(tombstoneIsExpired(now - 9 * DAY, now)).toBe(true)
  })

  it('honours a tombstone from moments ago', () => {
    // The case it exists to serve: a real sign-out on another subdomain,
    // which must still end this session.
    expect(tombstoneIsExpired(now - 1000, now)).toBe(false)
  })

  it('holds right up to the TTL and expires past it', () => {
    expect(tombstoneIsExpired(now - (SESSION_TOMBSTONE_TTL_MS - 1), now)).toBe(false)
    expect(tombstoneIsExpired(now - (SESSION_TOMBSTONE_TTL_MS + 1), now)).toBe(true)
  })

  it('expires a legacy untimestamped tombstone', () => {
    // It carries no date, so it cannot be shown to be recent — and an
    // undateable tombstone healing rather than denying is the same call
    // `tombstoneEndsSession` already makes.
    expect(tombstoneIsExpired(0, now)).toBe(true)
  })

  it('expires rather than honours anything nonsensical', () => {
    // Fail-open is right here and only here: the failure mode of honouring a
    // garbage tombstone is a user who cannot move between workspaces and has
    // no way to tell why.
    expect(tombstoneIsExpired(Number.NaN, now)).toBe(true)
    expect(tombstoneIsExpired(-1, now)).toBe(true)
  })

  it('does not expire a tombstone dated slightly in the future', () => {
    // Clock skew between the browser and the server is normal; treating a
    // future tombstone as expired would drop real sign-outs.
    expect(tombstoneIsExpired(now + 30_000, now)).toBe(false)
  })

  it('is much shorter than the session cookie it used to inherit', () => {
    // The regression in one line. 14 days was never a deliberate choice for
    // this value — it was the session TTL, reused.
    expect(SESSION_TOMBSTONE_TTL_MS).toBeLessThan(14 * DAY)
    expect(SESSION_TOMBSTONE_TTL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })
})
