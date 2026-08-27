/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * A switcher fetch that FAILED is not a switcher that is empty (AGL-1066).
 *
 * `useSwitcherCollection` deliberately keeps the previous rows when a fetch
 * fails, so a flaky network never blanks an open menu. That is right, and it
 * stays. What it must ALSO do is record that the fetch failed: a catch that
 * drops straight to `setLoading(false)` returns `{ items: [], loading: false }`
 * whenever there are no previous rows to keep — a cold load, or the first
 * fetch after a scope change. Every switcher reads that pair as a settled,
 * empty collection, so a refused read prints **"No sites yet."** to an owner
 * whose sites are all still there.
 */

import { act, renderHook, waitFor } from '@testing-library/react'

const mockGetDocs = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (ref: unknown) => ref,
  where: () => ({ kind: 'where' }),
  // The search path windows by document id (AGL-2486). Absent from this
  // double the hook calls `undefined()`, which lands in its own catch and
  // reports a REFUSAL — so the suite would blame a permission failure for a
  // gap in the mock.
  documentId: () => '__name__',
  orderBy: () => ({ kind: 'orderBy' }),
  startAt: () => ({ kind: 'startAt' }),
  endAt: () => ({ kind: 'endAt' }),
  limit: () => ({ kind: 'limit' }),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}))

import { useSwitcherCollection } from './use-switcher-collection'

const FIRESTORE = {} as never
const DEPS = [FIRESTORE, 'u1', 'org-1']

const snapshotOf = (ids: string[]) => ({
  docs: ids.map((id) => ({ id, data: () => ({ displayName: id }) })),
})

const mount = () =>
  renderHook(() =>
    useSwitcherCollection<any>({
      firestore: FIRESTORE,
      path: ['users', 'u1', 'hostMemberships'],
      query: '',
      deps: DEPS,
      debounceMs: 0,
    }),
  )

describe('useSwitcherCollection on a refused fetch', () => {
  beforeEach(() => mockGetDocs.mockReset())

  it('reports the refusal instead of settling on an empty list', async () => {
    mockGetDocs.mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'permission-denied' }),
    )

    const { result } = mount()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(0)
    // Without this the caller cannot tell this apart from a real zero.
    expect(result.current.error).toBe(true)
  })

  it('reports a genuinely empty collection as empty, not an error', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([]))

    const { result } = mount()

    await waitFor(() => expect(result.current.loading).toBe(false))
    // The negative control: a hook that hard-coded `error: true` would pass
    // the test above and fail here.
    expect(result.current.error).toBe(false)
  })

  it('clears the refusal once a fetch succeeds again', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('nope'))
    mockGetDocs.mockResolvedValue(snapshotOf(['site-a']))

    // A query change is what actually issues a second fetch; a bare rerender
    // re-runs no effect, so asserting through one would have measured the
    // test harness rather than the hook.
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useSwitcherCollection<any>({
          firestore: FIRESTORE,
          path: ['users', 'u1', 'hostMemberships'],
          query,
          deps: DEPS,
          debounceMs: 0,
        }),
      { initialProps: { query: '' } },
    )
    await waitFor(() => expect(result.current.error).toBe(true))

    // A latched flag would leave the menu apologising forever.
    act(() => rerender({ query: 'site' }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.error).toBe(false)
  })
})
