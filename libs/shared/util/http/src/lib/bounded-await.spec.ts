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

import {
  boundedAwait,
  createSettledValueCache,
  resetBoundedAwaitWarningsForTests,
} from './bounded-await'

describe('boundedAwait (AGL-3565)', () => {
  let warn: jest.SpyInstance
  beforeEach(() => {
    jest.useFakeTimers()
    resetBoundedAwaitWarningsForTests()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.useRealTimers()
    warn.mockRestore()
  })

  it('⛔ answers with the fallback when the work never settles — the incident shape', async () => {
    // A promise no signal reaches: what Next's patched fetch handed back.
    const pending = boundedAwait(
      new Promise<string>(() => undefined),
      2_500,
      null,
      'test.never',
    )
    await jest.advanceTimersByTimeAsync(2_499)
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      event: 'bounded-await-timeout',
      label: 'test.never',
      ms: 2_500,
      suppressed: 0,
    })
  })

  it('⛔ is not defeated by work that ignores its abort signal', async () => {
    let seen: AbortSignal | undefined
    const pending = boundedAwait(
      (signal) => {
        seen = signal
        return new Promise<string>(() => undefined)
      },
      100,
      'fallback',
      'test.ignores-signal',
    )
    await jest.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe('fallback')
    // The signal still fires, for work that can be canceled.
    expect(seen?.aborted).toBe(true)
  })

  it('writes one line per label a minute, counting the rest onto the next', async () => {
    const never = () => new Promise<string>(() => undefined)
    for (let i = 0; i < 3; i += 1) {
      const pending = boundedAwait(never(), 10, null, 'test.storm')
      await jest.advanceTimersByTimeAsync(10)
      await pending
    }
    expect(warn).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(60_000)
    const pending = boundedAwait(never(), 10, null, 'test.storm')
    await jest.advanceTimersByTimeAsync(10)
    await pending
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ label: 'test.storm', suppressed: 2 }),
    )
  })

  it('answers with the work when it beats the deadline, and leaves no timer behind', async () => {
    const answer = await boundedAwait(
      Promise.resolve('fast'),
      1_000,
      null,
      'test.fast',
    )
    expect(answer).toBe('fast')
    expect(jest.getTimerCount()).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes a rejection before the deadline through unchanged', async () => {
    const failure = new Error('upstream said no')
    await expect(
      boundedAwait(Promise.reject(failure), 1_000, null, 'test.rejects'),
    ).rejects.toBe(failure)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('ignores a rejection that lands after the deadline', async () => {
    let reject: (error: Error) => void = () => undefined
    const late = new Promise<string>((_, no) => (reject = no))
    const pending = boundedAwait(late, 50, 'fallback', 'test.late-reject')
    await jest.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe('fallback')
    reject(new Error('too late'))
    await Promise.resolve()
  })

  it('rejects when starting the work throws', async () => {
    await expect(
      boundedAwait(
        () => {
          throw new Error('could not start')
        },
        50,
        null,
        'test.throws',
      ),
    ).rejects.toThrow('could not start')
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('createSettledValueCache (AGL-3565)', () => {
  it('⛔ refuses to hold a promise', () => {
    const cache = createSettledValueCache<string, unknown>()
    expect(() => cache.set('k', Promise.resolve(1), 1_000)).toThrow(TypeError)
    expect(() => cache.set('k', { then: () => undefined }, 1_000)).toThrow(
      TypeError,
    )
    expect(cache.lookup('k')).toBeUndefined()
  })

  it('holds a value, null included, until it expires', () => {
    const cache = createSettledValueCache<string, number | null>()
    cache.set('a', null, 100, 1_000)
    expect(cache.lookup('a', 1_099)).toEqual({ value: null })
    expect(cache.lookup('a', 1_100)).toBeUndefined()
  })

  it('reads through only once the load has settled, with a TTL chosen by the answer', async () => {
    const cache = createSettledValueCache<string, string | null>()
    let resolve: (value: string | null) => void = () => undefined
    const loading = cache.readThrough(
      'k',
      () => new Promise((yes) => (resolve = yes)),
      (value) => (value ? 10_000 : 10),
    )
    // Nothing is held while the load is in flight: a second reader does not
    // wait on the first one's work.
    expect(cache.lookup('k')).toBeUndefined()
    resolve(null)
    await expect(loading).resolves.toBeNull()
    expect(cache.lookup('k')).toEqual({ value: null })
    const load = jest.fn(async () => 'again')
    await expect(cache.readThrough('k', load, () => 1)).resolves.toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('does not hold a load that failed', async () => {
    const cache = createSettledValueCache<string, string>()
    await expect(
      cache.readThrough(
        'k',
        async () => Promise.reject(new Error('no')),
        () => 1_000,
      ),
    ).rejects.toThrow('no')
    expect(cache.lookup('k')).toBeUndefined()
  })
})
