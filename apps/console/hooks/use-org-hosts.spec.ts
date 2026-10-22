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

/**
 * The hook now reads candidate ids from `users/{uid}/hostMemberships` and
 * hydrates each host by id (AGL-1190), so the mock routes two kinds of listen:
 * the membership query, and one document listen per host.
 */
type Handler = { onNext: (snap: unknown) => void; onError: () => void }
let mockMembershipHandlers: Handler[] = []
let mockHostHandlers: Map<string, Handler> = new Map()
let mockWhereCalls = 0
const mockUnsubscribe = jest.fn()
const mockGetDocsFromServer = jest.fn()
// The one-shot server ask for a host the cache calls missing (AGL-3789),
// told apart from the membership confirm by the collection it reads.
const mockConfirmHost = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => ({
    __kind: 'collection',
    path: args.slice(1).join('/'),
  }),
  query: (ref: unknown, ...constraints: unknown[]) => ({
    __kind: 'query',
    ref,
    constraints,
  }),
  // Counted: the point of AGL-1190 is that no LIVE read uses a predicate, so
  // a call outside the AGL-3789 confirm is a regression.
  where: (field: unknown, op: unknown, value: unknown) => {
    mockWhereCalls += 1
    return { field, op, value }
  },
  documentId: () => '__name__',
  doc: (...args: unknown[]) => ({
    __kind: 'doc',
    id: String(args[args.length - 1]),
  }),
  onSnapshot: (
    target: { __kind: string; id?: string },
    onNext: (snap: unknown) => void,
    onError: () => void,
  ) => {
    if (target.__kind === 'doc') {
      const id = target.id as string
      mockHostHandlers.set(id, { onNext, onError })
      return () => mockHostHandlers.delete(id)
    }
    mockMembershipHandlers.push({ onNext, onError })
    return mockUnsubscribe
  },
  getDocsFromServer: (q: { ref: { path: string } }) =>
    q.ref.path === 'hosts' ? mockConfirmHost(q) : mockGetDocsFromServer(q),
}))

const RETRY_DELAY_MS = 400
// A STABLE reference: the effect's deps include `firestore`, so a fresh object
// each render would re-run it forever. `useFirestore()` returns a singleton.
const firestore = {} as never

type Row = { id: string; orgId?: string; role?: string }
const rowSnap = (rows: Row[]) => ({
  empty: rows.length === 0,
  docs: rows.map(({ id, ...rest }) => ({
    id,
    data: () => ({ role: 'admin', ...rest }),
  })),
})

/** Deliver a membership snapshot to the newest membership listener. */
const emitMemberships = (rows: Row[]) =>
  act(() =>
    mockMembershipHandlers[mockMembershipHandlers.length - 1].onNext(
      rowSnap(rows),
    ),
  )

/** Deliver a host document; `null` means "does not exist". */
const emitHost = (id: string, data: Record<string, unknown> | null) =>
  act(() =>
    mockHostHandlers.get(id)?.onNext({
      id,
      exists: () => data !== null,
      data: () => data ?? {},
    }),
  )

/** Fail a host document read the way a rules denial does. */
const failHost = (id: string) => act(() => mockHostHandlers.get(id)?.onError())

describe('useOrgHosts (AGL-813 / AGL-827 / AGL-929 / AGL-1190)', () => {
  beforeEach(() => {
    mockMembershipHandlers = []
    mockHostHandlers = new Map()
    mockWhereCalls = 0
    mockUnsubscribe.mockClear()
    mockGetDocsFromServer.mockReset()
    // Default: the backend confirms an empty membership list.
    mockGetDocsFromServer.mockResolvedValue(rowSnap([]))
    mockConfirmHost.mockReset()
    // Default: the server has no host the cache called missing.
    mockConfirmHost.mockResolvedValue({ docs: [] })
  })

  /**
   * The regression this refactor exists to prevent. A `where` on a MUTABLE
   * field is what let a host leave the query target and get tombstoned; the
   * membership read must stay unconstrained so no document can stop matching.
   */
  it('never constrains the membership query (AGL-1190)', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([{ id: 'h1', orgId: 'org1' }])
    emitHost('h1', { subdomain: 'shop' })
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(mockWhereCalls).toBe(0)
  })

  it('exposes the hydrated host documents, not the mirror rows', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([{ id: 'h1', orgId: 'org1' }])
    emitHost('h1', { subdomain: 'shop', memberRoles: { u1: 'admin' } })

    await waitFor(() => expect(result.current.ready).toBe(true))
    // The mirror carries only a projection; consumers pass whole host docs on
    // to cards and billing components, so the host doc is what must surface.
    expect(result.current.hosts).toEqual([
      { $id: 'h1', subdomain: 'shop', memberRoles: { u1: 'admin' } },
    ])
    expect(result.current.error).toBe(false)
  })

  it('filters by org in memory', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([
      { id: 'h1', orgId: 'org1' },
      { id: 'other', orgId: 'org2' },
    ])
    emitHost('h1', { subdomain: 'shop' })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hosts.map((h) => h.$id)).toEqual(['h1'])
    // The out-of-scope host is never even read.
    expect(mockHostHandlers.has('other')).toBe(false)
  })

  it('does not read until a uid and a resolved orgId are present', () => {
    renderHook(() => useOrgHosts(firestore, undefined, 'org1'))
    expect(mockMembershipHandlers).toHaveLength(0)
    renderHook(() => useOrgHosts(firestore, 'u1', undefined))
    expect(mockMembershipHandlers).toHaveLength(0)
  })

  /**
   * AGL-813. A consumer that 404s on ready+empty must never see a list that is
   * merely still loading.
   */
  it('holds `ready` until every host has resolved', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([
      { id: 'h1', orgId: 'org1' },
      { id: 'h2', orgId: 'org1' },
    ])
    emitHost('h1', { subdomain: 'shop' })

    // One of two resolved — settling here would publish a short list.
    expect(result.current.ready).toBe(false)

    emitHost('h2', { subdomain: 'blog' })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hosts).toHaveLength(2)
  })

  it('holds `ready` on an empty result until the backend confirm returns (AGL-813)', async () => {
    mockGetDocsFromServer.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([])

    expect(result.current.ready).toBe(false)
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)
  })

  it('heals an empty live result the backend disagrees with (AGL-827)', async () => {
    mockGetDocsFromServer.mockResolvedValue(rowSnap([{ id: 'h1', orgId: 'org1' }]))
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([])

    await waitFor(() => expect(mockHostHandlers.has('h1')).toBe(true))
    emitHost('h1', { subdomain: 'shop' })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hosts.map((h) => h.$id)).toEqual(['h1'])
  })

  it('an empty result the backend also confirms empty is a real 404', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([])

    await waitFor(() => expect(result.current.ready).toBe(true))
    // The ONLY empty state a consumer may 404 on.
    expect(result.current.error).toBe(false)
    expect(result.current.hosts).toEqual([])
  })

  it('a failed confirm surfaces error (a retry), never a false 404 (AGL-813)', async () => {
    mockGetDocsFromServer.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([])

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.error).toBe(true)
  })

  it('re-arms the empty confirm after a real result', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([])
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)

    emitMemberships([{ id: 'h1', orgId: 'org1' }])
    emitHost('h1', { subdomain: 'shop' })
    await waitFor(() => expect(result.current.hosts).toHaveLength(1))

    // Empty again — a one-shot guard would leave this unconfirmed.
    emitMemberships([])
    await waitFor(() => expect(mockGetDocsFromServer).toHaveBeenCalledTimes(2))
  })

  /**
   * The mirror is a server-written hint; the per-host read is the gate. A row
   * the user can no longer read costs them a visible site, never a leak — and
   * must not take the rest of the list down with it.
   */
  it('drops a host whose document read is denied, keeping the others', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([
      { id: 'h1', orgId: 'org1' },
      { id: 'stale', orgId: 'org1' },
    ])
    emitHost('h1', { subdomain: 'shop' })
    failHost('stale')

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hosts.map((h) => h.$id)).toEqual(['h1'])
    expect(result.current.error).toBe(false)
  })

  it('drops a host the server confirms does not exist', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([
      { id: 'h1', orgId: 'org1' },
      { id: 'ghost', orgId: 'org1' },
    ])
    emitHost('h1', { subdomain: 'shop' })
    emitHost('ghost', null)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hosts.map((h) => h.$id)).toEqual(['h1'])
  })

  /**
   * AGL-3789. A tombstone two primaries wrote into the shared cache (AGL-3788)
   * says a live host does not exist, and it outlives reloads. The mirror still
   * lists the host, so the server is asked — and what it says wins.
   */
  describe('a host the cache calls missing (AGL-3789)', () => {
    const serverHas = (id: string, data: Record<string, unknown>) =>
      mockConfirmHost.mockResolvedValue({ docs: [{ id, data: () => data }] })

    it('shows the host the server still has, never "No sites yet"', async () => {
      serverHas('h1', { subdomain: 'shop' })
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)

      await waitFor(() => expect(result.current.ready).toBe(true))
      expect(result.current.hosts).toEqual([{ $id: 'h1', subdomain: 'shop' }])
      expect(result.current.error).toBe(false)
    })

    it('asks with the rules-provable shape: the id plus the access roles', async () => {
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)
      await waitFor(() => expect(result.current.ready).toBe(true))

      expect(mockConfirmHost).toHaveBeenCalledTimes(1)
      const [{ constraints }] = mockConfirmHost.mock.calls[0]
      expect(constraints).toEqual([
        { field: '__name__', op: '==', value: 'h1' },
        {
          field: 'memberRoles.u1',
          op: 'in',
          value: expect.arrayContaining(['admin', 'editor', 'author', 'viewer']),
        },
      ])
    })

    it('holds `ready` while the server is being asked', () => {
      mockConfirmHost.mockReturnValue(new Promise(() => undefined))
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)

      expect(result.current.ready).toBe(false)
    })

    it('an ask that fails is an error with a retry, never a clean empty', async () => {
      mockConfirmHost.mockRejectedValue(new Error('offline'))
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)

      await waitFor(() => expect(result.current.ready).toBe(true))
      expect(result.current.hosts).toEqual([])
      expect(result.current.error).toBe(true)
    })

    it('stays an error when the cache repeats itself after a failed ask', async () => {
      mockConfirmHost.mockRejectedValue(new Error('offline'))
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)
      await waitFor(() => expect(result.current.error).toBe(true))

      emitHost('h1', null)
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      await waitFor(() => expect(result.current.ready).toBe(true))
      expect(result.current.error).toBe(true)
      expect(mockConfirmHost).toHaveBeenCalledTimes(1)
    })

    it('asks once per attempt and keeps the answer over a repeated tombstone', async () => {
      serverHas('h1', { subdomain: 'shop' })
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)
      await waitFor(() => expect(result.current.hosts).toHaveLength(1))

      emitHost('h1', null)
      await waitFor(() => expect(result.current.hosts).toHaveLength(1))
      expect(mockConfirmHost).toHaveBeenCalledTimes(1)

      // The healed cache's own document then takes over.
      emitHost('h1', { subdomain: 'shop', name: 'Shop' })
      await waitFor(() =>
        expect(result.current.hosts).toEqual([
          { $id: 'h1', subdomain: 'shop', name: 'Shop' },
        ]),
      )
    })

    it('asks again on a retry', async () => {
      mockConfirmHost.mockRejectedValue(new Error('offline'))
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)
      await waitFor(() => expect(result.current.error).toBe(true))

      serverHas('h1', { subdomain: 'shop' })
      act(() => result.current.retry())
      emitMemberships([{ id: 'h1', orgId: 'org1' }])
      emitHost('h1', null)
      await waitFor(() => expect(result.current.hosts).toHaveLength(1))
      expect(result.current.error).toBe(false)
      expect(mockConfirmHost).toHaveBeenCalledTimes(2)
    })
  })

  it('stops listening to a host that leaves the membership list', async () => {
    const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
    emitMemberships([
      { id: 'h1', orgId: 'org1' },
      { id: 'h2', orgId: 'org1' },
    ])
    emitHost('h1', { subdomain: 'shop' })
    emitHost('h2', { subdomain: 'blog' })
    await waitFor(() => expect(result.current.hosts).toHaveLength(2))

    emitMemberships([{ id: 'h1', orgId: 'org1' }])
    await waitFor(() => expect(result.current.hosts).toHaveLength(1))
    expect(mockHostHandlers.has('h2')).toBe(false)
  })

  it('flags error (not a clean empty) once listen retries are exhausted', () => {
    jest.useFakeTimers()
    try {
      const { result } = renderHook(() => useOrgHosts(firestore, 'u1', 'org1'))
      act(() => {
        for (let i = 0; i < 15; i += 1) {
          mockMembershipHandlers[mockMembershipHandlers.length - 1].onError()
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
