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
 * `confirmDisappearances` on `useFirestoreCollection` (AGL-1196).
 *
 * Some queries cannot avoid a mutable predicate: the scoped `datasets` reads
 * are gated on `visibleTo`, and the rule REQUIRES that constraint for anyone
 * who is not org-wide, so the AGL-1190 trick of dropping the `where` does not
 * apply. Those queries can therefore still tombstone a document, and this
 * option repairs it after the fact.
 *
 * It is opt-in precisely because the repair costs a server read. The first
 * case below is the one that protects the other 89 call sites.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { useFirestoreCollection } from './use-firestore-collection'

type Handler = { onNext: (snap: unknown) => void; onError: () => void }
let mockHandlers: Handler[] = []
const mockGetDocsFromServer = jest.fn()

// A partial mock is enough now that the hook is imported directly. Through
// the `@aglyn/tenant-feature-instance` barrel it would NOT be: that barrel
// reaches `Timestamp`, which still `extends` the Firestore class, so the
// import itself throws unless the real module is spread in first (AGL-1207).
jest.mock('firebase/firestore', () => ({
  onSnapshot: (
    _q: unknown,
    onNext: (snap: unknown) => void,
    onError: () => void,
  ) => {
    mockHandlers.push({ onNext, onError })
    return jest.fn()
  },
  getDocsFromServer: (q: unknown) => mockGetDocsFromServer(q),
}))

const snap = (ids: string[], fromCache = false) => ({
  empty: ids.length === 0,
  docs: ids.map((id) => ({ id, data: () => ({ name: id }) })),
  // Real snapshots always carry this; the hook reads it to publish
  // `fromCache` (AGL-1066).
  metadata: { fromCache, hasPendingWrites: false },
})

const emit = (ids: string[]) =>
  act(() => mockHandlers[mockHandlers.length - 1].onNext(snap(ids)))

const buildQuery = () => ({}) as never

describe('useFirestoreCollection confirmDisappearances (AGL-1196)', () => {
  beforeEach(() => {
    mockHandlers = []
    mockGetDocsFromServer.mockReset()
    mockGetDocsFromServer.mockResolvedValue(snap([]))
  })

  /**
   * The guard for every call site that did NOT opt in. A disappearance must
   * cost nothing extra by default — most queries either have no predicate or
   * key on `documentId()`, and cannot produce this fault at all.
   */
  it('does nothing extra by default', async () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )
    emit(['a', 'b'])
    await waitFor(() => expect(result.current.data).toHaveLength(2))

    emit(['a'])
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(mockGetDocsFromServer).not.toHaveBeenCalled()
  })

  it('confirms a document that vanishes, and restores a tombstoned one', async () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], {
        idField: '$id',
        confirmDisappearances: true,
      }),
    )
    emit(['a', 'b'])
    await waitFor(() => expect(result.current.data).toHaveLength(2))

    // `b` is still on the server — the live result was tombstoned.
    mockGetDocsFromServer.mockResolvedValue(snap(['a', 'b']))
    emit(['a'])

    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('success')
  })

  it('confirms a genuine removal once, then stops re-reading', async () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], {
        idField: '$id',
        confirmDisappearances: true,
      }),
    )
    emit(['a', 'b'])
    await waitFor(() => expect(result.current.data).toHaveLength(2))

    // The server agrees `b` is gone.
    mockGetDocsFromServer.mockResolvedValue(snap(['a']))
    emit(['a'])
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)

    // Every later snapshot still omits it; without `confirmedGone` this would
    // bill a server read on each one, forever.
    emit(['a'])
    emit(['a'])
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1)
  })

  it('falls back to the live result when the confirm fails', async () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], {
        idField: '$id',
        confirmDisappearances: true,
      }),
    )
    emit(['a', 'b'])
    await waitFor(() => expect(result.current.data).toHaveLength(2))

    mockGetDocsFromServer.mockRejectedValue(new Error('offline'))
    emit(['a'])

    // It must have TRIED — without this the assertions below are satisfied by
    // the heal being disabled entirely, which is the same observable outcome.
    await waitFor(() => expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1))
    // A possibly-short list beats an error state on a browse surface.
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.status).toBe('success')
    expect(result.current.error).toBeUndefined()
  })
})

/**
 * The retry/backoff, which had no test of its own until AGL-1206 gave this
 * library a runner.
 *
 * It exists because of AGL-216/217: right after sign-in `useUser()` can report
 * a signed-in user a beat before Firestore's credential provider has attached
 * the ID token, so the first listen hits a transient `permission-denied`.
 * reactfire's cached Observable terminates on that first error and replays it
 * forever, even across remounts — which is why this hook opens a genuinely
 * FRESH `onSnapshot` each attempt rather than resubscribing to anything.
 */
describe('useFirestoreCollection retry (AGL-216/217)', () => {
  const RETRY_DELAY_MS = 400
  const MAX_RETRIES = 5

  beforeEach(() => {
    mockHandlers = []
    mockGetDocsFromServer.mockReset()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  it('opens a FRESH listener per attempt, and recovers once the token lands', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )
    expect(mockHandlers).toHaveLength(1)

    // The post-sign-in denial.
    act(() => {
      mockHandlers[mockHandlers.length - 1].onError()
      jest.advanceTimersByTime(RETRY_DELAY_MS)
    })

    // A NEW registration, not a resubscribe to the terminated one. This is the
    // whole reason the hook does not use reactfire here.
    expect(mockHandlers).toHaveLength(2)
    expect(result.current.status).not.toBe('error')

    emit(['a'])
    expect(result.current.status).toBe('success')
    expect(result.current.data).toHaveLength(1)
  })

  it('surfaces error only once the retry budget is spent', () => {
    const { result } = renderHook(() =>
      useFirestoreCollection(buildQuery, [], { idField: '$id' }),
    )

    act(() => {
      for (let i = 0; i < MAX_RETRIES; i += 1) {
        mockHandlers[mockHandlers.length - 1].onError()
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })
    // Still trying at the budget boundary — a premature error here is what
    // turns a token race into a broken page.
    expect(result.current.status).not.toBe('error')

    act(() => mockHandlers[mockHandlers.length - 1].onError())
    expect(result.current.status).toBe('error')
  })
})
