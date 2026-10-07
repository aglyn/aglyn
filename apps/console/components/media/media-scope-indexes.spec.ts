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
 * Composite-index coverage for every query the media grid can send
 * (AGL-1045, AGL-3327).
 *
 * **The emulator does not enforce composite index requirements.** A query
 * combining equality/array filters with an `orderBy` runs happily against
 * `firestore` locally and fails in production with `FAILED_PRECONDITION`.
 * That is not a theoretical gap — it shipped: after AGL-1042 the media
 * grid began sending `visibleTo array-contains-any` for scoped
 * collaborators, and EVERY paged shape lacked an index. The Media page was
 * broken in production for those users while the emulator, the rules
 * tests, and a signed-in UI pass all showed it working.
 *
 * So the coverage lives here, as a static assertion against the deployed
 * index file, instead of relying on someone remembering to probe prod.
 *
 * Since AGL-3327 every filter and the search are on the query, planned by the
 * console's list query plan, which composes equalities through INDEX MERGING:
 * one `[field, order]` composite per filter field and per order the library
 * can take serves every combination of them. `listQueryIndexes` enumerates
 * exactly those from the library's declaration and its base predicates (the
 * folder and the scope clause), so a filter added to the declaration is held
 * to the index file the moment it exists.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { MEDIA_BASE_INDEX_FIELDS, MEDIA_LIST_QUERY } from '@aglyn/aglyn/app-utils/media-filter'

interface IndexField {
  fieldPath: string
  order?: 'ASCENDING' | 'DESCENDING'
  arrayConfig?: 'CONTAINS'
}
interface CompositeIndex {
  collectionGroup: string
  queryScope: string
  fields: IndexField[]
}

const FILE: { indexes: CompositeIndex[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

/** `fieldPath:direction` for readable diffs. */
const signature = (fields: IndexField[]) =>
  fields
    .map((f) => `${f.fieldPath}:${f.arrayConfig ? 'ARRAY' : f.order}`)
    .join(' > ')

const MEDIA_SIGNATURES = new Set(
  FILE.indexes
    .filter((i) => i.collectionGroup === 'media')
    .map((i) => signature(i.fields)),
)

const ARRAY = 'visibleTo:ARRAY'
const ASC = (f: string) => `${f}:ASCENDING`
const DESC = (f: string) => `${f}:DESCENDING`

const NEEDED = listQueryIndexes(MEDIA_LIST_QUERY, MEDIA_BASE_INDEX_FIELDS)

describe('every media grid query has its composite indexes (AGL-1045, AGL-3327)', () => {
  it('enumerates one per filter field and order', () => {
    // folderId, visibleTo, nameTokens, kind, tags, uploadedBy, hasAlt,
    // orientation — each under Newest, Oldest, Name and Largest, which are
    // also the orders the date, size and name ranges impose. A walk that
    // collapsed would pass while testing nothing.
    expect(NEEDED).toHaveLength(32)
  })

  it('finds every one in the index file', () => {
    // Missing here means FAILED_PRECONDITION in production and a silent
    // pass locally. Add the index to cloud/firebase-firestore.indexes.json
    // and deploy it BEFORE the code that queries it.
    expect(
      missingListQueryIndexes(FILE, 'media', NEEDED).map((index) =>
        signature(index.fields as IndexField[]),
      ),
    ).toEqual([])
  })

  it('keeps the scope filter paired with every sort the grid offers', () => {
    // Belt and braces for the most likely regression: someone adds a sort
    // option and only indexes the unscoped form.
    const sorts = [DESC('createdAt'), ASC('createdAt'), ASC('nameLower'), DESC('sizeBytes')]
    const missing = sorts.filter(
      (sort) => !MEDIA_SIGNATURES.has([ARRAY, sort].join(' > ')),
    )
    expect(missing).toEqual([])
  })

  it('covers the per-folder file count, which names no orderBy (AGL-1047)', () => {
    expect(MEDIA_SIGNATURES.has([ASC('folderId'), ARRAY].join(' > '))).toBe(true)
  })
})
