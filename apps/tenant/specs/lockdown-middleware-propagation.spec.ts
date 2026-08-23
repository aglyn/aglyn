/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and `NextRequest`/`NextResponse` need real web globals.
 */

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
 * THE PANIC-BUTTON DRILL (AGL-1621), layer 2: the tenant middleware memo.
 *
 * Layer 1 — the verdict reader's 15s cache — is measured against a real
 * Firestore in
 * `apps/console/app/api/admin/lockdown/route.drill.emulator.spec.ts`.
 * That number is NOT the propagation a visitor experiences, because the
 * tenant does not read Firestore on the request path: the edge middleware
 * asks `/api/lockdown-verdict` and memoizes the answer per isolate for
 * `LOCKDOWN_VERDICT_TTL_MS`. The two caches are in SERIES, so a visitor's
 * worst case is their sum, and this file measures the second term.
 *
 * ## Why this layer is the one that matters
 *
 * Tenant pages are ISR-cached with `revalidate = 60`. A cached page never
 * calls the loader, so the loader's lockdown branch — real, and defence in
 * depth — cannot take a site down on its own. Only the middleware runs ahead
 * of the cache. Whatever this file measures IS the visitor-facing
 * propagation of a takedown, and the ISR TTL is irrelevant to it. That is
 * the answer to "does the CDN defeat the lock": it does not, and this is the
 * measurement that says so rather than the assumption that says so.
 *
 * ## Method
 *
 * The verdict route is stubbed at `fetch`, so what is under measurement is
 * exactly the memo and nothing else — no Firestore, no HTTP, no clock
 * mocking. Real `setTimeout`, real `Date.now()`: the memo is compared
 * against the wall clock, which is what an operator is holding.
 *
 * A DISTINCT host per case, always. `hostVerdict` memoizes per host, so a
 * shared one would have the second case reading the first case's answer and
 * the suite would pass on a middleware that only ever fetched once.
 *
 * ## Running it
 *
 * Opt-in, because it spends real half-minutes waiting on a real TTL:
 *
 *   LOCKDOWN_DRILL=1 npx jest -c apps/tenant/jest.config.ts \
 *     --testPathPatterns lockdown-middleware-propagation --runInBand
 *
 * Without `LOCKDOWN_DRILL=1` the timing cases skip and only the instant
 * assertions run, so a normal suite pays nothing.
 */

const TENANT_DEMO_HOST = 'localhost:4500'

/** Poll cadence for the convergence measurements; also their resolution. */
const POLL_MS = 250
/** Ceiling on one convergence wait. Comfortably past the 30s memo. */
const CONVERGE_TIMEOUT_MS = 60_000

const DRILL = process.env.LOCKDOWN_DRILL === '1'

let mockVerdict: Record<string, unknown>
let fetchCount: number

const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = (async () => {
    fetchCount += 1
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

const measurements: Array<{ what: string; ms: number }> = []

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
  fetchCount = 0
  mockVerdict = { locked: false, attribution: false, overQuota: false }
})

afterAll(() => {
  if (measurements.length) {
    console.log(
      '\nAGL-1621 LAYER-2 MEASUREMENTS (tenant middleware memo)\n' +
        measurements
          .map((m) => `  ${m.what.padEnd(44)}${String(m.ms).padStart(6)}ms`)
          .join('\n') +
        `\n  (resolution ±${POLL_MS}ms; add layer 1 for the visitor's ` +
        `worst case)\n`,
    )
  }
})

describe('lockdown propagation through the tenant middleware', () => {
  it('CONTROL — the notice is served ahead of the ISR cache, not by it', async () => {
    // The premise of every number below: this decision is taken in the
    // middleware, which runs before the page cache. If it were not, the
    // propagation bound would be the page's `revalidate`, not the memo.
    mockVerdict = { locked: true, mode: 'full', attribution: false }
    expect(await rewriteFor('control-locked-site')).toContain('/api/locked')
    mockVerdict = { locked: false, attribution: false, overQuota: false }
    expect(await rewriteFor('control-healthy-site')).not.toContain(
      '/api/locked',
    )
  })

  it('memoizes per host: a hot host costs one verdict fetch, not one per request', async () => {
    for (let i = 0; i < 8; i += 1) await rewriteFor('memo-count-site')
    expect(fetchCount).toBe(1)
  })

  it('fails OPEN — an unreachable verdict keeps the site serving', async () => {
    // Direction matters and is the opposite of CSRF's. Verified here rather
    // than assumed: an operator must know that a lock which cannot be READ
    // is a lock that is not enforced, so a Firestore incident during a
    // takedown means the takedown is not holding.
    global.fetch = (async () => {
      throw new Error('verdict route unreachable')
    }) as typeof global.fetch
    expect(await rewriteFor('fail-open-site')).not.toContain('/api/locked')
    global.fetch = (async () => {
      fetchCount += 1
      return new Response(JSON.stringify(mockVerdict), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof global.fetch
  })

  const timed = DRILL ? it : it.skip

  timed(
    'MEASURED — how long a warm isolate keeps serving after a lock lands',
    async () => {
      const host = 'drill-lock-site'
      // Prime the memo with the healthy answer, as a hot isolate would be.
      expect(await rewriteFor(host)).not.toContain('/api/locked')

      const flippedAt = Date.now()
      mockVerdict = { locked: true, mode: 'full', attribution: false }
      const ms = await convergeMs(
        async () => (await rewriteFor(host)).includes('/api/locked'),
        flippedAt,
      )
      measurements.push({ what: 'warm isolate starts refusing', ms })
      expect(ms).toBeLessThan(CONVERGE_TIMEOUT_MS)
    },
    120_000,
  )

  timed(
    'MEASURED — how long a warm isolate keeps refusing after a lift',
    async () => {
      const host = 'drill-lift-site'
      mockVerdict = { locked: true, mode: 'full', attribution: false }
      expect(await rewriteFor(host)).toContain('/api/locked')

      const flippedAt = Date.now()
      mockVerdict = { locked: false, attribution: false, overQuota: false }
      const ms = await convergeMs(
        async () => !(await rewriteFor(host)).includes('/api/locked'),
        flippedAt,
      )
      measurements.push({ what: 'warm isolate resumes serving', ms })
      expect(ms).toBeLessThan(CONVERGE_TIMEOUT_MS)
    },
    120_000,
  )

  timed(
    'MEASURED — a COLD isolate refuses on its first request',
    async () => {
      // The asymmetry the runbook's old "≤10s" number was really observing.
      // A fresh isolate has no memo, so a browser refresh that happens to
      // land on one shows the lock instantly — which is a lucky observation,
      // not a bound. Every already-warm isolate is still on its own TTL.
      mockVerdict = { locked: true, mode: 'full', attribution: false }
      const at = Date.now()
      expect(await rewriteFor('drill-cold-isolate-site')).toContain(
        '/api/locked',
      )
      measurements.push({
        what: 'cold isolate (first-ever request)',
        ms: Date.now() - at,
      })
    },
    120_000,
  )
})

// ------------------------------------------------------------------ helpers

/** A plain page request for `host`, which becomes the tenant host verbatim. */
async function rewriteFor(host: string): Promise<string> {
  process.env.AGLYN_TENANT_DEMO = host
  const response = (await middleware(
    new NextRequest(
      new Request(`http://${TENANT_DEMO_HOST}/some/page`, {
        headers: { host: TENANT_DEMO_HOST },
      }),
    ),
    {} as never,
  )) as Response | null
  return response?.headers?.get('x-middleware-rewrite') ?? ''
}

async function convergeMs(
  predicate: () => Promise<boolean>,
  fromMs: number,
): Promise<number> {
  const deadline = fromMs + CONVERGE_TIMEOUT_MS
  for (;;) {
    if (await predicate()) return Date.now() - fromMs
    if (Date.now() > deadline) {
      throw new Error(
        `the middleware did not converge within ${CONVERGE_TIMEOUT_MS}ms — ` +
          'this is a FAILED drill, not a slow one',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}
