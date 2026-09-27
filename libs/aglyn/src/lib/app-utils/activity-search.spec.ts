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
 * What an activity log's search box can find an entry by (AGL-3321).
 *
 * The worked examples are shared with the script-side twin
 * (`tools/scripts/lib/activity-search-tokens.mjs`) the backfills stamp
 * through — `backfill-activity-search-tokens.mjs --self-test` asserts the
 * same file — so the two cannot drift into stamping tokens the query never
 * asks for.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addressSearchWords, activitySearchTokens } from './activity-search'
import { nameSearchNormalizers } from './name-search'

interface Fixture {
  name: string
  entry: Parameters<typeof activitySearchTokens>[0]
  expected: string[]
}

const FIXTURES = (
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'activity-search-tokens.fixtures.json'),
      'utf8',
    ),
  ) as { tokens: Fixture[] }
).tokens

describe('activitySearchTokens', () => {
  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'the worked example the backfill shares: %s',
    (_name, fixture) => {
      expect(activitySearchTokens(fixture.entry)).toEqual(fixture.expected)
    },
  )

  it('finds an entry by any word a reader starts typing, asked the way the plan asks', () => {
    // A stored target carries its type and id beside the name the search reads.
    const target = { type: 'screen', id: 's1', name: 'Home page' }
    const tokens = activitySearchTokens({ actorEmail: 'Ada.Lovelace@Example.com', target })
    const finds = (typed: string) => tokens.includes(nameSearchNormalizers.token(typed))
    for (const typed of ['ada', 'Lovelace', 'ada.lovelace@example.com', 'example.com', 'exam', 'HOME', 'pag']) {
      expect({ typed, found: finds(typed) }).toEqual({ typed, found: true })
    }
    // A word's middle is not a word's start, and the action is not searched.
    for (const typed of ['velace', 'ample', 'saved']) {
      expect({ typed, found: finds(typed) }).toEqual({ typed, found: false })
    }
  })

  it('reads an address as its halves and its runs', () => {
    expect(addressSearchWords('ops+alerts@mail.acme.io')).toEqual([
      'ops+alerts@mail.acme.io',
      'ops+alerts',
      'mail.acme.io',
      'ops',
      'alerts',
      'mail',
      'acme',
      'io',
    ])
    expect(addressSearchWords(null)).toEqual([])
    expect(addressSearchWords('   ')).toEqual([])
  })
})
