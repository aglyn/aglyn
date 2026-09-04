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
 * Can the funnel probe actually go red? (AGL-2586)
 *
 * The first design constraint on the issue is that every check ships with a
 * proof it fails under the condition it exists to catch, because *"a green
 * that cannot go red is the thing that let this happen"* — signup was dead
 * for three days behind a board of green components.
 *
 * So each case below names a real way the contact, sales enquiry or demo
 * form stops producing a lead, and asserts the probe answers 503 for it. The
 * verdict half is exercised directly (it is pure) and the route half is
 * driven for real, on **GET and HEAD alike**: several uptime providers use
 * HEAD by default, and a HEAD that cannot go red is the same blindness in a
 * different method.
 */
import { HEALTH_NO_STORE } from '@aglyn/aglyn/server'

import {
  funnelIntakeHealth,
  funnelRoutingHealth,
  type FunnelFormFacts,
} from '../app/api/health/funnel/funnel-verdict'
import type { FunnelProbeResult } from '../app/api/health/funnel/funnel-probe'

/**
 * The route's own import, mocked WHOLESALE rather than spread over
 * `requireActual`: the probe module reaches Firestore and the page loader at
 * import time, and a verdict suite that needed an admin credential to run
 * would be a red-proof nobody could run.
 */
const PROBE = '../app/api/health/funnel/funnel-probe'

/** A form wired the way all three funnel forms are meant to be. */
const WIRED: FunnelFormFacts = {
  consentFieldName: 'marketingOptIn',
  fieldNames: ['name', 'email', 'message', 'marketingOptIn'],
  campaignCount: 1,
}

/**
 * Load the route with `probeFunnel` stubbed. Modules are reset each time
 * because the probe memoises for five minutes at module scope — without the
 * reset the second case in this file would read the first case's verdict,
 * and every red below would pass for the wrong reason.
 */
async function routeWith(result: FunnelProbeResult) {
  jest.resetModules()
  jest.doMock(PROBE, () => ({
    __esModule: true,
    PROBE_TTL_MS: 5 * 60_000,
    funnelHost: () => 'cname--example.test',
    probeFunnel: async () => result,
  }))
  return (await import('../app/api/health/funnel/route')) as {
    GET: () => Promise<Response>
    HEAD: () => Promise<Response>
  }
}

afterEach(() => {
  jest.resetModules()
  jest.dontMock(PROBE)
})

const HEALTHY: FunnelProbeResult = {
  intake: funnelIntakeHealth({ kind: 'open' }, 2, 1),
  routing: funnelRoutingHealth([WIRED, WIRED, WIRED], 3, 1),
}

describe('the routing verdict', () => {
  it('passes three correctly wired lead forms', () => {
    const check = funnelRoutingHealth([WIRED, WIRED, WIRED], 3, 1)
    expect(check.ok).toBe(true)
    expect(check.leadForms).toBe(3)
    expect(check.faults).toEqual({})
  })

  /**
   * THE FAILURE THE FLOOR EXISTS FOR. `routing.lead` turned off on one form
   * removes it from the set this check grades, so grading the set alone
   * would report perfect health for the single edit that loses every lead
   * that form collects.
   */
  it('goes red when a form stops routing leads at all', () => {
    const check = funnelRoutingHealth([WIRED, WIRED], 3, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('lead-forms-below-floor')
    expect(check.leadForms).toBe(2)
    expect(check.required).toBe(3)
  })

  /**
   * The silent-forever failure: `consentFieldName` still names a field that
   * no longer exists, so `readFormDeclaredConsent` looks up a key nothing
   * posts and every opt-in stops being recorded. Downstream that is
   * indistinguishable from consent never given.
   */
  it('goes red when the declared consent field is not on the form', () => {
    const renamed = { ...WIRED, fieldNames: ['name', 'email', 'newsletter'] }
    const check = funnelRoutingHealth([renamed, WIRED, WIRED], 3, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('forms-misrouted')
    expect(check.faults).toEqual({ 'consent-unreadable': 1 })
  })

  it('goes red when a lead form declares no consent field at all', () => {
    const undeclared = { ...WIRED, consentFieldName: undefined }
    const check = funnelRoutingHealth([undeclared, WIRED, WIRED], 3, 1)
    expect(check.ok).toBe(false)
    expect(check.faults).toEqual({ 'consent-undeclared': 1 })
  })

  /** Captured and never contacted: the form belongs to no campaign. */
  it('goes red when a form is filed under no campaign', () => {
    const unlinked = { ...WIRED, campaignCount: 0 }
    const check = funnelRoutingHealth([unlinked, WIRED, WIRED], 3, 1)
    expect(check.ok).toBe(false)
    expect(check.faults).toEqual({ 'campaign-unlinked': 1 })
  })

  it('counts every faulty form, so a red says how wide it is', () => {
    const check = funnelRoutingHealth(
      [{ ...WIRED, campaignCount: 0 }, { ...WIRED, campaignCount: 0 }, WIRED],
      3,
      1,
    )
    expect(check.faults).toEqual({ 'campaign-unlinked': 2 })
  })

  it('treats an unreadable forms collection as degraded, never as calm', () => {
    const check = funnelRoutingHealth(null, 3, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('routing-unavailable')
  })
})

describe('the intake verdict', () => {
  it('passes a site that would accept the next submission and tell somebody', () => {
    expect(funnelIntakeHealth({ kind: 'open' }, 2, 1).ok).toBe(true)
  })

  it.each([
    ['not-configured', 'not-configured'],
    ['host-unresolved', 'host-unresolved'],
    ['paused', 'submissions-paused'],
    ['quota-exhausted', 'quota-exhausted'],
    ['ceiling-tripped', 'abuse-ceiling-tripped'],
    ['unavailable', 'intake-unavailable'],
  ])('goes red on %s', (kind, code) => {
    const check = funnelIntakeHealth({ kind } as never, 0, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe(code)
  })

  /**
   * The quiet half of a lost lead: the row lands, and the only person who
   * would act on it never learns it arrived.
   */
  it('goes red when a submission would be announced to nobody', () => {
    const check = funnelIntakeHealth({ kind: 'unattended' }, 0, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-notification-recipient')
    expect(check.recipients).toBe(0)
  })
})

describe('/api/health/funnel', () => {
  it('answers 200 when the funnel is wired and open', async () => {
    const route = await routeWith(HEALTHY)
    const response = await route.GET()
    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe('ok')
    expect((await route.HEAD()).status).toBe(200)
  })

  it('answers 503 when a form stopped routing leads', async () => {
    const route = await routeWith({
      intake: HEALTHY.intake,
      routing: funnelRoutingHealth([WIRED, WIRED], 3, 1),
    })
    const response = await route.GET()
    expect(response.status).toBe(503)
    expect((await response.json()).checks.routing.code).toBe('lead-forms-below-floor')
  })

  it('answers 503 on HEAD too — the method a monitor may be using', async () => {
    const route = await routeWith({
      intake: funnelIntakeHealth({ kind: 'paused' }, 2, 1),
      routing: HEALTHY.routing,
    })
    expect((await route.HEAD()).status).toBe(503)
  })

  it('is uncacheable on the failure response, which is the one that matters', async () => {
    const route = await routeWith({
      intake: funnelIntakeHealth({ kind: 'unavailable' }, 0, 1),
      routing: HEALTHY.routing,
    })
    const response = await route.GET()
    expect(response.headers.get('cache-control')).toBe(HEALTH_NO_STORE)
    expect(response.headers.get('retry-after')).toBe('30')
  })

  /**
   * The body is public. It may carry codes and counts and nothing that names
   * a form, a person or a site.
   */
  it('publishes no form name, uid or address', async () => {
    const route = await routeWith({
      intake: funnelIntakeHealth({ kind: 'unattended' }, 0, 1),
      routing: funnelRoutingHealth([{ ...WIRED, campaignCount: 0 }], 3, 1),
    })
    const serialized = JSON.stringify(await (await route.GET()).json())
    expect(serialized).not.toMatch(/@|marketingOptIn|password|secret|token|Bearer/i)
  })
})
