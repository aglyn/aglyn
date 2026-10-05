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

import {
  TRANSFER_ID_FIELD,
  buildTransferFieldCatalog,
  buildTransferPlan,
  createTransferPolicy,
  deriveTransferRow,
  transferFieldProblems,
  transferResourceInstanceKey,
} from '@aglyn/aglyn/data-transfer'
import type { DatasetModel } from '../model/dataset-models'
import { RECORD_PAGE_ADDRESS_FIELD_TYPE } from '../record-pages/record-pages'
import { DATASET_TRANSFER_RESOURCE, datasetTransferResourceKey } from './dataset-transfer-key'
import {
  DATASET_TRANSFER_CREATED_FIELD,
  datasetMatchKeyOffer,
  datasetMatchKeyQuery,
  datasetOptionsPicklist,
  datasetRecordTransferValues,
  datasetStorageValues,
  datasetTransferCatalog,
  refuseInvalidDatasetRows,
} from './dataset-transfer-model'

/**
 * A dataset as a transfer resource (AGL-3530), the pure half: the catalog the
 * export picker and the mapping list, the two directions values travel in,
 * the match keys, and the dry run held to the dataset's model.
 */

const MODEL: DatasetModel = {
  order: ['id', 'title', 'slug', 'kind', 'price', 'count', 'live', 'starts', 'where', 'meta', 'tags', 'owner', 'crew', 'blob'],
  fields: {
    id: { name: 'Legacy ID', type: 'text' },
    title: { name: 'Title', type: 'text', required: true, validation: { max: 20 } },
    slug: { name: 'Page address', type: 'text', customType: RECORD_PAGE_ADDRESS_FIELD_TYPE, slugFrom: 'title' },
    kind: { name: 'Kind', type: 'text', validation: { options: ['Residential', 'Commercial'] } },
    price: { name: 'Price', type: 'float' },
    count: { name: 'Count', type: 'int32', validation: { min: 0 } },
    live: { name: 'Live', type: 'bool' },
    starts: { name: 'Starts', type: 'timestamp' },
    where: { name: 'Where', type: 'coordinates' },
    meta: { name: 'Meta', type: 'map' },
    tags: { name: 'Tags', type: 'sorted' },
    owner: { name: 'Owner', type: 'reference', reference: { datasetId: 'people', displayFieldId: 'name' } },
    crew: { name: 'Crew', type: 'reference', reference: { datasetId: 'people', multiple: true } },
    blob: { name: 'Blob', type: 'bytes' },
  },
}

const STORED = {
  id: 'L-1',
  title: 'Roofing',
  slug: 'roofing',
  kind: 'Commercial',
  price: 19.5,
  count: '3',
  live: 'true',
  starts: Date.UTC(2026, 9, 5, 12, 30),
  where: { latitude: 40.1, longitude: -74.2 },
  meta: { a: 1 },
  tags: ['Residential', 'Commercial'],
  owner: 'p-1',
  crew: ['p-1', 'p-2'],
}

describe('the resource key', () => {
  it('is the core’s instance key, spelled out so the card loads no transfer core', () => {
    expect(datasetTransferResourceKey('ds_1-A')).toBe(transferResourceInstanceKey(DATASET_TRANSFER_RESOURCE, 'ds_1-A'))
  })
})

describe('the catalog', () => {
  const catalog = buildTransferFieldCatalog(datasetTransferCatalog(MODEL, 'Services'))
  const field = (id: string) => catalog.byId.get(id)

  it('is a catalog the core accepts, every field typed for how a cell reads', () => {
    expect(transferFieldProblems(catalog.fields)).toEqual([])
    expect(Object.fromEntries(catalog.fields.map((one) => [one.id, one.type]))).toMatchObject({
      'field:id': 'text',
      title: 'text',
      kind: 'picklist',
      price: 'number',
      count: 'integer',
      live: 'boolean',
      starts: 'datetime',
      where: 'text',
      meta: 'json',
      tags: 'list',
      owner: 'lookup',
      crew: 'list',
      [TRANSFER_ID_FIELD]: 'text',
      [DATASET_TRANSFER_CREATED_FIELD]: 'datetime',
    })
    expect(catalog.groups[0]).toEqual({ id: 'fields', label: 'Services' })
  })

  it('moves a dataset field named id aside, so the Aglyn ID stays the record’s', () => {
    expect(field('field:id')).toMatchObject({ label: 'Legacy ID', aliases: ['id'] })
    expect(field(TRANSFER_ID_FIELD)).toMatchObject({ system: true, matchKey: true })
  })

  it('requires what the model requires, but never a page address that fills itself in', () => {
    expect(field('title')?.required).toBe(true)
    expect(field('slug')?.required).toBeUndefined()
  })

  it('names a reference’s target dataset and its display field as the lookup', () => {
    expect(field('owner')?.lookup).toEqual({ resource: 'data.dataset:people', by: ['id', 'name'] })
  })

  it('never writes bytes or the record’s own times', () => {
    expect(field('blob')?.readOnly).toBe(true)
    expect(field(DATASET_TRANSFER_CREATED_FIELD)).toMatchObject({ system: true, readOnly: true })
  })

  it('offers an options field’s values as a restricted picklist', () => {
    const list = datasetOptionsPicklist(MODEL.fields['kind'])
    expect(list.spec.restricted).toBe(true)
    expect(list.set.values.map((value) => value.label)).toEqual(['Residential', 'Commercial'])
  })
})

describe('values', () => {
  const view = datasetRecordTransferValues(MODEL, { id: 'r1', values: STORED, createdAt: { toMillis: () => 0 } })

  it('reads a stored record as transfer values — old text numbers and booleans as what they say', () => {
    expect(view).toMatchObject({
      id: 'r1',
      'field:id': 'L-1',
      count: 3,
      live: true,
      starts: '2026-10-05T12:30:00.000Z',
      where: '40.1, -74.2',
      tags: ['Residential', 'Commercial'],
      owner: 'p-1',
      crew: ['p-1', 'p-2'],
      [DATASET_TRANSFER_CREATED_FIELD]: '1970-01-01T00:00:00.000Z',
    })
  })

  it('writes them back as the record stores them: an export re-imports to the same record', () => {
    const { values, cleared } = datasetStorageValues(MODEL, view)
    expect(cleared).toEqual([])
    expect(values).toEqual({ ...STORED, count: 3, live: true })
  })

  it('reads a file’s cells back to the same values the export wrote', () => {
    const catalog = buildTransferFieldCatalog(datasetTransferCatalog(MODEL))
    const row = deriveTransferRow(catalog.byId, {
      starts: '2026-10-05T12:30:00.000Z',
      tags: 'Residential; Commercial',
      count: '3',
      live: 'yes',
    })
    expect(row.values).toEqual({ starts: view['starts'], tags: view['tags'], count: 3, live: true })
  })

  it('says which fields a blank clears, and ignores the ID, the times and bytes', () => {
    expect(datasetStorageValues(MODEL, { title: '', tags: [], id: 'x', blob: 'y', [DATASET_TRANSFER_CREATED_FIELD]: 'z' })).toEqual({
      values: {},
      cleared: ['title', 'tags'],
    })
  })
})

describe('match keys', () => {
  it('offers the ID and every text and number field, starting with the ID and the page address', () => {
    const offer = datasetMatchKeyOffer(MODEL)
    expect(offer.keys).toEqual([
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'field:id', normalizer: 'caseless' },
      { fieldId: 'title', normalizer: 'caseless' },
      { fieldId: 'slug', normalizer: 'caseless' },
      { fieldId: 'kind', normalizer: 'trim' },
      { fieldId: 'price', normalizer: 'exact' },
      { fieldId: 'count', normalizer: 'exact' },
    ])
    expect(offer.defaults).toEqual(['id', 'slug'])
  })

  it('asks the filter values the records table asks, in their stored form', () => {
    expect(datasetMatchKeyQuery(MODEL, { fieldId: 'title', normalizer: 'caseless' }, 'roofing')).toEqual({
      path: 'filterValues.title',
      value: 'roofing',
    })
    expect(datasetMatchKeyQuery(MODEL, { fieldId: 'kind', normalizer: 'trim' }, 'Commercial')).toEqual({
      path: 'filterValues.kind',
      value: 'Commercial',
    })
    expect(datasetMatchKeyQuery(MODEL, { fieldId: 'price', normalizer: 'exact' }, '19.5')).toEqual({
      path: 'filterValues.price',
      value: 19.5,
    })
  })
})

describe('the dry run held to the model', () => {
  const catalog = buildTransferFieldCatalog(datasetTransferCatalog(MODEL))
  const plan = (rows: Array<Record<string, unknown>>, existing = new Map<string, Record<string, unknown>>()) => {
    const built = buildTransferPlan({
      fields: catalog.fields,
      rows: rows.map((values, index) => ({ index, values })),
      matches: rows.map((values) =>
        values['id'] ? { kind: 'matched' as const, recordId: String(values['id']), via: { fieldId: 'id', value: String(values['id']) } } : { kind: 'new' as const },
      ),
      existing,
      policy: createTransferPolicy({ fields: { count: { mode: 'overwrite', blank: 'leave' } } }),
    })
    return refuseInvalidDatasetRows(MODEL, built, existing)
  }

  it('fails a new row the model refuses, naming the field', () => {
    const result = plan([{ title: 'A title well past twenty characters' }, { title: 'Fine' }])
    expect(result.rows[0]).toMatchObject({ verdict: 'fail', reason: 'refusedValue', missing: ['title'], diff: [] })
    expect(result.rows[1].verdict).toBe('create')
    expect(result.summary).toMatchObject({ create: 1, fail: 1 })
  })

  it('holds an update only to the fields it writes', () => {
    // The stored title breaks today's bound; an update of the count alone is not refused for it.
    const existing = new Map([['r1', { id: 'r1', title: 'An old title past the bound today', count: 1 }]])
    expect(plan([{ id: 'r1', count: 2 }], existing).rows[0]).toMatchObject({ verdict: 'update', recordId: 'r1' })
    expect(plan([{ id: 'r1', count: -1 }], existing).rows[0]).toMatchObject({ verdict: 'fail', missing: ['count'] })
  })
})
