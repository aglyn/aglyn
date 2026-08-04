/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * AGL-1161: the 50-path cap must SAY when it bites.
 *
 * `paths.slice(0, 50)` silently discarded the overflow — a caller sending 80
 * paths got `count: 50` back with nothing to distinguish that from having sent
 * 50. The dropped pages then sat stale for the full revalidate window while the
 * editor reported a successful publish, which is the exact "reported fast,
 * still slow" confusion AGL-1150 set out to remove.
 *
 * A widely-used component is the case that overflows, and this was measured on
 * production: `aglyn-marketing`'s "Site nav" fans out to 48 screens against a
 * cap of 50. It fits today by two. Nothing else guards that margin, so this
 * suite does.
 *
 * Deliberately asserts the SHAPE of the response, not just the count: `count`
 * alone cannot answer "did you take everything I sent", and that question is
 * the whole point of the fix.
 */

// `mock`-prefixed because a jest.mock factory is hoisted above the file and may
// not close over an ordinary out-of-scope variable.
const mockRevalidatePath = jest.fn()
jest.mock('next/cache', () => ({
  __esModule: true,
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}))

import { POST } from '../app/api/revalidate/route'

const SECRET = 'test-revalidate-secret'

const call = async (body: unknown, secret: string | null = SECRET) =>
  POST(
    new Request('https://demo.aglyn.app/api/revalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-revalidate-secret': secret } : {}),
      },
      body: JSON.stringify(body),
    }),
  )

const paths = (n: number) =>
  Array.from({ length: n }, (_, i) => `/page-${i + 1}`)

describe('tenant revalidate path cap (AGL-1161)', () => {
  beforeEach(() => {
    mockRevalidatePath.mockClear()
    process.env['REVALIDATE_SECRET'] = SECRET
  })

  it('reports the overflow instead of swallowing it', async () => {
    const response = await call({ host: 'demo', paths: paths(80) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.count).toBe(50)
    // The three fields that let a caller tell "all of it" from "as much as I
    // would take". Without these the response is a lie by omission.
    expect(body.requested).toBe(80)
    expect(body.truncated).toBe(30)
    expect(body.cap).toBe(50)
    expect(mockRevalidatePath).toHaveBeenCalledTimes(50)
  })

  it('CONTROL — says nothing was dropped when nothing was', async () => {
    // Without this the test above passes against a route that reports
    // truncation unconditionally, which would be its own kind of wrong.
    const response = await call({ host: 'demo', paths: paths(48) })
    const body = await response.json()
    expect(body.count).toBe(48)
    expect(body.requested).toBe(48)
    expect(body.truncated).toBe(0)
    // `cap` is present ONLY when it bit — a caller keys off its absence.
    expect(body).not.toHaveProperty('cap')
  })

  it('is exact at the boundary', async () => {
    // 48 fits with two to spare on the real site that motivated this. 50 is
    // where an off-by-one would hide.
    const response = await call({ host: 'demo', paths: paths(50) })
    const body = await response.json()
    expect(body.truncated).toBe(0)
    expect(body.count).toBe(50)
    const over = await (await call({ host: 'demo', paths: paths(51) })).json()
    expect(over.truncated).toBe(1)
    expect(over.count).toBe(50)
  })

  it('keys the cache on the rewritten host path, not the public URL', async () => {
    await call({ host: 'demo', paths: ['/', '/about'] })
    // The middleware rewrites `https://{host}{path}` to `/{host}{path}`, so
    // that is the key Next stored under. Revalidating `/about` would drop
    // nothing and look like it worked.
    expect(mockRevalidatePath).toHaveBeenCalledWith('/demo')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/demo/about')
  })

  it('refuses to bust another host cache through a traversal', async () => {
    // Not a filesystem traversal — a way to NAME a page on a different host's
    // tree. One tenant must never be able to drop another's cache.
    await call({ host: 'demo', paths: ['/../other/secret', 'no-leading-slash'] })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('fails loud when the secret is unset rather than no-opping', async () => {
    delete process.env['REVALIDATE_SECRET']
    const response = await call({ host: 'demo', paths: ['/'] })
    expect(response.status).toBe(503)
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const response = await call({ host: 'demo', paths: ['/'] }, 'wrong')
    expect(response.status).toBe(401)
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})
