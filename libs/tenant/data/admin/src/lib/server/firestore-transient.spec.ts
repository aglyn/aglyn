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

import { isTransientFirestoreError, retryTransientFirestore } from './firestore-transient'

const failure = (code: unknown) => Object.assign(new Error(String(code)), { code })

describe('isTransientFirestoreError', () => {
  it.each([4, 8, 10, 14, 'deadline-exceeded', 'resource-exhausted', 'aborted', 'unavailable'])(
    'is transient for %p',
    (code) => {
      expect(isTransientFirestoreError(failure(code))).toBe(true)
    },
  )

  it.each([3, 5, 7, 'permission-denied', undefined])('is not transient for %p', (code) => {
    expect(isTransientFirestoreError(failure(code))).toBe(false)
  })

  it('is not transient for something that is not an error', () => {
    expect(isTransientFirestoreError(null)).toBe(false)
    expect(isTransientFirestoreError('UNAVAILABLE')).toBe(false)
  })
})

describe('retryTransientFirestore', () => {
  it('retries a transient failure and returns what the next attempt does', async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(failure(14))
      .mockRejectedValueOnce(failure(4))
      .mockResolvedValue('done')
    const onRetry = jest.fn()

    await expect(retryTransientFirestore(operation, { delaysMs: [0, 0], onRetry })).resolves.toBe(
      'done',
    )
    expect(operation).toHaveBeenCalledTimes(3)
    expect(onRetry.mock.calls.map((call) => call[1])).toEqual([1, 2])
  })

  it('throws the last transient failure once the delays are spent', async () => {
    const operation = jest.fn(async () => {
      throw failure(14)
    })

    await expect(retryTransientFirestore(operation, { delaysMs: [0, 0] })).rejects.toMatchObject({
      code: 14,
    })
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('throws a failure that is not transient at once', async () => {
    const operation = jest.fn(async () => {
      throw failure(7)
    })

    await expect(retryTransientFirestore(operation, { delaysMs: [0, 0] })).rejects.toMatchObject({
      code: 7,
    })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('waits the given delay between attempts', async () => {
    jest.useFakeTimers()
    try {
      const operation = jest
        .fn<Promise<string>, []>()
        .mockRejectedValueOnce(failure(14))
        .mockResolvedValue('done')
      const result = retryTransientFirestore(operation, { delaysMs: [1000] })

      await jest.advanceTimersByTimeAsync(999)
      expect(operation).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(1)
      await expect(result).resolves.toBe('done')
      expect(operation).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })
})
