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
 * The abuse CEILING is served ahead of the ISR cache (AGL-2690).
 *
 * The sibling suite `bandwidth-cap-middleware.spec.ts` makes this argument for
 * the plan CAP; the ceiling arrived at the same place for a sharper reason.
 * The cap lives on the org doc, so engaging or clearing it is a write, and a
 * write can bust a cache. The ceiling clears by the CALENDAR — the stamp names
 * a month and `bandwidthCeilingMonthKey()` stops matching it — so there is no
 * write at that moment and nothing to hook a cache drop to. Evaluated only in
 * the loader, the notice would keep being served out of the ISR cache for a
 * full window into a month where the site was no longer contained. That window
 * is now an hour.
 *
 * So the verdict answers it, the middleware acts on it, and the whole thing is
 * bounded by the 30-second memo instead.
 *
 * `hostVerdict` memoizes per isolate for 30 seconds, so every case below uses a
 * DISTINCT tenant host — otherwise the second case reads the first case's
 * answer and the suite passes on a middleware that only ever fetched once.
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
  // `process.env` is shared by every suite in a jest WORKER, so a demo host
  // left behind here would resolve some other spec's tenant host.
  delete process.env.AGLYN_TENANT_DEMO
})

import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

async function request(host: string) {
  process.env.AGLYN_TENANT_DEMO = host
  const req = new NextRequest(
    new Request(`http://${TENANT_DEMO_HOST}/some/page`, {
      headers: { host: TENANT_DEMO_HOST },
    }),
  )
  return middleware(req, {} as never)
}

const rewrittenTo = (response: unknown): string | null =>
  (response as Response | null)?.headers?.get('x-middleware-rewrite') ?? null

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
  fetchedUrls = []
  mockVerdict = {
    locked: false,
    attribution: false,
    overQuota: false,
    contained: false,
  }
})

describe('a contained site is refused ahead of the ISR cache', () => {
  it('CONTROL — an uncontained site is rewritten to its page', async () => {
    expect(rewrittenTo(await request('ceiling-healthy'))).not.toContain(
      '/api/locked',
    )
  })

  it('a contained verdict rewrites EVERY path to the notice', async () => {
    mockVerdict = { ...mockVerdict, contained: true }
    expect(rewrittenTo(await request('ceiling-contained'))).toContain(
      '/api/locked',
    )
  })

  it('costs no extra round trip — it rides the verdict already fetched', async () => {
    mockVerdict = { ...mockVerdict, contained: true }
    await request('ceiling-one-fetch')
    expect(fetchedUrls.filter((url) => url.includes('lockdown-verdict'))).toHaveLength(
      1,
    )
  })

  it('a lock still outranks it — both serve 503, and the reason must be true', async () => {
    mockVerdict = { locked: true, attribution: false, contained: true }
    expect(rewrittenTo(await request('ceiling-and-lock'))).toContain(
      '/api/locked',
    )
  })
})

/**
 * The direction that matters most. A verdict this middleware cannot read must
 * never take a site OFF the air — the same posture the lock and the cap hold,
 * and the reason `contained` starts `false` rather than being derived.
 */
describe('FAILS OPEN, in the same direction as the lock and the cap', () => {
  it('a verdict with no contained field at all serves', async () => {
    // An older deployment's verdict route, which predates the field.
    mockVerdict = { locked: false, attribution: false, overQuota: false }
    expect(rewrittenTo(await request('ceiling-absent-field'))).not.toContain(
      '/api/locked',
    )
  })

  it('a non-boolean contained serves', async () => {
    mockVerdict = { ...mockVerdict, contained: 'yes' }
    expect(rewrittenTo(await request('ceiling-non-boolean'))).not.toContain(
      '/api/locked',
    )
  })

  it('an unreachable verdict route serves', async () => {
    const failing = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('verdict route down'))
    expect(rewrittenTo(await request('ceiling-unreachable'))).not.toContain(
      '/api/locked',
    )
    failing.mockRestore()
  })
})
