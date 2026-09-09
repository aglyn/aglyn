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
 *
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://aglyn.com/"}
 */

/**
 * One `/api/consent/region` lookup per pageview, even while it is SLOW
 * (AGL-2710).
 *
 * Two callers ask for the region on every first visit and they are meant to:
 * `primeVisitorConsent` fires during render so a page that never commits is
 * still resolved (AGL-1550), and `useVisitorConsent` fires from its effect
 * because that is where the answer has to land in state. The session cache is
 * what was supposed to make the second one free — and it cannot be, because it
 * is written when the RESPONSE arrives, which is after both callers have
 * already gone out.
 *
 * Measured on a cold `https://aglyn.com/` load: the first request went out at
 * 1545 ms and answered at 3011 ms; the second went out at 2147 ms, 864 ms
 * inside that window. Two invocations of a route whose whole body is a
 * request-header echo, on every first visit to every tenant site.
 *
 * So the endpoint here never resolves on its own. A spec whose fetch resolves
 * immediately passes against the broken code, because the microtask that
 * settles it runs before the effect gets its turn — the pending promise IS the
 * production condition, and it is the only shape that can tell the two apart.
 */
import { act, render, waitFor } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[scheme]/[[...slug]]/site-analytics'

jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src} />
  ),
}))

const HOST_ID = 'region-host-1'
const HOST = {
  $id: HOST_ID,
  analytics: { gaMeasurementId: 'G-TEST1234' },
  consent: { mode: 'geo' },
}

let regionCalls: number
let settleRegion: ((country: string | null) => void) | undefined
let failRegion: ((error: Error) => void) | undefined
let pathCounter = 0

beforeEach(() => {
  regionCalls = 0
  settleRegion = undefined
  failRegion = undefined
  // A distinct path per test: the render-time kick is keyed by host and path
  // and that guard is module state which outlives a single `render`.
  window.history.replaceState(null, '', `/region-${++pathCounter}`)
  ;(navigator as any).sendBeacon = jest.fn(() => true)
  ;(global as any).fetch = jest.fn((input: any) => {
    const url = String(input)
    if (url.includes('/api/consent/region')) {
      regionCalls += 1
      // Deliberately still PENDING when it is handed back. A fetch that
      // resolves on the spot settles in a microtask that runs before the
      // hook's effect, which hides the very race this file measures.
      return new Promise((resolve, reject) => {
        settleRegion = (country) =>
          resolve({ ok: true, json: async () => ({ country }) })
        failRegion = reject
      })
    }
    return Promise.reject(new Error(`Unexpected fetch in spec: ${url}`))
  })
})

afterEach(async () => {
  // Settle whatever this case left pending BEFORE clearing storage. The
  // in-flight share is module state scoped to a page load, and a spec that
  // walks away from an unanswered request carries that page load into the
  // next case — where the fetch it expects is correctly suppressed.
  await act(async () => {
    settleRegion?.(null)
  })
  jest.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete (global as any).fetch
  delete (navigator as any).sendBeacon
})

const mutableEnv = process.env as Record<string, string | undefined>
const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}
// A production deployment AND a real hostname, the AGL-2067 pair: on
// `localhost` the machinery reads the visit as a machine talking to itself and
// stays silent whatever the variables say. The document URL is in the pragma.
beforeAll(() => {
  mutableEnv.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
})
afterAll(() => {
  mutableEnv.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined)
    delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
})

describe('the consent region lookup (AGL-2710)', () => {
  it('asks ONCE while the endpoint is still answering', async () => {
    await act(async () => {
      render(<SiteAnalytics host={HOST as any} screenId="region-screen-1" />)
    })

    // Both callers have run by now: the render-time kick during `render`, the
    // hook's effect when `act` flushed it. Neither could have read a cache,
    // because nothing has answered yet.
    await waitFor(() => expect(regionCalls).toBe(1))
    expect(settleRegion).toBeDefined()
  })

  it('still reaches an answer, and caches it for the next pageview', async () => {
    await act(async () => {
      render(<SiteAnalytics host={HOST as any} screenId="region-screen-2" />)
    })
    await waitFor(() => expect(regionCalls).toBe(1))

    await act(async () => {
      settleRegion?.('US')
    })

    // The shared promise resolves for every caller, and the session cache is
    // written exactly as it was — sharing a request must not cost the visit
    // its answer.
    await waitFor(() =>
      expect(window.sessionStorage.getItem('aglyn:consent:region')).toBe(
        JSON.stringify({ country: 'US' }),
      ),
    )
    expect(regionCalls).toBe(1)
  })

  it('re-asks on the NEXT pageview when the request FAILED', async () => {
    // The share is released when the promise settles, never kept as a memo. A
    // network failure writes no session cache — deliberately, so one dropped
    // request cannot pin the strictest posture for the whole session — and a
    // memo that outlived the request would reinstate exactly that.
    await act(async () => {
      render(<SiteAnalytics host={HOST as any} screenId="region-screen-3" />)
    })
    await waitFor(() => expect(regionCalls).toBe(1))
    await act(async () => {
      failRegion?.(new Error('offline'))
    })
    expect(window.sessionStorage.getItem('aglyn:consent:region')).toBeNull()

    window.history.replaceState(null, '', `/region-${++pathCounter}`)
    await act(async () => {
      render(<SiteAnalytics host={HOST as any} screenId="region-screen-4" />)
    })
    await waitFor(() => expect(regionCalls).toBe(2))
  })
})
