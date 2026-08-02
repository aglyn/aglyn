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
  HEALTH_NO_STORE,
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
} from './health-report'

const OK = { ok: true, ms: 12 }
const BAD = { ok: false, ms: 5000, code: 'deadline-exceeded' }

describe('healthStatus', () => {
  it('is degraded if ANY check failed — no partial credit', () => {
    expect(healthStatus({ firestore: OK })).toBe('ok')
    expect(healthStatus({ firestore: OK, stripe: OK })).toBe('ok')
    expect(healthStatus({ firestore: OK, stripe: BAD })).toBe('degraded')
    expect(healthStatus({ firestore: BAD })).toBe('degraded')
  })

  it('treats no checks as ok rather than throwing', () => {
    // A liveness-only probe is a legitimate configuration; it must not 503.
    expect(healthStatus({})).toBe('ok')
  })
})

describe('the status code is the contract', () => {
  it('maps degraded to 503, not a 200 with a sad body', () => {
    // Most uptime monitors read the status code and nothing else. A 200 whose
    // body says "degraded" is a signal nobody receives.
    expect(healthHttpStatus('ok')).toBe(200)
    expect(healthHttpStatus('degraded')).toBe(503)
  })
})

describe('nothing may cache a health check', () => {
  it('sets no-store on success AND on failure', () => {
    // The failure response is the one you least want served from a cache: a
    // cached 503 outlives the outage, a cached 200 hides it.
    for (const status of ['ok', 'degraded'] as const) {
      expect(healthHeaders(status)['Cache-Control']).toBe(HEALTH_NO_STORE)
    }
  })

  it('spells out every directive a CDN might honour', () => {
    // `no-cache` alone permits a stored-and-revalidated copy; `max-age=0`
    // alone permits serving stale. Only the full set stops all of them.
    for (const directive of ['no-store', 'no-cache', 'must-revalidate', 'max-age=0']) {
      expect(`${directive}: ${HEALTH_NO_STORE.includes(directive)}`).toBe(
        `${directive}: true`,
      )
    }
  })

  it('asks a monitor to retry only when degraded', () => {
    expect(healthHeaders('degraded')['Retry-After']).toBe('30')
    expect(healthHeaders('ok')['Retry-After']).toBeUndefined()
  })
})

describe('healthBody', () => {
  it('reports the service, the checks and which build answered', () => {
    const body = healthBody({
      service: 'console',
      checks: { firestore: OK },
      commit: 'abc1234',
      environment: 'production',
      region: 'iad1',
      at: '2026-08-02T00:00:00.000Z',
    })
    expect(body).toEqual({
      status: 'ok',
      service: 'console',
      checks: { firestore: OK },
      commit: 'abc1234',
      environment: 'production',
      region: 'iad1',
      at: '2026-08-02T00:00:00.000Z',
    })
  })

  it('nulls absent build metadata rather than omitting the keys', () => {
    // A probe that stores these must not have to distinguish "missing key"
    // from "unknown value" — the shape is the same every sample.
    const body = healthBody({ service: 'tenant', checks: {}, at: 'now' })
    expect(body['commit']).toBeNull()
    expect(body['environment']).toBeNull()
    expect(body['region']).toBeNull()
  })

  it('carries a failing check’s CODE and never a message', () => {
    const body = healthBody({ service: 'console', checks: { firestore: BAD }, at: 'now' })
    expect(body['status']).toBe('degraded')
    expect(JSON.stringify(body)).toContain('deadline-exceeded')
    // The endpoint is public. Anything resembling an internal detail must not
    // be reachable through it.
    expect(Object.keys(BAD)).toEqual(['ok', 'ms', 'code'])
  })
})

describe('memoizeWithTtl', () => {
  it('probes once inside the window and again after it', async () => {
    let calls = 0
    let clock = 1000
    const probe = memoizeWithTtl(15_000, async () => ++calls, () => clock)

    expect(await probe()).toBe(1)
    expect(await probe()).toBe(1)
    clock += 14_999
    expect(await probe()).toBe(1)
    clock += 2
    expect(await probe()).toBe(2)
    expect(calls).toBe(2)
  })

  it('caches FAILURES too, so an outage is not a stampede', async () => {
    // Re-probing per request hammers the dependency that is already failing,
    // and on a public endpoint that is someone else's lever.
    let calls = 0
    let clock = 0
    const probe = memoizeWithTtl(
      10_000,
      async () => {
        calls += 1
        return { ok: false, ms: 1 }
      },
      () => clock,
    )
    await probe()
    await probe()
    await probe()
    expect(calls).toBe(1)
  })

  it('does not cache across the boundary when the clock jumps backwards', async () => {
    // Serverless instances get reused across odd clock behaviour; a negative
    // elapsed must not read as "still fresh forever".
    let calls = 0
    let clock = 100_000
    const probe = memoizeWithTtl(10_000, async () => ++calls, () => clock)
    expect(await probe()).toBe(1)
    clock = 0
    expect(await probe()).toBe(2)
  })
})
