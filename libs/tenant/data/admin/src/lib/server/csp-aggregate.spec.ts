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
 * Durable CSP-violation counters (AGL-1799).
 *
 * Every input to a counter's identity except the calendar comes from an
 * unauthenticated request body, so the properties worth pinning are the
 * BOUNDS, not the arithmetic: a flood of attacker-invented origins must
 * saturate a cap rather than mint unbounded documents (the AGL-1769 lesson),
 * an invented directive must not open a fresh key space, and a hostile
 * `blocked-uri` must never become a Firestore path (the AGL-1771 lineage).
 *
 * The fake below CAPTURES writes rather than modelling Firestore state — the
 * assertions are about which document ids are minted and what the payloads
 * carry, so replaying set/merge semantics would add fidelity risk without
 * adding reach (`feedback_a_test_double_must_model_real_semantics`: model
 * what the assertions read, fabricate nothing beyond it).
 */

import { FieldValue } from 'firebase-admin/firestore'
import type { CspViolation } from '@aglyn/aglyn/app-utils/csp-report'
import {
  CSP_AGGREGATE_COLLECTION,
  CSP_AGGREGATE_RETENTION_DAYS,
  MAX_DISTINCT_ORIGINS_PER_DAY,
  cspBlockedOrigin,
  recordCspViolations,
  resetCspAggregateStateForTests,
} from './csp-aggregate'

/** A fixed instant: 2026-08-17T12:00:00Z. Day bucket `2026-08-17`. */
const NOW = Date.UTC(2026, 7, 17, 12)

const violation = (
  blocked: string,
  directive = 'img-src',
  path = '/pricing',
): CspViolation => ({
  documentPath: path,
  effectiveDirective: directive,
  blockedUri: blocked,
  sourceFile: '',
  sample: '',
  lineNumber: null,
  disposition: 'report',
})

interface CapturedSet {
  collection: string
  id: string
  data: Record<string, any>
  options: unknown
}

function captureFirestore(sets: CapturedSet[], fail = false) {
  return {
    collection: (collection: string) => ({
      doc: (id: string) => ({
        set: async (data: Record<string, any>, options: unknown) => {
          if (fail) throw new Error('firestore unavailable')
          sets.push({ collection, id, data, options })
        },
      }),
    }),
  }
}

describe('CSP violation aggregation (AGL-1799)', () => {
  let sets: CapturedSet[]
  let firestore: ReturnType<typeof captureFirestore>
  let error: jest.SpyInstance

  beforeEach(() => {
    resetCspAggregateStateForTests()
    sets = []
    firestore = captureFirestore(sets)
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => error.mockRestore())

  const record = (violations: CspViolation[], overrides: object = {}) =>
    recordCspViolations(violations, {
      app: 'console',
      now: NOW,
      firestore,
      ...overrides,
    })

  it('mints one counter per (day × app × directive × disposition × origin)', async () => {
    const written = await record([
      violation('https://tracker.example/pixel.gif'),
      violation('https://cdn.example/x.js', 'script-src-elem', '/signin'),
    ])
    expect(written).toBe(2)
    expect(sets.map((s) => s.collection)).toEqual([
      CSP_AGGREGATE_COLLECTION,
      CSP_AGGREGATE_COLLECTION,
    ])
    expect(sets.map((s) => s.id).sort()).toEqual([
      '2026-08-17|console|img-src|report|tracker.example',
      '2026-08-17|console|script-src-elem|report|cdn.example',
    ])
    const img = sets.find((s) => s.id.includes('img-src'))!
    expect(img.options).toEqual({ merge: true })
    expect(img.data.day).toBe('2026-08-17')
    expect(img.data.app).toBe('console')
    expect(img.data.directive).toBe('img-src')
    expect(img.data.origin).toBe('tracker.example')
    expect(img.data.disposition).toBe('report')
    expect(img.data.lastSeenMs).toBe(NOW)
    expect(img.data.lastPath).toBe('/pricing')
    // TTL contract: a Date (Firestore Timestamp), never a number, set from
    // the DAY bucket so every write of a day agrees on one expiry.
    expect(img.data.expiresAt).toEqual(
      new Date(
        Date.UTC(2026, 7, 17) + CSP_AGGREGATE_RETENTION_DAYS * 86_400_000,
      ),
    )
  })

  it('compounds repeats into increment(n) with ONE write, and keeps counting across calls', async () => {
    await record([
      violation('https://tracker.example/pixel.gif'),
      violation('https://tracker.example/pixel.gif'),
      violation('https://tracker.example/pixel.gif'),
    ])
    expect(sets).toHaveLength(1)
    expect(sets[0].data.count.isEqual(FieldValue.increment(3))).toBe(true)

    // A later request for the SAME key writes to the SAME document — the
    // compounding is Firestore's, so instance recycling loses nothing.
    await record([violation('https://tracker.example/pixel.gif')])
    expect(sets).toHaveLength(2)
    expect(sets[1].id).toBe(sets[0].id)
    expect(sets[1].data.count.isEqual(FieldValue.increment(1))).toBe(true)
  })

  it('SATURATES at the distinct-origin cap instead of minting unbounded documents', async () => {
    // The flood bound this module exists to hold (AGL-1769): one and a half
    // times the cap in attacker-invented origins, all one directive.
    const flood = Array.from(
      { length: MAX_DISTINCT_ORIGINS_PER_DAY + 15 },
      (_, i) => violation(`https://evil-${i}.example/x.gif`),
    )
    expect(await record(flood)).toBe(MAX_DISTINCT_ORIGINS_PER_DAY)
    expect(new Set(sets.map((s) => s.id)).size).toBe(
      MAX_DISTINCT_ORIGINS_PER_DAY,
    )

    // Past the cap: a NEW origin is dropped, a KNOWN one still counts —
    // saturation must not blind the counters that already exist.
    sets.length = 0
    expect(await record([violation('https://evil-999.example/x.gif')])).toBe(0)
    expect(await record([violation('https://evil-0.example/x.gif')])).toBe(1)

    // And the cap is per DIRECTIVE: the flood above must not have spent
    // img-src's budget on script-src's behalf.
    sets.length = 0
    expect(
      await record([violation('https://cdn.example/x.js', 'script-src-elem')]),
    ).toBe(1)
  })

  it('routes an invented directive into `other` rather than a fresh key space', async () => {
    await record([violation('https://x.example/a', 'totally-invented-src')])
    expect(sets[0].id).toBe('2026-08-17|console|other|report|x.example')
    expect(sets[0].data.directive).toBe('other')
  })

  it('never lets a hostile blocked-uri become a Firestore path', async () => {
    // Path traversal, a nested-path id, a reserved id, and junk — each must
    // come out as ONE opaque component (the AGL-1771 predicate's contract).
    await record([
      violation('a/b/c'),
      violation('..'),
      violation('__proto__'),
      violation('inline'),
    ])
    for (const s of sets) {
      expect(s.id).not.toContain('/')
      expect(s.id).not.toMatch(/^__.*__$/)
    }
    expect(cspBlockedOrigin('a/b/c')).not.toContain('/')
    expect(cspBlockedOrigin('')).toBe('none')
    // URL forms reduce to the HOST — twelve chunk paths off one CDN are one
    // origin-level fact, and a path would hand id-minting to the attacker.
    expect(cspBlockedOrigin('https://cdn.example:8443/deep/path.js')).toBe(
      'cdn.example:8443',
    )
  })

  it('stops writing when the per-instance minute budget is spent, and recovers next window', async () => {
    // Fill the budget exactly: 120 = 4 directives × the 30-origin cap.
    const directives = ['img-src', 'script-src-elem', 'style-src', 'font-src']
    for (const directive of directives) {
      const batch = Array.from({ length: MAX_DISTINCT_ORIGINS_PER_DAY }, (_, i) =>
        violation(`https://host-${i}.example/x`, directive),
      )
      expect(await record(batch)).toBe(MAX_DISTINCT_ORIGINS_PER_DAY)
    }
    expect(sets).toHaveLength(4 * MAX_DISTINCT_ORIGINS_PER_DAY)

    // Budget exhausted: even a fresh directive writes nothing.
    expect(
      await record([violation('https://more.example/x', 'connect-src')]),
    ).toBe(0)
    expect(sets).toHaveLength(4 * MAX_DISTINCT_ORIGINS_PER_DAY)

    // A minute later the window resets and the same write goes through.
    expect(
      await record([violation('https://more.example/x', 'connect-src')], {
        now: NOW + 61_000,
      }),
    ).toBe(1)
  })

  it('carries the tenant site as a clamped SAMPLE field, never in the id', async () => {
    await record([violation('https://x.example/a')], {
      app: 'tenant',
      site: `acme.example${'x'.repeat(300)}`,
    })
    expect(sets[0].id).toBe('2026-08-17|tenant|img-src|report|x.example')
    expect(sets[0].data.lastSite).toHaveLength(253)
    expect(sets[0].id).not.toContain('acme')
  })

  it('fails SOFT: a Firestore outage costs the aggregate, never the response', async () => {
    const failing = captureFirestore(sets, true)
    await expect(
      recordCspViolations([violation('https://x.example/a')], {
        app: 'console',
        now: NOW,
        firestore: failing,
      }),
    ).resolves.toBe(0)
    // One tagged console.error — NOT console.warn, which the collector
    // specs count as report lines.
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain('AGL-1799:csp-aggregate')
  })

  it('writes nothing for an empty batch', async () => {
    expect(await record([])).toBe(0)
    expect(sets).toHaveLength(0)
  })
})
