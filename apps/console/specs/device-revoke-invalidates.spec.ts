/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and these routes need `Request`/`Response`.
 *
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
 * AGL-1959, part 1 — a revoked device is actually refused, not just hidden.
 *
 * AGL-2318 shipped the device list and stopped there on purpose: "a 'sign out
 * everywhere' button that did not actually sign anyone out would be worse than
 * no button." These are the assertions that make the button real, and each one
 * corresponds to a way the feature could look finished and revoke nothing:
 *
 *  - the row is STAMPED, not deleted — a delete hides the device and leaves
 *    the browser holding a 14-day cookie and a live refresh token;
 *  - `revokeRefreshTokens` lands in the pool the uid actually lives in — the
 *    AGL-2005 failure, where a revocation returned 200 and moved
 *    `tokensValidAfterTime` on a project-pool ghost while the real SSO
 *    account's never moved;
 *  - the MINT checks revocation — without it a stolen ID token, valid for up
 *    to an hour after the revoke, buys a fresh FOURTEEN-DAY session cookie and
 *    undoes the whole thing;
 *  - the EXCHANGE refuses the revoked device — otherwise "signed out" means
 *    "until you open a different workspace";
 *  - and a genuinely fresh sign-in on that same browser is ADMITTED, because a
 *    revoke that bricks the device the owner is sitting at is its own
 *    incident. AGL-1888 is a standing example on this very account.
 */

import {
  claimSecondsToMs,
  deviceRevocationRefuses,
} from '../app/api/_lib/device-revocation'

describe('the epoch predicate', () => {
  const REVOKED_AT = 1_760_000_000_000

  it('refuses a credential issued before the revocation', () => {
    expect(deviceRevocationRefuses(REVOKED_AT, REVOKED_AT - 1)).toBe(true)
  })

  it('admits a credential issued after it — the un-brick property', () => {
    expect(deviceRevocationRefuses(REVOKED_AT, REVOKED_AT + 1)).toBe(false)
  })

  it('admits everything when the device was never revoked', () => {
    expect(deviceRevocationRefuses(0, 1)).toBe(false)
    expect(deviceRevocationRefuses(null, 1)).toBe(false)
    expect(deviceRevocationRefuses(undefined, 1)).toBe(false)
  })

  it('refuses an UNDATEABLE credential against a live revocation', () => {
    // The opposite direction from the sign-out tombstone, and deliberately so:
    // the tombstone's failure is denying a session nobody asked it to deny,
    // this one's is admitting a session somebody asked us to end.
    expect(deviceRevocationRefuses(REVOKED_AT, null)).toBe(true)
    expect(deviceRevocationRefuses(REVOKED_AT, 0)).toBe(true)
  })

  it('converts a seconds claim to ms, and absence to null', () => {
    expect(claimSecondsToMs(1_760_000_000)).toBe(1_760_000_000_000)
    expect(claimSecondsToMs(0)).toBeNull()
    expect(claimSecondsToMs(undefined)).toBeNull()
  })
})
