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

// npm run test:org-record-list-fields
//
// The script-side CRM list fields answer the same fixtures the library's
// crm-list-fields.spec.ts answers (AGL-3321).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  crmFieldListFields,
  crmFieldListFieldsBackfillPatch,
  crmListFields,
  crmListFieldsBackfillPatch,
  crmNewRecordListFields,
} from './org-record-list-fields.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./org-record-list-fields.fixtures.json', import.meta.url), 'utf8'),
)

test('list fields match the fixtures', () => {
  for (const { collection, record, expected } of fixtures.records) {
    assert.deepEqual(crmListFields(collection, record), expected)
  }
})

test('a new record’s fields match the fixtures', () => {
  for (const { collection, record, expected } of fixtures.newRecords) {
    assert.deepEqual(crmNewRecordListFields(collection, record), expected)
  }
})

test('a backfill patch writes what is wrong and nothing on a level record', () => {
  for (const { collection, record } of fixtures.records) {
    const patch = crmListFieldsBackfillPatch(collection, record)
    assert.ok(Object.keys(patch).length > 0)
    assert.deepEqual(crmListFieldsBackfillPatch(collection, { ...record, ...patch }), {})
  }
  // A scheduled record keeps its date; an absent one is stamped null.
  assert.equal(crmListFieldsBackfillPatch('deals', { title: 'x', nextTaskAtMs: 5 }).nextTaskAtMs, undefined)
  assert.equal(crmListFieldsBackfillPatch('deals', { title: 'x' }).nextTaskAtMs, null)
})

test('a field definition’s list fields match the fixtures, and a backfill levels it (AGL-3335)', () => {
  assert.ok(fixtures.fieldDefinitions.length > 0)
  for (const { record, expected } of fixtures.fieldDefinitions) {
    assert.deepEqual(crmFieldListFields(record), expected)
    const patch = crmFieldListFieldsBackfillPatch(record)
    assert.ok(Object.keys(patch).length > 0)
    assert.deepEqual(crmFieldListFieldsBackfillPatch({ ...record, ...patch }), {})
  }
})
