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
  extractSearchEngineVerificationToken,
  isSearchEngineVerificationToken,
  searchEngineVerificationError,
  searchEngineVerificationMeta,
} from './search-engine-verification'

const GOOGLE = 'x3yQ9_abcDEF-1234567890abcdefghijklmnopqrs'
const BING = '0123456789ABCDEF0123456789ABCDEF'

describe('extractSearchEngineVerificationToken (AGL-3399)', () => {
  it('keeps a bare token, trimmed', () => {
    expect(extractSearchEngineVerificationToken(`  ${GOOGLE}\n`)).toBe(GOOGLE)
  })

  it('reads the content of the whole tag Search Console hands out', () => {
    expect(
      extractSearchEngineVerificationToken(
        `<meta name="google-site-verification" content="${GOOGLE}" />`,
      ),
    ).toBe(GOOGLE)
  })

  it('reads single quotes, content before name, and no self-close', () => {
    expect(
      extractSearchEngineVerificationToken(
        `<META CONTENT='${BING}' NAME='msvalidate.01'>`,
      ),
    ).toBe(BING)
  })

  it('reads an unquoted content value', () => {
    expect(
      extractSearchEngineVerificationToken(
        `<meta name=msvalidate.01 content=${BING}>`,
      ),
    ).toBe(BING)
  })

  it('yields nothing for a tag with no content, or for a non-string', () => {
    expect(
      extractSearchEngineVerificationToken('<meta name="google-site-verification">'),
    ).toBe('')
    expect(extractSearchEngineVerificationToken(undefined)).toBe('')
    expect(extractSearchEngineVerificationToken(42)).toBe('')
  })
})

describe('isSearchEngineVerificationToken', () => {
  it('accepts both engines’ shapes', () => {
    expect(isSearchEngineVerificationToken(GOOGLE)).toBe(true)
    expect(isSearchEngineVerificationToken(BING)).toBe(true)
  })

  it('rejects anything that could leave an attribute, and the empty and oversized', () => {
    for (const junk of [
      '',
      'abc def',
      'abc"onload="x',
      "abc'x",
      '<script>',
      'a/b',
      'a'.repeat(129),
      undefined,
      null,
      123,
    ]) {
      expect([junk, isSearchEngineVerificationToken(junk)]).toEqual([
        junk,
        false,
      ])
    }
    expect(isSearchEngineVerificationToken('a'.repeat(128))).toBe(true)
  })
})

describe('searchEngineVerificationError', () => {
  it('passes empty, a bare token and the matching tag', () => {
    expect(searchEngineVerificationError('google', undefined)).toBeUndefined()
    expect(searchEngineVerificationError('google', '   ')).toBeUndefined()
    expect(searchEngineVerificationError('google', GOOGLE)).toBeUndefined()
    expect(
      searchEngineVerificationError(
        'bing',
        `<meta name="msvalidate.01" content="${BING}" />`,
      ),
    ).toBeUndefined()
  })

  it('refuses junk with a friendly message', () => {
    expect(searchEngineVerificationError('google', 'not a token!')).toMatch(
      /letters, numbers/,
    )
    expect(
      searchEngineVerificationError(
        'google',
        '<meta name="google-site-verification" content="a b" />',
      ),
    ).toMatch(/letters, numbers/)
  })

  it('names the other engine when its tag lands in the wrong field', () => {
    expect(
      searchEngineVerificationError(
        'google',
        `<meta name="msvalidate.01" content="${BING}" />`,
      ),
    ).toMatch(/Bing Webmaster Tools/)
    expect(
      searchEngineVerificationError(
        'bing',
        `<meta name="google-site-verification" content="${GOOGLE}" />`,
      ),
    ).toMatch(/Google Search Console/)
  })

  it('refuses a tag that is for neither engine', () => {
    expect(
      searchEngineVerificationError(
        'google',
        '<meta name="description" content="hello" />',
      ),
    ).toMatch(/isn’t a Google Search Console verification tag/)
  })
})

describe('searchEngineVerificationMeta', () => {
  it('emits one tag per engine that has a valid token, Google first', () => {
    expect(searchEngineVerificationMeta({ bing: BING, google: GOOGLE })).toEqual([
      { name: 'google-site-verification', content: GOOGLE },
      { name: 'msvalidate.01', content: BING },
    ])
  })

  it('emits nothing when unset', () => {
    expect(searchEngineVerificationMeta(undefined)).toEqual([])
    expect(searchEngineVerificationMeta({})).toEqual([])
    expect(searchEngineVerificationMeta({ google: '' })).toEqual([])
  })

  it('never echoes a stored value that fails the pattern', () => {
    expect(
      searchEngineVerificationMeta({
        google: '"><script>alert(1)</script>',
        bing: BING,
      }),
    ).toEqual([{ name: 'msvalidate.01', content: BING }])
  })
})
