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
 * A filing made in the console rolls up like any activity (AGL-4123), through
 * the client's own read of the record, and a read that fails costs the entry
 * nothing: the membership has landed, and the entry says so either way.
 */

import { act, renderHook } from '@testing-library/react'

const mockRecords = new Map<string, Record<string, unknown>>()
const mockSetDoc = jest.fn(async (..._args: unknown[]) => undefined)
let mockReadFails = false

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u-1' } }),
  useUserName: () => 'Ada Admin',
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (first: unknown, ...segments: string[]) =>
    [typeof first === 'string' ? first : null, ...segments].filter(Boolean).join('/'),
  getDoc: async (path: string) => {
    if (mockReadFails) throw new Error('permission-denied')
    return { exists: () => mockRecords.has(path), data: () => mockRecords.get(path) }
  },
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

const mockFollowUp = jest.fn(async (..._args: unknown[]) => undefined)
jest.mock('../model/crm-sharing-api', () => ({
  callCrmSharing: jest.fn(),
  followUpCrmSharing: (...args: unknown[]) => mockFollowUp(...args),
}))

import { useCampaignFilingLog } from './use-campaign-filing-log'

const filing = async (link: Record<string, string>, org: Record<string, unknown> = {}) => {
  const { result } = renderHook(() =>
    useCampaignFilingLog({ orgId: 'org-1', hostId: 'site-1', org }),
  )
  await act(async () => {
    await result.current(link, { filed: [{ id: 'spring', name: 'Spring' }] })
  })
  return mockSetDoc.mock.calls[0]?.[1] as Record<string, unknown>
}

describe('useCampaignFilingLog', () => {
  beforeEach(() => {
    mockRecords.clear()
    mockSetDoc.mockClear()
    mockFollowUp.mockClear()
    mockReadFails = false
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('rolls an entry on a contact up to the company this site files them under', async () => {
    mockRecords.set('orgs/org-1/contacts/c-1', { facets: { 'site-1': { companyId: 'co-1' } } })
    expect(await filing({ contactId: 'c-1' })).toMatchObject({
      contactId: 'c-1',
      companyId: 'co-1',
      campaignId: 'spring',
    })
  })

  it('asks the server to mark the entries under the CRM default "All sites except…" (AGL-4047)', async () => {
    const row = await filing(
      { contactId: 'c-1' },
      {
        hosts: { 'site-1': true, 'site-2': true, 'site-3': true },
        crm: { defaultRecordScope: 'host', defaultRecordExcept: ['site-3'] },
      },
    )
    expect(row).toMatchObject({ visibleTo: ['host:site-1', 'host:site-2'] })
    // The rules refuse the marker from a browser; the follow-up names the entry written.
    expect('scopeMode' in row).toBe(false)
    const written = String(mockSetDoc.mock.calls[0][0]).split('/').pop()
    expect(mockFollowUp).toHaveBeenCalledTimes(1)
    expect(mockFollowUp.mock.calls[0].slice(1)).toEqual([{ hostId: 'site-1' }, 'crmActivities', [written]])
  })

  it('asks nothing while the default leaves no site out', async () => {
    await filing({ contactId: 'c-1' })
    expect(mockFollowUp).not.toHaveBeenCalled()
  })

  it('files the entry anyway when the record cannot be read', async () => {
    mockReadFails = true
    const row = await filing({ contactId: 'c-1' })
    expect(row).toMatchObject({ contactId: 'c-1' })
    expect('companyId' in row).toBe(false)
  })
})
