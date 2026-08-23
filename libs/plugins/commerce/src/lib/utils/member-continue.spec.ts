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

import { safeContinuePath } from './member-continue'

describe('safeContinuePath (AGL-553)', () => {
  it('passes plain relative paths through', () => {
    expect(safeContinuePath('/members/welcome')).toBe('/members/welcome')
    expect(safeContinuePath('/shop?item=1#top')).toBe('/shop?item=1#top')
  })

  it('falls back for absolute and protocol-relative URLs', () => {
    expect(safeContinuePath('https://evil.example')).toBe('/')
    expect(safeContinuePath('//evil.example/phish')).toBe('/')
    expect(safeContinuePath('javascript:alert(1)')).toBe('/')
  })

  it('falls back for backslash smuggling and empty values', () => {
    expect(safeContinuePath('/\\evil.example')).toBe('/')
    expect(safeContinuePath('')).toBe('/')
    expect(safeContinuePath(null)).toBe('/')
    expect(safeContinuePath(undefined, '/account')).toBe('/account')
  })

  /**
   * AGL-1881 — the characters the URL parser deletes before it parses. Each of
   * these contains neither `//` nor `\`, so every previous version of this
   * guard passed them straight through to a storefront member's post-sign-in
   * navigation.
   */
  it.each([
    ['a tab in the authority', '/\t/evil.example'],
    ['a newline in the authority', '/\n/evil.example'],
    ['a carriage return in the authority', '/\r/evil.example'],
    ['a tab concealing a backslash', '/\t\\evil.example'],
  ])('falls back for %s', (_label, candidate) => {
    expect(new URL(candidate, 'https://shop.example').origin).toBe(
      'https://evil.example',
    )
    expect(safeContinuePath(candidate)).toBe('/')
  })
})
