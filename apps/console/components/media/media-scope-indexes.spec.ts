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
 * Composite-index coverage for the scoped media grid (AGL-1045).
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
 * The table below mirrors `buildConstraints()` in
 * `media-library.component.tsx`. **If you add a sort option, a facet, or a
 * filter to that function, add its shape here too** — the pairing is
 * deliberate, because the alternative is discovering it from a support
 * ticket. A shape's index must be: equality fields, then the array field,
 * then the `orderBy` fields in order.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

const INDEXES: CompositeIndex[] = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
).indexes

/** `fieldPath:direction` for readable diffs. */
const signature = (fields: IndexField[]) =>
  fields
    .map((f) => `${f.fieldPath}:${f.arrayConfig ? 'ARRAY' : f.order}`)
    .join(' > ')

const MEDIA_SIGNATURES = new Set(
  INDEXES.filter((i) => i.collectionGroup === 'media').map((i) =>
    signature(i.fields),
  ),
)

const ARRAY = 'visibleTo:ARRAY'
const ASC = (f: string) => `${f}:ASCENDING`
const DESC = (f: string) => `${f}:DESCENDING`

/**
 * Every constraint set the grid can emit while `needsScope` is true — i.e.
 * for a scoped collaborator, or for any picker opened with a `forHostId`.
 *
 * A range filter on the SAME field as the `orderBy` (the `createdAt >=`
 * date facet) needs no extra index, which is why "last 7 days + newest"
 * does not appear separately: it is covered by the plain newest shape.
 */
const REQUIRED: Array<{ what: string; index: string[] }> = [
  { what: 'all files, Newest (the default view)', index: [ARRAY, DESC('createdAt')] },
  { what: 'all files, Oldest', index: [ARRAY, ASC('createdAt')] },
  { what: 'all files, Name', index: [ARRAY, ASC('fileName')] },
  { what: 'all files, Size', index: [ARRAY, DESC('sizeBytes')] },
  { what: 'inside a folder, Newest', index: [ASC('folderId'), ARRAY, DESC('createdAt')] },
  { what: 'inside a folder, Oldest', index: [ASC('folderId'), ARRAY, ASC('createdAt')] },
  { what: 'inside a folder, Name', index: [ASC('folderId'), ARRAY, ASC('fileName')] },
  { what: 'inside a folder, Size', index: [ASC('folderId'), ARRAY, DESC('sizeBytes')] },
  // The type facet has two shapes: PDF is an equality on contentType, while
  // image/video are a RANGE plus a leading orderBy('contentType').
  { what: 'type=PDF, Newest', index: [ASC('contentType'), ARRAY, DESC('createdAt')] },
  { what: 'type=PDF, Oldest', index: [ASC('contentType'), ARRAY, ASC('createdAt')] },
  { what: 'type=image/video (range), Newest', index: [ARRAY, ASC('contentType'), DESC('createdAt')] },
  { what: 'type=image/video (range), Oldest', index: [ARRAY, ASC('contentType'), ASC('createdAt')] },
  { what: 'folder + type=PDF, Newest', index: [ASC('folderId'), ASC('contentType'), ARRAY, DESC('createdAt')] },
  { what: 'folder + type=PDF, Oldest', index: [ASC('folderId'), ASC('contentType'), ARRAY, ASC('createdAt')] },
  { what: 'folder + type=image/video (range), Newest', index: [ASC('folderId'), ARRAY, ASC('contentType'), DESC('createdAt')] },
  { what: 'folder + type=image/video (range), Oldest', index: [ASC('folderId'), ARRAY, ASC('contentType'), ASC('createdAt')] },
  // The per-folder count (AGL-1047) — no orderBy, still needs the pair.
  { what: 'per-folder file count', index: [ASC('folderId'), ARRAY] },
]

describe('scoped media grid composite indexes (AGL-1045)', () => {
  it.each(REQUIRED)('covers $what', ({ index }) => {
    // Missing here means FAILED_PRECONDITION in production and a silent
    // pass locally. Add the index to cloud/firebase-firestore.indexes.json
    // and deploy it BEFORE the code that queries it.
    expect(MEDIA_SIGNATURES.has(index.join(' > '))).toBe(true)
  })

  it('keeps the scope filter paired with every sort the grid offers', () => {
    // Belt and braces for the most likely regression: someone adds a sort
    // option and only indexes the unscoped form.
    const sorts = [DESC('createdAt'), ASC('createdAt'), ASC('fileName'), DESC('sizeBytes')]
    const missing = sorts.filter(
      (sort) => !MEDIA_SIGNATURES.has([ARRAY, sort].join(' > ')),
    )
    expect(missing).toEqual([])
  })
})
