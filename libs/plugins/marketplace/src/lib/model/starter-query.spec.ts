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

import { SITE_STARTER_SEARCH_MAX } from './site-starter-listing'
import {
  parseStarterSearchAnswer,
  readStarterSummary,
  starterCardFacts,
  starterPagesLabel,
  starterPriceLabel,
  starterQueryFrom,
  starterQueryParams,
} from './starter-query'

/**
 * The starter search as a request and an answer (AGL-4049). The native apps
 * mirror this file in phase 5, so what is pinned here is the contract they
 * copy: the parameters and their order, what the route accepts back, the
 * defensive read, and the words a card shows.
 */

const ROW = {
  listingId: 'fp-starter-restaurant-base',
  displayName: 'Corner bistro',
  description: 'A starter',
  authorName: 'Aglyn',
  official: true,
  priceUsd: 0,
  previewImageUrl: 'https://console.example/_static/starter/styles/restaurant.webp',
  facets: { kind: 'restaurant', base: 'starter', fonts: 'jakarta', pages: 4, mode: 'base' },
  category: 'Restaurant & café',
}

describe('starterQueryParams', () => {
  it('writes one search as one URL, its parameters always in the same order', () => {
    const params = starterQueryParams({
      orgId: 'org-1',
      mode: 'ai',
      word: '  bistro  ',
      filter: { fonts: 'inter', kind: 'restaurant', base: 'material3' },
      limit: 12,
    })
    expect(params.toString()).toBe(
      'orgId=org-1&mode=ai&q=bistro&kind=restaurant&base=material3&fonts=inter&limit=12',
    )
  })

  it('leaves out what was not asked, and asks for the most a search answers by default', () => {
    expect(starterQueryParams({ orgId: 'org-1', mode: 'base', word: '   ' }).toString()).toBe(
      `orgId=org-1&mode=base&limit=${SITE_STARTER_SEARCH_MAX}`,
    )
  })

  it('caps the limit at the most a search answers', () => {
    expect(starterQueryParams({ orgId: 'org-1', mode: 'base', limit: 500 }).get('limit')).toBe(
      String(SITE_STARTER_SEARCH_MAX),
    )
  })
})

describe('starterQueryFrom', () => {
  const read = (query: string) => starterQueryFrom(new URLSearchParams(query))

  it('reads back exactly what starterQueryParams wrote', () => {
    const written = starterQueryParams({
      orgId: 'org-1',
      mode: 'ai',
      word: 'bistro',
      filter: { kind: 'restaurant', base: 'material3', fonts: 'inter' },
      limit: 12,
    })
    expect(starterQueryFrom(written)).toEqual({
      orgId: 'org-1',
      mode: 'ai',
      word: 'bistro',
      filter: { mode: 'ai', kind: 'restaurant', base: 'material3', fonts: 'inter' },
      limit: 12,
    })
  })

  it('asks for base starters when no mode is named, and always filters on the mode', () => {
    expect(read('orgId=org-1')).toEqual({
      orgId: 'org-1',
      mode: 'base',
      word: '',
      filter: { mode: 'base' },
      limit: SITE_STARTER_SEARCH_MAX,
    })
  })

  it.each([
    ['', 'Missing orgId'],
    ['orgId=a/b', 'Missing orgId'],
    ['orgId=org-1&mode=full', 'Unknown mode'],
    ['orgId=org-1&kind=Not%20a%20kind', 'Unknown kind of site'],
    ['orgId=org-1&base=windows95', 'Unknown base theme'],
    ['orgId=org-1&fonts=comic-sans', 'Unknown font pairing'],
  ])('refuses %j: %s', (query, error) => {
    expect(read(query)).toEqual({ error })
  })
})

describe('readStarterSummary', () => {
  it('keeps a summary’s fields and nothing else — never the answers or the pages', () => {
    const row = readStarterSummary({
      ...ROW,
      answers: { brief: 'what the buyer pays for' },
      screens: [{ slug: '/' }],
      theme: { kind: 'full' },
    })
    expect(row).toEqual(ROW)
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'authorName',
        'category',
        'description',
        'displayName',
        'facets',
        'listingId',
        'official',
        'previewImageUrl',
        'priceUsd',
      ].sort(),
    )
  })

  it('falls back field by field the way a card needs', () => {
    expect(
      readStarterSummary({
        listingId: ' x ',
        priceUsd: -3,
        official: 'yes',
        previewImageUrl: '',
        facets: { pages: 2.7, mode: 'other', kind: '' },
      }),
    ).toEqual({
      listingId: 'x',
      displayName: '',
      description: '',
      authorName: '',
      official: false,
      priceUsd: 0,
      previewImageUrl: null,
      facets: { kind: null, base: null, fonts: null, pages: 2, mode: 'base' },
      category: null,
    })
  })

  it.each([null, 'row', [], {}, { listingId: '' }, { listingId: 3 }])(
    'reads %j as no starter',
    (value) => {
      expect(readStarterSummary(value)).toBeNull()
    },
  )
})

describe('parseStarterSearchAnswer', () => {
  it('reads rows and labels, dropping what is not a starter and a repeated listing', () => {
    expect(
      parseStarterSearchAnswer({
        rows: [ROW, { listingId: '' }, 'junk', { ...ROW, displayName: 'Again' }],
        labels: { base: { material3: 'Material 3', empty: '', bad: 3 }, fonts: { inter: 'Inter' } },
      }),
    ).toEqual({
      rows: [ROW],
      labels: { base: { material3: 'Material 3' }, fonts: { inter: 'Inter' } },
    })
  })

  it.each([undefined, null, 'nope', { rows: 'x', labels: [] }])('never throws on %j', (json) => {
    expect(parseStarterSearchAnswer(json)).toEqual({ rows: [], labels: { base: {}, fonts: {} } })
  })
})

describe('the words on a card', () => {
  it.each([
    [0, 'Free'],
    [-1, 'Free'],
    [Number.NaN, 'Free'],
    [12, '$12'],
    [12.5, '$12.50'],
  ])('prices %p as %j', (usd, label) => {
    expect(starterPriceLabel(usd)).toBe(label)
  })

  it.each([
    [0, null],
    [1, '1 page'],
    [5, '5 pages'],
    [5.9, '5 pages'],
  ])('counts %p pages as %j', (pages, label) => {
    expect(starterPagesLabel(pages)).toBe(label)
  })

  it('reads a card’s chips in order: price, Aglyn, AI, kind, pages', () => {
    const ai = readStarterSummary({ ...ROW, priceUsd: 12, facets: { ...ROW.facets, mode: 'ai' } })
    expect(starterCardFacts(ai!)).toEqual([
      { key: 'price', label: '$12' },
      { key: 'official', label: 'Aglyn' },
      { key: 'ai', label: 'AI' },
      { key: 'kind', label: 'Restaurant & café' },
      { key: 'pages', label: '4 pages' },
    ])
  })

  it('puts a price on every card, Free included, and leaves out what a starter does not say', () => {
    const plain = readStarterSummary({ listingId: 'p', official: false })
    expect(starterCardFacts(plain!)).toEqual([{ key: 'price', label: 'Free' }])
  })
})
