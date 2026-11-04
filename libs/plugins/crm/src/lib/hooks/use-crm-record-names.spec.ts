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
import { getDoc, getDocFromCache } from 'firebase/firestore'
import { crmRecordName, resetCrmRecordNameCache, useCrmRecordNames } from './use-crm-record-names'

const healListeners = new Set<() => void>()
// One instance, as the app's provider hands every render the same one.
const mockFirestore = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  subscribeFirestoreSessionHeal: (listener: () => void) => {
    healListeners.add(listener)
    return () => void healListeners.delete(listener)
  },
}))

jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: jest.fn(),
  getDocFromCache: jest.fn(),
}))

const mockGetDoc = getDoc as jest.Mock
const mockGetDocFromCache = getDocFromCache as jest.Mock

const snapshotOf = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data })
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

const CONTACT_ID = 'contact-1'
const renderNames = () =>
  renderHook(() =>
    useCrmRecordNames({
      orgId: 'org-1',
      groupId: null,
      org: null,
      records: [{ kind: 'contact', id: CONTACT_ID }],
    }),
  )

describe('crmRecordName', () => {
  it('stands the email, then the phone number, in for a contact nobody named', () => {
    expect(crmRecordName('contact', { name: 'Jordan', email: 'j@example.com' }, 'g')).toBe('Jordan')
    expect(crmRecordName('contact', { email: 'j@example.com', phone: '+15125550100' }, 'g')).toBe(
      'j@example.com',
    )
    expect(crmRecordName('contact', { email: '', phone: '+15125550100' }, 'g')).toBe('+15125550100')
    expect(crmRecordName('contact', { email: '' }, 'g')).toBe('')
  })
})

/*
 * The deal page's Contact roles card named a person by their record id
 * while the person's own page, its listeners retrying and reading through the
 * persistent cache, showed the name. The card's one `getDoc` had failed once
 * and nothing on that mount ever read it again.
 */
describe('useCrmRecordNames', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetCrmRecordNameCache()
    healListeners.clear()
    mockGetDoc.mockReset()
    mockGetDocFromCache.mockReset()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('reads again after a refusal, as the page\'s listeners do after sign-in', async () => {
    mockGetDoc.mockRejectedValueOnce(denied()).mockResolvedValueOnce(snapshotOf({ name: 'Jordan Lee' }))
    const { result } = renderNames()
    expect(result.current('contact', CONTACT_ID)).toBeUndefined()
    await act(() => jest.advanceTimersByTimeAsync(1_000))
    expect(result.current('contact', CONTACT_ID)).toBe('Jordan Lee')
    expect(mockGetDoc).toHaveBeenCalledTimes(2)
    expect(mockGetDoc.mock.calls[0][0]).toEqual({ path: `orgs/org-1/contacts/${CONTACT_ID}` })
  })

  it('names the record from the cached copy the page shows when the server keeps refusing', async () => {
    mockGetDoc.mockRejectedValue(denied())
    mockGetDocFromCache.mockResolvedValue(snapshotOf({ name: 'Jordan Lee' }))
    const { result } = renderNames()
    await act(() => jest.advanceTimersByTimeAsync(5_000))
    expect(mockGetDoc).toHaveBeenCalledTimes(6)
    expect(result.current('contact', CONTACT_ID)).toBe('Jordan Lee')
  })

  it('keeps the id when nothing can be read, and reads again when the session heals', async () => {
    mockGetDoc.mockRejectedValue(denied())
    mockGetDocFromCache.mockRejectedValue(new Error('not cached'))
    const { result } = renderNames()
    await act(() => jest.advanceTimersByTimeAsync(5_000))
    expect(result.current('contact', CONTACT_ID)).toBeUndefined()

    mockGetDoc.mockReset().mockResolvedValue(snapshotOf({ name: 'Jordan Lee' }))
    act(() => {
      for (const listener of [...healListeners]) listener()
    })
    await waitFor(() => expect(result.current('contact', CONTACT_ID)).toBe('Jordan Lee'))
    expect(mockGetDoc).toHaveBeenCalledTimes(1)
  })

  it('tries once while a refusal has already outlasted the budget, so a dead session costs one read a name', async () => {
    mockGetDoc.mockRejectedValue(denied())
    mockGetDocFromCache.mockRejectedValue(new Error('not cached'))
    renderNames()
    await act(() => jest.advanceTimersByTimeAsync(5_000))
    expect(mockGetDoc).toHaveBeenCalledTimes(6)

    mockGetDoc.mockClear()
    renderHook(() =>
      useCrmRecordNames({
        orgId: 'org-1',
        groupId: null,
        org: null,
        records: [{ kind: 'company', id: 'company-1' }],
      }),
    )
    await act(() => jest.advanceTimersByTimeAsync(5_000))
    expect(mockGetDoc).toHaveBeenCalledTimes(1)
  })
})
