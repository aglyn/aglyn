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

// npm run test:email-search-tokens
//
// The script-side address search keys answer the same fixtures the library's
// email-suppression.spec.ts and list-members.spec.ts answer (AGL-3321).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { emailSearchTokens, listMemberSearchTokens } from './email-search-tokens.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./email-search-tokens.fixtures.json', import.meta.url), 'utf8'),
)

test('THE CONTROL: there are fixtures to hold the twin to', () => {
  assert.ok(fixtures.emailTokens.length >= 3)
  assert.ok(fixtures.memberTokens.length >= 3)
})

test('address tokens match the fixtures', () => {
  for (const { email, tokens } of fixtures.emailTokens) {
    assert.deepEqual(emailSearchTokens(email), tokens)
  }
})

test('list member tokens match the fixtures', () => {
  for (const { email, name, tokens } of fixtures.memberTokens) {
    assert.deepEqual(listMemberSearchTokens(email, name), tokens)
  }
})

test('no address, no tokens', () => {
  assert.deepEqual(emailSearchTokens(null), [])
  assert.deepEqual(emailSearchTokens('   '), [])
})
