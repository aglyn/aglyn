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

import { buildDatasetRecordValues } from '@aglyn/aglyn/server'
import { resolveDatasetDoc } from './resolve-dataset'

interface FakeDoc {
  id: string
  data: Record<string, unknown>
}

const makeSnapshot = (doc?: FakeDoc) => ({
  exists: Boolean(doc),
  id: doc?.id,
  get: (field: string) => doc?.data[field],
})

/** Minimal in-memory stand-in for the datasets CollectionReference. */
const makeCollection = (docs: FakeDoc[]) =>
  ({
    doc: (id: string) => ({
      get: async () => makeSnapshot(docs.find((entry) => entry.id === id)),
    }),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          const matched = docs.filter((entry) => entry.data[field] === value)
          return {
            empty: !matched.length,
            docs: matched.map((entry) => makeSnapshot(entry)),
          }
        },
      }),
    }),
  }) as unknown as FirebaseFirestore.CollectionReference

describe('resolveDatasetDoc (AGL-556)', () => {
  const datasets = makeCollection([
    { id: 'ds-1', data: { displayName: 'Survey responses v2' } },
    { id: 'ds-2', data: { displayName: 'Leads' } },
    { id: 'ds-3', data: { name: 'legacy_dataset' } },
  ])

  it('resolves by id — names never enter into it', async () => {
    // The binding still carries the dataset's OLD name; the id wins.
    const doc = await resolveDatasetDoc(datasets, {
      datasetId: 'ds-1',
      datasetName: 'Survey responses',
    })
    expect(doc?.id).toBe('ds-1')
  })

  it('falls back to the displayName query without an id', async () => {
    const doc = await resolveDatasetDoc(datasets, {
      datasetName: 'Leads',
    })
    expect(doc?.id).toBe('ds-2')
  })

  it('falls back to `name` for pre-migration docs', async () => {
    const doc = await resolveDatasetDoc(datasets, {
      datasetName: 'legacy_dataset',
    })
    expect(doc?.id).toBe('ds-3')
  })

  it('falls back to the name when the id no longer resolves', async () => {
    const doc = await resolveDatasetDoc(datasets, {
      datasetId: 'ds-gone',
      datasetName: 'Leads',
    })
    expect(doc?.id).toBe('ds-2')
  })

  it('returns undefined when nothing resolves', async () => {
    expect(
      await resolveDatasetDoc(datasets, {
        datasetId: 'ds-gone',
        datasetName: 'Nope',
      }),
    ).toBeUndefined()
    expect(await resolveDatasetDoc(datasets, {})).toBeUndefined()
  })

  it('keeps receiving records after BOTH the dataset and a schema field are renamed', async () => {
    // Bound when the dataset was "Survey responses" with a field named
    // "Rating" (fieldId `rating`); both display names have since changed.
    const renamed = makeCollection([
      {
        id: 'ds-1',
        data: {
          displayName: 'Visitor feedback (renamed)',
          model: {
            fields: {
              rating: { name: 'Happiness score', type: 'int32' },
              comments: { name: 'Notes', type: 'text' },
            },
            order: ['rating', 'comments'],
          },
          fields: ['rating', 'comments'],
        },
      },
    ])
    const doc = await resolveDatasetDoc(renamed, {
      datasetId: 'ds-1',
      datasetName: 'Survey responses',
    })
    expect(doc?.exists).toBe(true)
    const values = buildDatasetRecordValues(
      {
        model: doc?.get('model'),
        fields: doc?.get('fields'),
      },
      // The form submits its own field names…
      { stars: '5', feedback: 'Loved it' },
      // …and the id mapping routes them to the stable model fieldIds.
      { stars: 'rating', feedback: 'comments' },
    )
    expect(values).toEqual({ rating: '5', comments: 'Loved it' })
  })
})
