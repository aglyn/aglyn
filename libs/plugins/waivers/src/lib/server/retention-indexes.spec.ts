/**
 * @jest-environment node
 */
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
 * Index coverage for the waivers retention job (AGL-4042), which asks, across
 * every workspace, for the signed waivers kept after an erasure request whose
 * period has run out:
 *
 *     collectionGroup('waiverSignatures')
 *       .where('retainUntilMs', '<=', now)
 *       .orderBy('retainUntilMs', 'asc')
 *
 * One field, so a single-field index, and Firestore builds those
 * automatically at COLLECTION scope only: the collection-group form needs an
 * override asked for by name, or the job fails every run with
 * FAILED_PRECONDITION and nothing kept is ever deleted.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG: {
  fieldOverrides: Array<{ collectionGroup: string; fieldPath: string; indexes: Array<{ queryScope: string; order?: string }> }>
} = JSON.parse(readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'))

describe('the retention job’s index', () => {
  it('declares a collection-group ascending index on waiverSignatures.retainUntilMs', () => {
    const override = CONFIG.fieldOverrides.find(
      (entry) => entry.collectionGroup === 'waiverSignatures' && entry.fieldPath === 'retainUntilMs',
    )
    expect(override?.indexes).toEqual(
      expect.arrayContaining([
        { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
        // An override replaces the automatic indexes, so the collection's own stay declared.
        { queryScope: 'COLLECTION', order: 'ASCENDING' },
        { queryScope: 'COLLECTION', order: 'DESCENDING' },
      ]),
    )
  })
})
