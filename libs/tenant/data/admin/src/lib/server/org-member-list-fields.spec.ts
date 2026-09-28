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
 * What the team roster's query filters and searches a member by (AGL-3321),
 * held to the worked examples the backfill's script-side twin answers too.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { consoleUserType, isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { orgMemberListFields, orgMemberSearchTokens } from './org-member-list-fields'

const FIXTURES = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'org-member-list-fields.fixtures.json'),
    'utf8',
  ),
) as {
  cases: Array<{
    name: string
    member: Record<string, unknown>
    expected: { consoleUserType: string; searchTokens: string[] }
  }>
}

describe('orgMemberListFields', () => {
  it('THE CONTROL: the fixtures are there to answer', () => {
    expect(FIXTURES.cases.length).toBeGreaterThan(4)
  })

  it.each(FIXTURES.cases.map((one) => [one.name, one] as const))(
    'the worked example the backfill shares: %s',
    (_name, one) => {
      expect(orgMemberListFields(one.member)).toEqual(one.expected)
    },
  )

  it('reads Access exactly as the console and the seat meter read it', () => {
    for (const one of FIXTURES.cases) {
      expect(orgMemberListFields(one.member).consoleUserType).toBe(consoleUserType(one.member))
      expect(orgMemberListFields(one.member).consoleUserType === 'manager').toBe(
        isOrgWideMember(one.member),
      )
    }
  })

  it('finds a member by a word of the name, the address or the job title', () => {
    const tokens = orgMemberSearchTokens({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      title: 'Head of Ops',
    })
    const finds = (typed: string) => tokens.includes(nameSearchNormalizers.token(typed))
    for (const typed of ['ada', 'Lovelace', 'example', 'example.com', 'head', 'ops']) {
      expect({ typed, found: finds(typed) }).toEqual({ typed, found: true })
    }
    expect(finds('velace')).toBe(false)
  })
})
