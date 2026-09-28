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
 * The Sites cards ask ONE query of the reader's membership rows, and every
 * shape it can ask has its index (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  type ListQueryRequest,
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  SITE_LIST_COLLECTION_GROUP,
  SITE_LIST_DECLARATION,
  SITE_LIST_INDEX_BASE,
  siteListBase,
} from './site-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const shapes = (indexes: ReturnType<typeof listQueryIndexes>) =>
  indexes.map((index) =>
    index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
  )

const plan = (request: Omit<ListQueryRequest, 'base'>, orgId: string | null = 'org-1') =>
  planListQuery(
    SITE_LIST_DECLARATION,
    { ...request, base: siteListBase(orgId) },
    nameSearchNormalizers,
  )

describe('the Sites cards query (AGL-3321)', () => {
  it('every shape it can ask has its composite index, within the budget', () => {
    const needed = listQueryIndexes(SITE_LIST_DECLARATION, SITE_LIST_INDEX_BASE)
    expect(
      missingListQueryIndexes(INDEX_FILE, SITE_LIST_COLLECTION_GROUP, needed, 'COLLECTION'),
    ).toEqual([])
    expect(shapes(needed).sort()).toEqual(
      [
        'orgId:ASCENDING,nameLower:ASCENDING',
        'orgId:ASCENDING,createdAt:DESCENDING',
        'searchTokens:CONTAINS,nameLower:ASCENDING',
        'searchTokens:CONTAINS,createdAt:DESCENDING',
        'hasCustomDomain:ASCENDING,nameLower:ASCENDING',
        'hasCustomDomain:ASCENDING,createdAt:DESCENDING',
      ].sort(),
    )
    // The unscoped list (an account with no workspace) asks a subset.
    expect(
      missingListQueryIndexes(
        INDEX_FILE,
        SITE_LIST_COLLECTION_GROUP,
        listQueryIndexes(SITE_LIST_DECLARATION),
        'COLLECTION',
      ),
    ).toEqual([])
  })

  it('is scoped to the workspace and ordered by name, A to Z, by default', () => {
    const planned = plan({ clauses: [] })
    expect(planned.filters).toEqual([{ path: 'orgId', op: '==', value: 'org-1' }])
    expect(planned.orderBy).toMatchObject({ path: 'nameLower', direction: 'asc' })
  })

  it('an account with no workspace lists every site it holds, as useOrgHosts does', () => {
    expect(siteListBase(null)).toEqual([])
    expect(plan({ clauses: [] }, null).filters).toEqual([])
  })

  it('searches by one word on the token array, beside the Custom domain filter', () => {
    const planned = plan({
      clauses: [{ field: 'hasCustomDomain', op: 'is', value: 'true' }],
      search: ['Bakery.com'],
    })
    expect(planned.filters).toEqual([
      { path: 'orgId', op: '==', value: 'org-1' },
      { path: 'searchTokens', op: 'array-contains', value: 'bakery.com' },
      { path: 'hasCustomDomain', op: '==', value: true },
    ])
    expect(planned.refused).toEqual([])
    expect(planned.orderBy).toMatchObject({ path: 'nameLower', direction: 'asc' })
  })

  it('a Created range orders the cards newest first, and composes with the rest', () => {
    const planned = plan({
      clauses: [
        { field: 'createdAt', op: 'onOrAfter', value: '2026-03-01' },
        { field: 'hasCustomDomain', op: 'is', value: 'false' },
      ],
      search: ['harbor'],
    })
    expect(planned.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
    expect(planned.served).toHaveLength(2)
    expect(planned.refused).toEqual([])
  })

  it('a whole day is two bounds on the date, not a cursor', () => {
    const planned = plan({ clauses: [{ field: 'createdAt', op: 'is', value: '2026-03-01' }] })
    expect(planned.filters.filter((filter) => filter.path === 'createdAt').map((f) => f.op)).toEqual([
      '>=',
      '<',
    ])
  })

  it('refuses by name a clause it cannot put on the query, rather than guess', () => {
    const custom = plan({ clauses: [{ field: 'hasCustomDomain', op: 'is', value: 'maybe' }] })
    expect(custom.served).toEqual([])
    expect(custom.refused).toEqual([expect.objectContaining({ reason: 'pick true or false' })])
  })

  it('offers nothing a membership row cannot answer', () => {
    // Status and Updated live on the host document and move without the row;
    // plan, owner and template are not stored at all; the name and the
    // domains are what the search finds.
    for (const field of ['status', 'plan', 'createdBy', 'template', 'updatedAt', 'displayName', 'cname']) {
      const planned = plan({ clauses: [{ field, op: 'equals', value: 'x' }] })
      expect(planned.served).toEqual([])
      expect(planned.refused).toHaveLength(1)
    }
  })
})
