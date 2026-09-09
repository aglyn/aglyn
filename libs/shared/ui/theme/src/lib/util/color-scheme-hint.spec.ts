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
 * The device preference, as it actually arrives on the wire.
 *
 * `Sec-CH-Prefers-Color-Scheme` is a structured-field string, so a conforming
 * user agent may quote it — and the whole point of the hint is to decide the
 * scheme before anything renders, which means a spelling this parser fails to
 * recognize is not a degraded answer but the wrong one: a dark device served a
 * light document.
 */

import {
  COLOR_SCHEME_HINT_HEADER,
  parseColorSchemeHint,
} from './color-scheme-hint'

describe('parseColorSchemeHint', () => {
  it('reads a bare token', () => {
    expect(parseColorSchemeHint('dark')).toBe('dark')
    expect(parseColorSchemeHint('light')).toBe('light')
  })

  it('reads the quoted structured-field form', () => {
    expect(parseColorSchemeHint('"dark"')).toBe('dark')
    expect(parseColorSchemeHint('"light"')).toBe('light')
  })

  it('tolerates the whitespace and casing a proxy may introduce', () => {
    expect(parseColorSchemeHint(' dark ')).toBe('dark')
    expect(parseColorSchemeHint('Dark')).toBe('dark')
    expect(parseColorSchemeHint(' "DARK" ')).toBe('dark')
  })

  describe('anything that is not a scheme is "the request did not say"', () => {
    // Never light. A value this parser does not know is a value it cannot act
    // on, and guessing light would pin every device it misread to the scheme
    // the hint exists to stop being the default.
    it('a request that carried no header', () => {
      expect(parseColorSchemeHint(undefined)).toBeNull()
      expect(parseColorSchemeHint(null)).toBeNull()
      expect(parseColorSchemeHint('')).toBeNull()
    })

    it('a token from outside the pair', () => {
      expect(parseColorSchemeHint('no-preference')).toBeNull()
      expect(parseColorSchemeHint('sepia')).toBeNull()
    })

    it('a value wearing the shape of one', () => {
      expect(parseColorSchemeHint('darkness')).toBeNull()
      expect(parseColorSchemeHint('dark, light')).toBeNull()
    })
  })
})

describe('COLOR_SCHEME_HINT_HEADER', () => {
  /**
   * Pinned as a literal because it is a name browsers agree on, not one this
   * repo chooses: the middleware advertises it in `Accept-CH`, the browser
   * matches that spelling to decide what to send, and the layout looks the
   * value up by the same constant. A rename here compiles perfectly and stops
   * every hint arriving.
   */
  it('is the header name browsers implement', () => {
    expect(COLOR_SCHEME_HINT_HEADER).toBe('Sec-CH-Prefers-Color-Scheme')
  })

  it('finds the header however the transport cased it', () => {
    // HTTP/2 lowercases every field name, so the canonical spelling above is
    // never the one on the wire; `Headers` is what makes one constant serve
    // both directions.
    const request = new Headers({ 'sec-ch-prefers-color-scheme': 'dark' })
    expect(parseColorSchemeHint(request.get(COLOR_SCHEME_HINT_HEADER))).toBe(
      'dark',
    )
  })
})
