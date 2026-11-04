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
 * A contact's page named its owner by uid while the deal page beside it
 * named the same person. The contact page's roster was a request of its own,
 * made with whatever sign-in it had when the record arrived, and a failed
 * answer was kept as the roster. It now reads through the directory the deal
 * page uses, which waits for the signed-in user.
 */

import { renderHook, waitFor } from '@testing-library/react'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { resetOrgMemberDirectoryCache } from '../hooks/use-org-member-directory'
import { useOrgMembers } from './use-org-members'

let mockUser: { uid: string; getIdToken: () => Promise<string> } | null | undefined

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(),
}))

const mockFetch = authorizedFetch as jest.Mock
const OWNER = 'owner-uid'

describe('useOrgMembers', () => {
  beforeEach(() => {
    resetOrgMemberDirectoryCache()
    mockFetch.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        members: [{ $id: OWNER, displayName: 'Sam Rivera', email: 'reviewer@example.com' }],
      }),
    })
    mockUser = { uid: 'viewer', getIdToken: async () => 'token' }
  })

  it('reads nothing until asked', () => {
    const { result } = renderHook(() => useOrgMembers('org-1'))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
  })

  it("names the owner when the record arrives before the user's sign-in has", async () => {
    mockUser = undefined
    const { result, rerender } = renderHook(() => useOrgMembers('org-1', { enabled: true }))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)

    mockUser = { uid: 'viewer', getIdToken: async () => 'token' }
    rerender()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.memberName(OWNER)).toBe('Sam Rivera')
    expect(result.current.memberEmail(OWNER)).toBe('reviewer@example.com')
    expect(result.current.options.map((option) => option.label)).toEqual(['Sam Rivera'])
  })

  it('names by the reference itself for someone the roster does not have', async () => {
    const { result } = renderHook(() => useOrgMembers('org-1', { enabled: true }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.memberName('former-member')).toBe('former-member')
    expect(result.current.memberEmail('former-member')).toBe('former-member')
  })
})
