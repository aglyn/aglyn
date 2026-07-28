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

import { membershipRow } from './host-memberships'

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
