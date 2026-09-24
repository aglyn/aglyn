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
 *
 * @jest-environment node
 */

/**
 * Index coverage for the Inbox's two submission queries.
 *
 * The organization's Inbox (AGL-3303) asks for every site's submissions at
 * once:
 *
 *     collectionGroup('formSubmissions')
 *       .where('orgId', '==', orgId)
 *       .orderBy('createdAt', 'desc')
 *
 * An equality and an order on two fields of a COLLECTION GROUP, which no
 * automatic index serves — Firestore's single-field indexes are collection
 * scope only — so without this composite the Submissions tab is refused with
 * `FAILED_PRECONDITION` rather than answered slowly. A site's form filter asks
 * `formId ==` + `createdAt desc` of one site's collection, the other
 * composite. The emulator enforces no index at all, so only this file says
 * either is missing.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface CompositeIndex {
  collectionGroup: string
  queryScope: string
  fields: Array<{ fieldPath: string; order?: string }>
}

const CONFIG: { indexes: CompositeIndex[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const shape = (index: CompositeIndex) =>
  `${index.queryScope} ${index.fields.map((field) => `${field.fieldPath} ${field.order}`).join(', ')}`

const submissionIndexes = () =>
  CONFIG.indexes
    .filter((index) => index.collectionGroup === 'formSubmissions')
    .map(shape)

describe('the submission queries have their indexes', () => {
  it('THE CONTROL: the index file is read at all', () => {
    expect(CONFIG.indexes.length).toBeGreaterThan(10)
  })

  it('serves every site’s submissions, newest first, for one org', () => {
    expect(submissionIndexes()).toContain(
      'COLLECTION_GROUP orgId ASCENDING, createdAt DESCENDING',
    )
  })

  it('serves one site’s submissions narrowed to one form', () => {
    expect(submissionIndexes()).toContain(
      'COLLECTION formId ASCENDING, createdAt DESCENDING',
    )
  })
})
