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
  PENDING_INVITES_VISIBLE_REFETCH_MS,
  usePendingInvitesSource,
} from './use-pending-invites'

/**
 * The pending-invites list is read once per account and on demand, not once
 * per render or per tab flip: a tab whose visibility flipped every six
 * seconds asked `/api/orgs/invites?mine=1` 600 times an hour.
 */

let mockUser: { uid: string } | null = { uid: 'user-ada' }
jest.mock('@aglyn/tenant-feature-instance/hooks/firebase/firebase-services', () => ({
  // A NEW object on every call, as a token refresh can hand back.
  useUser: () => ({ data: mockUser ? { ...mockUser } : null }),
}))

const mockFetch = jest.fn(async () => ({
  ok: true,
  json: async () => ({ invites: [] }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...(args as [])),
}))

let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
})
const flipTab = () => {
  visibility = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
}

let now = 1_000_000
beforeEach(() => {
  mockFetch.mockClear()
  mockUser = { uid: 'user-ada' }
  now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => jest.restoreAllMocks())

const mounted = async () => {
  const hook = renderHook(() => usePendingInvitesSource())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

it('reads once on mount, and not again for a new object of the same account', async () => {
  const { rerender } = await mounted()
  rerender()
  rerender()

  expect(mockFetch).toHaveBeenCalledTimes(1)
})

it('reads again when the account changes', async () => {
  const { rerender } = await mounted()
  mockUser = { uid: 'user-grace' }
  rerender()

  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
})

it('ignores tab flips inside the window, and re-reads after it', async () => {
  await mounted()
  // Nine flips six seconds apart: 54s, still inside the window.
  for (let i = 0; i < 9; i += 1) {
    now += 6_000
    act(flipTab)
  }
  expect(mockFetch).toHaveBeenCalledTimes(1)

  now += PENDING_INVITES_VISIBLE_REFETCH_MS
  act(flipTab)
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
})

it('never throttles an explicit refresh', async () => {
  const { result } = await mounted()
  await act(() => result.current.refresh())
  await act(() => result.current.refresh())

  expect(mockFetch).toHaveBeenCalledTimes(3)
})
