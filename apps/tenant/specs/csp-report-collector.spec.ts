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
 * The tenant CSP collector (AGL-1703).
 *
 * The parser is shared with the console and is tested there
 * (`apps/console/specs/csp-report.spec.ts`, 14 cases). What is NOT shared, and
 * what this file exists for, is everything that follows from the collector
 * sitting on our CUSTOMERS' public websites rather than on a logged-in console:
 *
 * - the report must say WHICH site, and that has to come from the request
 *   rather than from a body an anonymous caller wrote;
 * - one real defect must not cost one log line per visitor. The console dedupes
 *   only within a single POST, which is correct there and worthless here —
 *   10,000 visitors reporting the same broken image send 10,000 POSTs of one
 *   report each, and no POST ever contains a duplicate.
 *
 * The second is the one worth testing, because it is the property a reviewer
 * would most reasonably assume is already handled by the shared code.
 */

// The durable aggregate (AGL-1799) is a Firestore write, so HERE it is a spy:
// what this suite can meaningfully pin is the wiring — which violations the
// route hands over, and that the damper does not starve them. The bounding
// behaviour behind the spy is tested against an injected fake store in
// `libs/tenant/data/admin/src/lib/server/csp-aggregate.spec.ts`.
const mockRecordCspViolations = jest.fn(async () => 0)

// The route pulls the in-memory limiter from the tenant-data-admin barrel,
// which drags in firebase-admin. The limiter itself is 20 lines of arithmetic
// over an injectable Map, so it is reimplemented here rather than mocked away
// to a stub that would make the damping assertions vacuous.
jest.mock('@aglyn/tenant-data-admin', () => {
  // Types are inlined rather than aliased: jest's out-of-scope guard rejects a
  // `type` declaration inside a mock factory as readily as a variable.
  const fallback = new Map<string, { count: number; windowStartMs: number }>()
  return {
    recordCspViolations: (...args: unknown[]) =>
      mockRecordCspViolations(...(args as [])),
    checkRateLimit: (
      key: string,
      options?: {
        limit?: number
        windowMs?: number
        store?: Map<string, { count: number; windowStartMs: number }>
      },
    ) => {
      const limit = options?.limit ?? 120
      const windowMs = options?.windowMs ?? 60_000
      const store = options?.store ?? fallback
      const now = Date.now()
      const state = store.get(key)
      if (!state || now - state.windowStartMs >= windowMs) {
        store.set(key, { count: 1, windowStartMs: now })
        return { allowed: true, limit, remaining: limit - 1, resetMs: now + windowMs }
      }
      state.count += 1
      return {
        allowed: state.count <= limit,
        limit,
        remaining: Math.max(0, limit - state.count),
        resetMs: state.windowStartMs + windowMs,
      }
    },
  }
})

/** One legacy-format report. `blockedUri` varies so each test gets a fresh key. */
const reportBody = (blocked: string, path = '/pricing') =>
  JSON.stringify({
    'csp-report': {
      'document-uri': `https://acme.com${path}`,
      'effective-directive': 'img-src',
      'blocked-uri': blocked,
      disposition: 'report',
    },
  })

/** Each call gets its own IP so the per-IP limiter never confounds a case. */
let ipCounter = 0
const post = async (body: string, host = 'acme.com') => {
  const { POST } = await import('../app/api/csp-report/route')
  ipCounter += 1
  return POST(
    new Request('https://acme.com/api/csp-report', {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/csp-report',
        'x-forwarded-for': `203.0.113.${ipCounter % 250}`,
      },
      body,
    }),
  )
}

const logged = (warn: jest.SpyInstance) =>
  warn.mock.calls.map(([line]) => JSON.parse(String(line)))

describe('tenant csp-report collector (AGL-1703)', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockRecordCspViolations.mockClear()
  })
  afterEach(() => warn.mockRestore())

  it('logs a violation tagged separately from the console stream', async () => {
    const response = await post(reportBody('https://tracker.example/a.gif'))
    expect(response.status).toBe(204)
    const lines = logged(warn)
    expect(lines).toHaveLength(1)
    // A distinct tag, not the console's `AGL-523:csp-violation`: the two
    // collectors answer different questions and a log query that cannot tell
    // them apart would read tenant volume as console volume.
    expect(lines[0].tag).toBe('AGL-1703:tenant-csp-violation')
    expect(lines[0].directive).toBe('img-src')
    expect(lines[0].blocked).toBe('https://tracker.example/a.gif')
  })

  it('names the site from the REQUEST, not from the body', async () => {
    // The body is written by an anonymous caller who may claim any
    // `document-uri` at all. Here it claims `acme.com` while the request
    // arrives on `victim.example` — if the logged site followed the body, one
    // customer could file reports against another's domain.
    await post(reportBody('https://tracker.example/b.gif'), 'victim.example')
    const lines = logged(warn)
    expect(lines[0].site).toBe('victim.example')
    // The path still comes from the body, which is fine — it is clamped, and
    // it is scoped by the site above rather than trusted on its own.
    expect(lines[0].path).toBe('/pricing')
  })

  it('rejects a junk Host rather than logging it verbatim', async () => {
    // The site is the one attacker-influenced field that reaches the log
    // outside the parser's clamps, so it gets a character allowlist of its own.
    //
    // CRLF is deliberately NOT the case tested here: `new Request` refuses to
    // construct with a header value containing one, so the classic log-
    // injection payload never reaches this route in the first place. What CAN
    // arrive is anything else a header value permits, which is most of ASCII.
    await post(reportBody('https://tracker.example/c.gif'), 'evil host <script>')
    expect(logged(warn)[0].site).toBe('unknown')
  })

  it('DAMPS a repeated violation ACROSS separate requests', async () => {
    // The property the console's collector does not have, and the reason this
    // route is not a copy of it. Ten separate visitors, ten separate POSTs,
    // one underlying defect. Without the per-key limiter every one of these is
    // a log line, on every page view, forever, on every site carrying it.
    const blocked = 'https://tracker.example/shared-header.gif'
    for (let i = 0; i < 10; i += 1) await post(reportBody(blocked))
    // KEY_LIMIT is 3 — deliberately not 1, so the same defect showing up on
    // several sites still reads as several findings.
    expect(logged(warn)).toHaveLength(3)
  })

  it('feeds the durable aggregate from BEFORE the log damper (AGL-1799)', async () => {
    // The damper protects the LOG from one defect costing a line per page
    // view; the counter is the thing that WANTS those occurrences compounded
    // — a week of traffic must be readable after the log's hour is gone. Five
    // visitors, one defect: three log lines, but five aggregate deliveries.
    const blocked = 'https://tracker.example/damped-but-counted.gif'
    for (let i = 0; i < 5; i += 1) await post(reportBody(blocked))
    expect(logged(warn)).toHaveLength(3)
    expect(mockRecordCspViolations).toHaveBeenCalledTimes(5)
    const [violations, options] = mockRecordCspViolations.mock.calls[4] as any
    expect(violations).toHaveLength(1)
    expect(violations[0].blockedUri).toBe(blocked)
    // The site rides along, REQUEST-derived like the log line's.
    expect(options).toEqual({ app: 'tenant', site: 'acme.com' })
  })

  it('never aggregates what the parser rejected', async () => {
    await post(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://acme.com/',
          'effective-directive': 'img-src',
          'blocked-uri': 'chrome-extension://abcdef/pixel.png',
        },
      }),
    )
    await post('not json')
    expect(mockRecordCspViolations).not.toHaveBeenCalled()
  })

  it('still distinguishes DIFFERENT violations on the same site', async () => {
    // The damper must not be so blunt that it hides a second defect behind a
    // first. Same site, same directive, different blocked host.
    await post(reportBody('https://one.example/x.gif'))
    await post(reportBody('https://two.example/y.gif'))
    expect(logged(warn)).toHaveLength(2)
  })

  it('drops browser-extension noise without logging it', async () => {
    const response = await post(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://acme.com/',
          'effective-directive': 'img-src',
          'blocked-uri': 'chrome-extension://abcdef/pixel.png',
        },
      }),
    )
    expect(response.status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers 204 and logs nothing for junk, oversized and empty bodies', async () => {
    // A report endpoint that argues with the browser gets retried, and the
    // status is read by nothing. Oversized is capped BEFORE parse.
    for (const body of ['not json', '', '[]', '{}', 'x'.repeat(20_000)]) {
      expect((await post(body)).status).toBe(204)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers the CORS preflight', async () => {
    const { OPTIONS } = await import('../app/api/csp-report/route')
    const response = OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })
})
