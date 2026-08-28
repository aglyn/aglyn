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
 * Hub section indexes redirect on the SERVER, and carry the query (AGL-693).
 *
 * Two properties, and they fail in opposite ways.
 *
 * The first is what the reader sees. These indexes were client components that
 * returned `null`, waited for hydration, resolved the org slug from a hook and
 * then client-navigated — load the index chunk, hydrate, resolve, navigate,
 * load the target chunk, render, with every step of that a blank main area.
 * The guard is structural rather than visual: a page whose module carries
 * `'use client'` cannot issue an HTTP redirect, so the assertion is on the
 * SOURCE. A rendering test would pass on the slow version.
 *
 * The second is what a third party put in the URL. Stripe bakes `?connect=`
 * into account-onboarding links and `?purchase=` into checkout sessions, so a
 * seller part-way through onboarding is carrying one right now — held
 * externally, and unfixable from our side once a redirect has dropped it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  sectionIndexTarget,
  type SearchParams,
} from '../utils/section-index-redirect'

const APP = join(__dirname, '../app')

/** Every hub index that redirects to a first section. */
const INDEX_PAGES = [
  '(app)/[orgSlug]/settings/page.tsx',
  '(app)/[orgSlug]/team/page.tsx',
  '(app)/[orgSlug]/hosts/[host]/admin/page.tsx',
  '(app)/[orgSlug]/marketplace/page.tsx',
  '(app)/manage/user/page.tsx',
]

describe('a hub index redirects on the server (AGL-693)', () => {
  it.each(INDEX_PAGES)('%s is not a client component', (page) => {
    const path = join(APP, page)
    expect({ page, exists: existsSync(path) }).toEqual({ page, exists: true })
    const source = readFileSync(path, 'utf8')
    // `'use client'` is what forces the whole slow sequence: a client page
    // cannot answer with an HTTP redirect, so it must ship, hydrate and then
    // navigate.
    expect({ page, clientComponent: source.includes("'use client'") }).toEqual({
      page,
      clientComponent: false,
    })
  })

  it.each(INDEX_PAGES)('%s redirects rather than rendering', (page) => {
    const source = readFileSync(join(APP, page), 'utf8')
    expect({ page, redirects: /\bredirect\s*\(/.test(source) }).toEqual({
      page,
      redirects: true,
    })
    // The client-navigation shape these replaced. Its absence is the point:
    // `router.replace` here means the hop is back in front of the reader.
    expect({ page, clientNav: source.includes('router.replace') }).toEqual({
      page,
      clientNav: false,
    })
  })
})

/** The balanced `(...)` beginning at `from`, as source. */
function balancedCall(code: string, from: number): string {
  const open = code.indexOf('(', from)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1
    else if (code[i] === ')') {
      depth -= 1
      if (depth === 0) return code.slice(open, i + 1)
    }
  }
  return ''
}

/**
 * Each index actually FEEDS its query to the helper (AGL-693).
 *
 * The helper's own tests prove it preserves what it is given, and the tests
 * above prove each page redirects — and both stayed green while one page
 * passed `undefined` instead of its `searchParams`. Found by breaking it: a
 * whole page can silently drop the query with every other assertion in this
 * file passing, because none of them looks at the call site.
 */
describe('every index passes its own query to the helper', () => {
  it.each(INDEX_PAGES)('%s forwards searchParams', (page) => {
    const source = readFileSync(join(APP, page), 'utf8')
    // `sectionIndexTarget(` with the paren: the bare name also appears in
    // the import, and starting the scan there reads the import list.
    const at = source.indexOf('sectionIndexTarget(')
    expect({ page, callsHelper: at >= 0 }).toEqual({ page, callsHelper: true })
    const call = balancedCall(source, at)
    /*
     * The query argument is a real value, not a hole. Matching the literal
     * name `searchParams` inside the call would be wrong: an index that needs
     * the query twice — the marketplace one reads it to pick a return section
     * — binds `await searchParams` to a local and passes that. What must never
     * appear is `undefined`, which is exactly the shape a dropped query takes.
     */
    expect({ page, dropsQuery: /,\s*undefined\s*,?\s*\)$/.test(call) }).toEqual({
      page,
      dropsQuery: false,
    })
    // …and the page did read its own query rather than passing someone else's.
    expect({ page, reads: source.includes('await searchParams') }).toEqual({
      page,
      reads: true,
    })
  })

  it.each(INDEX_PAGES)('%s declares searchParams as a prop', (page) => {
    const source = readFileSync(join(APP, page), 'utf8')
    // Without the prop there is nothing to forward: Next only supplies the
    // query to a page that asks for it.
    expect({
      page,
      declared: /searchParams:\s*Promise<SearchParams>/.test(source),
    }).toEqual({ page, declared: true })
  })
})

describe('a redirect carries the query across (AGL-693)', () => {
  const target = (query: SearchParams) =>
    sectionIndexTarget('/acme/marketplace/browse', query)

  /*
   * The CONTROL. Every assertion below is "the query survived", and a function
   * that appended its input blindly would satisfy them while breaking the
   * ordinary case. This is the reading that proves it does not append `?` to a
   * URL nobody put a query on.
   */
  it('CONTROL: adds nothing when there is no query', () => {
    expect(target({})).toBe('/acme/marketplace/browse')
    expect(sectionIndexTarget('/acme/team/members', undefined)).toBe(
      '/acme/team/members',
    )
  })

  /*
   * The case a third party holds. Stripe bakes these into onboarding links and
   * checkout sessions; dropping one silently deletes information we cannot
   * reissue from this side.
   */
  it('keeps a Stripe return marker', () => {
    expect(target({ connect: 'return' })).toBe(
      '/acme/marketplace/browse?connect=return',
    )
    expect(target({ purchase: 'lst_123' })).toBe(
      '/acme/marketplace/browse?purchase=lst_123',
    )
  })

  it('keeps every parameter, not only the ones we route on', () => {
    const href = target({ purchase: 'lst_1', utm_source: 'newsletter' })
    expect(href.startsWith('/acme/marketplace/browse?')).toBe(true)
    const query = new URLSearchParams(href.split('?')[1])
    expect(query.get('purchase')).toBe('lst_1')
    // A marker nothing routes on still survives the hop, which is what makes
    // it safe for anyone to add one.
    expect(query.get('utm_source')).toBe('newsletter')
  })

  it('keeps both halves of a repeated key', () => {
    const href = target({ tag: ['a', 'b'] })
    expect(new URLSearchParams(href.split('?')[1]).getAll('tag')).toEqual([
      'a',
      'b',
    ])
  })

  it('encodes a value rather than pasting it in raw', () => {
    const href = target({ next: '/acme/settings?x=1&y=2' })
    const query = new URLSearchParams(href.split('?')[1])
    // Round-trips: an unencoded `&` would split the value into two parameters
    // and silently truncate wherever it was going.
    expect(query.get('next')).toBe('/acme/settings?x=1&y=2')
  })

  it('drops a key whose value is absent rather than writing "undefined"', () => {
    expect(target({ connect: undefined })).toBe('/acme/marketplace/browse')
  })
})
