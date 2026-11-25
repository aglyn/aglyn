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

import { buildTransferFieldCatalog, matchHeaders, readTransferSource } from '@aglyn/aglyn/data-transfer'
import { matchRedirect, validateRedirectRule } from '../model/redirects'
import { REDIRECTS_ALIAS_DICTIONARIES, redirectsTransferCatalog } from './redirects-transfer-fields'
import {
  SQUARESPACE_URL_MAPPINGS_SOURCE,
  looksLikeSquarespaceUrlMappings,
  readSquarespaceUrlMappings,
  squarespaceUrlMappingsCsv,
} from './squarespace-url-mappings'

/**
 * Squarespace's URL mappings (AGL-4245): the text of its Settings box, hand
 * written here as the platform documents it, read into the CSV the redirects
 * import takes.
 */

const PASTED = [
  '# Old blog moved to news',
  '/about-us -> /about 301',
  '',
  '   /Old-Menu/   ->   /menu   302  ',
  '/blog/[name] -> /news/[name] 301',
  '/shop/[category]/[item] -> /store/[item] 301',
  '/gone -> /nowhere/[slug] 301',
  '/contact -> https://forms.example.com/acme 301',
  '/odd -> /even 303',
  '/no-code -> /with-default',
].join('\n')

describe('reading Squarespace URL mappings', () => {
  it('reads each rule line, comments and blank lines skipped, extra spaces folded', () => {
    const read = readSquarespaceUrlMappings(PASTED)
    expect(read.rules).toEqual([
      { line: 2, source: '/about-us', destination: '/about', statusCode: 301, kind: 'exact' },
      { line: 4, source: '/Old-Menu/', destination: '/menu', statusCode: 302, kind: 'exact' },
      { line: 5, source: '^/blog/([^/]+)$', destination: '/news/$1', statusCode: 301, kind: 'regex' },
      { line: 6, source: '^/shop/([^/]+)/([^/]+)$', destination: '/store/$2', statusCode: 301, kind: 'regex' },
      { line: 8, source: '/contact', destination: 'https://forms.example.com/acme', statusCode: 301, kind: 'exact' },
      { line: 10, source: '/no-code', destination: '/with-default', kind: 'exact' },
    ])
    expect(read.skipped).toEqual([
      { line: 7, text: '/gone -> /nowhere/[slug] 301', reason: 'it sends visitors to [slug], which the old address does not have' },
      { line: 9, text: '/odd -> /even 303', reason: '303 is not a redirect type Squarespace uses; use 301 or 302' },
    ])
  })

  it('turns a [variable] rule into a pattern the redirects matcher runs, with the segment carried', () => {
    const [blog, shop] = readSquarespaceUrlMappings(PASTED).rules.filter((rule) => rule.kind === 'regex')
    for (const rule of [blog, shop]) expect(validateRedirectRule(rule as never)).toBeNull()
    const rules = [blog, shop].map((rule) => ({ ...(rule as object), enabled: true })) as never
    expect(matchRedirect(rules, '/blog/spring-sale')).toMatchObject({ destination: '/news/spring-sale', statusCode: 301 })
    expect(matchRedirect(rules, '/shop/shoes/red-boot')).toMatchObject({ destination: '/store/red-boot' })
    // One segment only, as the variable is.
    expect(matchRedirect(rules, '/blog/2024/spring-sale')).toBeNull()
  })

  it('knows its own text, and leaves any other text to the step', () => {
    expect(looksLikeSquarespaceUrlMappings(PASTED)).toBe(true)
    expect(looksLikeSquarespaceUrlMappings('Redirect from,Redirect to\n/a,/b')).toBe(false)
    expect(looksLikeSquarespaceUrlMappings('# only a comment\n')).toBe(false)
    expect(squarespaceUrlMappingsCsv('source,target\n/a,/b')).toBeNull()
  })

  it('lists a line that is not a rule as not imported', () => {
    const read = readSquarespaceUrlMappings('/a -> /b 301\n/c -> \n')
    expect(read.rules).toHaveLength(1)
    expect(read.skipped).toEqual([{ line: 2, text: '/c ->', reason: 'it is not in the form /old-page -> /new-page 301' }])
  })

  it('writes a CSV the import reads and maps on its own, with what it read said', () => {
    const csv = squarespaceUrlMappingsCsv(PASTED)
    expect(csv?.source).toBe(SQUARESPACE_URL_MAPPINGS_SOURCE)
    expect(csv?.notes).toEqual([
      'Read as Squarespace URL mappings: 6 redirects, 2 with [variables] brought in as patterns.',
      'Line 7 is not imported: it sends visitors to [slug], which the old address does not have. (/gone -> /nowhere/[slug] 301)',
      'Line 9 is not imported: 303 is not a redirect type Squarespace uses; use 301 or 302. (/odd -> /even 303)',
    ])
    const read = readTransferSource(csv?.text ?? '', 'csv')
    if (!read.ok) throw new Error('the CSV did not read')
    expect(read.table.rows).toHaveLength(6)
    expect(read.table.rows[2]).toEqual(['^/blog/([^/]+)$', '/news/$1', '301', 'regex'])
    const catalog = buildTransferFieldCatalog(redirectsTransferCatalog())
    const matched = matchHeaders(read.table.headers, catalog.fields, { dictionaries: REDIRECTS_ALIAS_DICTIONARIES })
    expect(matched.mapping).toEqual({ 0: 'source', 1: 'destination', 2: 'statusCode', 3: 'kind' })
  })
})
