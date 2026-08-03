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
import useOrgHosts from './use-org-hosts'

// Each onSnapshot registration records its callbacks so a test can drive the
// listener to success or error at will.
type Handler = { onNext: (snap: unknown) => void; onError: () => void }
let mockHandlers: Handler[] = []
const mockUnsubscribe = jest.fn()
// The AGL-827 backend confirm for an empty live result — controllable per test.
const mockGetDocsFromServer = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (
    _q: unknown,
    onNext: (snap: unknown) => void,
    onError: () => void,
  ) => {
    mockHandlers.push({ onNext, onError })
    return mockUnsubscribe
  },
  getDocsFromServer: (q: unknown) => mockGetDocsFromServer(q),
}))

const RETRY_DELAY_MS = 400
// A STABLE reference: the effect's deps include `firestore`, so a fresh object
// each render would re-run it forever. `useFirestore()` returns a singleton.
const firestore = {} as never

const snap = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
  empty: docs.length === 0,
  docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
})
const emitSuccess = (
  docs: Array<{ id: string; data: Record<string, unknown> }>,
) => act(() => mockHandlers[mockHandlers.length - 1].onNext(snap(docs)))

describe('useOrgHosts (AGL-813 / AGL-827)', () => {
  beforeEach(() => {
    mockHandlers = []
    mockUnsubscribe.mockClear()
    mockGetDocsFromServer.mockReset()
    // Default: the backend confirms the empty result (a genuinely hostless org).
    mockGetDocsFromServer.mockResolvedValue(snap([]))
  })

  it('exposes the loaded hosts on a successful snapshot', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitSuccess([{ id: 'h1', data: { subdomain: 'shop' } }])
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.error).toBe(false)
    expect(result.current.hosts).toEqual([{ $id: 'h1', subdomain: 'shop' }])
    // A populated list settles without a backend round-trip.
    expect(mockGetDocsFromServer).not.toHaveBeenCalled()
  })

  it('does not query until a uid and a resolved orgId are present', () => {
    renderHook(() => useOrgHosts(firestore, undefined, undefined))
    expect(mockHandlers).toHaveLength(0)
    renderHook(() => useOrgHosts(firestore, 'u1', undefined))
    expect(mockHandlers).toHaveLength(0)
  })

  it('holds `ready` on an empty result until the backend confirm returns (AGL-813)', async () => {
    let resolveConfirm: (value: unknown) => void = () => undefined
    mockGetDocsFromServer.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve
      }),
    )
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))

    emitSuccess([]) // stale-looking empty — must NOT settle yet
    expect(result.current.ready).toBe(false)
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)

    // The backend has the host after all — heal into it, then settle.
    act(() => resolveConfirm(snap([{ id: 'h1', data: { subdomain: 'shop' } }])))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.error).toBe(false)
    expect(result.current.hosts).toEqual([{ $id: 'h1', subdomain: 'shop' }])
  })

  it('an empty result the backend also confirms empty is a real 404 (ready, no error)', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitSuccess([])
    await waitFor(() => expect(result.current.ready).toBe(true))
    // This is the ONLY empty state HostGuard is allowed to 404 on.
    expect(result.current.error).toBe(false)
    expect(result.current.hosts).toEqual([])
  })

  it('a failed confirm surfaces error (a retry), never a false 404 (AGL-813)', async () => {
    mockGetDocsFromServer.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitSuccess([])
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.error).toBe(true)
    expect(result.current.hosts).toEqual([])
  })

  /**
   * AGL-929. The AGL-827 heal above only fires on an EMPTY live result, so an
   * org with several sites that tombstoned ONE of them produced a shorter —
   * not empty — snapshot, ran no confirm, and dropped that site from the
   * switcher until the resume token was discarded. For a multi-site org that
   * is the likelier failure, not the rarer one.
   */
  describe('a host that vanishes from a non-empty result (AGL-929)', () => {
    it('is confirmed against the backend, not silently dropped', async () => {
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitSuccess([{ id: 'h1', data: {} }, { id: 'h2', data: {} }])
      await waitFor(() => expect(result.current.hosts).toHaveLength(2))

      // h2 tombstoned in the local cache: still on the server, absent here.
      mockGetDocsFromServer.mockResolvedValue(
        snap([{ id: 'h1', data: {} }, { id: 'h2', data: {} }]),
      )
      emitSuccess([{ id: 'h1', data: {} }])

      await waitFor(() => expect(result.current.hosts).toHaveLength(2))
      expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)
      expect(result.current.error).toBe(false)
    })

    it('confirms a genuine removal once, then stops re-confirming', async () => {
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitSuccess([{ id: 'h1', data: {} }, { id: 'h2', data: {} }])
      await waitFor(() => expect(result.current.hosts).toHaveLength(2))

      // The server agrees h2 is gone — access really was removed.
      mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'h1', data: {} }]))
      emitSuccess([{ id: 'h1', data: {} }])
      await waitFor(() => expect(result.current.hosts).toHaveLength(1))
      expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)

      // Every later snapshot still omits h2. Without `confirmedGone` this
      // would bill a server read on each one, forever.
      emitSuccess([{ id: 'h1', data: {} }])
      emitSuccess([{ id: 'h1', data: {} }])
      expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)
      expect(result.current.hosts).toEqual([{ $id: 'h1' }])
    })

    it('re-arms the empty confirm after a real result', async () => {
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))

      // First empty result confirms — the pre-existing AGL-827 behaviour.
      mockGetDocsFromServer.mockResolvedValue(snap([]))
      emitSuccess([])
      await waitFor(() => expect(result.current.ready).toBe(true))
      expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)

      // A real result lands, then everything vanishes again. `serverConfirmed`
      // used to be a one-shot for the life of the subscription, so this second
      // total loss went unconfirmed and read as a genuine 404.
      emitSuccess([{ id: 'h1', data: {} }])
      await waitFor(() => expect(result.current.hosts).toHaveLength(1))

      mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'h1', data: {} }]))
      emitSuccess([])
      await waitFor(() => expect(result.current.hosts).toHaveLength(1))
      expect(mockGetDocsFromServer).toHaveBeenCalledTimes(2)
    })
  })

  it('flags error (not a clean empty) once listen retries are exhausted', () => {
    jest.useFakeTimers()
    try {
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      // Fail every attempt; each error schedules a retry until the budget runs
      // out, at which point the hook settles as ready+error with no hosts.
      act(() => {
        for (let i = 0; i < 15; i += 1) {
          mockHandlers[mockHandlers.length - 1].onError()
          jest.advanceTimersByTime(RETRY_DELAY_MS)
        }
      })
      expect(result.current.ready).toBe(true)
      expect(result.current.error).toBe(true)
      expect(result.current.hosts).toEqual([])
    } finally {
      jest.useRealTimers()
    }
  })
})
