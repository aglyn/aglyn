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

import { act, renderHook, waitFor } from '@testing-library/react'
import {
  registerPluginRecordListSource,
  type PluginRecordListRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  useOutreachContactSearch,
  useOutreachEmailTemplates,
  useOutreachLeadSearch,
  useOutreachSavedViews,
} from './use-outreach-crm'

/**
 * What Outreach lists from the record system (AGL-3080): through the list
 * sources the record system publishes — never its collections — with the
 * owner's listing rules applied to what the query answers, and each list
 * read as empty when no plugin keeps people.
 */

const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({ useFirestore: () => mockFirestore }))

/** The rows each kind's "query" answers, by the query object the source built. */
let mockRows: Record<string, Array<Record<string, unknown>>> = {}
jest.mock('firebase/firestore', () => {
  const snapshot = (query: { kind: string }) => ({
    docs: (mockRows[query.kind] ?? []).map(({ id, ...data }) => ({ id, data: () => data })),
  })
  return {
    onSnapshot: (query: { kind: string }, next: (snapshot: unknown) => void) => {
      next(snapshot(query))
      return () => undefined
    },
    getDocs: async (query: { kind: string }) => snapshot(query),
  }
})

/** The requests each kind's source was asked to build, for the assertions. */
let asked: Array<{ kind: string; request: PluginRecordListRequest }> = []

/**
 * The record system's list sources, standing in for the one that publishes
 * them: each query is a marker the mocked listener answers, and each record
 * is read the way its facts say.
 */
function standInListSources(): void {
  const source = (kind: string, needsSearch = false) => ({
    query: (_firestore: unknown, request: PluginRecordListRequest) => {
      asked.push({ kind, request })
      if (needsSearch && !String(request.search ?? '').trim()) return null
      return { kind } as never
    },
    record: (id: string, data: Readonly<Record<string, unknown>>) => ({
      id,
      name: String(data['name'] ?? ''),
      facts: { ...data },
    }),
  })
  registerPluginRecordListSource('savedView', source('savedView'), { pluginId: 'record-system' })
  registerPluginRecordListSource('messageTemplate', source('messageTemplate'), { pluginId: 'record-system' })
  registerPluginRecordListSource('contact', source('contact', true), { pluginId: 'record-system' })
  registerPluginRecordListSource('lead', source('lead'), { pluginId: 'record-system' })
}

beforeEach(() => {
  resetPluginServicesForTests()
  standInListSources()
  asked = []
  mockRows = {}
})

describe('the saved views', () => {
  it('offers the views the record system says can be taken whole, by what they are of', async () => {
    mockRows = {
      savedView: [
        { id: 'v1', name: 'Warm', recordKind: 'contact', takeable: true },
        { id: 'v2', name: 'Open leads', recordKind: 'lead', takeable: true },
        { id: 'v3', name: 'Odd', recordKind: 'contact', takeable: false },
      ],
    }
    const { result } = renderHook(() => useOutreachSavedViews('o1', 'u1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data).toEqual([
      { id: 'v1', name: 'Warm', section: 'contacts' },
      { id: 'v2', name: 'Open leads', section: 'leads' },
    ])
    expect(asked[0]).toEqual({ kind: 'savedView', request: { orgId: 'o1', viewerUid: 'u1', limit: 50 } })
  })

  it('reads as empty where no plugin keeps people', async () => {
    resetPluginServicesForTests()
    const { result } = renderHook(() => useOutreachSavedViews('o1', 'u1'))
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', data: [] }))
  })
})

describe('the templates', () => {
  it('offers whole letters, not snippets, for this site and this member', async () => {
    mockRows = {
      messageTemplate: [
        { id: 't1', name: 'Intro', kind: 'template', subject: 'Hi', body: 'Hello' },
        { id: 't2', name: 'Sign-off', kind: 'snippet', subject: '', body: 'Thanks' },
      ],
    }
    const { result } = renderHook(() => useOutreachEmailTemplates('o1', 'h1', 'u1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data).toEqual([{ id: 't1', name: 'Intro', subject: 'Hi', body: 'Hello' }])
    expect(asked[0]?.request).toEqual({ orgId: 'o1', hostId: 'h1', viewerUid: 'u1', limit: 200 })
  })
})

describe('the people a search finds', () => {
  it('is idle until something is typed, then asks the record system as the site’s group', async () => {
    mockRows = { contact: [{ id: 'c1', name: 'Pat', email: 'pat@example.com' }] }
    jest.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ text }) => useOutreachContactSearch({ orgId: 'o1', hostId: 'h1', contactGroupId: 'g1', text }),
      { initialProps: { text: '' } },
    )
    expect(result.current.idle).toBe(true)
    rerender({ text: 'pat' })
    expect(result.current.idle).toBe(false)
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    jest.useRealTimers()
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'c1', name: 'Pat', email: 'pat@example.com' }]))
    expect(asked.at(-1)?.request).toEqual({
      orgId: 'o1',
      hostId: 'h1',
      consentGroupId: 'g1',
      search: 'pat',
      limit: 25,
    })
  })

  it('offers only the leads the record system says are still open, narrowed by what was typed', async () => {
    mockRows = {
      lead: [
        { id: 'l1', name: 'Lee Open', email: 'lee@example.com', open: true },
        { id: 'l2', name: 'Lou Closed', email: 'lou@example.com', open: false },
        { id: 'l3', name: 'Ann Open', email: 'ann@example.com', open: true },
      ],
    }
    const { result } = renderHook(() =>
      useOutreachLeadSearch({ orgId: 'o1', hostId: 'h1', text: 'lee', enabled: true }),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data).toEqual([{ id: 'l1', name: 'Lee Open', email: 'lee@example.com' }])
  })
})
