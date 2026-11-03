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

import { writeGuardedBySeed } from './guarded-seed-write'
import {
  createListenHandle,
  sameDocument,
  SEED_CONFIRM_WAIT_MS,
  trackListenConfirmation,
  whenListenConfirmed,
  whenListensConfirmed,
  type ListenConfirmation,
  type ListenHandle,
} from './listen-confirmation'

/**
 * A save on an unconfirmed seed waits for the server instead of refusing
 * (AGL-4120). The hooks' side is exercised in `listener-stall-recovery.spec.ts`;
 * this is the contract the guard relies on, and the one way the wait must never
 * fail: letting a save through on a seed nobody confirmed.
 */
describe('a save that waits for the server (AGL-4120)', () => {
  const open: ListenConfirmation[] = []
  const listen = (handle?: ListenHandle) => {
    const confirmation = trackListenConfirmation(handle)
    open.push(confirmation)
    return confirmation
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    open.splice(0).forEach((confirmation) => confirmation.report(false))
    jest.useRealTimers()
  })

  describe('whenListensConfirmed', () => {
    it('settles once every listener unconfirmed at the start has heard', async () => {
      const first = listen()
      const second = listen()
      const settled = jest.fn()
      void whenListensConfirmed().then(settled)

      first.report(false)
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()

      second.report(false)
      await expect(whenListensConfirmedResult(settled)).resolves.toBe('confirmed')
    })

    it('reports `untracked` when nothing is unconfirmed, so the caller keeps its answer', async () => {
      await expect(whenListensConfirmed()).resolves.toBe('untracked')
    })

    it('reports `refreshed` when a confirmation changed what was on screen', async () => {
      const listener = listen()
      const settled = whenListensConfirmed()
      listener.report(false, true)
      await expect(settled).resolves.toBe('refreshed')
    })

    it('ignores a cached snapshot, which confirms nothing', async () => {
      const listener = listen()
      const settled = jest.fn()
      void whenListensConfirmed(100).then(settled)
      listener.report(true)
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()
      jest.advanceTimersByTime(100)
      await expect(whenListensConfirmedResult(settled)).resolves.toBe('unconfirmed')
    })

    it('never takes a listener that went away for a confirmation', async () => {
      const listener = listen()
      const settled = whenListensConfirmed()
      listener.release()
      await expect(settled).resolves.toBe('unconfirmed')
    })

    it('counts a listener that is knocked back to the cache again', async () => {
      const listener = listen()
      listener.report(false)
      await expect(whenListensConfirmed()).resolves.toBe('untracked')
      listener.report(true)
      const settled = whenListensConfirmed()
      listener.report(false)
      await expect(settled).resolves.toBe('confirmed')
    })
  })

  /**
   * With another tab starving the shared cache, every listener on a page is
   * slow at once, and a save that waits on all of them waits on the slowest.
   * A save that names its seed's listener waits on that read alone (AGL-4135).
   */
  describe('whenListenConfirmed: one listener (AGL-4135)', () => {
    it('settles when that listener is confirmed, whatever else is still unconfirmed', async () => {
      const seed = createListenHandle()
      const own = listen(seed)
      listen()
      const settled = whenListenConfirmed(seed)
      own.report(false)
      await expect(settled).resolves.toBe('confirmed')
    })

    it('is not refused by another listener being refused or torn down', async () => {
      const seed = createListenHandle()
      const own = listen(seed)
      const other = listen()
      const settled = jest.fn()
      void whenListenConfirmed(seed).then(settled)
      other.release()
      other.close()
      await whenListensConfirmedResult(settled)
      expect(settled).not.toHaveBeenCalled()
      own.report(false)
      await expect(whenListensConfirmedResult(settled)).resolves.toBe('confirmed')
    })

    it('never takes its own refusal for a confirmation: it waits for the retry', async () => {
      const seed = createListenHandle()
      const own = listen(seed)
      const settled = jest.fn()
      void whenListenConfirmed(seed, 100).then(settled)
      own.release()
      await whenListensConfirmedResult(settled)
      expect(settled).not.toHaveBeenCalled()
      // The retry reopens on the same line and is answered.
      own.report(false)
      await expect(whenListensConfirmedResult(settled)).resolves.toBe('confirmed')
    })

    it('ends unconfirmed when its listener is refused and never answered', async () => {
      const seed = createListenHandle()
      listen(seed).release()
      const settled = jest.fn()
      void whenListenConfirmed(seed, 100).then(settled)
      jest.advanceTimersByTime(100)
      await expect(whenListensConfirmedResult(settled)).resolves.toBe('unconfirmed')
    })

    it('follows a listener replaced during the wait, and ignores the one it replaced', async () => {
      const seed = createListenHandle()
      const first = listen(seed)
      const settled = jest.fn()
      void whenListenConfirmed(seed).then(settled)
      // New deps: the hook tears its listener down and opens another.
      first.close()
      const second = listen(seed)
      first.report(false)
      await whenListensConfirmedResult(settled)
      expect(settled).not.toHaveBeenCalled()
      second.report(false)
      await expect(whenListensConfirmedResult(settled)).resolves.toBe('confirmed')
    })

    it('reports `refreshed` when its confirmation changed what was on screen', async () => {
      const seed = createListenHandle()
      const own = listen(seed)
      const settled = whenListenConfirmed(seed)
      own.report(false, true)
      await expect(settled).resolves.toBe('refreshed')
    })

    it('answers at once for a listener confirmed after the caller read `fromCache`', async () => {
      const seed = createListenHandle()
      listen(seed).report(false)
      await expect(whenListenConfirmed(seed)).resolves.toBe('confirmed')
      const changed = createListenHandle()
      listen(changed).report(false, true)
      await expect(whenListenConfirmed(changed)).resolves.toBe('refreshed')
    })

    it('waits again for a listener knocked back to the cache', async () => {
      const seed = createListenHandle()
      const own = listen(seed)
      own.report(false)
      own.report(true)
      const settled = jest.fn()
      void whenListenConfirmed(seed).then(settled)
      await whenListensConfirmedResult(settled)
      expect(settled).not.toHaveBeenCalled()
      own.report(false)
      await expect(whenListensConfirmedResult(settled)).resolves.toBe('confirmed')
    })

    it('reports `untracked` for a handle with no listener behind it, so the caller keeps its answer', async () => {
      await expect(whenListenConfirmed(createListenHandle())).resolves.toBe('untracked')
      const seed = createListenHandle()
      listen(seed).close()
      await expect(whenListenConfirmed(seed)).resolves.toBe('untracked')
    })
  })

  describe('writeGuardedBySeed', () => {
    const save = (write: () => Promise<void>) =>
      writeGuardedBySeed(
        { subject: 'contact', fromCache: true, checkSession: false },
        write,
      )

    it('holds the write until the server confirms, then runs it', async () => {
      const listener = listen()
      const write = jest.fn(async () => undefined)
      const saved = save(write)

      await Promise.resolve()
      expect(write).not.toHaveBeenCalled()

      listener.report(false)
      await expect(saved).resolves.toEqual({ ok: true })
      expect(write).toHaveBeenCalledTimes(1)
    })

    it('refuses when the confirmation changed the record, so newer values are not overwritten', async () => {
      const listener = listen()
      const write = jest.fn(async () => undefined)
      const saved = save(write)

      listener.report(false, true)

      await expect(saved).resolves.toEqual({
        ok: false,
        reason: 'refreshed',
        message: expect.stringContaining('nothing was saved'),
      })
      expect(write).not.toHaveBeenCalled()
    })

    it('refuses in plain words when the confirmation never comes, and never writes', async () => {
      listen()
      const write = jest.fn(async () => undefined)
      const saved = save(write)

      jest.advanceTimersByTime(SEED_CONFIRM_WAIT_MS)

      await expect(saved).resolves.toEqual({
        ok: false,
        reason: 'unconfirmed',
        message: expect.stringContaining('nothing was saved'),
      })
      expect(write).not.toHaveBeenCalled()
    })

    it('refuses at once when no listener can vouch for the seed', async () => {
      const write = jest.fn(async () => undefined)
      await expect(save(write)).resolves.toMatchObject({
        ok: false,
        reason: 'unconfirmed',
      })
      expect(write).not.toHaveBeenCalled()
    })

    it('does not wait on a read that failed: patience does not change that', async () => {
      listen()
      const write = jest.fn(async () => undefined)
      await expect(
        writeGuardedBySeed({ subject: 'contact', unreadable: true }, write),
      ).resolves.toMatchObject({ ok: false, reason: 'unreadable' })
      expect(write).not.toHaveBeenCalled()
    })

    it('waits on its own listener alone when it names it (AGL-4135)', async () => {
      const seed = createListenHandle()
      const own = listen(seed)
      const other = listen()
      const write = jest.fn(async () => undefined)
      const saved = writeGuardedBySeed(
        { subject: 'contact', fromCache: true, checkSession: false, listen: seed },
        write,
      )
      // An unrelated listener refused mid-wait used to refuse the save.
      other.release()
      await Promise.resolve()
      expect(write).not.toHaveBeenCalled()
      own.report(false)
      await expect(saved).resolves.toEqual({ ok: true })
      expect(write).toHaveBeenCalledTimes(1)
    })

    it('still never writes when its own listener is never confirmed (AGL-4135)', async () => {
      const seed = createListenHandle()
      listen(seed)
      const write = jest.fn(async () => undefined)
      const saved = writeGuardedBySeed(
        { subject: 'contact', fromCache: true, checkSession: false, listen: seed },
        write,
      )
      jest.advanceTimersByTime(SEED_CONFIRM_WAIT_MS)
      await expect(saved).resolves.toMatchObject({ ok: false, reason: 'unconfirmed' })
      expect(write).not.toHaveBeenCalled()
    })

    it('runs at once on a confirmed seed, whatever else is still unconfirmed', async () => {
      listen()
      const write = jest.fn(async () => undefined)
      await expect(
        writeGuardedBySeed(
          { subject: 'contact', fromCache: false, checkSession: false },
          write,
        ),
      ).resolves.toEqual({ ok: true })
      expect(write).toHaveBeenCalledTimes(1)
    })
  })

  describe('sameDocument', () => {
    const snapshot = (data: unknown) => ({ exists: () => data !== undefined, data: () => data })

    it('reads two snapshots holding the same values as the same', () => {
      expect(sameDocument(snapshot({ a: 1 }), snapshot({ a: 1 }))).toBe(true)
    })

    it('reads a changed value, or a document that appeared, as different', () => {
      expect(sameDocument(snapshot({ a: 1 }), snapshot({ a: 2 }))).toBe(false)
      expect(sameDocument(snapshot(undefined), snapshot({ a: 1 }))).toBe(false)
    })
  })
})

/** Flushes the microtasks a settled `whenListensConfirmed` waits on, then reads it. */
async function whenListensConfirmedResult(settled: jest.Mock): Promise<unknown> {
  for (let step = 0; step < 5 && !settled.mock.calls.length; step += 1) {
    await Promise.resolve()
  }
  return settled.mock.calls[0]?.[0]
}
