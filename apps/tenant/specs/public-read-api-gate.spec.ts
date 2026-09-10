/**
 * @jest-environment node
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

import { API_VERSION, API_VERSION_HEADER } from '@aglyn/aglyn/app-utils/agent-openapi'

interface MockRate {
  allowed: boolean
  limit: number
  remaining: number
  resetMs: number
}

// `mock`-prefixed so the jest factory below may close over it: the factory is
// hoisted above every other binding in this file.
let mockRate: MockRate | Error = {
  allowed: true,
  limit: 600,
  remaining: 599,
  resetMs: Date.now() + 60_000,
}
let mockSeenKeys: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  checkRateLimit: (key: string) => {
    mockSeenKeys.push(key)
    if (mockRate instanceof Error) throw mockRate
    return mockRate
  },
}))

const {
  publicReadApiGate,
  withPublicReadHeaders,
  PUBLIC_READ_LIMIT,
} = require('../app/api/_public-read-api')

const requestFrom = (ip = '203.0.113.7') =>
  new Request('https://demo.aglyn.app/api/screen', {
    headers: { 'x-forwarded-for': ip },
  })

beforeEach(() => {
  mockSeenKeys = []
  mockRate = {
    allowed: true,
    limit: 600,
    remaining: 599,
    resetMs: Date.now() + 60_000,
  }
})

describe('publicReadApiGate (AGL-2722)', () => {
  it('lets an ordinary read through and describes the budget', () => {
    const gate = publicReadApiGate(requestFrom())

    expect(gate.refusal).toBeNull()
    expect(gate.headers['RateLimit-Limit']).toBe('600')
    expect(gate.headers['RateLimit-Remaining']).toBe('599')
    expect(gate.headers[API_VERSION_HEADER]).toBe(API_VERSION)
  })

  it('reports the reset as SECONDS REMAINING, not a timestamp', () => {
    // A timestamp makes a caller trust our clock; a duration lets it use its
    // own. The difference is invisible until the two clocks disagree.
    mockRate = {
      allowed: true,
      limit: 600,
      remaining: 10,
      resetMs: Date.now() + 30_000,
    }
    const gate = publicReadApiGate(requestFrom())
    const reset = Number(gate.headers['RateLimit-Reset'])

    expect(reset).toBeGreaterThan(0)
    expect(reset).toBeLessThanOrEqual(30)
  })

  it('refuses over budget with a 429 that says how long to wait', async () => {
    mockRate = {
      allowed: false,
      limit: 600,
      remaining: 0,
      resetMs: Date.now() + 12_000,
    }
    const gate = publicReadApiGate(requestFrom())

    expect(gate.refusal).not.toBeNull()
    expect(gate.refusal.status).toBe(429)
    expect(Number(gate.refusal.headers.get('Retry-After'))).toBeGreaterThan(0)
    // The budget is still described on the refusal — a caller that only ever
    // sees 429s would otherwise never learn what the limit is.
    expect(gate.refusal.headers.get('RateLimit-Limit')).toBe('600')
    expect(gate.refusal.headers.get(API_VERSION_HEADER)).toBe(API_VERSION)
    expect(gate.refusal.headers.get('Cache-Control')).toContain('no-store')
    const body = JSON.parse(await gate.refusal.text())
    expect(body.statusCode).toBe(429)
    expect(body.statusMessage).toContain(String(PUBLIC_READ_LIMIT))
  })

  it('never sends Retry-After: 0, which reads as "retry immediately"', () => {
    mockRate = { allowed: false, limit: 600, remaining: 0, resetMs: Date.now() }
    const gate = publicReadApiGate(requestFrom())
    expect(Number(gate.refusal.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
  })

  it('FAILS OPEN when the limiter cannot answer', () => {
    /*
      The rule this encodes: a gate may suppress only on positive evidence,
      and silence is not evidence. A read API that starts refusing because its
      own bookkeeping is unwell has turned a bookkeeping problem into an
      outage — and on this surface a refused request is an agent concluding
      the site is unreachable.
    */
    mockRate = new Error('store unavailable')
    const gate = publicReadApiGate(requestFrom())

    expect(gate.refusal).toBeNull()
    // Still versioned: the response is answering, so it says what answered.
    expect(gate.headers[API_VERSION_HEADER]).toBe(API_VERSION)
    // And it publishes no budget it cannot vouch for.
    expect(gate.headers['RateLimit-Limit']).toBeUndefined()
  })

  it('budgets per address, not across every caller at once', () => {
    publicReadApiGate(requestFrom('203.0.113.7'))
    publicReadApiGate(requestFrom('198.51.100.9'))

    expect(mockSeenKeys).toHaveLength(2)
    expect(mockSeenKeys[0]).not.toBe(mockSeenKeys[1])
    for (const key of mockSeenKeys) expect(key).toContain('public-read:')
  })

  it('still counts a caller whose address cannot be read', () => {
    // An unreadable address must not mean "unmetered": that is the one bucket
    // an abuser would aim for.
    publicReadApiGate(new Request('https://demo.aglyn.app/api/screen'))
    expect(mockSeenKeys[0]).toMatch(/^public-read:.+/)
  })

  it('copies the headers onto a response without rebuilding it', async () => {
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const decorated = withPublicReadHeaders(original, {
      [API_VERSION_HEADER]: API_VERSION,
      'RateLimit-Limit': '600',
    })

    expect(decorated.headers.get(API_VERSION_HEADER)).toBe(API_VERSION)
    expect(decorated.headers.get('Content-Type')).toBe('application/json')
    expect(await decorated.text()).toBe('{"ok":true}')
  })
})
