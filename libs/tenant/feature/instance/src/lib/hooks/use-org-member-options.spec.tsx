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
 * THE TEAM, AS A PICKER'S OPTIONS (AGL-2603).
 *
 * Two surfaces need "who on this team can own a contact": the bulk bar on
 * the contacts list and the audience rule editor's owner filter. Both read
 * the roster through the members API rather than the `members` collection,
 * because a scoped collaborator's direct read of that collection is refused
 * by the rules — the route re-derives membership with the Admin SDK.
 *
 * The properties pinned here are the ones a second copy would get wrong:
 * the request goes to the route WITH the caller's token, the roster is
 * mapped to a label a human recognizes, nothing is read until a caller asks,
 * and a refusal is a reported error rather than an empty team.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { orgMemberOptions, useOrgMemberOptions } from './use-org-member-options'

let mockUser: Record<string, unknown> | null = {
  uid: 'uid-me',
  getIdToken: async () => 'token-abc',
}
jest.mock('./firebase/firebase-services', () => ({
  useUser: () => ({ data: mockUser }),
}))

/** Every request the hook made, as `[url, Authorization]`. */
let calls: Array<[string, string | undefined]> = []
let answer: { ok: boolean; body: unknown } = {
  ok: true,
  body: {
    members: [
      { $id: 'uid-b', email: 'bea@example.com', role: 'editor' },
      { $id: 'uid-a', displayName: 'Ada Lovelace', email: 'ada@example.com' },
      { $id: 'uid-c' },
    ],
  },
}

beforeEach(() => {
  calls = []
  mockUser = { uid: 'uid-me', getIdToken: async () => 'token-abc' }
  answer = {
    ok: true,
    body: {
      members: [
        { $id: 'uid-b', email: 'bea@example.com', role: 'editor' },
        { $id: 'uid-a', displayName: 'Ada Lovelace', email: 'ada@example.com' },
        { $id: 'uid-c' },
      ],
    },
  }
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push([String(url), init?.headers?.Authorization])
    return { ok: answer.ok, json: async () => answer.body } as any
  })
})

describe('the roster as options', () => {
  it('labels each member by name, then address, then uid, sorted by label', () => {
    expect(
      orgMemberOptions([
        { $id: 'uid-b', email: 'bea@example.com' },
        { $id: 'uid-a', displayName: 'Ada Lovelace', email: 'ada@example.com' },
        { $id: 'uid-c' },
      ]),
    ).toEqual([
      { uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com' },
      { uid: 'uid-b', label: 'bea@example.com', email: 'bea@example.com' },
      { uid: 'uid-c', label: 'uid-c', email: undefined },
    ])
  })
})

describe('reading the team', () => {
  it('asks the members route for the org, with the caller’s token', async () => {
    const { result } = renderHook(() =>
      useOrgMemberOptions('org-1', { enabled: true }),
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(calls).toEqual([
      ['/api/orgs/members?orgId=org-1', 'Bearer token-abc'],
    ])
    expect(result.current.options.map((option) => option.uid)).toEqual([
      'uid-a',
      'uid-b',
      'uid-c',
    ])
    expect(result.current.error).toBeNull()
  })

  it('reads nothing until a caller asks', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useOrgMemberOptions('org-1', { enabled }),
      { initialProps: { enabled: false } },
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(calls).toHaveLength(0)
    expect(result.current.ready).toBe(false)

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(calls).toHaveLength(1)
  })

  it('reports a refusal rather than an empty team', async () => {
    answer = { ok: false, body: { error: 'You are not a member of that organization' } }
    const { result } = renderHook(() =>
      useOrgMemberOptions('org-1', { enabled: true }),
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.options).toEqual([])
    expect(result.current.error).toMatch(/not a member/)
  })

  it('issues nothing for a signed-out account, and says so', async () => {
    // `authorizedFetch` answers a 401 without leaving the browser; the hook
    // reports that reason instead of an empty roster.
    mockUser = { uid: 'uid-me' }
    const { result } = renderHook(() =>
      useOrgMemberOptions('org-1', { enabled: true }),
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(calls).toHaveLength(0)
    expect(result.current.error).toMatch(/signed out/i)
  })
})
