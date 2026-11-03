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
 * Recovering a Firestore client that stopped syncing (AGL-3373).
 *
 * The recovery is a network cycle, which forces the multi-tab lease election
 * and restarts the streams. What must hold: it never runs offline or hidden,
 * it collapses a page's worth of stalled readers into one cycle, it always
 * re-enables the network, and it never reaches for the calls that would drop
 * pending writes (`terminate`, `clearIndexedDbPersistence`).
 */

const mockDisableNetwork = jest.fn(() => Promise.resolve())
const mockEnableNetwork = jest.fn(() => Promise.resolve())
const mockTerminate = jest.fn()
const mockClearIndexedDbPersistence = jest.fn()

jest.mock('firebase/firestore', () => ({
  disableNetwork: (...args: unknown[]) => mockDisableNetwork(...(args as [])),
  enableNetwork: (...args: unknown[]) => mockEnableNetwork(...(args as [])),
  terminate: (...args: unknown[]) => mockTerminate(...args),
  clearIndexedDbPersistence: (...args: unknown[]) =>
    mockClearIndexedDbPersistence(...args),
}))

import {
  armFirestoreStallWatch,
  createStallRecovery,
  FIRESTORE_STALL_MS,
  recoverStalledFirestore,
  noteFirestoreServerAnswer,
  STALL_RECOVERY_COOLDOWN_MS,
  STALL_RECOVERY_MAX_COOLDOWN_MS,
} from './firestore-stall-recovery'
import type { LeaseCheck } from './firestore-multitab-wedge'

describe('createStallRecovery (AGL-3373)', () => {
  const setup = (
    overrides: Partial<Parameters<typeof createStallRecovery>[0]> = {},
  ) => {
    const calls: string[] = []
    let clock = 1_000_000
    const recovery = createStallRecovery({
      disable: jest.fn(async () => void calls.push('disable')),
      enable: jest.fn(async () => void calls.push('enable')),
      isOnline: () => true,
      isVisible: () => true,
      now: () => clock,
      ...overrides,
    })
    return {
      calls,
      recovery,
      advance: (ms: number) => {
        clock += ms
      },
    }
  }

  it('takes the client off the network and puts it back, in that order', async () => {
    const { calls, recovery } = setup()
    await expect(recovery.recover()).resolves.toBe('recovered')
    expect(calls).toEqual(['disable', 'enable'])
  })

  it('does nothing while the browser reports no network: the cache is right then', async () => {
    const { calls, recovery } = setup({ isOnline: () => false })
    await expect(recovery.recover()).resolves.toBe('offline')
    expect(calls).toEqual([])
  })

  it('does nothing from a hidden tab', async () => {
    const { calls, recovery } = setup({ isVisible: () => false })
    await expect(recovery.recover()).resolves.toBe('hidden')
    expect(calls).toEqual([])
  })

  it('collapses concurrent requests into the one cycle already running', async () => {
    const { calls, recovery } = setup()
    const [a, b, c] = await Promise.all([
      recovery.recover(),
      recovery.recover(),
      recovery.recover(),
    ])
    expect([a, b, c]).toEqual(['recovered', 'recovered', 'recovered'])
    expect(calls).toEqual(['disable', 'enable'])
  })

  it('runs at most once per cooldown, and again after it', async () => {
    const { calls, recovery, advance } = setup()
    await recovery.recover()
    advance(STALL_RECOVERY_COOLDOWN_MS - 1)
    await expect(recovery.recover()).resolves.toBe('cooling')
    expect(calls).toEqual(['disable', 'enable'])
    advance(1)
    await expect(recovery.recover()).resolves.toBe('recovered')
    expect(calls).toEqual(['disable', 'enable', 'disable', 'enable'])
  })

  /**
   * The cycle gives up the lease and flips every confirmed view back to
   * `fromCache` (AGL-4120), so it is only for a client that has gone silent.
   * One slow listener among many that were just confirmed is not that.
   */
  it('leaves a client alone while the server is answering it (AGL-4120)', async () => {
    const answered: { at?: number } = {}
    const { calls, recovery, advance } = setup({
      lastServerAnswerAt: () => answered.at,
    })
    answered.at = 1_000_000
    advance(FIRESTORE_STALL_MS - 1)
    await expect(recovery.recover()).resolves.toBe('answering')
    expect(calls).toEqual([])
  })

  it('cycles once the client has been silent for the stall window (AGL-4120)', async () => {
    const { calls, recovery, advance } = setup({
      lastServerAnswerAt: () => 1_000_000,
    })
    advance(FIRESTORE_STALL_MS)
    await expect(recovery.recover()).resolves.toBe('recovered')
    expect(calls).toEqual(['disable', 'enable'])
  })

  /** Without it, a connection slower than the cooldown is restarted forever. */
  it('waits longer between cycles the server does not answer (AGL-4120)', async () => {
    const { calls, recovery, advance } = setup({ lastServerAnswerAt: () => undefined })
    await recovery.recover()
    advance(STALL_RECOVERY_COOLDOWN_MS)
    await recovery.recover()
    expect(calls).toHaveLength(4)

    advance(STALL_RECOVERY_COOLDOWN_MS)
    await expect(recovery.recover()).resolves.toBe('cooling')
    advance(STALL_RECOVERY_COOLDOWN_MS)
    await expect(recovery.recover()).resolves.toBe('recovered')
    expect(calls).toHaveLength(6)
  })

  it('caps the wait, and starts over once the server answers again (AGL-4120)', async () => {
    const answered: { at?: number } = {}
    const { recovery, advance } = setup({ lastServerAnswerAt: () => answered.at })
    let clock = 1_000_000
    const step = (ms: number) => {
      advance(ms)
      clock += ms
    }
    await recovery.recover()
    for (let cycle = 0; cycle < 6; cycle += 1) {
      step(STALL_RECOVERY_MAX_COOLDOWN_MS)
      await expect(recovery.recover()).resolves.toBe('recovered')
    }
    step(STALL_RECOVERY_COOLDOWN_MS)
    await expect(recovery.recover()).resolves.toBe('cooling')

    step(STALL_RECOVERY_MAX_COOLDOWN_MS)
    answered.at = clock
    step(FIRESTORE_STALL_MS)
    await expect(recovery.recover()).resolves.toBe('recovered')
    step(STALL_RECOVERY_COOLDOWN_MS)
    await expect(recovery.recover()).resolves.toBe('recovered')
  })

  it('re-enables the network even when disabling it throws', async () => {
    const { calls, recovery } = setup({
      disable: async () => {
        calls.push('disable')
        throw new Error('queue failed')
      },
    })
    await expect(recovery.recover()).resolves.toBe('failed')
    expect(calls).toEqual(['disable', 'enable'])
  })

  it('bounds a cycle whose calls queue behind a locked cache, so later recoveries are not pinned to it (AGL-3428)', async () => {
    const { calls, recovery, advance } = setup({
      disable: () => {
        calls.push('disable')
        return new Promise<void>(() => undefined)
      },
      enable: () => {
        calls.push('enable')
        return new Promise<void>(() => undefined)
      },
      stepTimeoutMs: 10,
    })
    await expect(recovery.recover()).resolves.toBe('failed')
    expect(calls).toEqual(['disable', 'enable'])

    advance(STALL_RECOVERY_COOLDOWN_MS)
    await expect(recovery.recover()).resolves.toBe('failed')
    expect(calls).toEqual(['disable', 'enable', 'disable', 'enable'])
  })

  it('runs the escalation after the cycle and reports a fallback (AGL-3428)', async () => {
    const escalate = jest.fn(async () => true)
    const { calls, recovery } = setup({ escalate })
    await expect(recovery.recover()).resolves.toBe('fell-back')
    expect(calls).toEqual(['disable', 'enable'])
    expect(escalate).toHaveBeenCalledTimes(1)
  })

  it('keeps the cycle outcome when the escalation finds nothing', async () => {
    const { recovery } = setup({ escalate: async () => false })
    await expect(recovery.recover()).resolves.toBe('recovered')
  })

  /**
   * The cycle broadcast `Offline` and put every confirmed view back on the
   * cache, in a tab that was only queued behind another tab's IndexedDB
   * transaction (production, two tabs, AGL-4135). It cannot shorten that
   * transaction: both of its calls queue behind it.
   */
  describe('reads the shared cache before it cycles (AGL-4135)', () => {
    const lease = (check: LeaseCheck) => jest.fn(async () => check)

    it('does not cycle a client queued behind a transaction, and checks for the wedge instead', async () => {
      const escalate = jest.fn(async () => false)
      const { calls, recovery } = setup({ checkLease: lease({ state: 'waiting' }), escalate })
      await expect(recovery.recover()).resolves.toBe('waiting')
      expect(calls).toEqual([])
      expect(escalate).toHaveBeenCalledTimes(1)
    })

    it('still falls back from a store that stays locked, as after a cycle (AGL-3428)', async () => {
      const { calls, recovery } = setup({
        checkLease: lease({ state: 'waiting' }),
        escalate: async () => true,
      })
      await expect(recovery.recover()).resolves.toBe('fell-back')
      expect(calls).toEqual([])
    })

    it('checks a long wait for the wedge once per cooldown, not at every watch', async () => {
      const escalate = jest.fn(async () => false)
      const { recovery, advance } = setup({ checkLease: lease({ state: 'waiting' }), escalate })
      await recovery.recover()
      advance(FIRESTORE_STALL_MS)
      await expect(recovery.recover()).resolves.toBe('waiting')
      expect(escalate).toHaveBeenCalledTimes(1)
      advance(STALL_RECOVERY_COOLDOWN_MS)
      await recovery.recover()
      expect(escalate).toHaveBeenCalledTimes(2)
    })

    it('does not cycle a client another tab serves on a live lease', async () => {
      const escalate = jest.fn(async () => true)
      const { calls, recovery } = setup({
        checkLease: lease({ state: 'served', ownerId: 'slow-tab' }),
        escalate,
      })
      await expect(recovery.recover()).resolves.toBe('served')
      expect(calls).toEqual([])
      expect(escalate).not.toHaveBeenCalled()
    })

    it('cycles a client nothing explains: its own lease, or one lapsed or vacant', async () => {
      const { calls, recovery } = setup({ checkLease: lease({ state: 'silent' }) })
      await expect(recovery.recover()).resolves.toBe('recovered')
      expect(calls).toEqual(['disable', 'enable'])
    })

    it('leaves a cycle free to run as soon as a client stops waiting and goes quiet', async () => {
      const check = { current: { state: 'waiting' } as LeaseCheck }
      const { calls, recovery } = setup({ checkLease: async () => check.current })
      await expect(recovery.recover()).resolves.toBe('waiting')
      check.current = { state: 'silent' }
      await expect(recovery.recover()).resolves.toBe('recovered')
      expect(calls).toEqual(['disable', 'enable'])
    })

    it('takes the stall at its word when the lease cannot be read', async () => {
      const { calls, recovery } = setup({
        checkLease: async () => {
          throw new Error('IndexedDB unavailable')
        },
      })
      await expect(recovery.recover()).resolves.toBe('recovered')
      expect(calls).toEqual(['disable', 'enable'])
    })

    it('does not cycle a client that answered while the lease was being read', async () => {
      const answered: { at?: number } = {}
      let clock = 1_000_000
      const { calls, recovery } = setup({
        now: () => clock,
        lastServerAnswerAt: () => answered.at,
        checkLease: async () => {
          // The queue drained behind the read, and a confirmation landed.
          clock += 500
          answered.at = clock
          return { state: 'silent' }
        },
      })
      await expect(recovery.recover()).resolves.toBe('answering')
      expect(calls).toEqual([])
    })

    it('shares one read between the watches that fire together', async () => {
      const checkLease = lease({ state: 'served', ownerId: 'slow-tab' })
      const { recovery } = setup({ checkLease })
      await Promise.all([recovery.recover(), recovery.recover(), recovery.recover()])
      expect(checkLease).toHaveBeenCalledTimes(1)
    })
  })
})

describe('recoverStalledFirestore (AGL-3373)', () => {
  beforeEach(() => {
    mockDisableNetwork.mockClear()
    mockEnableNetwork.mockClear()
  })

  it('cycles the network of the client it is given, once per cooldown', async () => {
    const firestore = {} as never
    await expect(recoverStalledFirestore(firestore)).resolves.toBe('recovered')
    await expect(recoverStalledFirestore(firestore)).resolves.toBe('cooling')
    expect(mockDisableNetwork).toHaveBeenCalledTimes(1)
    expect(mockDisableNetwork).toHaveBeenCalledWith(firestore)
    expect(mockEnableNetwork).toHaveBeenCalledWith(firestore)
  })

  it('keeps a separate cooldown per client', async () => {
    await recoverStalledFirestore({} as never)
    await recoverStalledFirestore({} as never)
    expect(mockDisableNetwork).toHaveBeenCalledTimes(2)
  })

  it('never clears the cache or terminates the client, so pending writes survive', async () => {
    await recoverStalledFirestore({} as never)
    expect(mockTerminate).not.toHaveBeenCalled()
    expect(mockClearIndexedDbPersistence).not.toHaveBeenCalled()
  })

  it('does not cycle a client that was just answered (AGL-4120)', async () => {
    const firestore = {} as never
    noteFirestoreServerAnswer(firestore)
    await expect(recoverStalledFirestore(firestore)).resolves.toBe('answering')
    expect(mockDisableNetwork).not.toHaveBeenCalled()
  })

  it('answers without a client instead of throwing', async () => {
    await expect(recoverStalledFirestore(undefined)).resolves.toBe('failed')
    expect(mockDisableNetwork).not.toHaveBeenCalled()
  })
})

describe('armFirestoreStallWatch (AGL-3373)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  it('calls for recovery once the read has gone unanswered for the stall window', () => {
    const onStall = jest.fn()
    armFirestoreStallWatch({} as never, { onStall })
    jest.advanceTimersByTime(FIRESTORE_STALL_MS - 1)
    expect(onStall).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('stays quiet once disarmed by an answer', () => {
    const onStall = jest.fn()
    const disarm = armFirestoreStallWatch({} as never, { onStall })
    disarm()
    disarm()
    jest.advanceTimersByTime(FIRESTORE_STALL_MS * 2)
    expect(onStall).not.toHaveBeenCalled()
  })

  /**
   * One call can do nothing, inside a cooldown or on a client still answering.
   * A watch that spent itself there left its listener unconfirmed for life,
   * which is how a tab's first page worked and a later page's saves were refused.
   */
  it('keeps asking for as long as the read stays unanswered (AGL-4120)', () => {
    const onStall = jest.fn()
    const disarm = armFirestoreStallWatch({} as never, { onStall })
    jest.advanceTimersByTime(FIRESTORE_STALL_MS * 3)
    expect(onStall).toHaveBeenCalledTimes(3)
    disarm()
    jest.advanceTimersByTime(FIRESTORE_STALL_MS * 3)
    expect(onStall).toHaveBeenCalledTimes(3)
  })

  it('keeps asking after a hidden tab is shown, and can be disarmed there (AGL-4120)', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    const onStall = jest.fn()
    const disarm = armFirestoreStallWatch({} as never, { onStall })
    jest.advanceTimersByTime(FIRESTORE_STALL_MS)
    disarm()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    jest.advanceTimersByTime(FIRESTORE_STALL_MS)
    expect(onStall).not.toHaveBeenCalled()
  })

  it('waits for a hidden tab to be shown before calling for recovery', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    const onStall = jest.fn()
    armFirestoreStallWatch({} as never, { onStall })
    jest.advanceTimersByTime(FIRESTORE_STALL_MS)
    expect(onStall).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onStall).toHaveBeenCalledTimes(1)
  })
})
