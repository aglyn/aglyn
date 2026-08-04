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
 * AGL-1161: the path cap must SAY when it bites.
 * AGL-1239: and it must not bite on an ordinary site.
 *
 * `paths.slice(0, cap)` silently discarded the overflow — a caller sending 80
 * paths got `count: 50` back with nothing to distinguish that from having sent
 * 50. The dropped pages then sat stale for the full revalidate window while the
 * editor reported a successful publish, which is the exact "reported fast,
 * still slow" confusion AGL-1150 set out to remove.
 *
 * A widely-used component is the case that overflows, and it was measured on
 * production: `aglyn-marketing`'s "Site nav" fans out to 48 screens. Against
 * the old cap of 50 that fit by two — which is why AGL-1239 raised it to 250.
 * `SITE_FANOUT` below is that real measurement, kept as the number this suite
 * asserts must NOT truncate, so the margin is guarded by a test rather than by
 * whoever last read the issue.
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

/** The cap the route ships with (AGL-1239 raised it from 50). */
const CAP = 250

/**
 * The real fan-out of `aglyn-marketing`'s nav component, measured on production
 * 2026-08-04. The point of the cap is that a site like this never reaches it.
 */
const SITE_FANOUT = 48

describe('tenant revalidate path cap (AGL-1161, AGL-1239)', () => {
  beforeEach(() => {
    mockRevalidatePath.mockClear()
    process.env['REVALIDATE_SECRET'] = SECRET
  })

  it('reports the overflow instead of swallowing it', async () => {
    const response = await call({ host: 'demo', paths: paths(CAP + 30) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.count).toBe(CAP)
    // The three fields that let a caller tell "all of it" from "as much as I
    // would take". Without these the response is a lie by omission.
    expect(body.requested).toBe(CAP + 30)
    expect(body.truncated).toBe(30)
    expect(body.cap).toBe(CAP)
    expect(mockRevalidatePath).toHaveBeenCalledTimes(CAP)
  })

  it('CONTROL — says nothing was dropped when nothing was', async () => {
    // Without this the test above passes against a route that reports
    // truncation unconditionally, which would be its own kind of wrong.
    const response = await call({ host: 'demo', paths: paths(SITE_FANOUT) })
    const body = await response.json()
    expect(body.count).toBe(SITE_FANOUT)
    expect(body.requested).toBe(SITE_FANOUT)
    expect(body.truncated).toBe(0)
    // `cap` is present ONLY when it bit — a caller keys off its absence.
    expect(body).not.toHaveProperty('cap')
  })

  it('does not bite on a real site, with room to grow (AGL-1239)', async () => {
    // The regression this issue exists to prevent. Under the old cap of 50 the
    // measured 48 fit by two; anyone lowering the cap back toward the size of
    // an ordinary site fails HERE rather than in production a publish later.
    // Asserted against a quadrupled site rather than the measurement alone, so
    // the test guards the margin and not just the day it was taken.
    const grown = await (
      await call({ host: 'demo', paths: paths(SITE_FANOUT * 4) })
    ).json()
    expect(grown.truncated).toBe(0)
    expect(grown.count).toBe(SITE_FANOUT * 4)
  })

  it('is exact at the boundary', async () => {
    const response = await call({ host: 'demo', paths: paths(CAP) })
    const body = await response.json()
    expect(body.truncated).toBe(0)
    expect(body.count).toBe(CAP)
    const over = await (await call({ host: 'demo', paths: paths(CAP + 1) })).json()
    expect(over.truncated).toBe(1)
    expect(over.count).toBe(CAP)
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
