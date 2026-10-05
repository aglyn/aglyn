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
  crmLeadSourceDirection,
  crmLeadSourcePicklist,
  crmListFields,
  crmListFieldsBackfillPatch,
  crmNewRecordListFields,
  LEAD_SOURCE_STANDARD_VALUES,
} from './org-record-list-fields.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./org-record-list-fields.fixtures.json', import.meta.url), 'utf8'),
)

/** The org's lead source list a fixture names, when it names one (AGL-3577). */
const contextOf = (entry) =>
  'leadSources' in entry ? { leadSources: crmLeadSourcePicklist(entry.leadSources) } : {}

test('list fields match the fixtures', () => {
  for (const entry of fixtures.records) {
    assert.deepEqual(crmListFields(entry.collection, entry.record, contextOf(entry)), entry.expected)
  }
})

test('a new record’s fields match the fixtures', () => {
  for (const entry of fixtures.newRecords) {
    assert.deepEqual(crmNewRecordListFields(entry.collection, entry.record, contextOf(entry)), entry.expected)
  }
})

test('a lead source’s direction is its group in the org’s list, as the library reads it (AGL-3577)', () => {
  assert.deepEqual(LEAD_SOURCE_STANDARD_VALUES, fixtures.leadSourceStandardValues)
  assert.ok(fixtures.leadSourceDirections.length > 0)
  for (const { leadSources, label, expected } of fixtures.leadSourceDirections) {
    assert.equal(crmLeadSourceDirection(crmLeadSourcePicklist(leadSources), label), expected, label)
  }
  // Without the org's list a held value's direction is left as stored; none at all is null.
  assert.equal('leadSourceDirection' in crmListFields('leads', { leadSource: 'Web' }), false)
  assert.equal(crmListFields('leads', {}).leadSourceDirection, null)
})

test('a backfill patch writes what is wrong and nothing on a level record', () => {
  for (const entry of fixtures.records) {
    const { collection, record } = entry
    const patch = crmListFieldsBackfillPatch(collection, record, contextOf(entry))
    assert.ok(Object.keys(patch).length > 0)
    assert.deepEqual(crmListFieldsBackfillPatch(collection, { ...record, ...patch }, contextOf(entry)), {})
  }
  // A regrouped value restamps the direction alone.
  const outbound = crmLeadSourcePicklist({
    values: [{ id: 'web', label: 'Web', active: true, group: 'outbound' }],
  })
  const lead = { ...crmListFields('leads', { leadSource: 'Web' }, { leadSources: crmLeadSourcePicklist(null) }), leadSource: 'Web' }
  assert.deepEqual(crmListFieldsBackfillPatch('leads', lead, { leadSources: outbound }), {
    leadSourceDirection: 'outbound',
  })
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
