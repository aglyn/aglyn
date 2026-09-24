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

/**
 * The sign-up doors AWAIT `rememberAccountAcquisition` (AGL-3289), so the one
 * thing it must never do is hold a sign-up hostage: a platform that does not
 * answer is abandoned at the deadline and the door moves on.
 */

import {
  ACCOUNT_ACQUISITION_TIMEOUT_MS,
  rememberAccountAcquisition,
} from './account-acquisition'

const user = { getIdToken: () => Promise.resolve('id-token') }
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('rememberAccountAcquisition', () => {
  it('moves on when the platform does not answer in time', async () => {
    jest.useFakeTimers()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    let aborted = false
    globalThis.fetch = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    ) as typeof fetch
    let settled = false
    const door = rememberAccountAcquisition(user).then(() => {
      settled = true
    })
    await jest.advanceTimersByTimeAsync(ACCOUNT_ACQUISITION_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await jest.advanceTimersByTimeAsync(1)
    await door
    expect(aborted).toBe(true)
    expect(settled).toBe(true)
  })

  it('sends the capture with the verified token when the platform answers', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 }) as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await rememberAccountAcquisition(user)
    expect(logged).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(input).toBe('/api/auth/acquisition')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer id-token')
    expect(JSON.parse(String(init.body))).toHaveProperty('touch')
    expect(init.signal).toBeDefined()
  })

  it('asks nothing when there is no account', async () => {
    const fetchMock = jest.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await rememberAccountAcquisition(null)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
