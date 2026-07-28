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

type Filter = { field: string; op: string; value: unknown }

const matches = (doc: FakeDoc, filter: Filter): boolean => {
  const actual = doc.data[filter.field]
  if (filter.op === 'array-contains-any') {
    return (
      Array.isArray(actual) &&
      (filter.value as unknown[]).some((token) => actual.includes(token))
    )
  }
  return actual === filter.value
}

/**
 * Minimal in-memory stand-in for the datasets CollectionReference.
 * Chainable, because the AGL-1039 scope is a second `.where()` on top of
 * the name query. `orgScoped` fakes the `parent.parent.id === 'orgs'`
 * check that tells the real code which storage path it is on.
 */
const makeCollection = (docs: FakeDoc[], orgScoped = true) => {
  const query = (filters: Filter[]): unknown => ({
    where: (field: string, op: string, value: unknown) =>
      query([...filters, { field, op, value }]),
    limit: () => ({
      get: async () => {
        const matched = docs.filter((doc) =>
          filters.every((filter) => matches(doc, filter)),
        )
        return {
          empty: !matched.length,
          docs: matched.map((entry) => makeSnapshot(entry)),
        }
      },
    }),
  })
  return {
    parent: orgScoped ? { parent: { id: 'orgs' } } : undefined,
    doc: (id: string) => ({
      get: async () => makeSnapshot(docs.find((entry) => entry.id === id)),
    }),
    where: (field: string, op: string, value: unknown) =>
      query([{ field, op, value }]),
  } as unknown as FirebaseFirestore.CollectionReference
}

/** Every dataset in the legacy specs is org-wide unless a test says else. */
const ORG_WIDE = { visibleTo: ['org'] }
const HOST = 'host-a'

describe('resolveDatasetDoc (AGL-556)', () => {
  const datasets = makeCollection([
    { id: 'ds-1', data: { displayName: 'Survey responses v2', ...ORG_WIDE } },
    { id: 'ds-2', data: { displayName: 'Leads', ...ORG_WIDE } },
    { id: 'ds-3', data: { name: 'legacy_dataset', ...ORG_WIDE } },
  ])

  it('resolves by id — names never enter into it', async () => {
    // The binding still carries the dataset's OLD name; the id wins.
    const doc = await resolveDatasetDoc(datasets, {
      datasetId: 'ds-1',
      datasetName: 'Survey responses',
    }, HOST)
    expect(doc?.id).toBe('ds-1')
  })

  it('falls back to the displayName query without an id', async () => {
    const doc = await resolveDatasetDoc(datasets, {
      datasetName: 'Leads',
    }, HOST)
    expect(doc?.id).toBe('ds-2')
  })

  it('falls back to `name` for pre-migration docs', async () => {
    const doc = await resolveDatasetDoc(datasets, {
      datasetName: 'legacy_dataset',
    }, HOST)
    expect(doc?.id).toBe('ds-3')
  })

  it('falls back to the name when the id no longer resolves', async () => {
    const doc = await resolveDatasetDoc(datasets, {
      datasetId: 'ds-gone',
      datasetName: 'Leads',
    }, HOST)
    expect(doc?.id).toBe('ds-2')
  })

  it('returns undefined when nothing resolves', async () => {
    expect(
      await resolveDatasetDoc(datasets, {
        datasetId: 'ds-gone',
        datasetName: 'Nope',
      }, HOST),
    ).toBeUndefined()
    expect(await resolveDatasetDoc(datasets, {}, HOST)).toBeUndefined()
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
          ...ORG_WIDE,
        },
      },
    ])
    const doc = await resolveDatasetDoc(renamed, {
      datasetId: 'ds-1',
      datasetName: 'Survey responses',
    }, HOST)
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

describe('resolveDatasetDoc scoping (AGL-1039)', () => {
  it('refuses a dataset scoped to a DIFFERENT host, by id', async () => {
    const datasets = makeCollection([
      { id: 'internal', data: { displayName: 'Rates', visibleTo: ['host:other'] } },
    ])
    expect(
      await resolveDatasetDoc(datasets, { datasetId: 'internal' }, HOST),
    ).toBeUndefined()
  })

  it('allows a dataset scoped to THIS host', async () => {
    const datasets = makeCollection([
      { id: 'mine', data: { displayName: 'Rates', visibleTo: [`host:${HOST}`] } },
    ])
    expect(
      (await resolveDatasetDoc(datasets, { datasetId: 'mine' }, HOST))?.id,
    ).toBe('mine')
  })

  it('does not fall through to the name lookup when the id is invisible', async () => {
    // The binding named ONE dataset. Answering with a different one that
    // happens to share a display name would be a silent substitution.
    const datasets = makeCollection([
      { id: 'internal', data: { displayName: 'Rates', visibleTo: ['host:other'] } },
      { id: 'decoy', data: { displayName: 'Rates', ...ORG_WIDE } },
    ])
    expect(
      await resolveDatasetDoc(
        datasets,
        { datasetId: 'internal', datasetName: 'Rates' },
        HOST,
      ),
    ).toBeUndefined()
  })

  it('picks the VISIBLE one when two datasets share a display name', async () => {
    // The leak this issue exists to close: a client site binds a
    // repeatable to "Products" and must get its own, not the agency's.
    // The scope has to be inside the query — an unscoped limit(1) could
    // pick the internal one and a post-filter would then report "no such
    // dataset" even though a visible one exists.
    const datasets = makeCollection([
      { id: 'agency', data: { displayName: 'Products', visibleTo: ['host:other'] } },
      { id: 'client', data: { displayName: 'Products', ...ORG_WIDE } },
    ])
    expect(
      (await resolveDatasetDoc(datasets, { datasetName: 'Products' }, HOST))?.id,
    ).toBe('client')
  })

  it('finds nothing when every same-named dataset is invisible', async () => {
    const datasets = makeCollection([
      { id: 'agency', data: { displayName: 'Products', visibleTo: ['host:other'] } },
    ])
    expect(
      await resolveDatasetDoc(datasets, { datasetName: 'Products' }, HOST),
    ).toBeUndefined()
  })

  it('leaves the legacy host-scoped path unfiltered', async () => {
    // `hosts/{hostId}/datasets` docs carry no visibleTo and are private by
    // construction; filtering them would match nothing and blank the site.
    const legacy = makeCollection(
      [{ id: 'ds-legacy', data: { displayName: 'Rates' } }],
      false,
    )
    expect(
      (await resolveDatasetDoc(legacy, { datasetId: 'ds-legacy' }, HOST))?.id,
    ).toBe('ds-legacy')
    expect(
      (await resolveDatasetDoc(legacy, { datasetName: 'Rates' }, HOST))?.id,
    ).toBe('ds-legacy')
  })
})
