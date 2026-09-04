/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * THE DROUGHT DENOMINATOR IS ACTUALLY COUNTED (AGL-2583).
 *
 * `/api/health/signup-volume` can only call zero accounts an outage if it
 * knows people were arriving. That number comes from here: the signup page
 * fetches `/api/lockdown-status?feature=signups` once per render to decide
 * whether to show the paused notice, so this route is the one server touch
 * every real arrival makes.
 *
 * Which makes the wiring load-bearing in both directions. Count nothing and
 * the drought alarm can never fire — the same silent-by-construction failure
 * that let AGL-2581 run for three days. Count every lockdown poll instead and
 * the console shell's own status check floods the denominator, so an outage
 * gets an ever-larger number of "arrivals" that never convert and the alarm
 * screams on a healthy quiet night until somebody mutes it.
 */

const mockRecordSignupServed = jest.fn()
const mockPlatformLockdown = jest.fn()
const mockFeatureLockdown = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getPlatformLockdown: () => mockPlatformLockdown(),
  getFeatureLockdown: (feature: string) => mockFeatureLockdown(feature),
  recordSignupServed: () => mockRecordSignupServed(),
}))

// A module, not a script. Every spec in this app shares one TypeScript
// program, so a top-level declaration in script scope collides with the
// identically named one in a sibling — which is why each health-route spec
// carries this line.
export {}

type RouteModule = typeof import('../app/api/lockdown-status/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/lockdown-status/route')
}

const ask = async (query: string) =>
  (await freshRoute()).GET(
    new Request(`https://app.aglyn.com/api/lockdown-status${query}`),
  )

beforeEach(() => {
  mockRecordSignupServed.mockReset()
  // Nothing locked: the ordinary state, in which the denominator still has
  // to be counted.
  mockPlatformLockdown.mockResolvedValue(null)
  mockFeatureLockdown.mockResolvedValue(null)
})

describe('AGL-2583 · the signup page is counted', () => {
  it('records one serve per ?feature=signups ask', async () => {
    const response = await ask('?feature=signups')
    expect(response.status).toBe(200)
    expect(mockRecordSignupServed).toHaveBeenCalledTimes(1)
  })

  it('counts the serve even while signups are LOCKED', async () => {
    // The hour a lock is on is exactly when somebody wants to know how many
    // people hit the closed door.
    mockFeatureLockdown.mockResolvedValue({
      feature: 'signups',
      reason: 'abuse',
    })
    const response = await ask('?feature=signups')
    expect(response.status).toBe(200)
    expect((await response.json()).locked).toBe(true)
    expect(mockRecordSignupServed).toHaveBeenCalledTimes(1)
  })

  it('does NOT count the console shell poll — the red control', async () => {
    // `platform-lockdown-gate` asks the bare route on every console load. If
    // that counted, the denominator would be signed-in traffic and the
    // drought alarm would fire on a healthy quiet night, then get muted.
    await ask('')
    expect(mockRecordSignupServed).not.toHaveBeenCalled()
  })

  it('does NOT count a different feature', async () => {
    await ask('?feature=billing')
    expect(mockRecordSignupServed).not.toHaveBeenCalled()
  })

  it('is not awaited — the page never waits on a breadcrumb', async () => {
    // A recorder that never settles must not hold the signup page's notice
    // check open. The library call is fire-and-forget by contract; this is
    // the call SITE honoring it.
    mockRecordSignupServed.mockImplementation(() => new Promise(() => undefined))
    const response = await ask('?feature=signups')
    expect(response.status).toBe(200)
  })
})
