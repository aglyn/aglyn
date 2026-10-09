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

import type { DatasetModel } from './dataset-model-core'
import {
  planReferenceFixups,
  referencingFieldIds,
  restrictedDeleteMessage,
} from './dataset-record-delete-plan'

/**
 * The delete-integrity verdict the Data card and `/api/orgs/datasets`
 * `delete-record` share (AGL-180, AGL-3668): which holders point at the
 * record through a field that targets its dataset, and whether that refuses
 * the delete or strips the reference.
 */

const orders = (onDelete?: 'restrict' | 'setNull', multiple = false): DatasetModel => ({
  order: ['title', 'customer', 'other'],
  fields: {
    title: { name: 'Title', type: 'text' },
    customer: {
      name: 'Customer',
      type: 'reference',
      reference: { datasetId: 'customers', ...(onDelete ? { onDelete } : {}), multiple },
    },
    other: { name: 'Other', type: 'reference', reference: { datasetId: 'products' } },
  },
})

describe('referencingFieldIds', () => {
  it('names only the fields that point into the dataset', () => {
    expect(referencingFieldIds(orders(), 'customers')).toEqual(['customer'])
    expect(referencingFieldIds(orders(), 'products')).toEqual(['other'])
    expect(referencingFieldIds(orders(), 'nothing')).toEqual([])
  })
})

describe('planReferenceFixups', () => {
  it('is nothing when the model has no field into the dataset', () => {
    expect(planReferenceFixups(orders(), 'elsewhere', 'c1', [{ id: 'o1', values: { customer: 'c1' } }])).toEqual({ kind: 'none' })
  })

  it('ignores a holder whose referencedIds came from another field', () => {
    // `referencedIds` is the union across fields: `other` holds the same id.
    expect(planReferenceFixups(orders(), 'customers', 'c1', [{ id: 'o1', values: { other: 'c1' } }])).toEqual({ kind: 'none' })
  })

  it('refuses under restrict, counting the holders', () => {
    const plan = planReferenceFixups(orders('restrict'), 'customers', 'c1', [
      { id: 'o1', values: { customer: 'c1' } },
      { id: 'o2', values: { customer: 'c1' } },
    ])
    expect(plan).toEqual({ kind: 'restricted', holders: 2 })
  })

  it('strips a single reference and removes it from a list under setNull', () => {
    const single = planReferenceFixups(orders(), 'customers', 'c1', [{ id: 'o1', values: { title: 'A', customer: 'c1' } }])
    expect(single).toEqual({ kind: 'strip', updates: [{ id: 'o1', values: { title: 'A' } }] })
    const multiple = planReferenceFixups(orders('setNull', true), 'customers', 'c1', [
      { id: 'o1', values: { customer: ['c0', 'c1', 'c2'] } },
    ])
    expect(multiple).toEqual({ kind: 'strip', updates: [{ id: 'o1', values: { customer: ['c0', 'c2'] } }] })
  })

  it('never mutates the values it was handed', () => {
    const values = { customer: ['c1'] }
    planReferenceFixups(orders('setNull', true), 'customers', 'c1', [{ id: 'o1', values }])
    expect(values).toEqual({ customer: ['c1'] })
  })
})

it('words the refusal as the card always has', () => {
  expect(restrictedDeleteMessage(1, 'Orders')).toBe('Cannot delete: referenced by 1 document in "Orders"')
  expect(restrictedDeleteMessage(3, 'Orders')).toBe('Cannot delete: referenced by 3 documents in "Orders"')
})
