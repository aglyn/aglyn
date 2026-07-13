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
