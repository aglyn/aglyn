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
 * The roster every CRM card names a teammate from. A read that fails in a
 * way that can clear (the sign-in token not ready, the route busy) is asked
 * again, because a page that keeps the failure names owners by uid until it
 * is reloaded. A refusal that cannot change is not.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { resetOrgMemberDirectoryCache, useOrgMemberDirectory } from './use-org-member-directory'

const mockUser = { uid: 'viewer', getIdToken: async () => 'token' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(),
}))

const mockFetch = authorizedFetch as jest.Mock

const answer = (status: number, body: Record<string, unknown>) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})
const OWNER = 'owner-uid'
const roster = answer(200, {
  members: [{ $id: OWNER, displayName: 'Sam Rivera', email: 'reviewer@example.com', role: 'owner' }],
})

describe('useOrgMemberDirectory', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetOrgMemberDirectoryCache()
    mockFetch.mockReset()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('names a member from the roster', async () => {
    mockFetch.mockResolvedValue(roster)
    const { result } = renderHook(() => useOrgMemberDirectory('org-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nameOf(OWNER)).toBe('Sam Rivera')
    expect(mockFetch).toHaveBeenCalledWith(mockUser, '/api/orgs/members?orgId=org-1')
  })

  it('asks again when the first read never went out because the token was not ready', async () => {
    mockFetch
      .mockResolvedValueOnce(answer(401, { error: 'Your sign-in could not be confirmed in time.' }))
      .mockResolvedValueOnce(roster)
    const { result } = renderHook(() => useOrgMemberDirectory('org-1'))
    await act(() => jest.advanceTimersByTimeAsync(1_000))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.nameOf(OWNER)).toBe('Sam Rivera')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('stops after its tries and names by the reference, for the next mount to ask again', async () => {
    mockFetch.mockResolvedValue(answer(503, { error: 'Busy' }))
    const { result } = renderHook(() => useOrgMemberDirectory('org-1'))
    await act(() => jest.advanceTimersByTimeAsync(3_000))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(result.current.error).toBe('Busy')
    expect(result.current.nameOf(OWNER)).toBe(OWNER)
  })

  it('does not ask again when the route refused the reader', async () => {
    mockFetch.mockResolvedValue(answer(403, { error: 'You are not a member of that organization' }))
    const { result } = renderHook(() => useOrgMemberDirectory('org-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => jest.advanceTimersByTimeAsync(3_000))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('You are not a member of that organization')
  })
})
