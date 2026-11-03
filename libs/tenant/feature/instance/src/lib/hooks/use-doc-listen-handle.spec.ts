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
 * `useDocData`'s listener, for a save that waits on it alone (AGL-4135).
 *
 * The host settings, the screen editors and every other `useHost`/`useScreen`
 * reader seed their forms from this hook, so its `listen` is what their
 * guarded saves name. The same three promises as the other two listener hooks
 * (`listener-stall-recovery.spec.ts`): a neighbour cannot refuse the save, the
 * handle follows a replaced listener, and a refusal is never a confirmation.
 */

import { act, renderHook } from '@testing-library/react'

type Handler = {
  onNext: (snapshot: unknown) => void
  onError: (error: unknown) => void
}
let mockHandlers: Handler[] = []

jest.mock('firebase/firestore', () => ({
  onSnapshot: (_target: unknown, ...rest: unknown[]) => {
    if (typeof rest[0] !== 'function') rest.shift()
    mockHandlers.push({
      onNext: rest[0] as Handler['onNext'],
      onError: rest[1] as Handler['onError'],
    })
    return jest.fn()
  },
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))

jest.mock('./firestore-denial-reporter', () => ({
  DENIAL_STREAK_TO_REPORT: 3,
  noteFirestoreServerRead: jest.fn(),
  scheduleRefusedReopen: () => () => undefined,
  subscribeFirestoreSessionHeal: () => jest.fn(),
}))

import { writeGuardedBySeed } from './helpers/guarded-seed-write'
import { useDocData } from './helpers/use-doc'

const RETRY_DELAY_MS = 400

const snapshot = (fromCache: boolean) => ({
  id: 'doc',
  exists: () => true,
  data: () => ({ name: 'stored' }),
  metadata: { fromCache, hasPendingWrites: false },
})

/** Enough of a `DocumentReference` for `useDocData`'s deps and the mock. */
const refAt = (path: string) => ({ firestore: {}, path }) as never

const render = (path: string) =>
  renderHook(({ ref }) => useDocData<{ name: string }>(ref), {
    initialProps: { ref: refAt(path) },
  })

describe('useDocData listen handle (AGL-4135)', () => {
  beforeEach(() => {
    mockHandlers = []
  })

  it('lets a save that names this listener wait on it alone', async () => {
    const view = render('hosts/h')
    const neighbour = render('hosts/h/screens/s')
    act(() => mockHandlers[0].onNext(snapshot(true)))
    act(() => mockHandlers[1].onNext(snapshot(true)))
    const write = jest.fn(async () => undefined)
    const saved = writeGuardedBySeed(
      {
        subject: 'site settings',
        fromCache: view.result.current.fromCache,
        listen: view.result.current.listen,
        checkSession: false,
      },
      write,
    )
    // Torn down mid-wait: on the all-listeners wait this refused the save.
    neighbour.unmount()
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()

    act(() => mockHandlers[0].onNext(snapshot(false)))

    await expect(saved).resolves.toEqual({ ok: true })
    expect(write).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it("follows the hook's listener when its ref changes during the wait", async () => {
    const view = render('hosts/a')
    const handle = view.result.current.listen
    act(() => mockHandlers[0].onNext(snapshot(true)))
    const write = jest.fn(async () => undefined)
    const saved = writeGuardedBySeed(
      { subject: 'site settings', fromCache: true, listen: handle, checkSession: false },
      write,
    )
    view.rerender({ ref: refAt('hosts/b') })
    expect(view.result.current.listen).toBe(handle)
    // The listener it replaced answers late; that is not this read.
    act(() => mockHandlers[0].onNext(snapshot(false)))
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()

    act(() => mockHandlers[1].onNext(snapshot(false)))

    await expect(saved).resolves.toEqual({ ok: true })
    view.unmount()
  })

  it('waits through a refusal for the retry, and never writes on the refusal', async () => {
    jest.useFakeTimers()
    try {
      const view = render('hosts/h')
      act(() => mockHandlers[0].onNext(snapshot(true)))
      const write = jest.fn(async () => undefined)
      const saved = writeGuardedBySeed(
        {
          subject: 'site settings',
          fromCache: true,
          listen: view.result.current.listen,
          checkSession: false,
        },
        write,
      )
      act(() => mockHandlers[0].onError({ code: 'permission-denied' }))
      await act(async () => {
        await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS)
      })
      expect(mockHandlers).toHaveLength(2)
      expect(write).not.toHaveBeenCalled()

      act(() => mockHandlers[1].onNext(snapshot(false)))

      await expect(saved).resolves.toEqual({ ok: true })
      expect(write).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      jest.useRealTimers()
    }
  })
})
