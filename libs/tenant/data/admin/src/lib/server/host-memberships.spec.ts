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
 * @jest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchToken } from '@aglyn/aglyn/app-utils/name-search'
import { hostMembershipSearchTokens, membershipRow } from './host-memberships'

/**
 * AGL-1071. The site switcher renders from this projection, so the favicon
 * has to travel with it — and the rows are written with `{ merge: true }`,
 * which makes "omit the key" and "clear the value" two very different things.
 */
describe('membershipRow favicon mirroring (AGL-1071)', () => {
  it('carries the favicon when the site has one', () => {
    const row = membershipRow(
      'org1',
      { displayName: 'Marketing', subdomain: 'mkt', favicon: 'https://x/i.png' },
      'admin',
    )
    expect(row.favicon).toBe('https://x/i.png')
  })

  it('always includes the key, even with no favicon', () => {
    // The load-bearing assertion. `{ merge: true }` means an ABSENT key
    // leaves whatever was already stored, so omitting it on clear would keep
    // showing the icon the user just deleted — indefinitely, until some
    // unrelated write happened to rewrite the row.
    const row = membershipRow('org1', { displayName: 'Marketing' }, 'admin')
    expect('favicon' in row).toBe(true)
    expect(typeof row.favicon).not.toBe('string')
  })

  it('treats the empty-string clear as "remove", not as a value', () => {
    // The Remove button writes `seo.favicon: ''` rather than deleting the
    // field, so a nullish check (`?? delete()`) would happily mirror an empty
    // string and render a broken <img>. Truthiness is the correct test.
    const row = membershipRow(
      'org1',
      { displayName: 'Marketing', favicon: '' },
      'admin',
    )
    expect(row.favicon).not.toBe('')
    expect(typeof row.favicon).not.toBe('string')
  })

  it('still carries the fields the switcher already depended on', () => {
    // Guards against the favicon change quietly dropping a sibling — this row
    // also drives name-prefix search and subdomain routing.
    const row = membershipRow(
      'org1',
      { displayName: 'Marketing Site', subdomain: 'mkt' },
      'editor',
    )
    expect(row.orgId).toBe('org1')
    expect(row.displayName).toBe('Marketing Site')
    expect(row.nameLower).toBe('marketing site')
    expect(row.subdomain).toBe('mkt')
    expect(row.role).toBe('editor')
  })
})

/**
 * AGL-3321. The organization's Sites list is a query over these rows, so a
 * row carries what the list asks of a site: the tokens its quick search
 * matches and the site's creation date its Created filter and order read.
 */
describe('membershipRow carries what the Sites list queries (AGL-3321)', () => {
  const at = (iso: string) => {
    const date = new Date(iso)
    return { toMillis: () => date.getTime(), toDate: () => date }
  }

  it('finds a site by any word of its name, its subdomain or its custom domain', () => {
    const tokens = hostMembershipSearchTokens({
      displayName: 'Harbor Bakery',
      subdomain: 'harbor-bakery',
      cname: 'shop.harbor.example',
    })
    // Each typed word becomes the ONE token the list's query asks for, so a
    // word finds the site exactly when its token is stored.
    for (const typed of ['harbor', 'Bakery', 'harbor-bakery', 'shop', 'shop.harbor', 'example', 'bak']) {
      expect(tokens).toContain(nameSearchToken(typed))
    }
    // A word inside another word is not a word: search is by word prefix.
    expect(tokens).not.toContain(nameSearchToken('akery'))
  })

  it('answers the worked examples the backfill\'s copy is held to', () => {
    // `tools/scripts/backfill-host-memberships-list-fields.mjs` restates this
    // builder for the rows written before it; its --self-test asserts the
    // same file, so the two cannot drift apart without one going red.
    const fixtures = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'host-membership-search-tokens.fixtures.json'),
        'utf8',
      ),
    ) as { tokens: Array<{ meta: Record<string, string>; expected: string[] }> }
    expect(fixtures.tokens.length).toBeGreaterThan(3)
    for (const one of fixtures.tokens) {
      expect(hostMembershipSearchTokens(one.meta)).toEqual(one.expected)
    }
  })

  it('stamps the tokens and the site\'s creation date on the row', () => {
    const created = at('2026-03-04T10:00:00Z')
    const row = membershipRow(
      'org1',
      { displayName: 'Harbor Bakery', subdomain: 'harbor-bakery', createdAt: created },
      'viewer',
    )
    expect(row.searchTokens).toEqual(
      hostMembershipSearchTokens({ displayName: 'Harbor Bakery', subdomain: 'harbor-bakery' }),
    )
    expect(row.createdAt).toBe(created)
  })

  it('writes a missing creation date as null, never omits it', () => {
    // `orderBy('createdAt')` drops a document MISSING the field, so a site
    // with no recorded date would vanish from the list sorted by Created;
    // null keeps it, sorted last. A non-timestamp legacy value is not a date
    // the Created range can compare, so it is null too.
    expect(membershipRow('org1', { displayName: 'Old' }, 'admin').createdAt).toBeNull()
    expect(membershipRow('org1', { displayName: 'Old', createdAt: 1_700_000_000_000 }, 'admin').createdAt).toBeNull()
    expect('createdAt' in membershipRow('org1', undefined, 'admin')).toBe(true)
  })
})
