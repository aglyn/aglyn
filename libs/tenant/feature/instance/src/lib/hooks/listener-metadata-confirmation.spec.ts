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
 * `fromCache` must CLEAR when the server confirms data the cache already had
 * (AGL-2486).
 *
 * ## Why this needs a faithful double rather than a plain stub
 *
 * The bug is not in our callback — it is that the SDK never CALLS it. A stub
 * that simply invokes `onNext` with `fromCache: false` would pass whether or
 * not the hook subscribes correctly, which proves nothing (a green check only
 * proves what it reads).
 *
 * So `emitToListener` below reimplements the SDK's own event-raising rule,
 * copied from `@firebase/firestore` 4.17.0 `QueryListener.shouldRaiseEvent`:
 *
 * ```js
 * if (snap.docChanges.length > 0) return true;
 * const pendingChanged = this.snap && this.snap.hasPendingWrites !== snap.hasPendingWrites;
 * return !(!snap.syncStateChanged && !pendingChanged)
 *   && true === this.options.includeMetadataChanges;
 * ```
 *
 * A cache→server confirmation of UNCHANGED data has no doc changes and no
 * pending-write transition — only `syncStateChanged` — so the double drops it
 * unless the subscriber asked for metadata changes. That makes the assertion
 * below fail for the real reason: remove
 * `CONFIRMABLE_LISTEN_OPTIONS` from the hook and the confirmation is
 * swallowed exactly as it was in production, and these tests redden.
 *
 * Verified against a real browser + real SDK + `persistentLocalCache` on
 * 2026-08-24 — see `helpers/listen-options.ts` for the measurements.
 */

import { act, renderHook } from '@testing-library/react'

type Listener = {
  options: { includeMetadataChanges?: boolean } | undefined
  onNext: (snapshot: unknown) => void
  /** The last snapshot actually DELIVERED, for the metadata compare. */
  delivered: { fromCache: boolean; hasPendingWrites: boolean } | null
}

let listeners: Listener[] = []

jest.mock('firebase/firestore', () => ({
  onSnapshot: (_target: unknown, ...rest: unknown[]) => {
    // Mirror the real overload: (target, onNext, onError?) or
    // (target, options, onNext, onError?).
    const options =
      typeof rest[0] === 'function'
        ? undefined
        : (rest.shift() as Listener['options'])
    listeners.push({
      options,
      onNext: rest[0] as Listener['onNext'],
      delivered: null,
    })
    return jest.fn()
  },
  getDocsFromServer: jest.fn(),
}))

/**
 * Lets the mutation test below take the fix away at the MODULE the hooks
 * import it from, without `jest.resetModules()` — which would reload React
 * itself and hand the hook a different copy than the renderer.
 *
 * The getter is consulted at each `subscribe()`, not at import, so flipping
 * the flag changes the next subscription only.
 */
let mockSuppressListenOptions = false

jest.mock('./helpers/listen-options', () => {
  const actual = jest.requireActual('./helpers/listen-options')
  return {
    get CONFIRMABLE_LISTEN_OPTIONS() {
      return mockSuppressListenOptions
        ? undefined
        : actual.CONFIRMABLE_LISTEN_OPTIONS
    },
  }
})

jest.mock('./firestore-denial-reporter', () => ({
  DENIAL_STREAK_TO_REPORT: 3,
  denialLabelForQuery: () => 'label',
  refusedRetryDelayMs: () => 1000,
  reportFirestoreDenial: jest.fn(),
  reportFirestoreServerRead: jest.fn(),
  subscribeFirestoreSessionHeal: () => jest.fn(),
}))

/** A document snapshot the SDK would build for `hosts/h/screens/s`. */
const docSnapshot = (fromCache: boolean, data: Record<string, unknown>) => ({
  metadata: { fromCache, hasPendingWrites: false },
  exists: () => true,
  data: () => data,
  id: 'screen-1',
})

const querySnapshot = (
  fromCache: boolean,
  docs: Record<string, unknown>[],
) => ({
  metadata: { fromCache, hasPendingWrites: false },
  empty: docs.length === 0,
  docs: docs.map((data, i) => ({ id: `d${i}`, data: () => data })),
})

/**
 * Deliver a snapshot through the SDK's raise-or-drop rule.
 *
 * `dataChanged` stands in for `snap.docChanges.length > 0`.
 */
function emitToListener(
  listener: Listener,
  snapshot: { metadata: { fromCache: boolean; hasPendingWrites: boolean } },
  dataChanged: boolean,
) {
  const previous = listener.delivered
  // The first event goes through `shouldRaiseInitialEvent`, which raises a
  // cached snapshot that has documents — hence `!previous` raises outright.
  const syncStateChanged =
    !!previous && previous.fromCache !== snapshot.metadata.fromCache
  const pendingChanged =
    !!previous &&
    previous.hasPendingWrites !== snapshot.metadata.hasPendingWrites
  const raise =
    !previous || dataChanged
      ? true
      : (syncStateChanged || pendingChanged) &&
        listener.options?.includeMetadataChanges === true
  if (!raise) return false
  listener.delivered = {
    fromCache: snapshot.metadata.fromCache,
    hasPendingWrites: snapshot.metadata.hasPendingWrites,
  }
  act(() => listener.onNext(snapshot))
  return true
}

beforeEach(() => {
  listeners = []
  mockSuppressListenOptions = false
})

describe('a warm cache the server agrees with (AGL-2486)', () => {
  it('clears `fromCache` on the doc hook when the server confirms unchanged data', async () => {
    const { useFirestoreDoc } = await import('./use-firestore-doc')
    const { result } = renderHook(() =>
      useFirestoreDoc<{ title: string }>(() => ({}) as never, []),
    )

    expect(listeners).toHaveLength(1)
    // 1. The cache answers first, with the document the author is editing.
    emitToListener(listeners[0], docSnapshot(true, { title: 'Home' }), true)
    expect(result.current.fromCache).toBe(true)

    // 2. The server confirms the SAME data. No doc change — metadata only.
    //    This is the event that used to be swallowed.
    const raised = emitToListener(
      listeners[0],
      docSnapshot(false, { title: 'Home' }),
      false,
    )

    expect(raised).toBe(true)
    // The guard reads exactly this. True here means every guarded save on the
    // page is refused forever.
    expect(result.current.fromCache).toBe(false)
  })

  it('clears `fromCache` on the collection hook when the server confirms unchanged rows', async () => {
    const { useFirestoreCollection } = await import('./use-firestore-collection')
    const { result } = renderHook(() =>
      useFirestoreCollection<{ title: string }>(() => ({}) as never, []),
    )

    expect(listeners).toHaveLength(1)
    emitToListener(listeners[0], querySnapshot(true, [{ title: 'Home' }]), true)
    expect(result.current.fromCache).toBe(true)

    const raised = emitToListener(
      listeners[0],
      querySnapshot(false, [{ title: 'Home' }]),
      false,
    )

    expect(raised).toBe(true)
    expect(result.current.fromCache).toBe(false)
  })

  it('subscribes with includeMetadataChanges so the SDK will raise that event', async () => {
    const { useFirestoreDoc } = await import('./use-firestore-doc')
    renderHook(() => useFirestoreDoc(() => ({}) as never, []))
    expect(listeners[0].options).toEqual({ includeMetadataChanges: true })
  })

  /**
   * The mutation test: take the fix away and watch the bug come back.
   *
   * The option is replaced at the MODULE the hook imports it from, so the
   * hook's own code path is untouched and the failure is the production one —
   * the SDK double drops the confirmation, `setFromCache(false)` never runs,
   * and the guard refuses forever. Without this, the assertions above would
   * pass just as happily against a stub that always delivered.
   */
  it('LATCHES `fromCache` true — forever — when the option is taken away', async () => {
    mockSuppressListenOptions = true
    const { useFirestoreDoc } = await import('./use-firestore-doc')
    const { result } = renderHook(() =>
      useFirestoreDoc<{ title: string }>(() => ({}) as never, []),
    )

    emitToListener(listeners[0], docSnapshot(true, { title: 'Home' }), true)
    const raised = emitToListener(
      listeners[0],
      docSnapshot(false, { title: 'Home' }),
      false,
    )

    // The server answered and agreed. The SDK never told the hook.
    expect(raised).toBe(false)
    expect(result.current.fromCache).toBe(true)
    expect(listeners[0].options).toBeUndefined()
  })
})
