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
 * The forms list's filters and search are ALL on its query (AGL-3330): the
 * shape each question becomes, and the composite index every such shape
 * needs, pinned against the index file.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newFormListFields } from '@aglyn/aglyn/app-utils/forms'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  FORM_LEAD_ROUTING_OPTIONS,
  FORM_LIST_FILTER_FIELDS,
  FORM_LIST_FILTER_HEADERS,
  FORM_LIST_QUERY,
  FORM_STATUS_OPTIONS,
  formListRequest,
} from './form-list-query'
import { answerListQuery } from '@aglyn/tenant-feature-instance/testing/list-query-double'

type Clause = { field: string; op: string; value: string }
const plan = (clauses: Clause[], search: string[] = []) =>
  planListQuery(FORM_LIST_QUERY, formListRequest(clauses, search), nameSearchNormalizers)

const IN_USE = { path: 'retired', op: '==', value: false }

describe('the questions a reader asks of the marketing site’s forms', () => {
  it('reads the forms in use, in document order, when nothing narrows the list', () => {
    expect(plan([])).toMatchObject({
      filters: [IN_USE],
      orderBy: { path: '__name__', direction: 'asc' },
      refused: [],
    })
  })

  it('Submissions over 1: a range on the stored counter, which then orders the list', () => {
    expect(plan([{ field: 'submissions', op: '>', value: '1' }])).toMatchObject({
      filters: [IN_USE, { path: 'stats.submissions', op: '>', value: 1 }],
      orderBy: { path: 'stats.submissions', direction: 'asc' },
      refused: [],
    })
  })

  it('Last submission after Sep 10: epoch milliseconds from the start of Sep 11', () => {
    const result = plan([{ field: 'lastSubmission', op: 'after', value: '2026-09-10' }])
    expect(result.refused).toEqual([])
    expect(result.filters).toEqual([
      IN_USE,
      {
        path: 'stats.lastSubmissionAtMs',
        op: '>=',
        value: new Date(2026, 8, 11).getTime(),
      },
    ])
    expect(result.orderBy).toEqual({ path: 'stats.lastSubmissionAtMs', direction: 'desc' })
  })

  it('Leads = 0 or empty: an equality, the empty one on the null an uncounted form holds', () => {
    expect(plan([{ field: 'leads', op: 'isEmpty', value: '' }]).filters).toEqual([
      IN_USE,
      { path: 'stats.leads', op: '==', value: null },
    ])
    expect(plan([{ field: 'leads', op: '=', value: '0' }]).filters).toEqual([
      IN_USE,
      { path: 'stats.leads', op: '==', value: 0 },
    ])
  })

  it('search "demo": one array-contains on the search tokens, beside the forms in use', () => {
    expect(plan([], ['Demo'])).toMatchObject({
      filters: [IN_USE, { path: 'searchTokens', op: 'array-contains', value: 'demo' }],
      searched: 'demo',
      orderBy: { path: '__name__', direction: 'asc' },
    })
  })

  it('Status replaces the forms-in-use default with the reader’s own choice', () => {
    expect(plan([{ field: 'status', op: 'equals', value: 'true' }]).filters).toEqual([
      { path: 'retired', op: '==', value: true },
    ])
  })

  it('Updated, Lead routing, Campaign, Slug and a Display name word', () => {
    expect(plan([{ field: 'updatedAt', op: 'before', value: '2026-09-01' }]).orderBy).toEqual({
      path: 'updatedAt',
      direction: 'desc',
    })
    expect(plan([{ field: 'leadRouting', op: 'equals', value: 'false' }]).filters).toContainEqual({
      path: 'routing.lead',
      op: '==',
      value: false,
    })
    expect(plan([{ field: 'campaignIds', op: 'isAnyOf', value: 'cmpFall,cmpSpring' }]).filters).toContainEqual({
      path: 'campaignIds',
      op: 'array-contains-any',
      value: ['cmpFall', 'cmpSpring'],
    })
    expect(plan([{ field: 'slug', op: 'equals', value: 'Contact' }]).filters).toContainEqual({
      path: 'slug',
      op: '==',
      value: 'contact',
    })
    expect(plan([{ field: 'displayName', op: 'contains', value: 'Audit' }]).filters).toContainEqual({
      path: 'nameTokens',
      op: 'array-contains',
      value: 'audit',
    })
  })

  it('composes a range with equalities, and refuses a second range by name', () => {
    const composed = plan([
      { field: 'submissions', op: '>', value: '1' },
      { field: 'leadRouting', op: 'equals', value: 'true' },
    ])
    expect(composed.refused).toEqual([])
    const second = plan([
      { field: 'submissions', op: '>', value: '1' },
      { field: 'lastSubmission', op: 'after', value: '2026-09-10' },
    ])
    expect(second.served.map((clause) => clause.field)).toEqual(['submissions'])
    expect(second.refused.map((entry) => entry.clause)).toEqual([
      { field: 'lastSubmission', op: 'after', value: '2026-09-10' },
    ])
  })
})

/*
 * THE ACCEPTANCE, over the marketing site's forms as production stores them
 * once the backfill has stamped them (read 2026-09-27): the counters as
 * `/api/forms/submit` left them, null where it never wrote one, and
 * `retired` mirroring `archivedAt`. The real plan asks, and the list query
 * double answers the way Firestore would, so what comes back is the rows the
 * query returns — including that a null counter is never inside a range.
 */
describe('the marketing site’s forms answer the acceptance on the query', () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime()
  const form = (
    id: string,
    displayName: string,
    stats: { submissions: number | null; leads: number | null; last: string | null },
    extra: Record<string, unknown> = {},
  ) => {
    const stamped = newFormListFields({
      id,
      displayName,
      slug: displayName.toLowerCase().replace(/\s+/g, '-'),
      routing: { lead: true },
    })
    return {
      $id: id,
      displayName,
      ...stamped,
      stats: {
        submissions: stats.submissions,
        leads: stats.leads,
        lastSubmissionAtMs: stats.last ? day(stats.last) : null,
      },
      updatedAt: new Date(day('2026-09-21')),
      ...extra,
    }
  }
  const rows = [
    form('Feerj7r-TG', 'Multi-brand site audit', { submissions: null, leads: null, last: null }),
    form('Jri2MxvBi1', 'Sales enquiry', { submissions: 1, leads: 1, last: '2026-09-01' }),
    form('MPpxJRqHcS', 'Launch notification', { submissions: null, leads: null, last: null }, {
      archivedAt: 1788811670330,
      retired: true,
    }),
    form('QjQn0B0pa1', 'Demo request', { submissions: 1, leads: 1, last: '2026-09-01' }),
    form('opSUy7v3q4', 'Multi-site cost sheet', { submissions: 2, leads: 1, last: '2026-09-21' }),
    form('xq2pmBcMGZ', 'Contact', { submissions: 5, leads: 4, last: '2026-09-07' }),
  ]
  const names = (clauses: Clause[], search: string[] = []) =>
    answerListQuery(rows, plan(clauses, search)).map((row) => row.displayName)

  it('Submissions > 1 returns Contact and Multi-site cost sheet', () => {
    expect(names([{ field: 'submissions', op: '>', value: '1' }]).sort()).toEqual([
      'Contact',
      'Multi-site cost sheet',
    ])
  })

  it('Last submission after Sep 10 returns Multi-site cost sheet', () => {
    expect(names([{ field: 'lastSubmission', op: 'after', value: '2026-09-10' }])).toEqual([
      'Multi-site cost sheet',
    ])
  })

  it('Leads is empty returns Multi-brand site audit, and not the retired form', () => {
    expect(names([{ field: 'leads', op: 'isEmpty', value: '' }])).toEqual(['Multi-brand site audit'])
    expect(names([{ field: 'leads', op: '=', value: '0' }])).toEqual([])
  })

  it('the search box finds "demo"', () => {
    expect(names([], ['demo'])).toEqual(['Demo request'])
  })

  it('Status is Retired reaches the retired form the default leaves out', () => {
    expect(names([])).not.toContain('Launch notification')
    expect(names([{ field: 'status', op: 'equals', value: 'true' }])).toEqual(['Launch notification'])
  })
})

describe('the grid offers every visible column, typed', () => {
  // The card's columns: the six it shows, and the two it hides until
  // Columns shows them.
  const columns = [
    'displayName',
    'slug',
    'submissions',
    'leads',
    'lastSubmission',
    'updatedAt',
    'status',
    'leadRouting',
  ].map((field) => ({ field }))
  const typed = listFilterGridColumns(
    columns,
    FORM_LIST_FILTER_FIELDS,
    { status: FORM_STATUS_OPTIONS, leadRouting: FORM_LEAD_ROUTING_OPTIONS, campaignIds: [{ value: 'c1', label: 'Fall' }] },
    FORM_LIST_FILTER_HEADERS,
  )
  const operators = (field: string) =>
    (typed.find((column) => column.field === field)?.filterOperators ?? []).map((op) => op.value)

  it('makes each visible column filterable', () => {
    for (const column of columns) {
      expect([column.field, typed.find((entry) => entry.field === column.field)?.filterable]).toEqual([
        column.field,
        true,
      ])
    }
  })

  it('types the figures as numbers and the moments as days', () => {
    expect(operators('submissions')).toEqual(expect.arrayContaining(['=', '>', '<', 'isEmpty']))
    expect(operators('leads')).toEqual(['=', 'isEmpty'])
    expect(operators('lastSubmission')).toEqual(expect.arrayContaining(['after', 'before']))
    expect(operators('updatedAt')).toEqual(expect.arrayContaining(['after', 'before']))
  })

  it('offers Status and Lead routing as picks, and Campaign as a filter the table does not draw', () => {
    expect(operators('status')).toEqual(['is'])
    expect(operators('leadRouting')).toEqual(['is'])
    const campaign = typed.find((entry) => entry.field === 'campaignIds')
    expect([campaign?.filterable, campaign?.hideable]).toEqual([true, false])
    expect(operators('campaignIds')).toEqual(['isAnyOf'])
  })
})

describe('every composite the forms query can need is in the index file', () => {
  const file = JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
      'utf8',
    ),
  )
  const needed = listQueryIndexes(FORM_LIST_QUERY)

  it('needs the three range orders and nothing wider', () => {
    const orders = [
      ...new Set(needed.map((index) => `${index.fields[1].fieldPath}:${index.fields[1].order}`)),
    ].sort()
    expect(orders).toEqual([
      'stats.lastSubmissionAtMs:DESCENDING',
      'stats.submissions:ASCENDING',
      'updatedAt:DESCENDING',
    ])
    // Eight equality fields times three range orders, less Submissions
    // against its own order. A new filter that grows this is a decision about
    // the index budget, made here on purpose rather than by accident.
    expect(needed).toHaveLength(23)
  })

  it('has every one of them', () => {
    expect(missingListQueryIndexes(file, 'forms', needed)).toEqual([])
  })
})
