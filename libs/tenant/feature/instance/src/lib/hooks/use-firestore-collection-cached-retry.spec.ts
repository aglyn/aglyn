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
 * What a stale session actually looks like through a listener (AGL-1066).
 *
 * `use-firestore-collection.spec.ts` covers the retry budget when the listen
 * is denied outright: five failures, then `status: 'error'`. That is the
 * MEMORY-cache shape, and it is not the shape production runs.
 *
 * Production configures `persistentLocalCache` (see `firebase-services`), and
 * a listener opened against a cache that holds this query emits a from-cache
 * snapshot FIRST, then discovers the server has refused it. The success
 * callback resets `attempt` to 0. So every retry is handed back its whole
 * budget by the cached emission that precedes the denial, and the budget is
 * never spent.
 *
 * That is the AGL-1062 asymmetry, in one mechanism: one-shot reads bypass the
 * cache, exhaust five retries and report themselves to `session-health`;
 * listeners never exhaust anything and keep reporting `success` over data of
 * unbounded age.
 */

import { act, renderHook } from '@testing-library/react'
import { useFirestoreCollection } from './use-firestore-collection'
import {
  DENIAL_STREAK_TO_REPORT,
  setFirestoreSessionReporters,
} from './firestore-denial-reporter'

type Handler = {
  onNext: (snap: unknown) => void
  onError: (err?: { code?: string }) => void
}
let mockHandlers: Handler[] = []

jest.mock('firebase/firestore', () => ({
  onSnapshot: (
    _q: unknown,
    onNext: (snap: unknown) => void,
    onError: () => void,
  ) => {
    mockHandlers.push({ onNext, onError })
    return jest.fn()
  },
  getDocsFromServer: jest.fn(),
}))

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

/** What IndexedDB still holds for this query — unconfirmed by definition. */
const cached = {
  empty: false,
  docs: [{ id: 'stale', data: () => ({ name: 'stale' }) }],
  metadata: { fromCache: true, hasPendingWrites: false },
}

const buildQuery = () => ({}) as never

describe('useFirestoreCollection under persistentLocalCache (AGL-1066)', () => {
  beforeEach(() => {
    mockHandlers = []
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  /**
   * One denial cycle as production experiences it: the cache answers, then
   * the server refuses. Ten times the retry budget goes by without the hook
   * ever reaching the error state the budget exists to produce.
   */
  it('never spends its retry budget while the cache can answer', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    const CYCLES = MAX_RETRIES * 10
    act(() => {
      for (let i = 0; i < CYCLES; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        // The persistent cache answers immediately...
        handler.onNext(cached)
        // ...and only then does the server refuse the listen.
        handler.onError()
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })

    // A fresh listener was opened for every single cycle. Nothing bounded it.
    expect(mockHandlers).toHaveLength(CYCLES + 1)
    // And the page still believes it is looking at live data.
    expect(result.current.status).toBe('success')
    expect(result.current.error).toBeUndefined()
    expect(result.current.data).toHaveLength(1)
    // `fromCache` is the one field that tells the truth here, which is why
    // write guards key on it rather than on `status` (AGL-1066).
    expect(result.current.fromCache).toBe(true)
  })

  /**
   * The signal has to CLEAR, or it is just a permanent refusal wearing a
   * freshness costume. A server snapshot after the storm must hand the page
   * back — no dismissal, no timeout, no re-auth.
   */
  it('clears fromCache the moment a server snapshot lands', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    act(() => {
      const handler = mockHandlers[mockHandlers.length - 1]
      handler.onNext(cached)
      handler.onError()
      jest.advanceTimersByTime(RETRY_DELAY_MS)
    })
    expect(result.current.fromCache).toBe(true)

    act(() =>
      mockHandlers[mockHandlers.length - 1].onNext({
        empty: false,
        docs: [{ id: 'live', data: () => ({ name: 'live' }) }],
        metadata: { fromCache: false, hasPendingWrites: false },
      }),
    )
    expect(result.current.fromCache).toBe(false)
    expect(result.current.status).toBe('success')
  })

  /**
   * The contrast that makes the point: identical denials, no cached emission
   * between them, and the budget is spent in five. The ONLY difference
   * between a page that reports the fault and a page that hides it is
   * whether IndexedDB happened to hold that query.
   */
  it('spends it in five when the cache is empty for that query', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    act(() => {
      for (let i = 0; i <= MAX_RETRIES; i += 1) {
        mockHandlers[mockHandlers.length - 1].onError()
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })

    expect(result.current.status).toBe('error')
  })
})

/**
 * Listener-side reporting into `session-health` (AGL-1066).
 *
 * The verdict used to be fed only by one-shot reads, which the console
 * barely uses — so on listener-only pages it could never be reached. These
 * pin the three properties that make listener reporting safe to trust.
 */
describe('useFirestoreCollection denial reporting (AGL-1066)', () => {
  let reported: Array<string | undefined> = []
  let serverReads = 0

  beforeEach(() => {
    mockHandlers = []
    reported = []
    serverReads = 0
    jest.useFakeTimers()
    setFirestoreSessionReporters({
      onDenied: (collection) => reported.push(collection),
      onServerRead: () => (serverReads += 1),
    })
  })
  afterEach(() => {
    jest.useRealTimers()
    setFirestoreSessionReporters(null)
  })

  const denied = { code: 'permission-denied' }

  const denyCycles = (count: number, err: { code?: string } = denied) =>
    act(() => {
      for (let i = 0; i < count; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        handler.onNext(cached)
        handler.onError(err)
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })

  it('reports once a refusal streak survives the budget, and only once', () => {
    renderHook(() => useFirestoreCollection(buildQuery, [], { idField: '$id' }))

    denyCycles(DENIAL_STREAK_TO_REPORT - 1)
    // Below the bar this is still indistinguishable from the AGL-216
    // post-sign-in token race, which resolves in well under two seconds.
    expect(reported).toHaveLength(0)

    denyCycles(1)
    expect(reported).toHaveLength(1)

    // A dead session denies forever; the banner must not be re-armed on a
    // timer by one listener shouting every 400ms.
    denyCycles(20)
    expect(reported).toHaveLength(1)
  })

  /**
   * The guarantee the whole mechanism rests on. A lost network produces no
   * error callback at all, but if some other code ever does surface one, it
   * carries `unavailable` — and that must not be read as a dead session.
   */
  it('ignores anything that is not permission-denied', () => {
    renderHook(() => useFirestoreCollection(buildQuery, [], { idField: '$id' }))
    denyCycles(DENIAL_STREAK_TO_REPORT * 3, { code: 'unavailable' })
    expect(reported).toHaveLength(0)
  })

  /**
   * A server snapshot is proof the session can read. Without this reset a
   * page that recovered would stay one refusal away from re-accusing a
   * perfectly healthy session for the rest of its life.
   */
  it('re-arms only after the SERVER answers', () => {
    renderHook(() => useFirestoreCollection(buildQuery, [], { idField: '$id' }))

    denyCycles(DENIAL_STREAK_TO_REPORT)
    expect(reported).toHaveLength(1)

    act(() =>
      mockHandlers[mockHandlers.length - 1].onNext({
        empty: true,
        docs: [],
        metadata: { fromCache: false, hasPendingWrites: false },
      }),
    )
    // The cached emissions inside `denyCycles` must NOT have done this —
    // only the server answer above did.
    denyCycles(DENIAL_STREAK_TO_REPORT)
    expect(reported).toHaveLength(2)
  })

  /**
   * The other half of the seam, and the reason listener reporting is safe to
   * enable at all: a scoped collaborator (AGL-1041) has collections they may
   * not read BY DESIGN, and could otherwise accumulate two denied
   * collections and be told their session is dead. Their other listens keep
   * being answered by the server, and one such answer clears the evidence.
   * A genuinely dead session has no answer to offer.
   */
  it('reports a SERVER answer, and never a cached one', () => {
    renderHook(() => useFirestoreCollection(buildQuery, [], { idField: '$id' }))

    // Twenty cached emissions are not evidence of anything.
    denyCycles(4)
    expect(serverReads).toBe(0)

    act(() =>
      mockHandlers[mockHandlers.length - 1].onNext({
        empty: false,
        docs: [{ id: 'live', data: () => ({ name: 'live' }) }],
        metadata: { fromCache: false, hasPendingWrites: false },
      }),
    )
    expect(serverReads).toBe(1)
  })
})
