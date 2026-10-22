/**
 * @jest-environment jsdom
 */
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
  besignerEntryNeedsSignIn,
  besignerEntryTarget,
  isNativeAppWebView,
  markNativeAppWebView,
} from './besigner-entry'

describe('besignerEntryTarget (AGL-3850)', () => {
  it('passes a Besigner path through, query intact', () => {
    const path = '/acme/hosts/shop/screens/s1/versions/v2/besigner?panel=layers'
    expect(besignerEntryTarget(path)).toBe(path)
  })

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['an absolute URL', 'https://app.aglyn.com/acme/hosts/shop/theme'],
    ['another site', 'https://evil.example/besigner'],
    ['a protocol-relative address', '//evil.example/besigner'],
    ['a backslash trick', '/\\evil.example/besigner'],
    ['a relative path', 'acme/hosts/shop/theme'],
    ['the sign-in wall', '/signin?continue=%2F'],
    ['the sign-out page', '/signout'],
  ])('refuses %s', (_label, value) => {
    expect(besignerEntryTarget(value)).toBeNull()
  })
})

describe('besignerEntryNeedsSignIn (AGL-3850)', () => {
  it('signs in a web view that holds nobody', () => {
    expect(besignerEntryNeedsSignIn({ uid: 'u1' }, null)).toBe(true)
  })

  it('keeps the account the web view already holds when it is the same one', () => {
    expect(besignerEntryNeedsSignIn({ uid: 'u1', tenantId: null }, { uid: 'u1' })).toBe(false)
  })

  it('switches when the app minted the cookie for another account', () => {
    expect(besignerEntryNeedsSignIn({ uid: 'u2' }, { uid: 'u1' })).toBe(true)
  })

  it('switches when the same uid belongs to another pool', () => {
    expect(
      besignerEntryNeedsSignIn({ uid: 'u1', tenantId: 'sso-1' }, { uid: 'u1', tenantId: null }),
    ).toBe(true)
  })

  it('leaves the web view alone when the answer names no account', () => {
    expect(besignerEntryNeedsSignIn({}, { uid: 'u1' })).toBe(false)
  })
})

describe('the native app web view mark (AGL-3850)', () => {
  afterEach(() => window.sessionStorage.clear())

  it('is absent in an ordinary tab', () => {
    expect(isNativeAppWebView()).toBe(false)
  })

  it('holds for the tab once the entry page marked it', () => {
    markNativeAppWebView()
    expect(isNativeAppWebView()).toBe(true)
  })
})
