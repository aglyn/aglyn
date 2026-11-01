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
 * A listen that never hears from the server asks the client to recover
 * (AGL-3373).
 *
 * In the multi-tab wedge no tab is syncing: a listener over an empty cache
 * raises no first snapshot at all, and one over a warm cache never gets its
 * server confirmation. Both shared listener hooks arm a stall watch when they
 * subscribe and disarm it on the first SERVER-confirmed snapshot, on an error
 * and on cleanup. The double here counts the network cycle the recovery
 * performs; `firestore-stall-recovery.spec.ts` covers its guards.
 */

import { act, renderHook } from '@testing-library/react'

type Listener = {
  onNext: (snapshot: unknown) => void
  onError: (error: unknown) => void
}

let listeners: Listener[] = []
const mockDisableNetwork = jest.fn(() => Promise.resolve())
const mockEnableNetwork = jest.fn(() => Promise.resolve())

jest.mock('firebase/firestore', () => ({
  onSnapshot: (_target: unknown, ...rest: unknown[]) => {
    if (typeof rest[0] !== 'function') rest.shift()
    listeners.push({
      onNext: rest[0] as Listener['onNext'],
      onError: rest[1] as Listener['onError'],
    })
    return jest.fn()
  },
  getDocsFromServer: jest.fn(),
  disableNetwork: (...args: unknown[]) => mockDisableNetwork(...(args as [])),
  enableNetwork: (...args: unknown[]) => mockEnableNetwork(...(args as [])),
}))

jest.mock('./firestore-denial-reporter', () => ({
  DENIAL_STREAK_TO_REPORT: 3,
  denialLabelForQuery: () => 'label',
  scheduleRefusedReopen: () => () => undefined,
  reportFirestoreDenial: jest.fn(),
  reportFirestoreServerRead: jest.fn(),
  subscribeFirestoreSessionHeal: () => jest.fn(),
}))

import {
  FIRESTORE_STALL_MS,
  STALL_RECOVERY_COOLDOWN_MS,
} from './firebase/firestore-stall-recovery'
import { writeGuardedBySeed } from './helpers/guarded-seed-write'
import { useFirestoreCollection } from './use-firestore-collection'
import { useFirestoreDoc } from './use-firestore-doc'

const collectionSnapshot = (fromCache: boolean) => ({
  docs: [],
  docChanges: () => [],
  metadata: { fromCache, hasPendingWrites: false },
})
const docSnapshot = (fromCache: boolean) => ({
  exists: () => false,
  data: () => undefined,
  metadata: { fromCache, hasPendingWrites: false },
})

/** A fresh client per test, so one test's cooldown cannot mute the next. */
let firestore: object
const renderCollection = () =>
  renderHook(() =>
    useFirestoreCollection(() => ({ firestore }) as never, [firestore]),
  )
const renderDoc = () =>
  renderHook(() => useFirestoreDoc(() => ({ firestore }) as never, [firestore]))

describe.each([
  ['useFirestoreCollection', renderCollection, collectionSnapshot],
  ['useFirestoreDoc', renderDoc, docSnapshot],
] as const)('%s stall watch (AGL-3373)', (_name, render, snapshot) => {
  beforeEach(() => {
    jest.useFakeTimers()
    listeners = []
    firestore = {}
    mockDisableNetwork.mockClear()
    mockEnableNetwork.mockClear()
  })
  afterEach(() => jest.useRealTimers())

  it('asks the client to recover when no snapshot arrives at all', async () => {
    render()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS)
    })
    expect(mockDisableNetwork).toHaveBeenCalledWith(firestore)
    expect(mockEnableNetwork).toHaveBeenCalledWith(firestore)
  })

  it('asks too when only the cache ever answers', async () => {
    render()
    act(() => listeners[0].onNext(snapshot(true)))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS)
    })
    expect(mockDisableNetwork).toHaveBeenCalledTimes(1)
  })

  it('leaves a listen the server confirmed alone', async () => {
    render()
    act(() => listeners[0].onNext(snapshot(false)))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS * 2)
    })
    expect(mockDisableNetwork).not.toHaveBeenCalled()
  })

  it('treats a refusal as an answer, not a stall', async () => {
    render()
    act(() => listeners[0].onError({ code: 'permission-denied' }))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS * 2)
    })
    expect(mockDisableNetwork).not.toHaveBeenCalled()
  })

  it('disarms on unmount', async () => {
    const view = render()
    view.unmount()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS * 2)
    })
    expect(mockDisableNetwork).not.toHaveBeenCalled()
  })

  /**
   * The bug itself (AGL-4120): one slow listener beside listeners the server had
   * just confirmed cycled the network, which handed away the lease and put every
   * confirmed listener back on the cache.
   */
  it('leaves a slow listener alone while the server is answering its neighbour', async () => {
    render()
    render()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS - 1)
    })
    act(() => listeners[1].onNext(snapshot(false)))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1)
    })
    expect(mockDisableNetwork).not.toHaveBeenCalled()
  })

  it('rescues that listener once the client really has gone silent', async () => {
    render()
    render()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS - 1)
    })
    act(() => listeners[1].onNext(snapshot(false)))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS)
    })
    expect(mockDisableNetwork).not.toHaveBeenCalled()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS)
    })
    expect(mockDisableNetwork).toHaveBeenCalledTimes(1)
  })

  it('reaches a listener that mounts inside another recovery cooldown', async () => {
    render()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FIRESTORE_STALL_MS)
    })
    expect(mockDisableNetwork).toHaveBeenCalledTimes(1)

    render()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(
        STALL_RECOVERY_COOLDOWN_MS + FIRESTORE_STALL_MS,
      )
    })
    expect(mockDisableNetwork).toHaveBeenCalledTimes(2)
  })

  it('holds a save until the server confirms this listener, then runs it', async () => {
    const view = render()
    act(() => listeners[0].onNext(snapshot(true)))
    const write = jest.fn(async () => undefined)
    const saved = writeGuardedBySeed(
      { subject: 'record', fromCache: view.result.current.fromCache, checkSession: false },
      write,
    )
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()

    act(() => listeners[0].onNext(snapshot(false)))

    await expect(saved).resolves.toEqual({ ok: true })
    expect(write).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
