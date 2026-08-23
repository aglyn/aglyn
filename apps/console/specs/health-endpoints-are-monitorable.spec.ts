/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Response`.
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
 * Can an EXTERNAL monitor be pointed at these? (AGL-1148)
 *
 * AGL-1148 asks for a real external monitor, and the reason it matters is on
 * the record: `/api/health/crons` answered 503 for FIFTY-ONE HOURS while the
 * board stayed green. Two separate things had to be true for that, and both
 * were:
 *
 *  1. The GitHub probe read only `/api/health`, which aggregates one check.
 *     Fixed separately — the probe now reads all seven subsystems.
 *  2. **Nothing in GCP Cloud Monitoring watched `/api/health/crons` at all.**
 *     `docs/UPTIME_AND_SLA.md` listed a `scheduled-jobs` check in its table
 *     of what is watched, and a note far below it recorded that the check was
 *     owed and never created. Verified against the live project: eleven
 *     uptime checks exist and that is not one of them.
 *
 * This suite is the code-side half of never repeating it. It cannot reach
 * GCP, so it does not pretend to — what it pins is the CONTRACT an external
 * monitor depends on, over every health endpoint in the tree, derived rather
 * than listed so a new one cannot ship outside it.
 *
 * The property that actually bit: **a health check must be able to go red.**
 * Until this shipped, every one of these endpoints answered HEAD with a
 * hardcoded 200 and the comment "touches nothing" — so a monitor configured
 * with HEAD, which several providers use by default, could never have
 * reported an outage on any of them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  HEALTH_NO_STORE,
  healthBody,
  healthHeadOf,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
} from '@aglyn/aglyn/server'

const REPO_ROOT = join(__dirname, '../../..')

/** Every health `route.ts` in the monorepo, discovered rather than listed. */
function healthRoutes(): string[] {
  const roots = [
    'apps/console/app/api/health',
    'apps/tenant/app/api/health',
  ]
  const found: string[] = []
  const walk = (absolute: string, relative: string) => {
    for (const entry of readdirSync(absolute)) {
      const next = join(absolute, entry)
      if (statSync(next).isDirectory()) walk(next, `${relative}/${entry}`)
      else if (entry === 'route.ts') found.push(`${relative}/route.ts`)
    }
  }
  for (const root of roots) walk(join(REPO_ROOT, root), root)
  return found.sort()
}

const ROUTES = healthRoutes()
const source = (relative: string) =>
  readFileSync(join(REPO_ROOT, relative), 'utf8')

describe('the health endpoints an external monitor would watch', () => {
  it('discovers them rather than trusting a list', () => {
    // Without this the `it.each` below would run zero cases and the whole
    // suite would pass while asserting nothing — the failure mode a derived
    // guard is most prone to.
    expect(ROUTES.length).toBeGreaterThanOrEqual(9)
    expect(ROUTES).toContain('apps/console/app/api/health/route.ts')
    // The one the fifty-one hours happened on.
    expect(ROUTES).toContain('apps/console/app/api/health/crons/route.ts')
    expect(ROUTES).toContain('apps/tenant/app/api/health/route.ts')
  })

  describe.each(ROUTES)('%s', (relative) => {
    const text = source(relative)

    it('answers GET', () => {
      expect(text).toMatch(/export async function GET\(/)
    })

    /**
     * The defect this suite was written for. A HEAD that returns a literal
     * status is a HEAD that cannot report the outage its GET can see.
     */
    it('answers HEAD with whatever GET would answer', () => {
      expect(text).toMatch(/export async function HEAD\(/)
      expect(text).toContain('healthHeadOf(GET)')
    })

    it('has no hardcoded success left in its HEAD', () => {
      const head = text.slice(text.indexOf('export async function HEAD('))
      expect(head.length).toBeGreaterThan(20)
      expect(head).not.toMatch(/status:\s*200/)
      // The other spelling of the same lie: rebuilding the headers as `'ok'`
      // regardless of what the checks said.
      expect(head).not.toMatch(/healthHeaders\('ok'\)/)
    })

    /**
     * A cached health response is a monitor reporting the past. This repo has
     * already had an ISR cache defeat a security smoke test, and three
     * separate caches have faked a green check here.
     */
    it('is never prerendered and never revalidated', () => {
      expect(text).toMatch(/export const dynamic = 'force-dynamic'/)
      expect(text).toMatch(/export const revalidate = 0/)
    })

    it('sends the headers the shared helper builds, for the COMPUTED status', () => {
      // `healthHeaders(status)`, never `healthHeaders('ok')` — the second
      // would send a monitor `no-store` and a 503 while telling it the
      // service was fine, and it is a one-character edit away.
      expect(text).toMatch(/headers: healthHeaders\(status\)/)
      expect(text).toMatch(/status: healthHttpStatus\(status\)/)
    })

    /**
     * A monitor cannot authenticate, so these must stay open — and the
     * lockdown sweep must know that is deliberate rather than an oversight.
     */
    it('is exempt from lockdown, in writing', () => {
      expect(text).toMatch(/lockdown-\d+: exempt/)
    })
  })
})

describe('the contract those routes delegate to', () => {
  const degraded = { firestore: { ok: false, ms: 4, code: 'unavailable' } }
  const healthy = { firestore: { ok: true, ms: 4 } }

  it('turns any failed check into a 503 — there is no partial credit', () => {
    expect(healthStatus(degraded)).toBe('degraded')
    expect(healthHttpStatus(healthStatus(degraded))).toBe(503)
    expect(healthHttpStatus(healthStatus(healthy))).toBe(200)
    // One failure among several is still degraded: a monitor reading the
    // status code must not need the body to learn that.
    expect(healthStatus({ ...healthy, backups: degraded.firestore })).toBe(
      'degraded',
    )
  })

  it('is uncacheable on the FAILURE response too, which is the one that matters', () => {
    expect(healthHeaders('degraded')['Cache-Control']).toBe(HEALTH_NO_STORE)
    expect(healthHeaders('degraded')['Cache-Control']).toContain('no-store')
    expect(healthHeaders('ok')['Cache-Control']).toContain('no-store')
  })

  it('is readable cross-origin, so a status page off this deploy can read it', () => {
    expect(healthHeaders('ok')['Access-Control-Allow-Origin']).toBe('*')
    expect(healthHeaders('degraded')['Access-Control-Allow-Origin']).toBe('*')
  })

  it('tells a monitor a degraded answer is transient', () => {
    expect(healthHeaders('degraded')['Retry-After']).toBe('30')
    expect(healthHeaders('ok')['Retry-After']).toBeUndefined()
  })

  /**
   * The body is public and unauthenticated. It carries codes, never messages
   * — an error message can hold a project id, a document path or a fragment
   * of a credential, and this response is readable by anyone.
   */
  it('exposes a fixed set of fields and nothing else', () => {
    const body = healthBody({
      service: 'console',
      checks: degraded,
      commit: 'abc1234',
      version: '1.0.0',
      environment: 'production',
      region: 'sfo1',
      at: '2026-08-23T00:00:00.000Z',
    })
    expect(Object.keys(body).sort()).toEqual([
      'at',
      'checks',
      'commit',
      'environment',
      'region',
      'service',
      'status',
      'version',
    ])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/@|password|secret|token|Bearer|sk_/i)
  })

  describe('healthHeadOf', () => {
    const respond = (status: number) =>
      new Response(JSON.stringify({ status: 'degraded' }), {
        status,
        headers: healthHeaders(status === 200 ? 'ok' : 'degraded'),
      })

    it('carries the status through, in both directions', async () => {
      expect((await healthHeadOf(async () => respond(200))).status).toBe(200)
      // The direction the old hardcoded HEAD could never produce.
      expect((await healthHeadOf(async () => respond(503))).status).toBe(503)
    })

    it('carries the headers a monitor reads, and drops the body', async () => {
      const head = await healthHeadOf(async () => respond(503))
      expect(head.headers.get('cache-control')).toContain('no-store')
      expect(head.headers.get('access-control-allow-origin')).toBe('*')
      expect(head.headers.get('retry-after')).toBe('30')
      expect(await head.text()).toBe('')
    })
  })
})
