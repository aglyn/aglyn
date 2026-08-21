/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
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
 * `useOrgHosts` must tell a REFUSED read apart from an empty workspace
 * (AGL-1066, AGL-1062).
 *
 * ## Why the list paints and then empties
 *
 * `persistentLocalCache` answers a document listen from IndexedDB the moment
 * it is opened, and only afterwards does the server get a chance to refuse
 * the listen. So on a stale session every `hosts/{id}` listener fires once
 * with real, cached data — the sites render — and then fires its ERROR
 * callback. That callback resolved the host to `null`, which is the same
 * branch a host that does not exist takes, and `publish()` then called
 * `setError(false)` unconditionally. The hook's answer was
 * `{ hosts: [], ready: true, error: false }`: byte-identical to a brand-new
 * workspace, which is what let the page print "No sites yet".
 *
 * The mirror listen (`users/{uid}/hostMemberships`) had the opposite problem:
 * it DID latch `error` after exhausting its retries, but reported nothing to
 * `session-health`, so the collection whose denial is least ambiguous in the
 * whole console — its rule is `request.auth.uid == userId`, with no
 * `resource.data` term, so no scoped collaborator can be denied it BY DESIGN
 * (AGL-1041) — contributed no evidence to the AGL-1063 banner.
 */

import { act, renderHook, waitFor } from '@testing-library/react'

type Listener = {
  next: (snapshot: unknown) => void
  error: (error: unknown) => void
}

/** Every `hosts/{id}` listen the hook opened, keyed by document id. */
const mockHostListeners = new Map<string, Listener>()
/** The most recent `users/{uid}/hostMemberships` listen. */
let mockMembershipListener: Listener | null = null
/** How many times the hook re-subscribed the mirror after a refusal. */
let mockMembershipSubscribes = 0

const denied = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  })

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    type: 'collection',
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({
    type: 'document',
    path: segments.join('/'),
    id: segments[segments.length - 1],
  }),
  query: (ref: unknown) => ref,
  getDocsFromServer: jest.fn(async () => ({ docs: [] })),
  onSnapshot: (ref: any, next: any, error: any) => {
    const listener: Listener = { next, error }
    if (ref.type === 'collection') {
      mockMembershipSubscribes += 1
      mockMembershipListener = listener
    } else {
      mockHostListeners.set(ref.id, listener)
    }
    return () => undefined
  },
}))

import { useOrgHosts } from '../hooks/use-org-hosts'
import {
  __resetSessionHealth,
  getSessionHealth,
} from '../utils/session-health'

const { getDocsFromServer } = jest.requireMock('firebase/firestore')

/** A membership-mirror snapshot naming `ids`, all in scope and all admin. */
const mirror = (ids: string[]) => ({
  docs: ids.map((id) => ({
    id,
    data: () => ({ orgId: 'org-1', role: 'admin' }),
  })),
})

/** A cached `hosts/{id}` snapshot — what IndexedDB answers with. */
const cachedHost = (id: string) => ({
  exists: () => true,
  id,
  data: () => ({ displayName: `Site ${id}`, subdomain: id }),
})

/**
 * A STABLE instance. `useOrgHosts` keys its effect on the Firestore handle, so
 * a fresh `{}` per render tears down and re-opens every listen on every commit
 * — an infinite loop that looks like a hook bug and is a test bug.
 */
const FIRESTORE = {} as never

const mount = () => renderHook(() => useOrgHosts(FIRESTORE, 'u1', 'org-1'))

describe('useOrgHosts on a session the server refuses', () => {
  beforeEach(() => {
    mockHostListeners.clear()
    mockMembershipListener = null
    mockMembershipSubscribes = 0
    getDocsFromServer.mockReset()
    getDocsFromServer.mockResolvedValue(mirror([]))
    __resetSessionHealth()
  })

  it('reports an ERROR when every candidate host read is refused', async () => {
    const { result } = mount()

    // The mirror answers from cache: two sites this person holds.
    act(() => mockMembershipListener?.next(mirror(['site-a', 'site-b'])))
    await waitFor(() => expect(mockHostListeners.size).toBe(2))

    // Both host docs paint from the persistent cache — "it shows the sites".
    act(() => {
      mockHostListeners.get('site-a')?.next(cachedHost('site-a'))
      mockHostListeners.get('site-b')?.next(cachedHost('site-b'))
    })
    await waitFor(() => expect(result.current.hosts).toHaveLength(2))

    // Then the server refuses both listens — "then they disappear".
    act(() => {
      mockHostListeners.get('site-a')?.error(denied())
      mockHostListeners.get('site-b')?.error(denied())
    })
    await waitFor(() => expect(result.current.hosts).toHaveLength(0))

    // THE DEFECT. An empty list here means "we could not read your sites",
    // and nothing downstream can recover that fact if the hook drops it.
    expect(result.current.error).toBe(true)
  })

  it('keeps dropping ONE unreadable host without failing the list', async () => {
    const { result } = mount()

    act(() => mockMembershipListener?.next(mirror(['site-a', 'site-b'])))
    await waitFor(() => expect(mockHostListeners.size).toBe(2))

    // A stale mirror row is a real, by-design case (AGL-1190): the mirror is
    // a hint, the per-host read is the gate. One refusal among several is not
    // the dead-session signature and must not blank a list that loaded.
    act(() => {
      mockHostListeners.get('site-a')?.next(cachedHost('site-a'))
      mockHostListeners.get('site-b')?.error(denied())
    })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hosts).toHaveLength(1)
    expect(result.current.error).toBe(false)
  })

  it('reports a genuinely empty workspace as empty, never as an error', async () => {
    const { result } = mount()

    act(() => mockMembershipListener?.next(mirror([])))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.hosts).toHaveLength(0)
    // The negative control for the first test: a hook that simply latched
    // `error` on every empty list would satisfy it and fail here.
    expect(result.current.error).toBe(false)
  })

  it('feeds the refused mirror listen to session-health as evidence', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] })
    try {
      mount()

      // Exhaust the mirror listen's retry budget (MAX_RETRIES = 8).
      for (let attempt = 0; attempt <= 9; attempt += 1) {
        act(() => mockMembershipListener?.error(denied()))
        act(() => jest.advanceTimersByTime(500))
      }

      expect(mockMembershipSubscribes).toBeGreaterThan(1)
      expect(getSessionHealth().deniedCollections).toContain(
        'users/hostMemberships',
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('exposes a retry that re-opens the mirror listen', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] })
    try {
      const { result } = mount()

      for (let attempt = 0; attempt <= 9; attempt += 1) {
        act(() => mockMembershipListener?.error(denied()))
        act(() => jest.advanceTimersByTime(500))
      }
      expect(result.current.error).toBe(true)

      const before = mockMembershipSubscribes
      act(() => result.current.retry())
      act(() => jest.advanceTimersByTime(500))

      // A "Try again" button that re-renders the same failure is a dead end.
      expect(mockMembershipSubscribes).toBeGreaterThan(before)
    } finally {
      jest.useRealTimers()
    }
  })
})
