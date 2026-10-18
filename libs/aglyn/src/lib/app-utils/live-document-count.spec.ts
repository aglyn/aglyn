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
 * The live-count rule every plan allowance on a soft-deleting collection
 * reads (AGL-3918): archived yes, deleted no.
 *
 * The double evaluates the filter the helper sends with Firestore's own
 * semantics — `!=` matches a document that HAS the field with another value,
 * so an absent `deletedAt` matches nothing — rather than answering a canned
 * number, so the arithmetic is tested against the shapes stored documents
 * really have.
 */

import {
  countLiveDocuments,
  deletedTemplatesCounted,
  isLiveDocument,
  liveDocumentCount,
  TOMBSTONE_FIELD,
} from './live-document-count'

type Row = Record<string, unknown>

/** A collection double: `count()`, and `where(field, '!=', value).count()`. */
const collectionOf = (rows: Row[]) => {
  const aggregate = (keep: (row: Row) => boolean) => ({
    get: async () => ({ data: () => ({ count: rows.filter(keep).length }) }),
  })
  return {
    count: () => aggregate(() => true),
    where: (field: string, op: '!=', value: null) => {
      expect([field, op, value]).toEqual([TOMBSTONE_FIELD, '!=', null])
      return { count: () => aggregate((row) => row[field] !== undefined && row[field] !== value) }
    },
  }
}

describe('countLiveDocuments', () => {
  it('counts both live shapes and an archived document, and no deleted one', async () => {
    const rows: Row[] = [
      { name: 'made by the resources route' },
      { name: 'installed', deletedAt: null },
      { name: 'archived', status: 'archived', deletedAt: null },
      { name: 'disabled', enabled: false },
      { name: 'deleted', deletedAt: { seconds: 1 } },
      { name: 'deleted by the app', deletedAt: 1_760_000_000_000 },
    ]
    expect(await countLiveDocuments(collectionOf(rows))).toBe(4)
  })

  it('reads both aggregates through the reader it is handed, as a transaction does', async () => {
    const read = jest.fn(async (aggregate: { get(): Promise<{ data(): { count: number } }> }) => aggregate.get())
    expect(await countLiveDocuments(collectionOf([{}, { deletedAt: { seconds: 1 } }]), read)).toBe(1)
    expect(read).toHaveBeenCalledTimes(2)
  })
})

describe('liveDocumentCount', () => {
  it('is the total less the tombstones, never below zero', () => {
    expect(liveDocumentCount(5, 2)).toBe(3)
    // A delete landing between the two reads can make the second the larger.
    expect(liveDocumentCount(2, 3)).toBe(0)
  })
})

describe('isLiveDocument', () => {
  it('is live with no `deletedAt` or a null one, and deleted with any value', () => {
    expect(isLiveDocument(undefined)).toBe(true)
    expect(isLiveDocument(null)).toBe(true)
    expect(isLiveDocument({ seconds: 1 })).toBe(false)
    expect(isLiveDocument(0)).toBe(false)
  })
})

describe('deletedTemplatesCounted', () => {
  const snapshot = (row: Row) => ({
    get: (field: string) => field.split('.').reduce<unknown>((value, key) => (value as Row | undefined)?.[key], row),
  })

  it('subtracts only the deleted templates the starter-excluding count included', () => {
    const tombstones = [
      { source: { type: 'authored' } },
      { source: { type: 'marketplace' } },
      // A starter was never counted, so it is not subtracted.
      { source: { type: 'starter' } },
      // `source.type != 'starter'` skips a template without the field.
      {},
    ].map(snapshot)
    expect(deletedTemplatesCounted(tombstones)).toBe(2)
  })
})
