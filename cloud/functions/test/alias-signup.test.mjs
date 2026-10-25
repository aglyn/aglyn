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

// AGL-4041: a project-pool account is not created under an address that is
// another account's verified alias. Run against the compiled module the
// blocking function runs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { aliasSignupVerdict } from '../lib/alias-signup.js'

const reads = (overrides = {}) => ({
  indexOwner: async () => 'owner_1',
  rowVerified: async () => true,
  ownerExists: async () => true,
  ...overrides,
})

const google = { uid: 'new_1', email: 'Work@Example.test', tenantId: null }

test('refuses a verified alias of an account that still exists', async () => {
  const seen = []
  const verdict = await aliasSignupVerdict(google, reads({
    indexOwner: async (address) => (seen.push(address), 'owner_1'),
  }))
  assert.deepEqual(verdict, { refused: true, cause: 'verified-alias' })
  assert.deepEqual(seen, ['work@example.test'])
})

test('admits an address nobody holds', async () => {
  const verdict = await aliasSignupVerdict(google, reads({ indexOwner: async () => null }))
  assert.equal(verdict.refused, false)
})

test('admits when the row is not verified', async () => {
  const verdict = await aliasSignupVerdict(google, reads({ rowVerified: async () => false }))
  assert.equal(verdict.refused, false)
})

test('admits when the owner was deleted, so a stale entry never burns an address', async () => {
  const verdict = await aliasSignupVerdict(google, reads({ ownerExists: async () => false }))
  assert.equal(verdict.refused, false)
})

test('never touches an SSO tenant creation', async () => {
  const verdict = await aliasSignupVerdict(
    { ...google, tenantId: 'org-tenant' },
    reads({ indexOwner: async () => assert.fail('must not read the index') }),
  )
  assert.deepEqual(verdict, { refused: false, cause: 'not-applicable' })
})

test('fails OPEN when a read throws', async () => {
  const verdict = await aliasSignupVerdict(google, reads({
    rowVerified: async () => { throw new Error('firestore down') },
  }))
  assert.deepEqual(verdict, { refused: false, cause: 'unreadable' })
})

test('admits an account that has no address (phone)', async () => {
  const verdict = await aliasSignupVerdict({ uid: 'p', email: null }, reads())
  assert.deepEqual(verdict, { refused: false, cause: 'not-applicable' })
})
