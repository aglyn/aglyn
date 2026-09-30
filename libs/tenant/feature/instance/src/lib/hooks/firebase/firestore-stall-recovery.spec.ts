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
  STALL_RECOVERY_COOLDOWN_MS,
} from './firestore-stall-recovery'

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
    const afterCycle = jest.fn(async () => true)
    const { calls, recovery } = setup({ afterCycle })
    await expect(recovery.recover()).resolves.toBe('fell-back')
    expect(calls).toEqual(['disable', 'enable'])
    expect(afterCycle).toHaveBeenCalledTimes(1)
  })

  it('keeps the cycle outcome when the escalation finds nothing', async () => {
    const { recovery } = setup({ afterCycle: async () => false })
    await expect(recovery.recover()).resolves.toBe('recovered')
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
