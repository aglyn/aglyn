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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers, nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import {
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryIndex,
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  CAMPAIGN_EMAILS_QUERY,
  SINGLE_SENDS_BASE,
  SINGLE_SEND_FILTER_VALUE,
  campaignContainerSearchFields,
  campaignContainersListQuery,
  campaignContainersScope,
  campaignEmailsListQuery,
  campaignSendSearchFields,
  campaignSendsScope,
  campaignSingleSendsListQuery,
  campaignSiteSearchClause,
  emailCampaignQueryClauses,
} from './campaign-list-query'

/**
 * Every shape the Marketing lists' queries can take has its composite index,
 * and the search each one reads is the token array the writers stamp
 * (AGL-3321).
 *
 * The emulator serves any query, so a missing index is invisible to every
 * card spec; production answers FAILED_PRECONDITION and the list shows a
 * load error the moment a reader sets the filter that needs it.
 */

const INDEXES = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
)

/** Each list, at each level, with the scope its query always carries. */
const SENDS: Array<[string, ListQueryDeclaration, Array<{ path: string; array?: boolean }>]> = [
  ['the Emails list, org hub', campaignEmailsListQuery(true), []],
  ['the Emails list, site hub', campaignEmailsListQuery(false), [{ path: 'hostId' }]],
  ['a campaign’s emails, org hub', CAMPAIGN_EMAILS_QUERY, [{ path: 'emailCampaignId' }]],
  ['a campaign’s emails, site hub', CAMPAIGN_EMAILS_QUERY, [{ path: 'emailCampaignId' }, { path: 'hostId' }]],
  ['single sends, org hub', campaignSingleSendsListQuery(true), [{ path: 'emailCampaignId' }]],
  ['single sends, site hub', campaignSingleSendsListQuery(false), [{ path: 'emailCampaignId' }, { path: 'hostId' }]],
]
const CONTAINERS: Array<[string, ListQueryDeclaration, Array<{ path: string; array?: boolean }>]> = [
  ['campaigns, org hub', campaignContainersListQuery(true), []],
  ['campaigns, site hub', campaignContainersListQuery(false), [{ path: 'visibleTo', array: true }]],
]

const distinct = (lists: ListQueryIndex[][]) =>
  new Set(lists.flat().map((index) => JSON.stringify(index))).size

describe('the Marketing lists’ composite indexes', () => {
  it.each(SENDS)('%s has every composite it needs (orgs/{orgId}/campaigns)', (_name, declaration, base) => {
    expect(missingListQueryIndexes(INDEXES, 'campaigns', listQueryIndexes(declaration, base))).toEqual([])
  })

  it.each(CONTAINERS)('%s has every composite it needs (orgs/{orgId}/emailCampaigns)', (_name, declaration, base) => {
    expect(
      missingListQueryIndexes(INDEXES, 'emailCampaigns', listQueryIndexes(declaration, base)),
    ).toEqual([])
  })

  it('spends four on sends and four on campaigns: one per queried field, under the one order', () => {
    expect(distinct(SENDS.map(([, declaration, base]) => listQueryIndexes(declaration, base)))).toBe(4)
    expect(distinct(CONTAINERS.map(([, declaration, base]) => listQueryIndexes(declaration, base)))).toBe(4)
  })
})

const plan = (
  declaration: ListQueryDeclaration,
  request: Parameters<typeof planListQuery>[1],
) => planListQuery(declaration, request, nameSearchNormalizers)

/** Whether a stored array satisfies one array predicate. */
const holds = (stored: readonly string[], filter: ListQueryFilter | undefined): boolean => {
  if (!filter) return false
  const asked = Array.isArray(filter.value) ? filter.value : [filter.value]
  return asked.some((value) => stored.includes(String(value)))
}

describe('what a site hub asks', () => {
  it('asks a site’s sends by hostId, an equality, so search keeps the array clause', () => {
    const asked = plan(campaignEmailsListQuery(false), {
      clauses: [{ field: 'status', op: 'equals', value: 'sent' }],
      search: ['Spring'],
      base: campaignSendsScope('host-a'),
    })
    expect(asked.refused).toEqual([])
    expect(asked.filters).toEqual([
      { path: 'hostId', op: '==', value: 'host-a' },
      { path: 'subjectTokens', op: 'array-contains', value: 'spring' },
      { path: 'status', op: '==', value: 'sent' },
    ])
    expect(asked.orderBy).toEqual({ path: 'createdAtMs', direction: 'desc' })
    expect(campaignSendsScope(null)).toEqual([])
  })

  it('searches a site’s campaigns by the start of the name, a range beside the scope', () => {
    /*
     * Never the scoped tokens: the rules prove a site collaborator's read
     * from `visibleTo`, and a query on another array field proves nothing
     * about it (AGL-3321). So the scope keeps the one array clause, and the
     * search is a prefix range on the stored lower-cased name.
     */
    const clause = campaignSiteSearchClause(['  Spring ', 'La'])
    expect(clause).toEqual({ field: 'name', op: 'startsWith', value: 'Spring La' })
    expect(campaignSiteSearchClause(['  '])).toBeNull()
    const asked = plan(campaignContainersListQuery(false), {
      clauses: clause ? [clause] : [],
      base: campaignContainersScope('host-a'),
    })
    expect(asked.refused).toEqual([])
    expect(asked.filters).toEqual([
      { path: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:host-a'] },
      { path: 'nameLower', op: '>=', value: 'spring la' },
      { path: 'nameLower', op: '<=', value: 'spring la\uf8ff' },
    ])
    expect(asked.orderBy).toEqual({ path: 'nameLower', direction: 'asc' })
    // The stamped key sits inside that range.
    const stored = campaignContainerSearchFields('Spring Launch').nameLower
    expect(stored >= 'spring la' && stored <= 'spring la\uf8ff').toBe(true)
    expect(asked.filters.some((filter) => filter.path === 'nameScopedTokens')).toBe(false)
  })

  it('names the search, not the date, when both would be a range on a site', () => {
    const clause = campaignSiteSearchClause(['spring']) as NonNullable<
      ReturnType<typeof campaignSiteSearchClause>
    >
    const created = { field: 'createdAtMs', op: 'onOrAfter', value: '2026-09-01' }
    const asked = plan(campaignContainersListQuery(false), {
      clauses: [clause, created],
      base: campaignContainersScope('host-a'),
    })
    expect(asked.served).toEqual([clause])
    expect(asked.refused).toEqual([
      { clause: created, reason: 'only one range (dates, numbers, starts with) can apply at a time' },
    ])
  })

  it('offers Lists and Sites only on the org hub, where no scope holds the array clause', () => {
    const columns = (declaration: ListQueryDeclaration) =>
      declaration.fields.map((field) => field.column)
    expect(columns(campaignContainersListQuery(false))).toEqual(['name', 'createdAtMs'])
    expect(columns(campaignContainersListQuery(true))).toEqual(['name', 'listIds', 'sitesLabel', 'createdAtMs'])
    expect(columns(campaignEmailsListQuery(false))).not.toContain('site')
    expect(columns(campaignEmailsListQuery(true))).toContain('site')
  })

  it('refuses by name a Sites any-of beside the org hub’s campaign search', () => {
    const asked = plan(campaignContainersListQuery(true), {
      clauses: [{ field: 'sitesLabel', op: 'isAnyOf', value: 'org,host:host-a' }],
      search: ['spring'],
    })
    expect(asked.served).toEqual([])
    expect(asked.refused).toEqual([
      {
        clause: { field: 'sitesLabel', op: 'isAnyOf', value: 'org,host:host-a' },
        reason: 'cannot be combined with the search — clear the search to use it',
      },
    ])
  })
})

describe('single sends', () => {
  it('are the sends whose campaign is stored null', () => {
    expect(SINGLE_SENDS_BASE).toEqual({ path: 'emailCampaignId', op: '==', value: null })
    const asked = plan(campaignSingleSendsListQuery(false), {
      clauses: [],
      base: [SINGLE_SENDS_BASE, ...campaignSendsScope('host-a')],
    })
    expect(asked.filters).toEqual([
      { path: 'emailCampaignId', op: '==', value: null },
      { path: 'hostId', op: '==', value: 'host-a' },
    ])
  })

  it('the Emails list’s "Single send" choice asks the same null', () => {
    const clauses = emailCampaignQueryClauses([
      { field: 'emailCampaignId', op: 'equals', value: SINGLE_SEND_FILTER_VALUE },
    ])
    const asked = plan(campaignEmailsListQuery(true), { clauses })
    expect(asked.refused).toEqual([])
    expect(asked.filters).toEqual([{ path: 'emailCampaignId', op: '==', value: null }])
    // A campaign id is asked as itself.
    expect(
      plan(campaignEmailsListQuery(true), {
        clauses: emailCampaignQueryClauses([{ field: 'emailCampaignId', op: 'equals', value: 'c-1' }]),
      }).filters,
    ).toEqual([{ path: 'emailCampaignId', op: '==', value: 'c-1' }])
  })
})

describe('the fields the writers stamp', () => {
  it('a send’s subject tokens are the name-search tokens of its subject', () => {
    expect(campaignSendSearchFields('Spring Sale — 20% off')).toEqual({
      subjectTokens: nameSearchTokens('Spring Sale — 20% off'),
    })
    expect(campaignSendSearchFields(undefined)).toEqual({ subjectTokens: [] })
  })

  it('a campaign carries its name’s key and tokens', () => {
    expect(campaignContainerSearchFields('  Fall   Sale ')).toEqual({
      nameLower: 'fall sale',
      nameTokens: nameSearchTokens('Fall Sale'),
    })
    expect(campaignContainerSearchFields(undefined)).toEqual({ nameLower: '', nameTokens: [] })
  })

  it('a stamped subject is found by the search that asks for it', () => {
    const asked = plan(campaignEmailsListQuery(true), { clauses: [], search: ['ann'] })
    const stored = campaignSendSearchFields('Annual members night').subjectTokens
    expect(holds(stored, asked.filters[0])).toBe(true)
  })
})
