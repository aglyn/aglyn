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

// npm run test:site-form-list-fields
//
// The script-side Forms list fields answer the same fixtures the library's
// forms.spec.ts answers (AGL-3330).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { formListFields, newFormListFields, planFormListFields } from './site-form-list-fields.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./site-form-list-fields.fixtures.json', import.meta.url), 'utf8'),
)

test('the list fields match the fixtures', () => {
  assert.ok(fixtures.forms.length > 0)
  for (const { form, expected } of fixtures.forms) {
    assert.deepEqual(formListFields(form), expected)
  }
})

test('a new form is stamped with nothing counted, in use, and its lead switch set', () => {
  const fields = newFormListFields({
    id: 'f1',
    displayName: 'Demo request',
    slug: 'demo-request',
    routing: { datasetId: 'd1' },
  })
  assert.equal(fields.retired, false)
  assert.deepEqual(fields.routing, { datasetId: 'd1', lead: false })
  assert.deepEqual(fields.stats, { submissions: null, leads: null, lastSubmissionAtMs: null })
  assert.deepEqual(newFormListFields({ id: 'f2', routing: { lead: true } }).routing, { lead: true })
})

test('the backfill stamps every field a form that predates them lacks', () => {
  const keys = formListFields({ id: 'fDemo1', displayName: 'Demo request', slug: 'demo-request' })
  assert.deepEqual(
    planFormListFields('hosts/h1/forms/fDemo1', {
      displayName: 'Demo request',
      slug: 'demo-request',
      routing: { datasetId: 'd1' },
      stats: { submissions: 3 },
    }),
    {
      patch: {
        ...keys,
        retired: false,
        'routing.lead': false,
        'stats.leads': null,
        'stats.lastSubmissionAtMs': null,
      },
      reasons: ['search', 'retired', 'lead', 'counters'],
    },
  )
})

test('the backfill mirrors a retirement marker of either shape and leaves counts alone', () => {
  const keys = formListFields({ id: 'fDemo1', displayName: 'Demo request', slug: 'demo-request' })
  assert.deepEqual(
    planFormListFields('hosts/h1/forms/fDemo1', {
      displayName: 'Demo request',
      slug: 'demo-request',
      ...keys,
      archivedAt: { seconds: 1, nanoseconds: 0 },
      routing: { lead: true },
      stats: { submissions: 1, leads: 1, lastSubmissionAtMs: 5 },
    }),
    { patch: { retired: true }, reasons: ['retired'] },
  )
})

test('the backfill is idempotent, and restamps a rename that skipped the keys', () => {
  const keys = formListFields({ id: 'fDemo1', displayName: 'Demo request', slug: 'demo-request' })
  const stamped = {
    displayName: 'Demo request',
    slug: 'demo-request',
    ...keys,
    retired: false,
    archivedAt: null,
    routing: { lead: false },
    stats: { submissions: null, leads: null, lastSubmissionAtMs: null },
  }
  assert.deepEqual(planFormListFields('hosts/h1/forms/fDemo1', stamped), { skip: 'current' })
  assert.deepEqual(
    planFormListFields('hosts/h1/forms/fDemo1', { ...stamped, displayName: 'Book a demo' }).reasons,
    ['search'],
  )
})

test('the backfill touches only hosts/*/forms', () => {
  assert.deepEqual(planFormListFields('orgs/o1/forms/f1', {}), { skip: 'not-a-form' })
  assert.deepEqual(planFormListFields('hosts/h1/forms/f1/versions/v1', {}), { skip: 'not-a-form' })
})
