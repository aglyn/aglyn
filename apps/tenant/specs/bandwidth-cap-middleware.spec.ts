/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and `NextRequest`/`NextResponse` need real web globals.
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
 * THE LAYER THAT ACTUALLY STOPS THE EGRESS (AGL-2155).
 *
 * The loader's cap branch is defence in depth and is proven in
 * `bandwidth-cap-refusal.spec.ts`. It is not, on its own, a cap: a viral free
 * site's traffic is overwhelmingly served from the ISR cache, and a cached
 * page never calls the loader. Only the middleware runs ahead of that cache,
 * which is why the verdict is consulted here and why this suite exists —
 * without it the feature could ship "working" and still pay out every byte it
 * was built to stop.
 *
 * `hostVerdict` memoizes per isolate for 30 seconds, so every case below uses
 * a DISTINCT tenant host. A shared one would have the second case reading the
 * first case's answer, and the suite would pass on a middleware that only ever
 * fetched once.
 */

const TENANT_DEMO_HOST = 'localhost:4500'

let mockVerdict: Record<string, unknown>
let fetchedUrls: string[]

const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = (async (input: unknown) => {
    fetchedUrls.push(String(input))
    return new Response(JSON.stringify(mockVerdict), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof global.fetch
})
afterAll(() => {
  global.fetch = originalFetch
  // `process.env` is shared by every suite in a jest WORKER, not just this
  // file, so a demo host left behind here would resolve some other spec's
  // tenant host. Cheap to restore; miserable to diagnose.
  delete process.env.AGLYN_TENANT_DEMO
})

import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

/** A plain page request for `host`, which becomes the tenant host verbatim. */
async function request(host: string) {
  process.env.AGLYN_TENANT_DEMO = host
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}/some/page`, {
      headers: { host: TENANT_DEMO_HOST },
    }),
  )
  return middleware(req, {} as never)
}

/** Where the middleware rewrote to, or null when it did not rewrite. */
const rewrittenTo = (response: unknown): string | null =>
  (response as Response | null)?.headers?.get('x-middleware-rewrite') ?? null

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
  fetchedUrls = []
  mockVerdict = { locked: false, attribution: false, overQuota: false }
})

describe('the middleware serves the notice ahead of the ISR cache', () => {
  it('CONTROL — a healthy site is rewritten to its page, not to the notice', async () => {
    const to = rewrittenTo(await request('healthy-site'))
    expect(to).not.toContain('/api/locked')
  })

  it('an overQuota verdict rewrites EVERY path to the notice', async () => {
    mockVerdict = { locked: false, attribution: false, overQuota: true }
    expect(rewrittenTo(await request('capped-site'))).toContain('/api/locked')
  })

  it('a LOCK still rewrites there too — the cap did not displace it', async () => {
    mockVerdict = { locked: true, mode: 'full', attribution: false }
    expect(rewrittenTo(await request('locked-site'))).toContain('/api/locked')
  })

  it('a READ-ONLY lock still serves, and a cap on top of it does not', async () => {
    // AGL-1511's mode must survive the new field: a read-only lock is a write
    // freeze whose entire point is that the site keeps serving and earning.
    mockVerdict = { locked: true, mode: 'read-only', attribution: false }
    expect(rewrittenTo(await request('read-only-site'))).not.toContain(
      '/api/locked',
    )
  })

  describe('FAILS OPEN, in the same direction as the lock', () => {
    it('a verdict with no overQuota field at all serves', async () => {
      // An older deployment's verdict route. Absent must never read as true.
      mockVerdict = { locked: false, attribution: false }
      expect(rewrittenTo(await request('older-deploy-site'))).not.toContain(
        '/api/locked',
      )
    })

    it('a non-boolean overQuota serves', async () => {
      mockVerdict = { locked: false, overQuota: 'yes' }
      expect(rewrittenTo(await request('garbage-verdict-site'))).not.toContain(
        '/api/locked',
      )
    })

    it('an unreachable verdict route serves', async () => {
      // An outage is not a cap. This failing the other way would take every
      // free site on the platform down at once.
      const failing = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('edge fetch failed'))
      expect(rewrittenTo(await request('unreachable-site'))).not.toContain(
        '/api/locked',
      )
      failing.mockRestore()
    })
  })

  it('asks the verdict route, and the cap costs no extra round trip', async () => {
    // The cap rides the lockdown verdict rather than a second endpoint: one
    // fetch per host per TTL decides lock, attribution and cap together.
    mockVerdict = { locked: false, overQuota: true }
    await request('one-fetch-site')
    expect(fetchedUrls).toHaveLength(1)
    expect(fetchedUrls[0]).toContain('/api/lockdown-verdict?host=')
  })
})
