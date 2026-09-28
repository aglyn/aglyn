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

import { renderHook, waitFor } from '@testing-library/react'

const mockAuthorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
const mockUser = { uid: 'viewer' }
jest.mock('./firebase/firebase-services', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

import { useResolvedActivityActors } from './use-resolved-activity-actors'

const answer = (actors: Record<string, string>) =>
  Promise.resolve({ ok: true, json: async () => ({ actors }) })

beforeEach(() => mockAuthorizedFetch.mockReset())

describe('useResolvedActivityActors (AGL-3369)', () => {
  const rows = [
    { $id: '1', actorId: 'uid-7', actorEmail: null },
    { $id: '2', actorId: 'uid-8', actorEmail: 'then@example.test' },
    { $id: '3', actorId: null, actorEmail: null },
    { $id: '4', actorId: 'api', actorEmail: null },
    { $id: '5', actorId: 'uid-7', actorEmail: null },
  ]

  it('asks only for uids recorded without an address, once each', async () => {
    mockAuthorizedFetch.mockReturnValue(answer({ 'uid-7': 'owner@example.test' }))
    const { result } = renderHook(() => useResolvedActivityActors('host-1', rows))

    await waitFor(() => expect(result.current[0].actorEmailNow).toBe('owner@example.test'))
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    const url = new URL(mockAuthorizedFetch.mock.calls[0][1])
    expect(url.pathname).toBe('/api/hosts/activity-actors')
    expect(url.searchParams.get('hostId')).toBe('host-1')
    expect(url.searchParams.get('uids')).toBe('uid-7')
    // The same uid on another row gets the same answer; the rest are as written.
    expect(result.current[4].actorEmailNow).toBe('owner@example.test')
    expect(result.current[1]).toBe(rows[1])
    expect(result.current[2]).toBe(rows[2])
    expect(result.current[3]).toBe(rows[3])
  })

  it('does not ask again when the rows re-render', async () => {
    mockAuthorizedFetch.mockReturnValue(answer({ 'uid-7': 'owner@example.test' }))
    const { result, rerender } = renderHook(
      ({ page }) => useResolvedActivityActors('host-1', page),
      { initialProps: { page: rows } },
    )
    await waitFor(() => expect(result.current[0].actorEmailNow).toBeDefined())
    rerender({ page: [...rows] })
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for a page where every row carries its address', () => {
    renderHook(() =>
      useResolvedActivityActors('host-1', [{ actorId: 'uid-8', actorEmail: 'a@example.test' }]),
    )
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })

  it('leaves the rows as they were when the lookup is refused', async () => {
    mockAuthorizedFetch.mockResolvedValue({ ok: false, json: async () => ({}) })
    const { result } = renderHook(() => useResolvedActivityActors('host-1', rows))
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalled())
    expect(result.current[0]).toBe(rows[0])
  })
})
