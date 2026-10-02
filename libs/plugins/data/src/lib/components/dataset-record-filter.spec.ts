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

import { listQueryIndexes } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { answerListQuery } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { datasetRecordFilter, planRecordQuery, recordColumn } from './dataset-record-filter'
import { type DatasetModel, datasetIntegrityFields } from '../model/dataset-models'

const model: DatasetModel = {
  order: ['title', 'status', 'done', 'price', 'tags', 'due', 'owner', 'e.mail'],
  fields: {
    title: { name: 'Title', type: 'text' },
    status: { name: 'Status', type: 'text', validation: { options: ['Open', 'Closed'] } },
    done: { name: 'Done', type: 'bool' },
    price: { name: 'Price', type: 'float' },
    tags: { name: 'Tags', type: 'sorted' },
    due: { name: 'Due', type: 'timestamp' },
    owner: { name: 'Owner', type: 'reference', reference: { datasetId: 'people' } },
    'e.mail': { name: 'E-mail', type: 'text' },
  },
}
const filter = datasetRecordFilter(model)
const column = recordColumn
const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planRecordQuery(model, filter, clauses, search)

describe('datasetRecordFilter', () => {
  it('offers only what one query can serve, per field type', () => {
    expect(
      Object.fromEntries(filter.fields.map((field) => [field.column, field.operators])),
    ).toEqual({
      [column('title')]: ['contains', 'equals', 'isAnyOf'],
      [column('status')]: ['equals', 'isAnyOf'],
      [column('done')]: ['equals'],
      [column('price')]: ['='],
      [column('tags')]: ['contains'],
      // A column no query path can name keeps its word-level `contains`.
      [column('e.mail')]: ['contains'],
    })
  })

  it('needs no composite index: every order is the document name', () => {
    expect(filter.declaration.sorts).toEqual([{ path: '__name__', direction: 'asc' }])
    expect(listQueryIndexes(filter.declaration)).toEqual([])
  })
})

describe('planRecordQuery', () => {
  it('puts every equality and one word-level clause on ONE query', () => {
    const { plan: query, refused } = plan(
      [
        { field: column('status'), op: 'isAnyOf', value: 'Open,Closed' },
        { field: column('done'), op: 'equals', value: 'true' },
        { field: column('price'), op: '=', value: '19.50' },
        { field: column('title'), op: 'equals', value: '  Red KETTLE ' },
        { field: column('tags'), op: 'contains', value: ' Gift ' },
      ],
    )
    expect(refused).toEqual([])
    expect(query.filters).toEqual([
      { path: 'filterValues.status', op: 'in', value: ['Open', 'Closed'] },
      { path: 'filterValues.done', op: '==', value: true },
      { path: 'filterValues.price', op: '==', value: 19.5 },
      { path: 'filterValues.title', op: '==', value: 'red kettle' },
      { path: 'filterKeys', op: 'array-contains', value: 'f:tags=Gift' },
    ])
    expect(query.orderBy).toEqual({ path: '__name__', direction: 'asc' })
  })

  it('asks exactly what the writers stored', () => {
    // The whole design rests on this: a clause is only as good as the
    // writer and the reader agreeing on the spelling.
    const stored = {
      $id: 'rec-1',
      values: {},
      ...datasetIntegrityFields(model, {
        title: 'Red Kettle — 1.7 L',
        status: 'Closed',
        done: 'true',
        price: '19.50',
        tags: ['Gift'],
      }),
    }
    const other = {
      $id: 'rec-2',
      values: {},
      ...datasetIntegrityFields(model, { title: 'Blue mug', status: 'Open', done: false }),
    }
    const rows = [stored, other]
    for (const clauses of [
      [{ field: column('title'), op: 'contains', value: 'KETT' }],
      [{ field: column('title'), op: 'equals', value: 'red kettle — 1.7 l' }],
      [{ field: column('status'), op: 'equals', value: 'Closed' }],
      [{ field: column('done'), op: 'equals', value: 'true' }],
      [{ field: column('price'), op: '=', value: '19.5' }],
      [{ field: column('tags'), op: 'contains', value: 'Gift' }],
    ]) {
      expect({ clauses, ids: answerListQuery(rows, plan(clauses).plan).map((row) => row.$id) })
        .toEqual({ clauses, ids: ['rec-1'] })
    }
    expect(answerListQuery(rows, plan([], ['kettl']).plan).map((row) => row.$id)).toEqual([
      'rec-1',
    ])
  })

  it('refuses a second word-level clause by name, as the reader typed it', () => {
    const tags = { field: column('tags'), op: 'contains', value: 'Gift' }
    const { plan: query, refused } = plan([tags], ['kettle'])
    expect(query.filters).toEqual([{ path: 'filterKeys', op: 'array-contains', value: 's:kettle' }])
    expect(refused).toEqual([
      { clause: tags, reason: 'cannot be combined with the search — clear the search to use it' },
    ])
  })

  it('asks the first word of a many-word search or contains, and says so', () => {
    const search = plan([], ['red', 'kettle'])
    expect(search.plan.filters).toEqual([
      { path: 'filterKeys', op: 'array-contains', value: 's:red' },
    ])
    expect(search.notices).toEqual([
      'Search matches one word at a time: showing records with a word starting "red".',
    ])
    const contains = plan([{ field: column('title'), op: 'contains', value: 'Extraordinarily red' }])
    expect(contains.plan.filters).toEqual([
      { path: 'filterKeys', op: 'array-contains', value: 'f:title^extraordinar' },
    ])
    expect(contains.notices).toEqual([
      'Title contains matches one word at a time: showing records with a word starting "extraordinar".',
      'Title contains reads the first 12 letters of a word.',
    ])
  })

  it('refuses what it does not offer rather than answering part of it', () => {
    const range = { field: column('price'), op: '>', value: '5' }
    const due = { field: column('due'), op: 'after', value: '2026-01-01' }
    const { plan: query, refused } = plan([range, due])
    expect(query.filters).toEqual([])
    expect(refused.map((entry) => entry.clause)).toEqual([range, due])
  })
})
