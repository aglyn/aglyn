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
 * The name-search fields a site member's display name travels with, held to
 * the worked examples the backfill runs too (AGL-3321), so the backfill
 * cannot stamp a key the writers and the Site users query do not use.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { memberNameSearchFields } from './member-name-search'

const FIXTURES = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'site-member-name-search.fixtures.json'),
    'utf8',
  ),
) as {
  cases: Array<{
    displayName: string
    expected: { displayName: string; displayNameLower: string; displayNameTokens: string[] }
  }>
}

describe('memberNameSearchFields', () => {
  it('THE CONTROL: the fixtures are there to hold it to', () => {
    expect(FIXTURES.cases.length).toBeGreaterThan(3)
  })

  it.each(FIXTURES.cases)('stamps $displayName as the fixtures say', ({ displayName, expected }) => {
    expect(memberNameSearchFields(displayName)).toEqual(expected)
  })

  it('finds a member by any word of the name, not only the first', () => {
    expect(memberNameSearchFields('Ada Lovelace').displayNameTokens).toEqual(
      expect.arrayContaining(['ada', 'lovelace']),
    )
  })
})
