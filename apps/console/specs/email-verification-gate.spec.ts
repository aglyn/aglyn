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
 * The client's read of the AGL-479 gate (AGL-2691).
 *
 * This predicate exists to STOP requests, so every case that answers `true`
 * is a request the server must also refuse. The cases that keep it honest
 * are therefore the negatives: an impersonated session (AGL-480) and an
 * unreadable token both have to answer `false`, because suppressing either
 * would disable a working feature and report nothing.
 */

import {
  claimsFailEmailGate,
  emailGateWouldRefuse,
} from '../utils/email-verification-gate'

const userWithClaims = (claims: Record<string, unknown>) => ({
  getIdTokenResult: async () => ({ claims }),
})

describe('claimsFailEmailGate (AGL-479/AGL-480)', () => {
  it('refuses an unverified address', () => {
    expect(claimsFailEmailGate({ email_verified: false })).toBe(true)
  })

  it('passes a verified address', () => {
    expect(claimsFailEmailGate({ email_verified: true })).toBe(false)
  })

  it('treats an absent claim as unverified, exactly as the server does', () => {
    // `isEmailVerified` requires `=== true`; a custom-token sign-in carrying
    // no claim is refused. Answering `false` here would leave a 403 through.
    expect(claimsFailEmailGate({})).toBe(true)
  })

  it('is not fooled by a truthy non-boolean claim', () => {
    expect(claimsFailEmailGate({ email_verified: 'true' })).toBe(true)
  })

  it('exempts a staff impersonation session, unverified or not (AGL-480)', () => {
    expect(
      claimsFailEmailGate({
        email_verified: false,
        impersonatedBy: 'staff-uid',
      }),
    ).toBe(false)
  })

  it('CONTROL — a non-string impersonatedBy is no exemption', () => {
    // The server's `isImpersonationSession` is a `typeof … === 'string'`
    // check. A looser client rule would suppress a request the server sends
    // straight back as a 403.
    expect(
      claimsFailEmailGate({ email_verified: false, impersonatedBy: true }),
    ).toBe(true)
  })

  it('CONTROL — no claims at all is not a verdict', () => {
    expect(claimsFailEmailGate(null)).toBe(false)
    expect(claimsFailEmailGate(undefined)).toBe(false)
  })
})

describe('emailGateWouldRefuse (AGL-2691)', () => {
  it('reads the verdict off the token', async () => {
    await expect(
      emailGateWouldRefuse(userWithClaims({ email_verified: false })),
    ).resolves.toBe(true)
    await expect(
      emailGateWouldRefuse(userWithClaims({ email_verified: true })),
    ).resolves.toBe(false)
  })

  it('CONTROL — a token that cannot be read suppresses nothing', async () => {
    // "Could not read" is not the empty claim set (the use-is-staff
    // discipline). A backgrounded tab whose refresh fails must not have its
    // features quietly switched off; the request goes and the server decides.
    await expect(
      emailGateWouldRefuse({
        getIdTokenResult: async () => {
          throw new Error('network')
        },
      }),
    ).resolves.toBe(false)
  })

  it('CONTROL — an account that cannot produce claims suppresses nothing', async () => {
    await expect(emailGateWouldRefuse({})).resolves.toBe(false)
    await expect(emailGateWouldRefuse(null)).resolves.toBe(false)
    await expect(emailGateWouldRefuse(undefined)).resolves.toBe(false)
  })
})
