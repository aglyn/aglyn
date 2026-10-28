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

import { withVisitorQuery } from './redirect-query'

const SIGNUP =
  'https://app.aglyn.com/signup?utm_source=event&utm_medium=qr&utm_campaign=booth-left'

describe('withVisitorQuery', () => {
  it('CONTROL — no visitor query leaves the destination exactly as written', () => {
    expect(withVisitorQuery(SIGNUP, '')).toBe(SIGNUP)
    expect(withVisitorQuery(SIGNUP, '?')).toBe(SIGNUP)
  })

  it("appends the visitor's parameters to the rule's own", () => {
    expect(withVisitorQuery(SIGNUP, '?ref=flyer&lang=es')).toBe(
      `${SIGNUP}&ref=flyer&lang=es`,
    )
  })

  it("keeps the rule's value when the visitor brings the same key", () => {
    expect(
      withVisitorQuery(SIGNUP, '?utm_campaign=hijack&ref=flyer'),
    ).toBe(`${SIGNUP}&ref=flyer`)
  })

  it('gives a destination with no query of its own the whole visitor query', () => {
    expect(withVisitorQuery('/pricing', '?plan=pro&interval=year')).toBe(
      '/pricing?plan=pro&interval=year',
    )
  })

  it('puts the query before the fragment', () => {
    expect(withVisitorQuery('/docs?x=1#install', '?ref=sign')).toBe(
      '/docs?x=1&ref=sign#install',
    )
    expect(withVisitorQuery('https://example.com/a#top', 'b=2')).toBe(
      'https://example.com/a?b=2#top',
    )
  })

  it("keeps repeated visitor keys and the rule's own encoding", () => {
    expect(withVisitorQuery('/s?q=a%20b', '?tag=x&tag=y')).toBe(
      '/s?q=a%20b&tag=x&tag=y',
    )
  })

  it('returns the destination untouched when every visitor key is the rule’s', () => {
    expect(withVisitorQuery(SIGNUP, '?utm_source=other')).toBe(SIGNUP)
  })
})
