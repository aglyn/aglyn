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
 *
 * @jest-environment node
 */

/**
 * Every Inbox list asks its QUERY, and the index file holds every shape it
 * can ask (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers, scopedSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
  type ListQueryRequest,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  FORM_SCOPED_SUBMISSION_LIST_QUERY,
  LEAD_LIST_BASE_INDEX,
  LEAD_LIST_QUERY,
  ORG_LEAD_LIST_QUERY,
  ORG_SUBMISSION_LIST_QUERY,
  SITE_MEMBER_LIST_QUERY,
  SUBMISSION_LIST_QUERY,
  formSubmissionBase,
  leadListBase,
  LEAD_ADDRESS_SEARCH_COLUMN,
  leadListQueryFor,
  orgSubmissionBase,
} from './list-queries'

const indexFile = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
    'utf8',
  ),
)

describe('every Inbox list has the composites its queries need', () => {
  it.each([
    ['siteMembers', 'COLLECTION', SITE_MEMBER_LIST_QUERY, []],
    ['leads', 'COLLECTION', LEAD_LIST_QUERY, LEAD_LIST_BASE_INDEX],
    ['leads', 'COLLECTION', ORG_LEAD_LIST_QUERY, []],
    ['formSubmissions', 'COLLECTION', SUBMISSION_LIST_QUERY, []],
    ['formSubmissions', 'COLLECTION', FORM_SCOPED_SUBMISSION_LIST_QUERY, [{ path: 'formId' }]],
    ['formSubmissions', 'COLLECTION_GROUP', ORG_SUBMISSION_LIST_QUERY, [{ path: 'orgId' }]],
  ] as const)('%s (%s)', (group, scope, declaration, base) => {
    const needed = listQueryIndexes(declaration, base)
    expect(missingListQueryIndexes(indexFile, group, needed, scope)).toEqual([])
  })

  it('stays inside the budget: one composite per filterable field and order', () => {
    // email, searchTokens — the Site users list's own two.
    expect(listQueryIndexes(SITE_MEMBER_LIST_QUERY)).toHaveLength(2)
    // visibleTo, email, searchTokens, scopedSearchTokens.
    expect(listQueryIndexes(LEAD_LIST_QUERY, LEAD_LIST_BASE_INDEX)).toHaveLength(4)
    // email, searchTokens, scopedSearchTokens, sources, capturedByHostIds.
    expect(listQueryIndexes(ORG_LEAD_LIST_QUERY)).toHaveLength(5)
    // senderTokens, read, formId, searchTokens.
    expect(listQueryIndexes(SUBMISSION_LIST_QUERY)).toHaveLength(4)
    // orgId, senderTokens, read, hostId, searchTokens.
    expect(listQueryIndexes(ORG_SUBMISSION_LIST_QUERY, [{ path: 'orgId' }])).toHaveLength(5)
  })
})

describe('the site members list', () => {
  it('serves Email and the name search on one query, newest first', () => {
    const planned = planListQuery(
      SITE_MEMBER_LIST_QUERY,
      { clauses: [{ field: 'email', op: 'equals', value: ' Ada@Example.com ' }], search: ['Love'] },
      nameSearchNormalizers,
    )
    expect(planned.refused).toEqual([])
    expect(planned.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'love' },
      { path: 'email', op: '==', value: 'ada@example.com' },
    ])
    expect(planned.orderBy).toEqual({ path: 'createdAt', direction: 'desc' })
  })
})

describe('the leads list', () => {
  const base = leadListBase(scopeTokensForHost('host-1'))
  const plan = (declaration: typeof LEAD_LIST_QUERY, request: ListQueryRequest) =>
    planListQuery(declaration, request, nameSearchNormalizers)

  it('keeps a site’s scope under every clause', () => {
    const planned = plan(LEAD_LIST_QUERY, {
      clauses: [{ field: 'email', op: 'equals', value: 'Dana@Acme.com' }],
      base,
    })
    expect(planned.refused).toEqual([])
    expect(planned.filters).toEqual([
      { path: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:host-1'] },
      { path: 'email', op: '==', value: 'dana@acme.com' },
    ])
  })

  it('folds the search into the scope for an org-wide reader, as the writers stamp it', () => {
    const query = leadListQueryFor(LEAD_LIST_QUERY, true, { clauses: [], search: ['Dana'], base })
    expect(query.addressSearch).toBe(false)
    const planned = plan(query.declaration, query.request)
    expect(planned.refused).toEqual([])
    expect(planned.filters).toEqual([
      { path: 'scopedSearchTokens', op: 'array-contains-any', value: ['org~dana', 'host:host-1~dana'] },
    ])
    // A lead this site sees, stamped as the CRM's writers stamp it, answers.
    const stamped = scopedSearchTokens(['host:host-1'], ['d', 'da', 'dan', 'dana'])
    expect(stamped.some((token) => (planned.filters[0].value as string[]).includes(token))).toBe(true)
  })

  it('asks a site collaborator’s search as the start of the address, beside the scope', () => {
    const query = leadListQueryFor(LEAD_LIST_QUERY, false, {
      clauses: [],
      search: ['Dana', 'Scully'],
      base,
    })
    expect(query.addressSearch).toBe(true)
    const planned = plan(query.declaration, query.request)
    expect(planned.refused).toEqual([])
    // The scope clause stands — the query is one the rules prove — and the
    // first word is a prefix range on the stored address, ordered by it.
    expect(planned.filters).toEqual([
      ...base,
      { path: 'email', op: '>=', value: 'dana' },
      { path: 'email', op: '<=', value: 'dana\uf8ff' },
    ])
    expect(planned.orderBy).toEqual({ path: 'email', direction: 'asc' })
    expect(planned.served.map((clause) => clause.field)).toEqual([LEAD_ADDRESS_SEARCH_COLUMN])
  })

  it('needs no composite past the ones the lead list carries for the address search', () => {
    const query = leadListQueryFor(LEAD_LIST_QUERY, false, { clauses: [], search: ['x'], base })
    const needed = listQueryIndexes(query.declaration, LEAD_LIST_BASE_INDEX)
    expect(missingListQueryIndexes(indexFile, 'leads', needed, 'COLLECTION')).toEqual([])
  })

  it('serves Source and Site on the organization’s Inbox, one at a time', () => {
    const one = plan(ORG_LEAD_LIST_QUERY, {
      clauses: [{ field: 'sources', op: 'isAnyOf', value: 'booking,manual' }],
    })
    expect(one.refused).toEqual([])
    expect(one.filters).toEqual([
      { path: 'sources', op: 'array-contains-any', value: ['booking', 'manual'] },
    ])
    const two = plan(ORG_LEAD_LIST_QUERY, {
      clauses: [
        { field: 'sources', op: 'isAnyOf', value: 'booking' },
        { field: 'capturedByHostIds', op: 'isAnyOf', value: 'Host-A' },
      ],
    })
    expect(two.served).toHaveLength(1)
    expect(two.refused).toHaveLength(1)
    expect(two.refused[0].clause).toMatchObject({ field: 'capturedByHostIds' })
  })

  it('reads the plain search tokens on the organization’s Inbox', () => {
    const planned = plan(ORG_LEAD_LIST_QUERY, { clauses: [], search: ['acme'] })
    expect(planned.filters).toEqual([{ path: 'searchTokens', op: 'array-contains', value: 'acme' }])
  })
})

describe('the submissions list', () => {
  it('serves Read, Form and the search on one query under a site', () => {
    const planned = planListQuery(
      SUBMISSION_LIST_QUERY,
      {
        clauses: [
          { field: 'read', op: 'equals', value: 'false' },
          { field: 'formId', op: 'equals', value: 'form-1' },
        ],
        search: ['Wedding'],
      },
      nameSearchNormalizers,
    )
    expect(planned.refused).toEqual([])
    expect(planned.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'wedding' },
      { path: 'read', op: '==', value: false },
      { path: 'formId', op: '==', value: 'form-1' },
    ])
    expect(planned.orderBy).toEqual({ path: 'createdAt', direction: 'desc' })
  })

  it('refuses From beside the search, by name', () => {
    const planned = planListQuery(
      SUBMISSION_LIST_QUERY,
      { clauses: [{ field: 'from', op: 'contains', value: 'dana' }], search: ['cake'] },
      nameSearchNormalizers,
    )
    expect(planned.served).toEqual([])
    expect(planned.refused[0].reason).toMatch(/search/)
  })

  it('keeps the organization in every org-wide query, beside Site', () => {
    const planned = planListQuery(
      ORG_SUBMISSION_LIST_QUERY,
      {
        clauses: [{ field: 'hostId', op: 'equals', value: 'host-b' }],
        base: orgSubmissionBase('org-1'),
      },
      nameSearchNormalizers,
    )
    expect(planned.filters).toEqual([
      { path: 'orgId', op: '==', value: 'org-1' },
      { path: 'hostId', op: '==', value: 'host-b' },
    ])
  })

  it('keeps a form-scoped card on its form, and offers no Form to change it', () => {
    const planned = planListQuery(
      FORM_SCOPED_SUBMISSION_LIST_QUERY,
      {
        clauses: [{ field: 'formId', op: 'equals', value: 'other' }],
        base: formSubmissionBase('form-1'),
      },
      nameSearchNormalizers,
    )
    expect(planned.filters).toEqual([{ path: 'formId', op: '==', value: 'form-1' }])
    expect(planned.refused).toHaveLength(1)
  })
})
