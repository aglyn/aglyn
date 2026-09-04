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
 * ONE ordering decision for the plugin console lists (AGL-2501).
 *
 * Eleven plugin cards capped a Firestore read with no `orderBy` and sorted the
 * result in the browser. Firestore answers an unordered limit in DOCUMENT-ID
 * order, so each window was a pseudo-random sample that the client sort dressed
 * up as an alphabetical or chronological list — the rows on screen ran in a
 * believable order, they were simply the wrong rows, and the ones missing left
 * no gap to notice.
 *
 * The obvious fix — `orderBy` on the field the list is sorted by — is the
 * trap. `orderBy` matches only documents that HAVE the field, so ordering on
 * one any writer omits does not mis-order the list, it HIDES rows from it.
 * This file asserts both halves against a model of Firestore that FILTERS as
 * well as sorts, because a double that only sorted would make the drop test an
 * assertion about a comment.
 */

import {
  ceilingedWindow,
  collectionCeiling,
  collectionPage,
} from './host-collection-queries'

jest.mock('firebase/firestore', () => ({
  documentId: () => '__name__',
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown, direction?: string) => ({
    orderBy: field,
    direction,
  }),
  query: (base: unknown, ...constraints: unknown[]) => ({ base, constraints }),
}))

/** The collection every plugin card is really reading: mixed writers. */
const documents = [
  { $id: 'a', name: 'Alpha', createdAt: 1 },
  // Written by `/api/hosts/resources`, which validates no field for presence.
  { $id: 'b' },
  // Restored through `IMPORTABLE_FIELDS`, which carries no timestamp.
  { $id: 'c', name: 'Gamma' },
  { $id: 'd', name: 'Delta', createdAt: 4 },
]

/**
 * Firestore's answer in the two respects that matter: an `orderBy` SORTS, and
 * it also FILTERS — a document without the field is not in the result at all.
 */
const answer = (constraints: Array<Record<string, any>>) => {
  const order = constraints.find((item) => 'orderBy' in item)
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const field = order?.orderBy === '__name__' ? '$id' : order?.orderBy
  const matching = field
    ? documents.filter((doc) => (doc as any)[field] !== undefined)
    : documents
  const sorted = [...matching].sort((a, b) =>
    String((a as any)[field ?? '$id']) < String((b as any)[field ?? '$id'])
      ? -1
      : 1,
  )
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

const constraintsOf = (built: any) => built.constraints as Array<Record<string, any>>

describe('the shared plugin query builder (AGL-2501)', () => {
  it('THE CONTROL: the model drops documents an orderBy cannot see', () => {
    // Without this the two assertions below would be claims about a sorter,
    // and the whole point is that `orderBy` is also a filter.
    expect(answer([{ orderBy: 'name' }])).toHaveLength(3)
    expect(answer([{ orderBy: 'createdAt' }])).toHaveLength(2)
    expect(answer([])).toHaveLength(documents.length)
  })

  it('the page walk is TOTAL — it reaches the document with no fields', () => {
    const rows = answer(constraintsOf(collectionPage({} as any, 10)))
    expect(rows).toHaveLength(documents.length)
    // `b` has neither a name nor a timestamp. Every field-ordered walk loses
    // it; the document-name walk cannot.
    expect(rows.map((row) => row.$id)).toContain('b')
  })

  it('the page walk applies the cap it was given', () => {
    expect(answer(constraintsOf(collectionPage({} as any, 2)))).toHaveLength(2)
  })

  it('the ceiling asks for ONE MORE than the ceiling', () => {
    // The probe. `length >= ceiling` is wrong at exactly the count that
    // equals the ceiling — the one collection size where a reader is told
    // rows are missing and none are.
    const built = constraintsOf(collectionCeiling({} as any, 3))
    expect(built).toContainEqual({ limit: 4 })
  })

  it('both builders order on the document name and on no field', () => {
    for (const built of [
      constraintsOf(collectionPage({} as any, 10)),
      constraintsOf(collectionCeiling({} as any, 10)),
    ]) {
      expect(built).toContainEqual({ orderBy: '__name__', direction: undefined })
    }
  })
})

describe('a ceilinged read knows when it was cut short (AGL-2501)', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ $id: `row-${index}` }))

  it('one document past the ceiling is a FACT, and never a row', () => {
    const window = ceilingedWindow(rows(11), 10)
    expect(window.truncated).toBe(true)
    // The probe is dropped: a caller rendering 11 rows would be describing a
    // window it did not draw.
    expect(window.rows).toHaveLength(10)
    expect(window.rows.at(-1)).toEqual({ $id: 'row-9' })
  })

  it('is NOT truncated when the collection exactly fills the ceiling', () => {
    // The off-by-one the comparison it replaces got wrong.
    const window = ceilingedWindow(rows(10), 10)
    expect(window.truncated).toBe(false)
    expect(window.rows).toHaveLength(10)
  })

  it('a pending read is short, not truncated', () => {
    expect(ceilingedWindow(undefined, 10)).toEqual({
      rows: [],
      truncated: false,
    })
  })
})
