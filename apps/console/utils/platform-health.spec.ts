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

import {
  HEALTH_PROBES,
  readCspReport,
  readEmailHealthResponse,
  readHealthResponse,
  summarizePlatformHealth,
  type HealthProbeResult,
} from './platform-health'

describe('readHealthResponse', () => {
  // THE contract of this module: the health endpoints answer 503 when they
  // are degraded. Treating that as a failed read would turn every real
  // outage into "unknown" — the inversion this whole surface exists to avoid.
  it('reads a 503 as a DEGRADED report, not as a failure to read', () => {
    const result = readHealthResponse(503, {
      status: 'degraded',
      checks: {
        backups: {
          ok: false,
          ms: 120,
          code: 'STALE',
          states: { READY: 1, NOT_AVAILABLE: 2 },
          newestReadyAgeDays: 9,
        },
      },
    })
    expect(result.verdict).toBe('degraded')
    expect(result.error).toBeNull()
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].code).toBe('STALE')
    expect(result.checks[0].facts).toContain('1 READY · 2 NOT_AVAILABLE')
    expect(result.checks[0].facts).toContain('newest usable backup is 9 days old')
  })

  it('reads a 200 as healthy', () => {
    const result = readHealthResponse(200, {
      status: 'ok',
      checks: { firestore: { ok: true, ms: 12 } },
    })
    expect(result.verdict).toBe('ok')
    expect(result.checks[0].ms).toBe(12)
  })

  it('calls a refusal UNREACHABLE, never healthy', () => {
    // A staff probe answering 403 must not render as a green tile.
    const result = readHealthResponse(403, { error: 'Staff only' })
    expect(result.verdict).toBe('unreachable')
    expect(result.error).toBe('Staff only')
  })

  it('calls a probe that never answered unreachable', () => {
    const result = readHealthResponse(null, null)
    expect(result.verdict).toBe('unreachable')
    expect(result.error).toContain('did not answer')
  })

  it('derives degraded from a failing check when the body states no status', () => {
    const result = readHealthResponse(200, {
      checks: { firestore: { ok: false, ms: 3, code: 'TIMEOUT' } },
    })
    expect(result.verdict).toBe('degraded')
  })

  it('words the rate-limit figures instead of leaving raw fields', () => {
    const result = readHealthResponse(503, {
      status: 'degraded',
      checks: {
        rateLimits: {
          ok: false,
          ms: 40,
          degradedCalls: 12,
          degradedEpisodes: 3,
          minutesSinceLast: 7,
          windowMinutes: 60,
          threshold: 1,
        },
      },
    })
    const facts = result.checks[0].facts
    expect(facts).toContain('12 fallback calls in window')
    expect(facts).toContain('3 instance-episodes — more than one instance saw it')
    expect(facts).toContain('last fallback 7 min ago')
  })

  it('says so when no usable backup exists at all', () => {
    const result = readHealthResponse(503, {
      status: 'degraded',
      checks: {
        backups: { ok: false, ms: 1, states: {}, newestReadyAgeDays: null },
      },
    })
    expect(result.checks[0].facts).toContain('no backups listed at all')
    expect(result.checks[0].facts).toContain('no usable backup exists')
  })
})

describe('readEmailHealthResponse', () => {
  it('reads a configured deployment as healthy', () => {
    const result = readEmailHealthResponse(200, {
      healthy: true,
      hasApiKey: true,
      hasFrom: true,
      fromDomain: 'aglyn.com',
      blockers: [],
      credentials: { status: 'ok' },
    })
    expect(result.verdict).toBe('ok')
    expect(result.checks[0].facts).toContain('sends from aglyn.com')
  })

  it('surfaces each blocker in the order delivery breaks', () => {
    const result = readEmailHealthResponse(200, {
      healthy: false,
      hasApiKey: false,
      hasFrom: false,
      blockers: ['RESEND_API_KEY is not set', 'USAGE_EMAIL_FROM is not set'],
    })
    expect(result.verdict).toBe('degraded')
    expect(result.checks[0].facts).toContain('API key MISSING')
    expect(result.checks[0].facts).toContain('sender address MISSING')
    expect(result.checks[0].facts).toContain('RESEND_API_KEY is not set')
  })

  it('does not read a refusal as healthy', () => {
    const result = readEmailHealthResponse(403, { error: 'Staff only' })
    expect(result.verdict).toBe('unreachable')
    expect(result.error).toBe('Staff only')
  })
})

describe('summarizePlatformHealth', () => {
  const result = (id: string, verdict: HealthProbeResult['verdict']) =>
    ({ id, verdict, httpStatus: 200, checks: [], error: null }) as HealthProbeResult

  it('is all-green only when every probe answered and every one is ok', () => {
    const all = HEALTH_PROBES.map((probe) => result(probe.id, 'ok'))
    expect(summarizePlatformHealth(all).allGreen).toBe(true)
  })

  // The guard, proven able to fail: a board that reports "all normal" while a
  // probe never replied is asserting something it did not check.
  it('is NOT all-green when a probe never answered', () => {
    const all = HEALTH_PROBES.map((probe, index) =>
      result(probe.id, index === 0 ? 'unreachable' : 'ok'),
    )
    const summary = summarizePlatformHealth(all)
    expect(summary.allGreen).toBe(false)
    expect(summary.unreachable).toEqual([HEALTH_PROBES[0].id])
  })

  it('is NOT all-green when results are still missing', () => {
    const partial = HEALTH_PROBES.slice(0, 2).map((probe) =>
      result(probe.id, 'ok'),
    )
    expect(summarizePlatformHealth(partial).allGreen).toBe(false)
  })

  it('separates degraded from unreachable', () => {
    const summary = summarizePlatformHealth([
      result('serving', 'degraded'),
      result('email', 'unreachable'),
      result('signups', 'ok'),
    ])
    expect(summary.degraded).toEqual(['serving'])
    expect(summary.unreachable).toEqual(['email'])
    expect(summary.ok).toEqual(['signups'])
  })
})

describe('every probe descriptor is renderable', () => {
  it('carries a label, a path, a meaning and a remedy', () => {
    expect(HEALTH_PROBES.length).toBeGreaterThan(0)
    for (const probe of HEALTH_PROBES) {
      expect(probe.id).toBeTruthy()
      expect(probe.label).toBeTruthy()
      expect(probe.path.startsWith('/api/')).toBe(true)
      expect(probe.meaning.length).toBeGreaterThan(20)
      expect(probe.remedy.length).toBeGreaterThan(20)
    }
  })

  it('has unique ids', () => {
    const ids = HEALTH_PROBES.map((probe) => probe.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('readCspReport', () => {
  it('totals violations per directive, most-violated first', () => {
    const view = readCspReport({
      windowDays: 14,
      since: '2026-08-04',
      rowCount: 3,
      truncated: false,
      rows: [
        { directive: 'img-src', count: 10, blockedOrigin: 'https://a.example' },
        { directive: 'script-src', count: 40, blockedOrigin: 'https://b.example' },
        { directive: 'img-src', count: 5, blockedOrigin: 'https://c.example' },
      ],
    })
    expect(view.totalViolations).toBe(55)
    expect(view.directives).toEqual([
      { directive: 'script-src', count: 40 },
      { directive: 'img-src', count: 15 },
    ])
    expect(view.windowDays).toBe(14)
  })

  it('reads an empty window as zero rather than as no answer', () => {
    // Zero violations is the finding that says a directive is safe to enforce.
    const view = readCspReport({ windowDays: 14, since: '2026-08-04', rows: [] })
    expect(view).toBeTruthy()
    expect(view.totalViolations).toBe(0)
    expect(view.directives).toEqual([])
  })

  it('carries the truncation flag through', () => {
    const view = readCspReport({ rows: [], truncated: true })
    expect(view.truncated).toBe(true)
  })

  it('answers null when there is no report at all', () => {
    expect(readCspReport(null)).toBeNull()
    expect(readCspReport({ error: 'CSP report read failed' })).toBeNull()
  })
})
