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

// npm run test:site-form-stats-recount
//
// The script-side form counter recount answers the same fixtures the
// library's forms.spec.ts answers (AGL-3330).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  FORM_LAST_SUBMISSION_TOLERANCE_MS,
  formCounterDrift,
  formCounterPatch,
  formCountersFromSource,
  formLeadSource,
} from './site-form-stats-recount.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./site-form-stats-recount.fixtures.json', import.meta.url), 'utf8'),
)

test('the recount matches the fixtures', () => {
  assert.equal(fixtures.toleranceMs, FORM_LAST_SUBMISSION_TOLERANCE_MS)
  assert.ok(fixtures.cases.length > 0)
  for (const one of fixtures.cases) {
    const recounted = formCountersFromSource(one.source)
    assert.deepEqual(recounted, one.recounted, one.name)
    assert.deepEqual(formCounterDrift(one.stored, recounted), one.drift, one.name)
  }
})

test('the patch is three dotted fields, and a form files leads under form:{id}', () => {
  assert.deepEqual(formCounterPatch({ submissions: 2, leads: 0, lastSubmissionAtMs: 5 }), {
    'stats.submissions': 2,
    'stats.leads': 0,
    'stats.lastSubmissionAtMs': 5,
  })
  assert.equal(formLeadSource('f1'), 'form:f1')
})
