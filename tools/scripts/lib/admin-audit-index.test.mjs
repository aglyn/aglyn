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
// npm run test:admin-audit-index
//
// The script-side `adminAudit` stamp answers the same worked examples the
// library's admin-audit-index.spec.ts answers (AGL-3321), so the backfill
// cannot write a field the writers and the queries do not use.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ADMIN_AUDIT_INDEX_FIXTURES,
  adminAuditIndexFields,
  adminAuditSearchTokens,
  stampAdminAuditIndex,
} from './admin-audit-index.mjs'
import { nameSearchTokens } from './name-search-tokens.mjs'

test('every worked example stamps what the fixture expects', () => {
  for (const { name, entry, expected } of ADMIN_AUDIT_INDEX_FIXTURES.cases) {
    assert.deepEqual(adminAuditIndexFields(entry), expected, name)
  }
})

test('a code is found by any word in it, and an address by its domain', () => {
  const tokens = adminAuditSearchTokens({ action: 'org.override', actorEmail: 'jane@acme.com' })
  for (const typed of ['override', 'org.override', 'acme', 'jane@acme', 'jane']) {
    assert.ok(tokens.includes(nameSearchTokens(typed).at(-1)), typed)
  }
})

test('the stamp keeps the row, adding only the stamped fields', () => {
  const row = stampAdminAuditIndex({ action: 'org.override', target: 'orgs/o1', before: { a: 1 } })
  assert.deepEqual(Object.keys(row).sort(), [
    'action',
    'actionGroup',
    'before',
    'kind',
    'searchTokens',
    'target',
    'targetHostId',
    'targetKind',
  ])
})
