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
import {
  crmLeadListFields,
  crmSearchTokens,
  EMAIL_STATE_STATUSES,
} from '@aglyn/aglyn'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { planListQuery } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  LEAD_EMAIL_FILTER_LABELS,
  LEAD_EMAIL_FILTERS,
  LEAD_FILTER_LABELS,
  LEAD_FILTERS,
  LEAD_LIST_DECLARATION,
  LEAD_SOURCE_FILTER_NONE,
  leadClausesForGrid,
  leadClausesToStore,
  leadQueryClause,
} from './lead-filters'

/**
 * The Leads list asks every clause of its query (AGL-3321), through the
 * field each lead writer stores for it — so the one question that made the
 * list a window before, "which leads are Open", is an `in` over a status
 * every lead carries.
 */
describe('leadQueryClause', () => {
  it('asks Open as the three open statuses, and a status as itself', () => {
    expect(leadQueryClause({ field: 'status', op: 'equals', value: 'nurturing' })).toEqual({
      field: 'status',
      op: 'equals',
      value: 'nurturing',
    })
    expect(leadQueryClause({ field: 'status', op: 'equals', value: 'open' })).toEqual({
      field: 'status',
      op: 'isAnyOf',
      value: 'new,nurturing,working',
    })
    expect(leadQueryClause({ field: 'status', op: 'equals', value: 'qualified' })).toEqual({
      field: 'status',
      op: 'equals',
      value: 'qualified',
    })
    expect(leadQueryClause({ field: 'status', op: 'isAnyOf', value: 'open,new' })).toEqual({
      field: 'status',
      op: 'isAnyOf',
      value: 'new,nurturing,working',
    })
    expect(leadQueryClause({ field: 'status', op: 'equals', value: 'lost' })).toEqual({
      refused: 'lost is not a lead status',
    })
  })

  it('asks a lead nobody touched as new, which its writer stored', () => {
    // The capture door writes `crmLeadListFields`, so an untouched lead is
    // `new` on the record and answers the Open query.
    const untouched = crmLeadListFields({ email: 'a@b.co', visibleTo: ['host:a'] })
    expect(untouched.status).toBe('new')
  })

  it('asks an email verdict through emailStatus, and "Cannot be emailed" as every verdict but ok', () => {
    expect(leadQueryClause({ field: 'emailState', op: 'equals', value: 'problem' })).toEqual({
      field: 'emailStatus',
      op: 'isAnyOf',
      value: EMAIL_STATE_STATUSES.filter((status) => status !== 'ok').join(','),
    })
    expect(leadQueryClause({ field: 'emailState', op: 'equals', value: 'none' })).toEqual({
      field: 'emailStatus',
      op: 'equals',
      value: 'none',
    })
    expect(leadQueryClause({ field: 'emailState', op: 'equals', value: 'bounced' })).toEqual({
      field: 'emailStatus',
      op: 'equals',
      value: 'bounced',
    })
  })

  it('offers "Would bounce" and asks it as a query on emailStatus (AGL-3328)', () => {
    expect(LEAD_EMAIL_FILTERS).toContain('undeliverable')
    expect(LEAD_EMAIL_FILTER_LABELS.undeliverable).toBe('Would bounce')
    expect(leadQueryClause({ field: 'emailState', op: 'equals', value: 'undeliverable' })).toEqual({
      field: 'emailStatus',
      op: 'equals',
      value: 'undeliverable',
    })
    // "Cannot be emailed" includes it: a prediction is still a reason not to write.
    const problem = leadQueryClause({ field: 'emailState', op: 'equals', value: 'problem' }) as { value?: unknown }
    expect(String(problem.value).split(',')).toContain('undeliverable')
  })

  it('asks a lead source by the key its writer stores, and "none" as a null', () => {
    const stored = crmLeadListFields({ leadSource: 'Website  form' }).leadSourceKey
    expect(leadQueryClause({ field: 'leadSource', op: 'equals', value: 'website FORM' })).toEqual({
      field: 'leadSourceKey',
      op: 'equals',
      value: stored,
    })
    expect(leadQueryClause({ field: 'leadSource', op: 'isEmpty', value: '' })).toEqual({
      field: 'leadSourceKey',
      op: 'isEmpty',
      value: '',
    })
    expect(
      leadQueryClause({ field: 'leadSource', op: 'equals', value: LEAD_SOURCE_FILTER_NONE }),
    ).toEqual({ field: 'leadSourceKey', op: 'isEmpty', value: '' })
    expect(crmLeadListFields({}).leadSourceKey).toBeNull()
  })

  it('asks Industry and Rating by the key their writers store (AGL-3513)', () => {
    const stored = crmLeadListFields({ industry: 'Food & Beverage', rating: 'Hot' })
    expect(leadQueryClause({ field: 'industry', op: 'equals', value: 'food & beverage' })).toEqual({
      field: 'industryKey',
      op: 'equals',
      value: stored.industryKey,
    })
    // A label typed into a stored view keys the same way.
    expect(leadQueryClause({ field: 'rating', op: 'isAnyOf', value: 'HOT,Warm' })).toEqual({
      field: 'ratingKey',
      op: 'isAnyOf',
      value: `${stored.ratingKey},warm`,
    })
  })

  it('asks a campaign as array-contains on the lead, and an owner as stored', () => {
    expect(leadQueryClause({ field: 'campaignIds', op: 'contains', value: 'spring' })).toEqual({
      field: 'campaignIds',
      op: 'contains',
      value: 'spring',
    })
    expect(leadQueryClause({ field: 'ownerUid', op: 'isAnyOf', value: 'u1,u2' })).toEqual({
      field: 'ownerUid',
      op: 'isAnyOf',
      value: 'u1,u2',
    })
    expect(leadQueryClause({ field: 'somethingElse', op: 'equals', value: 'x' })).toEqual({
      refused: 'this list does not filter by that',
    })
  })
})

describe('the Leads query plan', () => {
  const plan = (clauses: Parameters<typeof leadQueryClause>[0][], search: string[] = [], base = false) =>
    planListQuery(
      LEAD_LIST_DECLARATION,
      {
        clauses: clauses.map((clause) => leadQueryClause(clause) as Parameters<typeof leadQueryClause>[0]),
        search,
        base: base ? [{ path: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:a'] }] : [],
      },
      nameSearchNormalizers,
    )

  it('serves Open, a verdict, a source and an owner together, newest seen first', () => {
    const served = plan([
      { field: 'status', op: 'equals', value: 'open' },
      { field: 'emailState', op: 'equals', value: 'problem' },
      { field: 'leadSource', op: 'equals', value: 'Referral' },
      { field: 'ownerUid', op: 'equals', value: 'u1' },
    ])
    expect(served.refused).toEqual([])
    expect(served.orderBy).toEqual({ path: 'lastSeenAtMs', direction: 'desc' })
    expect(served.filters.map((filter) => filter.path)).toEqual([
      'status',
      'emailStatus',
      'leadSourceKey',
      'ownerUid',
    ])
  })

  it('serves Industry and Rating, each beside the newest-seen order (AGL-3513)', () => {
    for (const field of ['industry', 'rating']) {
      const served = plan([{ field, op: 'equals', value: 'hot' }])
      expect(served.refused).toEqual([])
      expect(served.filters.map((filter) => filter.path)).toEqual([`${field}Key`])
      expect(served.orderBy).toEqual({ path: 'lastSeenAtMs', direction: 'desc' })
    }
  })

  it('searches the tokens every lead writer stamps, and refuses a campaign beside it by name', () => {
    const tokens = crmSearchTokens(['Morgan Lamphere', 'morgan@lamphere.coffee', 'Lamphere Roasters', ['sal-15']])
    const served = plan([{ field: 'campaignIds', op: 'contains', value: 'spring' }], ['Roast'])
    const search = served.filters.find((filter) => filter.path === 'searchTokens')
    expect(tokens).toContain(search?.value)
    expect(served.refused).toHaveLength(1)
    expect(served.refused[0].reason).toMatch(/search/)
  })

  it('folds the search into the scope clause under a site', () => {
    const served = plan([], ['sal'], true)
    expect(served.filters).toEqual([
      {
        path: 'scopedSearchTokens',
        op: 'array-contains-any',
        value: ['org~sal', 'host:a~sal'],
      },
    ])
  })
})

describe('the Leads grid clauses', () => {
  it('shows no stored status as Open, and stores Open as no status', () => {
    expect(leadClausesForGrid([])).toEqual([{ field: 'status', op: 'equals', value: 'open' }])
    expect(leadClausesToStore([{ field: 'status', op: 'equals', value: 'open' }])).toEqual([])
    expect(leadClausesForGrid([{ field: 'status', op: 'equals', value: 'all' }])).toEqual([])
  })

  it('labels every Show option, open first and all last', () => {
    expect(LEAD_FILTERS[0]).toBe('open')
    expect(LEAD_FILTERS[LEAD_FILTERS.length - 1]).toBe('all')
    for (const filter of LEAD_FILTERS) expect(LEAD_FILTER_LABELS[filter]).toBeTruthy()
  })

  it('labels every Email option, Any first and Nothing known last', () => {
    expect(LEAD_EMAIL_FILTERS[0]).toBe('any')
    expect(LEAD_EMAIL_FILTERS.at(-1)).toBe('none')
    for (const option of LEAD_EMAIL_FILTERS) expect(LEAD_EMAIL_FILTER_LABELS[option]).toBeTruthy()
  })
})
