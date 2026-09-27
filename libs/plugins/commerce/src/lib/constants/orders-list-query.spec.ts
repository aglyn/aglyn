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
 * The orders list's query holds every clause and the search, reads the fields
 * the writers stamp, and the index file holds every composite it can need
 * (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { listQueryRefusals } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { answerListQuery } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import {
  OPEN_DISPUTE_CLAUSE,
  ORDER_DISPUTE_OPTIONS,
  ORDER_LIST_FIELDS,
  ORDER_LIST_HEADERS,
  ORDER_LIST_QUERY,
  ordersCustomerClause,
} from './orders-list-query'
import { orderListFields } from '../model/order-list-fields'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const INDEXES = JSON.parse(
  readFileSync(join(REPO, 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planListQuery(ORDER_LIST_QUERY, { clauses, search }, nameSearchNormalizers)

/** An order as a writer leaves it: its own fields and `orderListFields`. */
const stamped = (id: string, order: Record<string, unknown>) => ({
  $id: id,
  ...order,
  ...orderListFields(order, id),
})

describe('the orders list puts every clause on its query', () => {
  it('lists newest first with nothing asked', () => {
    const shape = plan([])
    expect(shape.filters).toEqual([])
    expect(shape.orderBy).toMatchObject({ path: 'createdAtMs', direction: 'desc' })
  })

  it('serves the search, Status, Channel, Disputes and a date range together', () => {
    const shape = plan(
      [
        { field: 'statusKey', op: 'isAnyOf', value: 'paid,fulfilled' },
        { field: 'channelKey', op: 'equals', value: 'pos' },
        { field: 'disputeKey', op: 'equals', value: 'open' },
        { field: 'createdAtMs', op: 'onOrAfter', value: '2026-09-01' },
      ],
      ['Kettle'],
    )
    expect(shape.refused).toEqual([])
    expect(shape.searched).toBe('kettle')
    expect(shape.filters).toEqual(
      expect.arrayContaining([
        { path: 'searchTokens', op: 'array-contains', value: 'kettle' },
        { path: 'status', op: 'in', value: ['paid', 'fulfilled'] },
        { path: 'channel', op: '==', value: 'pos' },
        { path: 'disputeKey', op: '==', value: 'open' },
      ]),
    )
    // The range is on the field the list is already ordered by.
    expect(shape.orderBy.path).toBe('createdAtMs')
  })

  it('asks for a buyer and an order number the way the writers stored them', () => {
    const order = stamped('o1', {
      number: 1042,
      customerEmail: 'Jane.Doe@Acme.com',
      createdAtMs: 1,
      lineItems: [{ productId: 'p1', name: 'Enamel Camp Mug' }],
    })
    const asks = (clauses: Array<{ field: string; op: string; value: string }>, search: string[] = []) =>
      answerListQuery([order], plan(clauses, search)).map((row) => row.$id)
    expect(asks([{ field: 'customerEmail', op: 'equals', value: 'jane.doe@ACME.com' }])).toEqual(['o1'])
    expect(asks([{ field: 'customerEmail', op: 'contains', value: 'acme.com' }])).toEqual(['o1'])
    expect(asks([{ field: 'orderLabel', op: 'contains', value: '#1042' }])).toEqual(['o1'])
    expect(asks([{ field: 'orderLabel', op: 'contains', value: '104' }])).toEqual(['o1'])
    expect(asks([{ field: 'productIds', op: 'isAnyOf', value: 'p9,p1' }])).toEqual(['o1'])
    // The quick search: number, address and item names.
    for (const word of ['1042', 'jane', 'acme', 'camp', 'mug']) {
      expect(asks([], [word])).toEqual(['o1'])
    }
    expect(asks([], ['kettle'])).toEqual([])
  })

  it('refuses a second array clause BY NAME, labelled by the shared helper', () => {
    const shape = plan([{ field: 'productIds', op: 'isAnyOf', value: 'p1' }], ['mug'])
    expect(shape.served).toEqual([])
    expect(
      listQueryRefusals(shape.refused, {
        fields: ORDER_LIST_FIELDS,
        headers: ORDER_LIST_HEADERS,
        options: { productIds: [{ value: 'p1', label: 'Kettle' }] },
      }),
    ).toEqual([
      {
        label: 'Product is any of Kettle',
        reason: 'cannot be combined with the search — clear the search to use it',
      },
    ])
  })

  it('offers a Disputes choice for every tone the writers stamp', () => {
    const tones = ['open', 'lost', 'won', 'settled']
    expect(ORDER_DISPUTE_OPTIONS.map((option) => option.value).sort()).toEqual([...tones].sort())
    expect(OPEN_DISPUTE_CLAUSE).toEqual({ field: 'disputeKey', op: 'equals', value: 'open' })
  })
})

describe('the CRM seed (?email=)', () => {
  it('is that buyer for a whole address and a word prefix for anything else', () => {
    expect(ordersCustomerClause(' ada@example.test ')).toEqual({
      field: 'customerEmail',
      op: 'equals',
      value: 'ada@example.test',
    })
    expect(ordersCustomerClause('@acme.com')).toEqual({
      field: 'customerEmail',
      op: 'contains',
      value: 'acme.com',
    })
    expect(ordersCustomerClause('   ')).toBeNull()
  })
})

describe('the index file serves every shape the orders list can ask', () => {
  const needed = listQueryIndexes(ORDER_LIST_QUERY)

  it('needs one composite per filterable field beneath the one order', () => {
    // Index merging: one `(field, createdAtMs DESC)` per equality or array
    // field serves every combination; the date range rides the sort.
    expect(needed).toHaveLength(8)
    expect(
      needed.map((index) => index.fields.map((field) => field.fieldPath).join('+')).sort(),
    ).toEqual(
      [
        'channel+createdAtMs',
        'customerEmailLower+createdAtMs',
        'customerEmailTokens+createdAtMs',
        'disputeKey+createdAtMs',
        'orderLabelTokens+createdAtMs',
        'productIds+createdAtMs',
        'searchTokens+createdAtMs',
        'status+createdAtMs',
      ],
    )
  })

  it('holds every one of them', () => {
    expect(missingListQueryIndexes(INDEXES, 'orders', needed)).toEqual([])
  })
})
