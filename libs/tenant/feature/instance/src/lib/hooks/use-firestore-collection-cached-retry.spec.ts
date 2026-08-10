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
 *
 * ## Why `status` is still `'success'` below
 *
 * The correction — gating `attempt = 0` on `!snapshot.metadata.fromCache` —
 * is one line, and it is NOT landed. Making a denied listen reach
 * `status: 'error'` also makes it reach every consumer's error branch, and
 * two of those blank a working screen (the besigner editors swap the canvas
 * for "Not found"; the host setup Theme tab renders nothing). Worse, the
 * budget is two seconds and the error branch stops retrying for good, while
 * the heal — an AGL-664 in-place re-auth — takes as long as a human takes to
 * type a password. Nothing re-subscribes, so every listener would have given
 * up before the session came back.
 *
 * So the verdict is carried on `serverDenied` first, consumers migrate onto
 * it, and `status` moves last. These tests pin BOTH halves: the corrected
 * verdict fires, and `status` does not move yet. When the flip lands, the
 * `status` assertions here are the ones that change — deliberately.
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
/** The slow cadence a refusal that outlives the budget falls back to. */
const REFUSED_RETRY_DELAY_MS = 2_000

/** What IndexedDB still holds for this query — unconfirmed by definition. */
const cached = {
  empty: false,
  docs: [{ id: 'stale', data: () => ({ name: 'stale' }) }],
  metadata: { fromCache: true, hasPendingWrites: false },
}

/** A snapshot the server actually answered. */
const live = {
  empty: false,
  docs: [{ id: 'live', data: () => ({ name: 'live' }) }],
  metadata: { fromCache: false, hasPendingWrites: false },
}

const denied = { code: 'permission-denied' }

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
        handler.onError(denied)
        jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS)
      }
    })

    // A fresh listener was opened for every single cycle. `attempt` bounded
    // nothing — this is the defect, and it is still here.
    expect(mockHandlers).toHaveLength(CYCLES + 1)
    // STILL the broken half, on purpose: see the file header. Fifty refusals
    // in and the page's own status says it is looking at live data.
    expect(result.current.status).toBe('success')
    expect(result.current.error).toBeUndefined()
    expect(result.current.data).toHaveLength(1)
    // The two fields that tell the truth. `fromCache` says "unconfirmed",
    // which is also true offline and true of a healthy first snapshot;
    // `serverDenied` says "refused", which is what `status` would say if the
    // budget were spendable. Write guards key on the former; anything asking
    // "will this ever refresh?" wants the latter.
    expect(result.current.fromCache).toBe(true)
    expect(result.current.serverDenied).toBe(true)
  })

  /**
   * The corrected verdict has to arrive on the SAME schedule the budget
   * would have produced — a signal that needs fifty refusals to admit a dead
   * session is not a substitute for one that needs five.
   */
  it('denies after a budget of refusals, not before', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    const cycle = () =>
      act(() => {
        const handler = mockHandlers[mockHandlers.length - 1]
        handler.onNext(cached)
        handler.onError(denied)
        jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS)
      })

    for (let i = 0; i < MAX_RETRIES - 1; i += 1) cycle()
    // Below the bar this is indistinguishable from the AGL-216/217
    // post-sign-in token race, which resolves in well under two seconds.
    expect(result.current.serverDenied).toBe(false)

    cycle()
    expect(result.current.serverDenied).toBe(true)
  })

  /**
   * A dead session denies forever, and the old loop answered by opening a
   * fresh listener every 400ms for as long as it lasted. It must keep
   * retrying — that is the only thing that heals the page after an AGL-664
   * in-place re-auth — but not at that price.
   */
  it('backs the doomed loop off without ever abandoning it', () => {
    renderHook(() => useFirestoreCollection(buildQuery, [], { idField: '$id' }))

    act(() => {
      for (let i = 0; i <= MAX_RETRIES; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        handler.onNext(cached)
        handler.onError(denied)
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })
    const opened = mockHandlers.length

    // The last refusal scheduled the slow cadence, so a fast-cadence tick
    // reopens nothing...
    act(() => jest.advanceTimersByTime(RETRY_DELAY_MS))
    expect(mockHandlers).toHaveLength(opened)

    // ...but the listener is not abandoned, and a server answer at any later
    // moment still hands the page back.
    act(() => jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS))
    expect(mockHandlers).toHaveLength(opened + 1)
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

    act(() => mockHandlers[mockHandlers.length - 1].onNext(live))
    expect(result.current.fromCache).toBe(false)
    expect(result.current.status).toBe('success')
  })

  /**
   * THE positive control, and the one that breaks everything if it is wrong.
   *
   * Every healthy load emits from cache first — latency compensation — and
   * then again from the server. If a from-cache emission could deny, or could
   * consume the budget, this would fire on literally every page in the
   * console. It must cost nothing.
   */
  it('a healthy from-cache-then-server load never denies', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    act(() => mockHandlers[mockHandlers.length - 1].onNext(cached))
    expect(result.current.status).toBe('success')
    expect(result.current.serverDenied).toBe(false)
    expect(result.current.fromCache).toBe(true)

    act(() => mockHandlers[mockHandlers.length - 1].onNext(live))
    expect(result.current.status).toBe('success')
    expect(result.current.serverDenied).toBe(false)
    expect(result.current.fromCache).toBe(false)

    // No error, so nothing was ever rescheduled: one listener, start to
    // finish.
    act(() => jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS * 10))
    expect(mockHandlers).toHaveLength(1)
    expect(result.current.error).toBeUndefined()
  })

  /**
   * The second half of that control: a refusal storm SHORTER than the budget
   * — the AGL-216/217 token race — must leave no residue once the server
   * answers. Otherwise every sign-in would arm the verdict.
   */
  it('a token race that resolves leaves nothing armed', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    act(() => {
      for (let i = 0; i < MAX_RETRIES - 1; i += 1) {
        mockHandlers[mockHandlers.length - 1].onError(denied)
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })
    expect(result.current.serverDenied).toBe(false)

    act(() => mockHandlers[mockHandlers.length - 1].onNext(live))
    expect(result.current.status).toBe('success')
    expect(result.current.serverDenied).toBe(false)

    // And the streak was reset, not merely un-published: a second storm has
    // to earn the verdict from zero.
    act(() => {
      for (let i = 0; i < MAX_RETRIES - 1; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        handler.onNext(cached)
        handler.onError(denied)
        jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS)
      }
    })
    expect(result.current.serverDenied).toBe(false)
  })

  /**
   * Offline, which this must never touch. A lost network produces no error
   * callback at all — the listener just keeps serving cache — so the loop
   * below is already more than reality offers. Anything that does surface an
   * error carries `unavailable`, and that is not a dead session.
   */
  it('is inert offline', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    act(() => {
      for (let i = 0; i < MAX_RETRIES * 4; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        handler.onNext(cached)
        handler.onError({ code: 'unavailable' })
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })

    expect(result.current.serverDenied).toBe(false)
    expect(result.current.status).toBe('success')
    expect(result.current.data).toHaveLength(1)
    // And the cadence is untouched — every cycle reopened at 400ms.
    expect(mockHandlers).toHaveLength(MAX_RETRIES * 4 + 1)
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
        mockHandlers[mockHandlers.length - 1].onError(denied)
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })

    expect(result.current.status).toBe('error')
    expect(result.current.serverDenied).toBe(true)
    // The one path that already worked must keep its timing exactly: six
    // refusals, no cached emission to refund the budget, and the terminal
    // error at 2.4s. The slow cadence must never delay THIS.
    expect(mockHandlers).toHaveLength(MAX_RETRIES + 1)
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

  // Advances past the SLOW cadence a surviving refusal streak falls back to,
  // so every cycle genuinely reopens a listener whichever cadence is in force.
  const denyCycles = (count: number, err: { code?: string } = denied) =>
    act(() => {
      for (let i = 0; i < count; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        handler.onNext(cached)
        handler.onError(err)
        jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS)
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
