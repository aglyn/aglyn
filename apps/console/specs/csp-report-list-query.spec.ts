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
 * The Health page's CSP violations table: every filter and the search on its
 * query, beneath the Window, and every shape that query can take has its
 * index (AGL-3321).
 *
 * A clause the plan puts on a query with no composite behind it throws
 * FAILED_PRECONDITION for every reader, in production only; it fails here
 * instead.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  CSP_SEARCH_TOKENS_PATH as WRITTEN_TOKENS_PATH,
  cspSearchTokens,
} from '@aglyn/tenant-data-admin/server/csp-aggregate'
import {
  CSP_LIST_QUERY,
  CSP_SEARCH_TOKENS_PATH,
  cspWindowBase,
} from '../utils/csp-report-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const SINCE = '2026-09-13'

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) =>
  planListQuery(
    CSP_LIST_QUERY,
    { clauses, search, base: cspWindowBase(SINCE) },
    nameSearchNormalizers,
  )

describe('the CSP table has the composites its query shapes need', () => {
  it('holds every one in the index file', () => {
    expect(
      missingListQueryIndexes(INDEX_FILE, 'cspViolationDaily', listQueryIndexes(CSP_LIST_QUERY)),
    ).toEqual([])
  })

  it('names exactly the merged composites, all under the window’s day DESC', () => {
    const shapes = listQueryIndexes(CSP_LIST_QUERY).map((index) =>
      index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
    )
    expect(shapes.sort()).toEqual([
      'app:ASCENDING,day:DESCENDING',
      'directive:ASCENDING,day:DESCENDING',
      'disposition:ASCENDING,day:DESCENDING',
      'origin:ASCENDING,day:DESCENDING',
      'searchTokens:CONTAINS,day:DESCENDING',
    ])
  })

  it('searches the field the collector writes', () => {
    expect(CSP_SEARCH_TOKENS_PATH).toBe(WRITTEN_TOKENS_PATH)
  })
})

describe('every clause and the search word land on the query, beneath the window', () => {
  it('App, Directive, Blocked or measured, Blocked origin, a day and the search, at once', () => {
    const answer = plan(
      [
        { field: 'app', op: 'equals', value: 'tenant' },
        { field: 'directive', op: 'isAnyOf', value: 'img-src,script-src-elem' },
        { field: 'disposition', op: 'equals', value: 'enforce' },
        { field: 'origin', op: 'equals', value: 'CDN.Example.com' },
        { field: 'day', op: 'startsWith', value: '2026-09-17' },
      ],
      ['googletag'],
    )
    expect(answer.refused).toEqual([])
    expect(answer.served).toHaveLength(5)
    expect(answer.searched).toBe('googletag')
    expect(answer.filters.map((filter) => `${filter.path} ${filter.op}`)).toEqual([
      'day >=',
      'searchTokens array-contains',
      'app ==',
      'directive in',
      'disposition ==',
      'origin ==',
      'day >=',
      'day <=',
    ])
    // The origin is asked the way the collector stored it: lower case.
    expect(answer.filters.find((filter) => filter.path === 'origin')?.value).toBe('cdn.example.com')
    expect(answer.orderBy).toMatchObject({ path: 'day', direction: 'desc', column: 'day' })
  })

  it('finds a counter by any part of its origin, as the collector stamps it', () => {
    const tokens = cspSearchTokens({ origin: 'www.googletagmanager.com', directive: 'script-src-elem', app: 'console' })
    for (const typed of ['googletagmanager', 'www.googletagmanager.com', 'elem', 'console']) {
      const searched = plan([], [typed]).searched
      expect(searched && tokens.includes(searched)).toBe(true)
    }
  })

  it('refuses what one query cannot hold, by name, and applies none of it', () => {
    const answer = plan([
      { field: 'count', op: '>', value: '10' },
      { field: 'directive', op: 'startsWith', value: 'script' },
    ])
    expect(answer.served).toEqual([])
    expect(answer.refused.map((entry) => entry.clause)).toEqual([
      { field: 'count', op: '>', value: '10' },
      { field: 'directive', op: 'startsWith', value: 'script' },
    ])
    // Only the window.
    expect(answer.filters).toEqual(cspWindowBase(SINCE))
  })

  it('searches one word, and says so when two were typed', () => {
    expect(plan([], ['cdn']).notices).toEqual([])
    expect(plan([], ['cdn', 'example']).notices).toHaveLength(1)
  })
})
