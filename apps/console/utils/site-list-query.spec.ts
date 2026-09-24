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
 * The Sites list asks ONE query of the reader's membership rows, and every
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

describe('the Sites list query (AGL-3321)', () => {
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
        'nameLower:ASCENDING,createdAt:DESCENDING',
      ].sort(),
    )
    expect(needed.length).toBeLessThanOrEqual(12)
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

  it('searches by one word on the token array, beside every clause', () => {
    const planned = plan({
      clauses: [{ field: 'displayName', op: 'equals', value: 'Harbor Bakery' }],
      search: ['Bakery.com'],
    })
    expect(planned.filters).toEqual([
      { path: 'orgId', op: '==', value: 'org-1' },
      { path: 'searchTokens', op: 'array-contains', value: 'bakery.com' },
      { path: 'nameLower', op: '==', value: 'harbor bakery' },
    ])
    expect(planned.refused).toEqual([])
  })

  it('a Created range orders the list by the date it ranges over', () => {
    const planned = plan({
      clauses: [{ field: 'createdAt', op: 'onOrAfter', value: '2026-03-01' }],
    })
    expect(planned.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
    expect(planned.served).toHaveLength(1)
  })

  it('starts with is a range over the name the list sorts by', () => {
    const planned = plan({
      clauses: [{ field: 'displayName', op: 'startsWith', value: 'Har' }],
      sort: { path: 'createdAt', direction: 'desc' },
    })
    expect(planned.filters).toContainEqual({ path: 'nameLower', op: '>=', value: 'har' })
    expect(planned.orderBy).toMatchObject({ path: 'nameLower', direction: 'asc' })
  })

  it('refuses a second range by name rather than applying it to a page', () => {
    const planned = plan({
      clauses: [
        { field: 'displayName', op: 'startsWith', value: 'Har' },
        { field: 'createdAt', op: 'before', value: '2026-03-01' },
      ],
    })
    expect(planned.served.map((clause) => clause.field)).toEqual(['displayName'])
    expect(planned.refused).toEqual([
      expect.objectContaining({ clause: expect.objectContaining({ field: 'createdAt' }) }),
    ])
  })

  it('offers nothing a membership row cannot answer', () => {
    // Status, custom-domain state and Updated live on the host document and
    // move without the row; the domains are what the search finds.
    for (const field of ['status', 'customDomainState', 'cname', 'platformDomain', 'updatedAt']) {
      const planned = plan({ clauses: [{ field, op: 'equals', value: 'x' }] })
      expect(planned.served).toEqual([])
      expect(planned.refused).toHaveLength(1)
    }
    // A name contains would be a second array clause beside the search.
    expect(
      plan({ clauses: [{ field: 'displayName', op: 'contains', value: 'bak' }] }).served,
    ).toEqual([])
  })
})
