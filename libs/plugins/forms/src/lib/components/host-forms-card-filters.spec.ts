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
 * WHAT THE FORMS LIST CAN BE FILTERED AND SEARCHED BY (AGL-3330).
 *
 * Every column the table shows is a filter, typed as what it holds, and the
 * stored fields a site sorts its forms out by — lead routing, campaign,
 * retired — are filters kept out of sight. Asserted over the declaration and
 * the in-memory matcher the card hands its grid, against a catalog shaped
 * like the marketing site's own five forms, because each case below is a
 * question a reader asks of that list.
 */

import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { filterListRows } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { listFilterColumn, listFilterOperators } from '@aglyn/shared-ui-jsx/const/list-filter'

// The card's hooks are not exercised here, only the declarations beside them.
jest.mock('@aglyn/tenant-feature-instance', () => ({ __esModule: true }))
jest.mock('@aglyn/tenant-feature-instance/hooks/host-collection-queries', () => ({
  __esModule: true,
}))

const {
  FORM_FILTER_FIELDS,
  FORM_FILTER_HEADERS,
  FORM_SEARCH_FIELDS,
  formFilterRow,
} = require('./host-forms-card.component') as typeof import('./host-forms-card.component')

/** A Firestore timestamp as the client reads it: seconds, and `toDate`. */
const stamp = (at: Date) => ({
  seconds: Math.floor(at.getTime() / 1000),
  nanoseconds: 0,
  toDate: () => at,
})

/*
 * The marketing site's catalog, as production measured it on 2026-09-24.
 * Local dates, so the day a filter names is the day each row falls on
 * wherever the suite runs.
 */
const CATALOG = [
  {
    $id: 'fKq2mBrandAudit',
    displayName: 'Multi-brand site audit',
    slug: 'multi-brand-site-audit',
    // Never submitted and not lead-routed: no counter was ever written.
    updatedAt: stamp(new Date(2026, 8, 21, 3, 55)),
    createdAt: stamp(new Date(2026, 8, 21, 3, 50)),
  },
  {
    $id: 'fSalesEnquiry01',
    displayName: 'Sales enquiry',
    slug: 'sales-enquiry',
    routing: { lead: true },
    stats: { submissions: 1, leads: 1, lastSubmissionAtMs: new Date(2026, 8, 1, 2, 51).getTime() },
    updatedAt: stamp(new Date(2026, 8, 5, 19, 23)),
    createdAt: stamp(new Date(2026, 7, 30, 12, 0)),
  },
  {
    $id: 'fDemoRequest001',
    displayName: 'Demo request',
    slug: 'demo-request',
    routing: { lead: true },
    campaignIds: ['cmpFallLaunch'],
    stats: { submissions: 1, leads: 1, lastSubmissionAtMs: new Date(2026, 8, 1, 2, 51).getTime() },
    updatedAt: stamp(new Date(2026, 8, 5, 19, 25)),
  },
  {
    $id: 'fCostSheet00001',
    displayName: 'Multi-site cost sheet',
    slug: 'multi-site-cost-sheet',
    routing: { lead: true },
    campaignIds: ['cmpFallLaunch', 'cmpAgencyPush'],
    stats: { submissions: 2, leads: 1, lastSubmissionAtMs: new Date(2026, 8, 21, 3, 59).getTime() },
    updatedAt: stamp(new Date(2026, 8, 21, 3, 55)),
  },
  {
    $id: 'fContact0000001',
    displayName: 'Contact',
    slug: 'contact',
    routing: { lead: true },
    stats: { submissions: 5, leads: 4, lastSubmissionAtMs: new Date(2026, 8, 7, 10, 47).getTime() },
    updatedAt: stamp(new Date(2026, 7, 31, 22, 57)),
  },
  {
    $id: 'fOldNewsletter1',
    displayName: 'Old newsletter',
    slug: 'old-newsletter',
    archivedAt: 1_757_000_000_000,
    stats: { submissions: 9 },
    updatedAt: stamp(new Date(2026, 6, 1)),
  },
]

const ROWS = CATALOG.map(formFilterRow)

/** The names of the rows that answer the clauses and the search words. */
const names = (clauses: ListFilterClause[], words: string[] = []) =>
  filterListRows(ROWS, FORM_FILTER_FIELDS, clauses, {
    paths: FORM_SEARCH_FIELDS,
    words,
  }).map((row) => row.displayName)

const fieldFor = (header: string) => {
  const column = Object.entries(FORM_FILTER_HEADERS).find(([, name]) => name === header)?.[0]
  return FORM_FILTER_FIELDS.find((field) => field.column === column)
}

/*
 * The table's visible columns, named here rather than read off the card: a
 * check that derived them from the component would agree with it however
 * many had dropped out of the panel, which is the gap this closes.
 */
const VISIBLE_COLUMNS = [
  'Display name',
  'Slug',
  'Submissions',
  'Leads',
  'Last submission',
  'Updated',
]

describe('every column the forms table shows is a filter', () => {
  it('declares a field for each visible column, and the panel offers it', () => {
    for (const header of VISIBLE_COLUMNS) {
      const field = fieldFor(header)
      expect([header, field?.column]).toEqual([header, expect.any(String)])
      expect([header, listFilterColumn(FORM_FILTER_FIELDS, field!.column).filterable]).toEqual([
        header,
        true,
      ])
    }
  })

  it('types the figures as numbers and the moments as days', () => {
    expect(fieldFor('Submissions')?.kind).toBe('number')
    expect(fieldFor('Leads')?.kind).toBe('number')
    expect(fieldFor('Last submission')?.kind).toBe('date')
    expect(fieldFor('Updated')?.kind).toBe('date')
    expect(fieldFor('Created')?.kind).toBe('date')
    // Equal, over, under and the empty pair: a count nobody took is a
    // question the reader has to be able to ask.
    expect(listFilterOperators(fieldFor('Leads')!)).toEqual(
      expect.arrayContaining(['=', '>', '<', 'isEmpty', 'isNotEmpty']),
    )
    expect(listFilterOperators(fieldFor('Last submission')!)).toEqual(
      expect.arrayContaining(['after', 'before', 'onOrAfter', 'onOrBefore']),
    )
  })

  it('keeps the triage fields as filters the table does not draw', () => {
    for (const header of ['Status', 'Lead routing', 'Campaign', 'Created']) {
      expect([header, Boolean(fieldFor(header))]).toEqual([header, true])
    }
  })
})

describe('the questions a reader asks of the marketing site’s forms', () => {
  it('Submissions over 1: Multi-site cost sheet and Contact', () => {
    expect(names([{ field: 'submissions', op: '>', value: '1' }])).toEqual([
      'Multi-site cost sheet',
      'Contact',
      // A retired form answers too; the card hands the panel retired rows
      // only when Status is asked, so on screen this row stays out.
      'Old newsletter',
    ])
  })

  it('Last submission after Sep 10: Multi-site cost sheet', () => {
    expect(names([{ field: 'lastSubmission', op: 'after', value: '2026-09-10' }])).toEqual([
      'Multi-site cost sheet',
    ])
    // The panel's date input travels as the ISO of the day it names.
    expect(
      names([
        { field: 'lastSubmission', op: 'after', value: '2026-09-10T00:00:00.000Z' },
      ]),
    ).toEqual(['Multi-site cost sheet'])
  })

  it('Leads empty finds the form nobody routed, and = 0 does not claim it', () => {
    expect(names([{ field: 'leads', op: 'isEmpty', value: '' }])).toEqual([
      'Multi-brand site audit',
      'Old newsletter',
    ])
    // The dash is not a zero: a form that never counted leads has produced
    // no measured zero for `= 0` to find.
    expect(names([{ field: 'leads', op: '=', value: '0' }])).toEqual([])
  })

  it('Updated and Created are days', () => {
    expect(names([{ field: 'updatedAt', op: 'onOrAfter', value: '2026-09-21' }])).toEqual([
      'Multi-brand site audit',
      'Multi-site cost sheet',
    ])
    expect(names([{ field: 'createdAt', op: 'isEmpty', value: '' }])).toHaveLength(4)
    expect(names([{ field: 'createdAt', op: 'before', value: '2026-09-01' }])).toEqual([
      'Sales enquiry',
    ])
  })

  it('Lead routing on or off, read off `routing.lead`', () => {
    expect(names([{ field: 'leadRouting', op: 'equals', value: 'off' }])).toEqual([
      'Multi-brand site audit',
      'Old newsletter',
    ])
    expect(names([{ field: 'leadRouting', op: 'equals', value: 'on' }])).toHaveLength(4)
  })

  it('Campaign matches a form filed under it among others, by id exactly', () => {
    expect(names([{ field: 'campaignIds', op: 'equals', value: 'cmpFallLaunch' }])).toEqual([
      'Demo request',
      'Multi-site cost sheet',
    ])
    expect(names([{ field: 'campaignIds', op: 'equals', value: 'cmpfalllaunch' }])).toEqual([])
    expect(
      names([{ field: 'campaignIds', op: 'isAnyOf', value: 'cmpAgencyPush,cmpNone' }]),
    ).toEqual(['Multi-site cost sheet'])
  })

  it('Status picks the retired form out', () => {
    expect(names([{ field: 'status', op: 'equals', value: 'retired' }])).toEqual([
      'Old newsletter',
    ])
  })

  it('clauses on different columns add up', () => {
    expect(
      names([
        { field: 'submissions', op: '>', value: '1' },
        { field: 'lastSubmission', op: 'after', value: '2026-09-10' },
      ]),
    ).toEqual(['Multi-site cost sheet'])
  })
})

describe('the forms search', () => {
  it('finds "demo" by its name', () => {
    expect(names([], ['demo'])).toEqual(['Demo request'])
  })

  it('reads the slug and the form id as well as the name', () => {
    expect(names([], ['cost-sheet'])).toEqual(['Multi-site cost sheet'])
    expect(names([], ['fSalesEnquiry01'])).toEqual(['Sales enquiry'])
  })

  it('needs every word, in any order', () => {
    expect(names([], ['site', 'multi'])).toEqual([
      'Multi-brand site audit',
      'Multi-site cost sheet',
    ])
    expect(names([], ['multi', 'contact'])).toEqual([])
  })
})
