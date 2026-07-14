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
  authSignInHost,
  buildDelegatedSignInUrl,
  clearDelegationBounces,
  recordDelegationBounce,
  shouldDelegateSignIn,
} from './auth-delegation'

describe('shouldDelegateSignIn', () => {
  it('delegates org workspace subdomains', () => {
    expect(shouldDelegateSignIn('aglyn-org.aglyn.io')).toBe(true)
    expect(shouldDelegateSignIn('acme.aglyn.io')).toBe(true)
    expect(shouldDelegateSignIn('aglyn-org.aglyn.io:443')).toBe(true)
  })

  it('does not delegate the apex or platform/auth hosts', () => {
    expect(shouldDelegateSignIn('aglyn.io')).toBe(false)
    expect(shouldDelegateSignIn('app.aglyn.io')).toBe(false)
    expect(shouldDelegateSignIn('auth.aglyn.io')).toBe(false)
    expect(shouldDelegateSignIn('www.aglyn.io')).toBe(false)
    expect(shouldDelegateSignIn('console.aglyn.io')).toBe(false)
    expect(shouldDelegateSignIn('admin.aglyn.io')).toBe(false)
  })

  it('does not delegate off-workspace hosts (localhost, previews)', () => {
    expect(shouldDelegateSignIn('localhost')).toBe(false)
    expect(shouldDelegateSignIn('localhost:4200')).toBe(false)
    expect(shouldDelegateSignIn('app-aglyn-abc.vercel.app')).toBe(false)
    // A look-alike suffix must not be treated as same-site.
    expect(shouldDelegateSignIn('evil-aglyn.io')).toBe(false)
  })

  it('does not delegate deeper nested hosts (not a single org label)', () => {
    expect(shouldDelegateSignIn('a.b.aglyn.io')).toBe(false)
  })

  describe('on mobile', () => {
    const mobile = { isMobile: true }
    it('delegates apex/platform hosts too (cross-origin authDomain breaks redirect)', () => {
      expect(shouldDelegateSignIn('app.aglyn.io', mobile)).toBe(true)
      expect(shouldDelegateSignIn('console.aglyn.io', mobile)).toBe(true)
      expect(shouldDelegateSignIn('aglyn-org.aglyn.io', mobile)).toBe(true)
    })
    it('never delegates the auth host itself (same-origin OAuth)', () => {
      expect(shouldDelegateSignIn('auth.aglyn.io', mobile)).toBe(false)
    })
    it('still signs in locally off-workspace (previews/localhost)', () => {
      expect(shouldDelegateSignIn('localhost:4200', mobile)).toBe(false)
      expect(shouldDelegateSignIn('app-aglyn-abc.vercel.app', mobile)).toBe(
        false,
      )
    })
  })
})

describe('buildDelegatedSignInUrl', () => {
  it('carries an absolute same-site return on the auth host', () => {
    expect(
      buildDelegatedSignInUrl('https://aglyn-org.aglyn.io', '/screens'),
    ).toBe(
      'https://auth.aglyn.io/signin?continue=' +
        encodeURIComponent('https://aglyn-org.aglyn.io/screens'),
    )
  })

  it('routes signup to the auth host signup page', () => {
    expect(
      buildDelegatedSignInUrl('https://acme.aglyn.io', '/', 'signup'),
    ).toBe(
      'https://auth.aglyn.io/signup?continue=' +
        encodeURIComponent('https://acme.aglyn.io/'),
    )
  })

  it('sanitizes an unsafe return path to root (no open redirect)', () => {
    expect(
      buildDelegatedSignInUrl('https://acme.aglyn.io', '//evil.com'),
    ).toBe(
      'https://auth.aglyn.io/signin?continue=' +
        encodeURIComponent('https://acme.aglyn.io/'),
    )
  })

  it('exposes the auth host', () => {
    expect(authSignInHost()).toBe('auth.aglyn.io')
  })
})

describe('delegation loop breaker', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    jest.restoreAllMocks()
  })

  it('allows redirects up to the cap, then stops', () => {
    expect(recordDelegationBounce()).toBe(true) // 1
    expect(recordDelegationBounce()).toBe(true) // 2
    expect(recordDelegationBounce()).toBe(true) // 3 (cap)
    expect(recordDelegationBounce()).toBe(false) // 4 — loop broken
  })

  it('clears the counter on a successful sign-in', () => {
    recordDelegationBounce()
    recordDelegationBounce()
    clearDelegationBounces()
    expect(recordDelegationBounce()).toBe(true) // counting restarts
  })

  it('resets after the window elapses so a later attempt is not blocked', () => {
    const now = 2_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    recordDelegationBounce()
    recordDelegationBounce()
    recordDelegationBounce()
    expect(recordDelegationBounce()).toBe(false) // capped within the window
    ;(Date.now as jest.Mock).mockReturnValue(now + 30_001)
    expect(recordDelegationBounce()).toBe(true) // window elapsed — fresh count
  })
})
