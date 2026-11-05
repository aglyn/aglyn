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
 * What the plugins say a person erasure keeps, as a screen reads it (AGL-4042):
 * a member the route refuses gets nothing, and any other failure is said, so a
 * missing note never reads as nothing being kept.
 */

import { renderHook, waitFor } from '@testing-library/react'
import type { User } from 'firebase/auth'
import { usePersonErasureNotes } from './use-person-erasure-notes'

const mockAuthorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))

const user = { uid: 'admin-1' } as User
const answer = (status: number, body: unknown) => ({
  ok: status < 300,
  status,
  json: async () => body,
})

beforeEach(() => mockAuthorizedFetch.mockReset())

describe('usePersonErasureNotes', () => {
  it('asks about the workspace and answers each sentence', async () => {
    mockAuthorizedFetch.mockResolvedValue(
      answer(200, { notes: [{ id: 'a', text: 'Kept.', pluginId: 'p' }], unavailable: [] }),
    )
    const { result } = renderHook(() => usePersonErasureNotes(user, 'org-1'))
    expect(result.current).toEqual({ lines: [], unavailable: false })
    await waitFor(() => expect(result.current.lines).toEqual(['Kept.']))
    expect(result.current.unavailable).toBe(false)
    expect(mockAuthorizedFetch).toHaveBeenCalledWith(user, '/api/person-erasure-notes?orgId=org-1')
  })

  it('keeps the notes it has, and says when a plugin could not answer', async () => {
    mockAuthorizedFetch.mockResolvedValue(
      answer(200, { notes: [{ id: 'a', text: 'Kept.', pluginId: 'p' }], unavailable: ['q'] }),
    )
    const { result } = renderHook(() => usePersonErasureNotes(user, 'org-1'))
    await waitFor(() => expect(result.current).toEqual({ lines: ['Kept.'], unavailable: true }))
  })

  it('says nothing to a member the route refuses', async () => {
    mockAuthorizedFetch.mockResolvedValue(answer(403, { error: 'No' }))
    const { result } = renderHook(() => usePersonErasureNotes(user, 'org-1'))
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current).toEqual({ lines: [], unavailable: false })
  })

  it.each([
    ['a server failure', async () => answer(500, { error: 'Down' })],
    ['an answer with no notes', async () => answer(200, {})],
    [
      'a network failure',
      async () => {
        throw new Error('offline')
      },
    ],
  ])('says details are missing after %s', async (_name, respond) => {
    mockAuthorizedFetch.mockImplementation(respond)
    const { result } = renderHook(() => usePersonErasureNotes(user, 'org-1'))
    await waitFor(() => expect(result.current).toEqual({ lines: [], unavailable: true }))
  })

  it('asks nothing until it has a person and a workspace', () => {
    renderHook(() => usePersonErasureNotes(null, 'org-1'))
    renderHook(() => usePersonErasureNotes(user, null))
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })
})
