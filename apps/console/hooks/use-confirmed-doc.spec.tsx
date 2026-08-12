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

import { act, renderHook } from '@testing-library/react'

const listeners: Array<(snapshot: unknown) => void> = []
const mockGetDocFromServer = jest.fn()

jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, path: string) => ({ path }),
  onSnapshot: (
    ref: { path: string },
    next: (snapshot: unknown) => void,
  ) => {
    listeners.push(next)
    return () => undefined
  },
  getDocFromServer: (ref: { path: string }) => mockGetDocFromServer(ref.path),
}))

import { useConfirmedDoc, resetConfirmedDocSharing } from './use-confirmed-doc'

const CONFIRM_DELAY_MS = 1_500

/** A snapshot the local cache served: exists, but the server never acked it. */
const cachedHit = (path: string) => ({
  metadata: { fromCache: true },
  exists: () => true,
  id: path.split('/').pop(),
  data: () => ({ plan: 'free' }),
})

const serverHit = (path: string) => ({
  exists: () => true,
  id: path.split('/').pop(),
  data: () => ({ plan: 'business' }),
})

/**
 * The cost claim (AGL-1440): the console chrome mounts `useCurrentOrg` seven
 * times per page, and each instance used to bill its own `getDocFromServer` on
 * `orgs/{orgId}` — seven server reads to answer one question.
 */
describe('useConfirmedDoc server confirms', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    listeners.length = 0
    mockGetDocFromServer.mockReset()
    mockGetDocFromServer.mockImplementation((path: string) =>
      Promise.resolve(serverHit(path)),
    )
    resetConfirmedDocSharing()
  })
  afterEach(() => jest.useRealTimers())

  // ONE identity: the hook keys its effect on the Firestore instance, so a
  // fresh object per render would resubscribe forever.
  const firestore = {} as never

  const mountChrome = (count: number, path = 'orgs/org-1') =>
    Array.from({ length: count }, () =>
      renderHook(() =>
        useConfirmedDoc(firestore, path.split('/') as never, {
          confirmCachedHit: true,
        }),
      ),
    )

  it('bills ONE server read when the chrome mounts seven copies', async () => {
    const hooks = mountChrome(7)
    act(() => listeners.forEach((next) => next(cachedHit('orgs/org-1'))))
    await act(async () => {
      jest.advanceTimersByTime(CONFIRM_DELAY_MS)
    })
    expect(mockGetDocFromServer).toHaveBeenCalledTimes(1)
    expect(hooks).toHaveLength(7)
  })

  it('still confirms EVERY instance — none is left flagged fromCache', async () => {
    // Suppressing the duplicates instead of sharing the promise would leave
    // six consumers on a value they are told not to act on.
    const hooks = mountChrome(7)
    act(() => listeners.forEach((next) => next(cachedHit('orgs/org-1'))))
    await act(async () => {
      jest.advanceTimersByTime(CONFIRM_DELAY_MS)
    })
    for (const hook of hooks) {
      expect(hook.result.current.fromCache).toBe(false)
      expect(hook.result.current.data).toMatchObject({ plan: 'business' })
    }
  })

  it('does not share a confirm across different documents', async () => {
    mountChrome(2, 'orgs/org-1')
    mountChrome(2, 'orgs/org-2')
    act(() => {
      listeners[0](cachedHit('orgs/org-1'))
      listeners[1](cachedHit('orgs/org-1'))
      listeners[2](cachedHit('orgs/org-2'))
      listeners[3](cachedHit('orgs/org-2'))
    })
    await act(async () => {
      jest.advanceTimersByTime(CONFIRM_DELAY_MS)
    })
    expect(mockGetDocFromServer.mock.calls.map(([path]) => path).sort()).toEqual(
      ['orgs/org-1', 'orgs/org-2'],
    )
  })

  it('asks again after the shared confirm settles', async () => {
    // A burst collapser, not a cache: a later mount gets a fresh answer.
    mountChrome(3)
    act(() => listeners.forEach((next) => next(cachedHit('orgs/org-1'))))
    await act(async () => {
      jest.advanceTimersByTime(CONFIRM_DELAY_MS)
    })
    expect(mockGetDocFromServer).toHaveBeenCalledTimes(1)

    const before = listeners.length
    mountChrome(1)
    act(() => listeners[before](cachedHit('orgs/org-1')))
    await act(async () => {
      jest.advanceTimersByTime(CONFIRM_DELAY_MS)
    })
    expect(mockGetDocFromServer).toHaveBeenCalledTimes(2)
  })
})
