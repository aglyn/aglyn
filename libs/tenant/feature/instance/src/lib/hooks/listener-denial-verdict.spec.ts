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
 * `serverDenied` on the two DOCUMENT listeners (AGL-1066).
 *
 * `use-firestore-collection-cached-retry.spec.ts` carries the mechanism and
 * the argument; this pins that the other two hooks reach the same verdict,
 * because a signal that only one of three hooks publishes is a signal no
 * consumer can rely on.
 *
 * `helpers/use-doc` matters most and had nothing at all: it is the hook
 * behind `useHost`/`useScreenVersion`/`useLayoutVersion`/`useComponentVersion`
 * /`useHostTemplate`, so it is what every besigner editor reads through — the
 * surfaces a wrong verdict would blank.
 */

import { act, renderHook } from '@testing-library/react'
import { useFirestoreDoc } from './use-firestore-doc'
import { useDocData } from './helpers/use-doc'
import { setFirestoreSessionReporters } from './firestore-denial-reporter'

type Handler = {
  onNext: (snap: unknown) => void
  onError: (err?: { code?: string }) => void
}
let mockHandlers: Handler[] = []

jest.mock('firebase/firestore', () => ({
  onSnapshot: (
    _ref: unknown,
    onNext: (snap: unknown) => void,
    onError: () => void,
  ) => {
    mockHandlers.push({ onNext, onError })
    return jest.fn()
  },
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5
const REFUSED_RETRY_DELAY_MS = 5_000

const snapshot = (fromCache: boolean) => ({
  id: 'doc',
  exists: () => true,
  data: () => ({ name: fromCache ? 'stale' : 'live' }),
  metadata: { fromCache, hasPendingWrites: false },
})

const denied = { code: 'permission-denied' }

/** Enough of a `DocumentReference` for `useDocData`'s deps and the mock. */
const docRef = { firestore: {}, path: 'orgs/o/hosts/h' } as never

/**
 * Both hooks, driven identically. Each entry renders one and returns the
 * `serverDenied` the caller sees.
 */
const subjects: Array<[string, () => { serverDenied: boolean }]> = [
  ['useFirestoreDoc', () => useFirestoreDoc(() => docRef, [])],
  ['useDocData', () => useDocData(docRef)],
]

describe.each(subjects)('%s serverDenied (AGL-1066)', (_name, useSubject) => {
  beforeEach(() => {
    mockHandlers = []
    jest.useFakeTimers()
    // The doc hook reports into `session-health`; keep that off the table so
    // these assertions are about the verdict only.
    setFirestoreSessionReporters(null)
  })
  afterEach(() => jest.useRealTimers())

  const denyCycles = (count: number, err: { code?: string } = denied) =>
    act(() => {
      for (let i = 0; i < count; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        // The persistent cache answers first, and only then does the server
        // refuse — the emission order that refunds `attempt` forever.
        handler.onNext(snapshot(true))
        handler.onError(err)
        jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS)
      }
    })

  it('denies after a budget of refusals the cache kept hiding', () => {
    const { result } = renderHook(useSubject)

    denyCycles(MAX_RETRIES - 1)
    expect(result.current.serverDenied).toBe(false)

    denyCycles(1)
    expect(result.current.serverDenied).toBe(true)
  })

  /**
   * The positive control. Every healthy load emits from cache before the
   * server answers; if that could deny, this would fire on every page.
   */
  it('never denies on a healthy from-cache-then-server load', () => {
    const { result } = renderHook(useSubject)

    act(() => mockHandlers[mockHandlers.length - 1].onNext(snapshot(true)))
    expect(result.current.serverDenied).toBe(false)

    act(() => mockHandlers[mockHandlers.length - 1].onNext(snapshot(false)))
    expect(result.current.serverDenied).toBe(false)

    act(() => jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS * 10))
    expect(mockHandlers).toHaveLength(1)
  })

  /** A server answer is the only thing that clears it, and it always does. */
  it('clears the moment the server answers', () => {
    const { result } = renderHook(useSubject)

    denyCycles(MAX_RETRIES)
    expect(result.current.serverDenied).toBe(true)

    act(() => mockHandlers[mockHandlers.length - 1].onNext(snapshot(false)))
    expect(result.current.serverDenied).toBe(false)
  })

  /** Offline yields `unavailable`, never a refusal. Nothing here may fire. */
  it('is inert offline', () => {
    const { result } = renderHook(useSubject)

    denyCycles(MAX_RETRIES * 3, { code: 'unavailable' })
    expect(result.current.serverDenied).toBe(false)
  })

  /**
   * The budget itself is untouched: the fast cadence still covers the whole
   * AGL-216/217 token race before anything slows down.
   */
  it('keeps the fast cadence until the streak outlives the budget', () => {
    renderHook(useSubject)

    act(() => {
      for (let i = 0; i < MAX_RETRIES; i += 1) {
        const handler = mockHandlers[mockHandlers.length - 1]
        handler.onNext(snapshot(true))
        handler.onError(denied)
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })
    expect(mockHandlers).toHaveLength(MAX_RETRIES + 1)
  })
})
