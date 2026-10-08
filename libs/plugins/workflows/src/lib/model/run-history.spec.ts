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
 * The run history is ONE served query (AGL-3321): its scope, every clause
 * the Filters panel offers and the search word are predicates the index file
 * serves, and the entries written before the structured fields are completed
 * by a backfill held to the same worked examples as this model.
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
  RUN_HISTORY_BASE_PATHS,
  RUN_HISTORY_QUERY,
  RUN_RESULTS,
  runEntryCompletion,
  runHistoryBase,
  runSummaryFields,
} from './run-history'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const read = (path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8'))

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) =>
  planListQuery(
    RUN_HISTORY_QUERY,
    { clauses, search, base: runHistoryBase('wf-1', clauses) },
    nameSearchNormalizers,
  )

describe('the run history scope', () => {
  it('is this automation and only runs', () => {
    expect(runHistoryBase('wf-1', [])).toEqual([
      { path: 'target.id', op: '==', value: 'wf-1' },
      { path: 'result', op: 'in', value: [...RUN_RESULTS] },
    ])
  })

  it('lets a Result clause keep it to runs instead of repeating the field', () => {
    const clauses = [{ field: 'result', op: 'equals', value: 'failed' }]
    expect(runHistoryBase('wf-1', clauses)).toEqual([
      { path: 'target.id', op: '==', value: 'wf-1' },
    ])
    expect(plan(clauses).filters).toEqual([
      { path: 'target.id', op: '==', value: 'wf-1' },
      { path: 'result', op: '==', value: 'failed' },
    ])
  })

  it('never drops the scope for a Result clause the plan would refuse', () => {
    // The scope leaves only for a clause the plan serves unconditionally;
    // every other shape keeps `result in [...]` on the query.
    for (const value of RUN_RESULTS) {
      const clauses = [{ field: 'result', op: 'equals', value }]
      expect(plan(clauses).served).toEqual(clauses)
    }
    const anyOf = [{ field: 'result', op: 'isAnyOf', value: 'failed,skipped' }]
    expect(plan(anyOf).served).toEqual(anyOf)
    for (const clauses of [
      [{ field: 'result', op: 'isNotEmpty', value: '' }],
      [{ field: 'result', op: 'equals', value: '' }],
    ]) {
      expect(runHistoryBase('wf-1', clauses)).toContainEqual({
        path: 'result',
        op: 'in',
        value: [...RUN_RESULTS],
      })
    }
  })
})

describe('every Filters-panel clause and the search are on the query', () => {
  it('serves Time, Trigger, Result and a search word together', () => {
    const clauses = [
      { field: 'createdAtMs', op: 'onOrAfter', value: '2026-09-01' },
      { field: 'trigger', op: 'equals', value: 'formSubmission' },
      { field: 'result', op: 'isAnyOf', value: 'failed,skipped' },
    ]
    const served = plan(clauses, ['webhook'])
    expect(served.refused).toEqual([])
    expect(served.served).toEqual(clauses)
    expect(served.searched).toBe('webhook')
    expect(served.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc', column: 'createdAtMs' })
    expect(served.filters).toEqual(
      expect.arrayContaining([
        { path: 'summaryTokens', op: 'array-contains', value: 'webhook' },
        { path: 'trigger', op: '==', value: 'formSubmission' },
        { path: 'result', op: 'in', value: ['failed', 'skipped'] },
      ]),
    )
  })

  it('offers no operator the query cannot serve', () => {
    const offered = RUN_HISTORY_QUERY.fields.flatMap((field) =>
      (field.operators ?? []).map((op) => ({ field: field.column, op })),
    )
    for (const { field, op } of offered) {
      const value = field === 'createdAtMs' ? '2026-09-01' : field === 'result' ? 'failed' : 'x'
      expect(plan([{ field, op, value }]).refused).toEqual([])
    }
  })

  it('has every composite its shapes need in the index file', () => {
    const needed = listQueryIndexes(RUN_HISTORY_QUERY, RUN_HISTORY_BASE_PATHS)
    expect(needed.length).toBeLessThanOrEqual(12)
    expect(
      missingListQueryIndexes(
        read('cloud/firebase-firestore.indexes.json'),
        'activity',
        needed,
        'COLLECTION',
      ),
    ).toEqual([])
  })
})

describe('run entries carry what the query asks for', () => {
  it('writes a summary and its tokens together', () => {
    expect(runSummaryFields('Sent email · webhook 200')).toEqual({
      summary: 'Sent email · webhook 200',
      summaryTokens: expect.arrayContaining(['s', 'se', 'sent', 'webhook', '200']),
    })
  })

  it('completes stored entries exactly as the backfill does', () => {
    // `tools/scripts/backfill-activity-run-fields.mjs --self-test` asserts the
    // same file against its own copy, so the two cannot drift apart without
    // one of them going red.
    const fixtures = read('tools/scripts/lib/activity-run-fields.fixtures.json')
    expect(fixtures.cases.length).toBeGreaterThan(0)
    for (const one of fixtures.cases) {
      expect({ name: one.name, patch: runEntryCompletion(one.entry) }).toEqual({
        name: one.name,
        patch: one.expected,
      })
    }
  })
})

describe('every header sorts (AGL-3680)', () => {
  const sorted = (
    sort: { path: string; direction: 'asc' | 'desc' },
    clauses: Array<{ field: string; op: string; value: string }> = [],
  ) =>
    planListQuery(
      RUN_HISTORY_QUERY,
      { clauses, search: [], base: runHistoryBase('wf-1', clauses), sort },
      nameSearchNormalizers,
    )

  it('orders the history by Trigger with nothing narrowing it', () => {
    expect(sorted({ path: 'trigger', direction: 'asc' }).orderBy).toMatchObject({
      path: 'trigger',
      direction: 'asc',
    })
  })

  it('falls back to newest first under a filter, and says so', () => {
    const answer = sorted({ path: 'summary', direction: 'asc' }, [
      { field: 'result', op: 'equals', value: 'failed' },
    ])
    expect(answer.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
    expect(answer.notices).toEqual(['Sorted by Time: What happened sorts only with no filter or search on.'])
  })
})
