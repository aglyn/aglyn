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
 * `/api/health/error-beacon` can go red, and stops going red for nothing
 * (AGL-1923, AGL-2713).
 *
 * The external monitor on this route is a keyword check for `"status":"ok"`,
 * alerting when the keyword is ABSENT. That contract only means something if
 * the route stops saying `ok` when the beacon heartbeat cannot be written —
 * and the sibling health routes each carry a spec proving exactly that for
 * their own subject. This one was the exception: the route was live and
 * monitored, and nothing asserted it could ever answer anything but 200.
 *
 * Since AGL-2713 the same keyword has to survive one undecided heartbeat and
 * disappear on the second, so both halves are planted here: the transport is
 * faked, the GRADER is not, because the keyword's presence is a fact about
 * the two of them together.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probe memo is module-level with a five-minute TTL, so a shared module
 * would serve every test the first test's answer.
 */

// No static imports — see the sibling route specs for why this file must not
// be a global script in the one program `tsc` builds over `apps/console`.
export {}

/** What the stubbed heartbeat write should answer with; null means it threw. */
let mockHeartbeat: { ok: boolean; code?: string } | null
/** When a heartbeat was last shown to land, or null when none has been. */
let mockLandedAtMs: number | null
/** How many times the route asked for a probe, so the memo is measurable. */
let mockProbes: number
/** A fixed clock, so `minutesSinceHeartbeat` is a stated number. */
const mockNow = 1_757_400_000_000
const mockGraceMs = 15 * 60_000

/*==========================================
 * The TRANSPORT is stubbed; the VERDICT is not.
 *
 * `beaconHeartbeatProbe` owns the retry, the durable marker and the store
 * read, and `libs/tenant/data/admin`'s spec drives every one of those. What
 * this file has to prove is the half that spec cannot see: that a graded
 * check becomes the 200/503 and the monitor keyword an external checker
 * actually reads. So the stub hands the REAL grader a planted write and a
 * planted landing, and the route does the rest.
 *=========================================*/
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  BEACON_HEARTBEAT_LOG_ID: 'client-error-beacon-heartbeat',
  beaconHeartbeatProbe: async ({ service }: { service: string }) => {
    mockProbes += 1
    const { beaconHealth } = jest.requireActual('@aglyn/aglyn/server')
    return beaconHealth(
      mockHeartbeat,
      'client-error-beacon-heartbeat',
      service,
      12,
      {
        attempts: mockHeartbeat === null || mockHeartbeat.ok ? 1 : 2,
        landedAtMs: mockLandedAtMs,
        graceMs: mockGraceMs,
        now: mockNow,
      },
    )
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
  mockProbes = 0
  mockHeartbeat = { ok: true }
  mockLandedAtMs = mockNow
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

  it('memoizes the probe, so a public endpoint cannot be turned into a bill', async () => {
    const route = await freshRoute()
    await probe(route)
    await probe(route)
    expect(mockProbes).toBe(1)
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
    mockHeartbeat = null
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

/**
 * ONE MISS IS NOT AN OUTAGE, TWO IS (AGL-2713).
 *
 * This route answered `503 no-credential` twice on 2026-09-09 — 15:12 and
 * 17:22 UTC, minutes after new capacity from that day's deploy — self-cleared
 * both times, and between them took the 15-minute uptime workflow red and
 * opened four GCP alert events for a beacon that was working.
 */
describe('a single undecided heartbeat, and a sustained one', () => {
  it('KEEPS the monitor keyword when one attempt decided nothing and a heartbeat landed recently', async () => {
    mockHeartbeat = { ok: false, code: 'credential-unavailable' }
    mockLandedAtMs = mockNow - 60_000
    const seen = await probe()

    expect(seen.status).toBe(200)
    expect(seen.text).toContain(KEYWORD)
    // Green, and not silently: the board reads the code, the attempt count and
    // the age of the landing being spent, or a tolerance is indistinguishable
    // from a door that was widened until it stopped reporting.
    expect(seen.beacon).toMatchObject({
      ok: true,
      code: 'heartbeat-missed',
      attempts: 2,
      minutesSinceHeartbeat: 1,
      graceMinutes: 15,
    })
  })

  it('DROPS the keyword once the silence outlasts the grace', async () => {
    mockHeartbeat = { ok: false, code: 'credential-unavailable' }
    mockLandedAtMs = mockNow - mockGraceMs - 1
    const seen = await probe()

    expect(seen.status).toBe(503)
    expect(seen.text).not.toContain(KEYWORD)
    expect(seen.beacon).toMatchObject({
      ok: false,
      code: 'credential-unavailable',
    })
  })

  it('DROPS the keyword for a lost grant however recently a heartbeat landed', async () => {
    // http-403 is permanent until somebody restores the IAM binding, and
    // browser errors are being collected by nothing for the whole of it.
    mockHeartbeat = { ok: false, code: 'http-403' }
    mockLandedAtMs = mockNow - 1_000
    const seen = await probe()

    expect(seen.status).toBe(503)
    expect(seen.text).not.toContain(KEYWORD)
  })

  it('DROPS the keyword when no heartbeat has ever been shown to land', async () => {
    mockHeartbeat = { ok: false, code: 'credential-unavailable' }
    mockLandedAtMs = null
    const seen = await probe()

    expect(seen.status).toBe(503)
    expect(seen.text).not.toContain(KEYWORD)
    expect(seen.beacon['minutesSinceHeartbeat']).toBeNull()
  })
})
