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
 * One-off reads that cannot hang (AGL-3373).
 *
 * The notifications feed awaited a bare `getDocs` that never settled, so its
 * `loading` never cleared. A bounded read settles one of three ways: the
 * server's answer, the cache's answer marked stale (with the server's still
 * to come), or an error. It never waits forever.
 */

jest.mock('firebase/firestore', () => ({}))

import { boundedRead, FirestoreStallError } from './firestore-bounded-read'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('boundedRead (AGL-3373)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const firestore = {} as never

  it('returns the server answer when it arrives in time, without touching the cache', async () => {
    const cache = jest.fn()
    const recover = jest.fn()
    const read = boundedRead({
      server: () => Promise.resolve('server'),
      cache,
      firestore,
      stallMs: 1000,
      recover,
    })
    await expect(read).resolves.toEqual({ snapshot: 'server', stale: false })
    expect(cache).not.toHaveBeenCalled()
    expect(recover).not.toHaveBeenCalled()
  })

  it('settles from the cache, marked stale, when the server has not answered', async () => {
    const server = deferred<string>()
    const recover = jest.fn()
    const read = boundedRead({
      server: () => server.promise,
      cache: () => Promise.resolve('cached'),
      firestore,
      stallMs: 1000,
      recover,
    })
    await jest.advanceTimersByTimeAsync(1000)
    const result = await read
    expect(result.snapshot).toBe('cached')
    expect(result.stale).toBe(true)
    // …and the client was asked to recover.
    expect(recover).toHaveBeenCalledWith(firestore)

    // The server's answer is not thrown away: it arrives as `fresh`.
    server.resolve('server')
    await expect(result.fresh).resolves.toBe('server')
  })

  it('never rejects `fresh`, so a caller that ignores it raises nothing', async () => {
    const server = deferred<string>()
    const read = boundedRead({
      server: () => server.promise,
      cache: () => Promise.resolve('cached'),
      firestore,
      stallMs: 1000,
      recover: jest.fn(),
    })
    await jest.advanceTimersByTimeAsync(1000)
    const result = await read
    server.reject(new Error('unavailable'))
    await expect(result.fresh).resolves.toBeUndefined()
  })

  it('rejects rather than hanging when the cache cannot answer either', async () => {
    const read = boundedRead({
      server: () => new Promise<string>(() => undefined),
      cache: () => Promise.reject(new Error('not cached')),
      firestore,
      stallMs: 1000,
      recover: jest.fn(),
    })
    const settled = expect(read).rejects.toBeInstanceOf(FirestoreStallError)
    await jest.advanceTimersByTimeAsync(1000)
    await settled
  })

  it('passes a server error straight through when it arrives in time', async () => {
    const denied = Object.assign(new Error('denied'), {
      code: 'permission-denied',
    })
    await expect(
      boundedRead({
        server: () => Promise.reject(denied),
        cache: jest.fn(),
        firestore,
        stallMs: 1000,
        recover: jest.fn(),
      }),
    ).rejects.toBe(denied)
  })
})
