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

// npm run test:name-search-tokens
//
// The script-side list-search keys answer the same fixtures the library's
// name-search.spec.ts answers (AGL-3321).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  displayNameSearchFields,
  nameSearchKey,
  nameSearchReversed,
  nameSearchTokens,
  sameSearchTokens,
  scopedSearchTokens,
} from './name-search-tokens.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./name-search-tokens.fixtures.json', import.meta.url), 'utf8'),
)

test('keys and reversed keys match the fixtures', () => {
  for (const { name, key, reversed } of fixtures.keys) {
    assert.equal(nameSearchKey(name), key)
    assert.equal(nameSearchReversed(name), reversed)
  }
})

test('tokens match the fixtures', () => {
  for (const { name, tokens } of fixtures.tokens) {
    assert.deepEqual(nameSearchTokens(name), tokens)
  }
})

test('scoped tokens match the fixtures', () => {
  for (const { visibleTo, tokens, scoped } of fixtures.scoped) {
    assert.deepEqual(scopedSearchTokens(visibleTo, tokens), scoped)
  }
})

test('displayNameSearchFields derives the three keys and never displayName', () => {
  const fields = displayNameSearchFields('Acme Coffee')
  assert.deepEqual(fields, {
    nameLower: 'acme coffee',
    nameTokens: nameSearchTokens('Acme Coffee'),
    nameReversed: 'eeffoc emca',
  })
  assert.deepEqual(displayNameSearchFields(undefined), { nameLower: '', nameTokens: [], nameReversed: '' })
})

test('a non-string name has no keys', () => {
  assert.equal(nameSearchKey(null), '')
  assert.deepEqual(nameSearchTokens(42), [])
})

test('sameSearchTokens compares order and content', () => {
  assert.equal(sameSearchTokens(['a', 'ab'], ['a', 'ab']), true)
  assert.equal(sameSearchTokens(['ab', 'a'], ['a', 'ab']), false)
  assert.equal(sameSearchTokens(undefined, []), false)
})
