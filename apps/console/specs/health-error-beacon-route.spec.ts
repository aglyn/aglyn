/**
 * @jest-environment node
 *
 * The docblock has to be the FIRST comment in the file: placed after the
 * license it is silently ignored and this runs on jsdom, where the route's
 * `Response` helpers are unavailable.
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
 * `/api/health/error-beacon` can go red (AGL-1923).
 *
 * The external monitor on this route is a keyword check for `"status":"ok"`,
 * alerting when the keyword is ABSENT. That contract only means something if
 * the route stops saying `ok` when the beacon heartbeat cannot be written —
 * and the sibling health routes each carry a spec proving exactly that for
 * their own subject. This one was the exception: the route was live and
 * monitored, and nothing asserted it could ever answer anything but 200.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probe memo is module-level with a five-minute TTL, so a shared module
 * would serve every test the first test's answer.
 */

// No static imports — see the sibling route specs for why this file must not
// be a global script in the one program `tsc` builds over `apps/console`.
export {}

/** What the stubbed heartbeat write should answer with. */
let mockHeartbeat: { ok: boolean; code?: string } | 'throws'
/** How many times the route asked for a write, so the memo is measurable. */
let mockWrites: number

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  BEACON_HEARTBEAT_LOG_ID: 'client-error-beacon-heartbeat',
  writeBeaconHeartbeat: async () => {
    mockWrites += 1
    if (mockHeartbeat === 'throws') throw new Error('logging write exploded')
    return mockHeartbeat
  },
}))

type RouteModule = typeof import('../app/api/health/error-beacon/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/error-beacon/route')
}

/** Drive GET and read back what a monitor and an operator each see. */
async function probe(route?: RouteModule): Promise<{
  status: number
  text: string
  body: Record<string, unknown>
  beacon: Record<string, unknown>
  cacheControl: string | null
}> {
  const { GET } = route ?? (await freshRoute())
  const response = await GET()
  const text = await response.text()
  const body = JSON.parse(text) as Record<string, unknown>
  const checks = body['checks'] as Record<string, Record<string, unknown>>
  return {
    status: response.status,
    text,
    body,
    beacon: checks['beacon'],
    cacheControl: response.headers.get('cache-control'),
  }
}

/** The literal the UptimeRobot keyword monitor looks for, byte for byte. */
const KEYWORD = '"status":"ok"'

beforeEach(() => {
  mockWrites = 0
  mockHeartbeat = { ok: true }
})

describe('the beacon heartbeat lands', () => {
  it('answers 200 and carries the monitor keyword exactly once', async () => {
    const seen = await probe()
    expect(seen.status).toBe(200)
    expect(seen.body['status']).toBe('ok')
    expect(seen.beacon['ok']).toBe(true)
    // Once: a nested check must never spell the top-level verdict, or a
    // degraded body would still satisfy a substring monitor.
    expect(seen.text.split(KEYWORD).length - 1).toBe(1)
  })

  it('names the log and service an operator would query', async () => {
    const seen = await probe()
    expect(seen.beacon['logId']).toBe('client-error-beacon-heartbeat')
    expect(seen.beacon['service']).toBe('console-web')
  })

  it('memoizes the write, so a public endpoint cannot be turned into a bill', async () => {
    const route = await freshRoute()
    await probe(route)
    await probe(route)
    expect(mockWrites).toBe(1)
  })
})

describe('the beacon heartbeat cannot be written', () => {
  it('goes 503 and drops the keyword when the write is refused', async () => {
    mockHeartbeat = { ok: false, code: 'no-credential' }
    const seen = await probe()
    expect(seen.status).toBe(503)
    expect(seen.body['status']).toBe('degraded')
    expect(seen.beacon).toMatchObject({ ok: false, code: 'no-credential' })
    expect(seen.text).not.toContain(KEYWORD)
  })

  it('goes 503 with a code of its own when the write throws', async () => {
    mockHeartbeat = 'throws'
    const seen = await probe()
    expect(seen.status).toBe(503)
    expect(seen.beacon).toMatchObject({ ok: false, code: 'heartbeat-unavailable' })
    expect(seen.text).not.toContain(KEYWORD)
  })

  it('is uncacheable on the failure response too, which is the one that matters', async () => {
    mockHeartbeat = { ok: false, code: 'no-credential' }
    const seen = await probe()
    expect(seen.cacheControl ?? '').toMatch(/no-store/)
  })

  it('answers HEAD with the same 503, so a HEAD monitor is not told calm', async () => {
    mockHeartbeat = { ok: false }
    const { HEAD } = await freshRoute()
    const response = await HEAD()
    expect(response.status).toBe(503)
  })
})
