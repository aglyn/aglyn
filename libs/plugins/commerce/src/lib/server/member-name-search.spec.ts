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
 * What the Site users list finds a site member by (AGL-3321): the Name
 * filter's keys and the quick search's tokens, as the two writers stamp
 * them. The word-prefix tokens themselves are `nameSearchTokens`, held to
 * their own fixtures in `name-search.spec.ts`; this holds what the member's
 * fields are MADE of, which `tools/scripts/backfill-site-member-search.mjs`
 * composes the same way (its `--self-test` asserts the same examples).
 */

import { nameSearchNormalizers, nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { memberNameSearchFields, memberSearchTokens } from './member-name-search'

/** Whether a typed word, asked the way the list's query asks it, finds these tokens. */
const finds = (tokens: string[], typed: string) =>
  tokens.includes(nameSearchNormalizers.token(typed))

describe('memberNameSearchFields', () => {
  it('keys the name for the Name filter: lower-cased, and every word\'s prefixes', () => {
    expect(memberNameSearchFields('  Ada   Lovelace ')).toEqual({
      displayName: '  Ada   Lovelace ',
      displayNameLower: 'ada lovelace',
      displayNameTokens: nameSearchTokens('Ada Lovelace'),
    })
  })
})

describe('memberSearchTokens', () => {
  const ada = memberSearchTokens('Ada Lovelace', 'ada@example.com')

  it('finds a member by any word of the name or of the address', () => {
    for (const typed of ['ada', 'Lovelace', 'example', 'example.com', 'ada@example.com']) {
      expect({ typed, found: finds(ada, typed) }).toEqual({ typed, found: true })
    }
  })

  it('does not find a member by the middle of a word', () => {
    for (const typed of ['velace', 'ample']) {
      expect({ typed, found: finds(ada, typed) }).toEqual({ typed, found: false })
    }
  })

  it('finds a member who never gave a name by their address', () => {
    const tokens = memberSearchTokens(undefined, 'ops@acme.io')
    expect(finds(tokens, 'acme')).toBe(true)
    expect(finds(tokens, 'ops')).toBe(true)
  })

  it('is empty for a member with neither', () => {
    expect(memberSearchTokens('', '')).toEqual([])
  })
})
