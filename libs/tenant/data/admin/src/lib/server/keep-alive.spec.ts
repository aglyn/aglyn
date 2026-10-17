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

import { keepAlive } from './keep-alive'

const NEXT = Symbol.for('@next/request-context')
const VERCEL = Symbol.for('@vercel/request-context')
const scope = globalThis as unknown as Record<symbol, unknown>

afterEach(() => {
  delete scope[NEXT]
  delete scope[VERCEL]
})

describe('keepAlive', () => {
  it('hands the work to the waitUntil of the request Next is serving', async () => {
    const waited: Promise<unknown>[] = []
    scope[NEXT] = { get: () => ({ waitUntil: (p: Promise<unknown>) => waited.push(p) }) }
    const work = Promise.resolve('done')
    await expect(keepAlive(work)).resolves.toBe('done')
    expect(waited).toHaveLength(1)
  })

  it("falls back to Vercel's own request context", () => {
    const waited: Promise<unknown>[] = []
    scope[VERCEL] = { get: () => ({ waitUntil: (p: Promise<unknown>) => waited.push(p) }) }
    void keepAlive(Promise.resolve())
    expect(waited).toHaveLength(1)
  })

  it('never makes a failure the platform sees unhandled, and still rejects for the caller', async () => {
    const waited: Promise<unknown>[] = []
    scope[NEXT] = { get: () => ({ waitUntil: (p: Promise<unknown>) => waited.push(p) }) }
    const work = keepAlive(Promise.reject(new Error('boom')))
    await expect(waited[0]).resolves.toBeUndefined()
    await expect(work).rejects.toThrow('boom')
  })

  it('outside a request it just returns the work', async () => {
    await expect(keepAlive(Promise.resolve(7))).resolves.toBe(7)
  })
})
