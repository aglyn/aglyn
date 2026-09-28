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

import { renderHook } from '@testing-library/react'
import { OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY } from '../model/do-not-contact-domain-list-query'
import { OUTREACH_ENROLLMENT_LIST_QUERY } from '../model/enrollment-list-query'
import { OUTREACH_SEQUENCE_LIST_QUERY } from '../model/sequence-list-query'
import {
  useOutreachDoNotContactDomainList,
  useOutreachEnrollmentList,
  useOutreachSequenceList,
} from './use-outreach-data'

/**
 * The Outreach lists read through the shared list query (AGL-3321): each
 * hands `useListQuery` its collection, its declaration and the reader's
 * request, and answers in the module's four states with each document read
 * through its stored-record reader.
 */

/** One instance, as the real hook returns: the listen is keyed on it. */
const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
}))

jest.mock('../model/stored-records', () => ({
  readStoredOutreachEnrollment: () => null,
  readStoredOutreachSequence: (id: string, data: { createdAtMs?: number; broken?: boolean }) =>
    data.broken ? null : { id, createdAtMs: data.createdAtMs },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: () => ({}),
  documentId: () => '__name__',
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  query: () => ({}),
  onSnapshot: () => () => undefined,
}))

let mockListed: Record<string, unknown>
let mockOptions: Array<Record<string, unknown>> = []
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => ({
  useListQuery: (options: Record<string, unknown>) => {
    mockOptions.push(options)
    return mockListed
  },
}))

const listed = (extra: Record<string, unknown> = {}) => ({
  data: [],
  rows: [],
  status: 'success',
  error: undefined,
  fromCache: false,
  serverDenied: false,
  hasMore: false,
  page: 0,
  setPage: jest.fn(),
  pageSize: 10,
  setPageSize: jest.fn(),
  plan: { filters: [], orderBy: { path: 'createdAtMs', direction: 'desc' }, served: [], searched: null, refused: [], notices: [] },
  ...extra,
})

beforeEach(() => {
  mockOptions = []
  mockListed = listed()
})

describe('useOutreachSequenceList (AGL-3321)', () => {
  it('asks the org’s sequences with the list’s declaration and the reader’s request', () => {
    const request = { clauses: [{ field: 'status', op: 'equals', value: 'active' }], search: ['win'] }
    renderHook(() => useOutreachSequenceList('org-1', request))
    const options = mockOptions.at(-1) as Record<string, any>
    expect(options['collection']).toEqual({ path: 'orgs/org-1/outreachSequences' })
    expect(options['declaration']).toBe(OUTREACH_SEQUENCE_LIST_QUERY)
    expect(options['request']).toBe(request)
    expect(options['idField']).toBe('$id')
  })

  it('asks nothing until the organization is known', () => {
    renderHook(() => useOutreachSequenceList(null, { clauses: [] }))
    expect((mockOptions.at(-1) as Record<string, unknown>)['collection']).toBeNull()
  })

  it('reads each row through the stored-record reader, leaving out one it cannot read', () => {
    mockListed = listed({
      rows: [
        { $id: 'seq-1', createdAtMs: 2 },
        { $id: 'seq-2', broken: true },
      ],
      hasMore: true,
    })
    const { result } = renderHook(() => useOutreachSequenceList('org-1', { clauses: [] }))
    expect(result.current.status).toBe('ready')
    expect(result.current.rows).toEqual([{ id: 'seq-1', createdAtMs: 2 }])
    expect(result.current.hasMore).toBe(true)
  })

  it('says a refusal as refused and any other failure as an error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockListed = listed({ status: 'error', error: { code: 'permission-denied' } })
    expect(renderHook(() => useOutreachSequenceList('org-1', { clauses: [] })).result.current.status).toBe('refused')
    mockListed = listed({ status: 'error', error: { code: 'failed-precondition' } })
    expect(renderHook(() => useOutreachSequenceList('org-1', { clauses: [] })).result.current.status).toBe('error')
    mockListed = listed({ status: 'loading' })
    expect(renderHook(() => useOutreachSequenceList('org-1', { clauses: [] })).result.current.status).toBe('loading')
    spy.mockRestore()
  })
})

describe('useOutreachEnrollmentList (AGL-3321)', () => {
  it('asks the org’s enrollments narrowed to the sequence, with the table’s declaration', () => {
    const request = { clauses: [{ field: 'status', op: 'equals', value: 'replied' }], search: ['casey'] }
    renderHook(() => useOutreachEnrollmentList('org-1', 'seq-1', request))
    const options = mockOptions.at(-1) as Record<string, any>
    expect(options['collection']).toEqual({ path: 'orgs/org-1/outreachEnrollments' })
    expect(options['declaration']).toBe(OUTREACH_ENROLLMENT_LIST_QUERY)
    expect(options['request']).toEqual({
      ...request,
      base: [{ path: 'sequenceId', op: '==', value: 'seq-1' }],
    })
  })

  it('asks nothing until both the organization and the sequence are known', () => {
    renderHook(() => useOutreachEnrollmentList('org-1', null, { clauses: [] }))
    expect((mockOptions.at(-1) as Record<string, unknown>)['collection']).toBeNull()
    renderHook(() => useOutreachEnrollmentList(null, 'seq-1', { clauses: [] }))
    expect((mockOptions.at(-1) as Record<string, unknown>)['collection']).toBeNull()
  })
})

describe('useOutreachDoNotContactDomainList (AGL-3321)', () => {
  it('asks the org’s domains with the list’s declaration, each row named by its id', () => {
    mockListed = listed({ rows: [{ $id: 'acme.com', reason: 'manual', addedAtMs: 1 }] })
    const request = { clauses: [], search: ['acme'] }
    const { result } = renderHook(() => useOutreachDoNotContactDomainList('org-1', request))
    const options = mockOptions.at(-1) as Record<string, any>
    expect(options['collection']).toEqual({ path: 'orgs/org-1/outreachDoNotContactDomains' })
    expect(options['declaration']).toBe(OUTREACH_DO_NOT_CONTACT_DOMAIN_LIST_QUERY)
    expect(options['request']).toBe(request)
    expect(result.current.rows).toEqual([
      expect.objectContaining({ domain: 'acme.com', reason: 'manual', addedAtMs: 1 }),
    ])
  })
})
