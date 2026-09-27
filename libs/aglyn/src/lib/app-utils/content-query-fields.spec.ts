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
 * The fields the console's content tables query, against the worked examples
 * the scripts that stamp them are held to (AGL-3321).
 *
 * The entries table searches `titleTokens` and the Authors table reads
 * `nameLower`, `nameTokens` and `schemaType`. Every live writer stamps them
 * through `entryTitleSearchFields` / `contentAuthorQueryFields`; the
 * backfills cannot import this library, so they stamp the name keys through
 * `tools/scripts/lib/name-search-tokens.mjs` (held to
 * `name-search-tokens.fixtures.json` by `name-search.spec.ts` and by its own
 * test) and read the schema type the way this library does. A query asks for
 * the key THESE functions make of a typed value, so a script that stamped
 * another spelling would write records no filter finds: this spec and the
 * author backfill's `--self-test` read the same schema-type fixtures.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { entryTitleSearchFields } from './collection-entries'
import { contentAuthorQueryFields } from './content-authors'

const fixture = <T,>(name: string): T =>
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', name),
      'utf8',
    ),
  )

const NAMES = fixture<{
  keys: Array<{ name: string; key: string }>
  tokens: Array<{ name: string; tokens: string[] }>
}>('name-search-tokens.fixtures.json')

const TYPES = fixture<{
  cases: Array<{ type?: string | number | null; schemaType: string }>
}>('author-schema-type.fixtures.json')

describe('an entry title, stamped for the entries table (AGL-3321)', () => {
  it('carries the same tokens', () => {
    for (const { name, tokens } of NAMES.tokens) {
      expect(entryTitleSearchFields(name)).toEqual({ titleTokens: tokens })
    }
  })

  it('carries the field with no title at all, so a backfill finds nothing left', () => {
    expect(entryTitleSearchFields(undefined)).toEqual({ titleTokens: [] })
    expect(entryTitleSearchFields(42)).toEqual({ titleTokens: [] })
  })
})

describe('an author, stamped for the Authors table (AGL-3321)', () => {
  it('keys and tokenizes the name through the same normalizers', () => {
    for (const { name, key } of NAMES.keys) {
      expect(contentAuthorQueryFields({ name }).nameLower).toBe(key)
    }
    for (const { name, tokens } of NAMES.tokens) {
      expect(contentAuthorQueryFields({ name }).nameTokens).toEqual(tokens)
    }
  })

  it('THE CONTROL: the type fixtures hold both words', () => {
    const words = new Set(TYPES.cases.map((entry) => entry.schemaType))
    expect(words).toEqual(new Set(['Person', 'Organization']))
  })

  it.each(TYPES.cases)('stores type $type as $schemaType', (entry) => {
    const stored = 'type' in entry ? { name: 'A', type: entry.type } : { name: 'A' }
    expect(contentAuthorQueryFields(stored).schemaType).toBe(entry.schemaType)
  })
})
