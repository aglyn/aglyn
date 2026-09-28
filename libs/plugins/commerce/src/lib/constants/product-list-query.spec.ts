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
 * The products table's query holds every clause and the search, and the index
 * file holds every composite that query can need (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { listQueryRefusals } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  PRODUCT_LIST_BASE,
  PRODUCT_LIST_FIELDS,
  PRODUCT_LIST_HEADERS,
  PRODUCT_LIST_INDEX_BASE,
  PRODUCT_LIST_OPTIONS,
  PRODUCT_LIST_QUERY,
  productListRequestClauses,
} from './product-list-query'
import { productSearchFields } from '../model'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) =>
  planListQuery(
    PRODUCT_LIST_QUERY,
    { clauses: productListRequestClauses(clauses), search, base: PRODUCT_LIST_BASE },
    nameSearchNormalizers,
  )

const context = {
  fields: PRODUCT_LIST_FIELDS,
  headers: PRODUCT_LIST_HEADERS,
  options: PRODUCT_LIST_OPTIONS,
}

describe('the products table puts every clause on its query', () => {
  it('maps its refusals only through the shared mapper', () => {
    const card = read(
      'libs/plugins/commerce/src/lib/components/console/products-hub-card.component.tsx',
    )
    expect(card).toContain('listQueryRefusals(plan.refused')
    expect(card).not.toMatch(/ClauseLabel|usePagedRowsFilter|useListRowsFilter|filterListRows|keepAlongside/)
  })

  it('lists live products only, ordered by name, with nothing asked', () => {
    const shape = plan([])
    expect(shape.filters).toEqual([{ path: 'deletedAt', op: '==', value: null }])
    expect(shape.orderBy).toEqual({ path: 'nameLower', direction: 'asc', column: 'name' })
  })

  it('serves the search, Status and Type together', () => {
    const shape = plan(
      [
        { field: 'status', op: 'equals', value: 'active' },
        { field: 'type', op: 'isAnyOf', value: 'physical,digital' },
      ],
      ['Coffee'],
    )
    expect(shape.refused).toEqual([])
    expect(shape.searched).toBe('coffee')
    expect(shape.filters).toEqual([
      { path: 'deletedAt', op: '==', value: null },
      { path: 'nameTokens', op: 'array-contains', value: 'coffee' },
      { path: 'status', op: '==', value: 'active' },
      { path: 'type', op: 'in', value: ['physical', 'digital'] },
    ])
    expect(shape.orderBy.path).toBe('nameLower')
  })

  it('asks for a SKU the way the writer stored it, whole and lower-cased', () => {
    const [stored] = productSearchFields({
      name: 'Tee',
      variants: [{ id: 'a', priceUsd: 1, sku: ' ABC-123 ' }],
    }).skus ?? []
    const shape = plan([{ field: 'skus', op: 'contains', value: '  ABC-123 ' }])
    expect(shape.filters).toContainEqual({ path: 'skus', op: 'array-contains', value: stored })
    const any = plan([{ field: 'barcodes', op: 'isAnyOf', value: 'X1, y2 ,Z3' }])
    expect(any.filters).toContainEqual({
      path: 'barcodes',
      op: 'array-contains-any',
      value: ['x1', 'y2', 'z3'],
    })
  })

  it('serves a name prefix in the order the list already has', () => {
    const shape = plan([{ field: 'name', op: 'startsWith', value: 'Wal' }])
    expect(shape.refused).toEqual([])
    expect(shape.orderBy.path).toBe('nameLower')
    expect(shape.filters).toContainEqual({ path: 'nameLower', op: '>=', value: 'wal' })
  })

  it('refuses a second array clause BY NAME rather than matching it over a page', () => {
    const shape = plan([{ field: 'skus', op: 'contains', value: 'abc-123' }], ['lamp'])
    expect(shape.served).toEqual([])
    expect(shape.refused).toEqual([
      {
        clause: { field: 'skus', op: 'contains', value: 'abc-123' },
        reason: 'cannot be combined with the search — clear the search to use it',
      },
    ])
    expect(listQueryRefusals(shape.refused, context)).toEqual([
      {
        label: expect.stringContaining('SKU'),
        reason: 'cannot be combined with the search — clear the search to use it',
      },
    ])
  })

  it('names a picked value by its label in a refusal, through the shared mapper', () => {
    const [refusal] = listQueryRefusals(
      [{ clause: { field: 'status', op: 'isAnyOf', value: 'active,draft' }, reason: 'why' }],
      context,
    )
    expect(refusal.label).toContain('Status')
    expect(refusal.label).toContain('Active')
    expect(refusal.label).toContain('Draft')
  })
})

describe('the index file serves every shape the products table can ask', () => {
  const indexFile = JSON.parse(read('cloud/firebase-firestore.indexes.json'))
  const needed = listQueryIndexes(PRODUCT_LIST_QUERY, PRODUCT_LIST_INDEX_BASE)

  it('holds every composite', () => {
    expect(missingListQueryIndexes(indexFile, 'products', needed, 'COLLECTION')).toEqual([])
  })

  it('needs one composite per filterable field and the scope, within the budget', () => {
    expect(
      needed.map((index) =>
        index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
      ),
    ).toEqual([
      'deletedAt:ASCENDING,nameLower:ASCENDING',
      'nameTokens:CONTAINS,nameLower:ASCENDING',
      'status:ASCENDING,nameLower:ASCENDING',
      'type:ASCENDING,nameLower:ASCENDING',
      'slug:ASCENDING,nameLower:ASCENDING',
      'skus:CONTAINS,nameLower:ASCENDING',
      'barcodes:CONTAINS,nameLower:ASCENDING',
    ])
    expect(needed.length).toBeLessThanOrEqual(12)
  })
})

describe('the rules let a site member ask any of those shapes', () => {
  /*
   * Queries from the browser run under the rules, and a rule that inspects a
   * field the query does not constrain refuses the whole listen. Products
   * are read through the host catch-all, which asks only whether the reader
   * is a member of the site — nothing about the document — and names no
   * product field anywhere.
   */
  const rules = read('cloud/firebase-firestore.rules')

  it('reads products through the member catch-all, which inspects no field', () => {
    const readRule = rules.slice(rules.indexOf('match /{subcollection}/{document=**} {'))
    const allowRead = readRule.slice(readRule.indexOf('allow read:'), readRule.indexOf(';'))
    expect(allowRead).toContain('isHostMember(hostId)')
    expect(allowRead).not.toContain("'products'")
    expect(allowRead).not.toMatch(/resource\.data/)
  })

  it('has no dedicated products block to narrow it', () => {
    expect(rules).not.toMatch(/match \/products\//)
  })
})
