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

/**
 * The regression AGL-1550 exists to prevent: a site-plugin load that is slow,
 * wedged or outright rejected must not decide whether a pageview is counted.
 *
 * AGL-1541 was that failure in the wild. The plugin gate stayed suspended in
 * any rAF-starved tab, and because the pageview beacon, the GA mounts and the
 * consent machinery all sat BELOW the gate inside `CatchAllClient`, all three
 * went silent together — `/pricing` measured zero beacon activity at 90 s. The
 * acute mechanism is fixed; these specs are about the coupling, and they fail
 * if anyone re-nests the mounts under the gate.
 *
 * The gate is wedged and then rejected FOR REAL here — `sitePluginLoader
 * .ensure` is planted, so `CatchAllClient` genuinely suspends and genuinely
 * throws, exactly as a stalled or 404-ing plugin chunk makes it do after a
 * deploy. What is asserted is the sibling: the beacon fires and the consent
 * region call goes out anyway.
 */
import { act, render, waitFor } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import CatchAllClient from '../app/[host]/[[...slug]]/catch-all-client'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'
import { sitePluginLoader } from '../utils/site-plugin-loader'

jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src} />
  ),
}))

const HOST_ID = 'stall-host-1'
const SCREEN_ID = 'stall-screen-1'
const GA_HOST = {
  $id: HOST_ID,
  analytics: { gaMeasurementId: 'G-TEST1234' },
  // Implied posture everywhere, so the run does not depend on a region: the
  // question here is whether the machinery RUNS, not which answer it gives.
  consent: { mode: 'geo' },
}

let beacons: Array<{ url: string; body: any }>
let regionCalls: number
let pathCounter = 0

beforeEach(() => {
  beacons = []
  regionCalls = 0
  // A distinct path per test: both once-per-pageview guards (the beacon and
  // the consent kick) are keyed by host and path, deliberately — a metered
  // input must not be told twice about one pageview — and that guard is module
  // state that outlives a single `render`.
  window.history.replaceState(null, '', `/stall-${++pathCounter}`)
  ;(navigator as any).sendBeacon = jest.fn((url: string, body: string) => {
    beacons.push({ url, body: JSON.parse(body) })
    return true
  })
  ;(global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (url.includes('/api/consent/region')) {
      regionCalls += 1
      return { ok: true, json: async () => ({ country: 'US' }) }
    }
    throw new Error(`Unexpected fetch in spec: ${url}`)
  })
})

afterEach(() => {
  jest.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete (global as any).fetch
  delete (navigator as any).sendBeacon
})

/**
 * Keeps a thrown plugin failure from taking the whole test root down, so the
 * spec can ask its real question: did the SIBLING still do its job? In
 * production this role is played by the route boundary — the point being
 * proven is that the analytics mounts are no longer inside the subtree that
 * fails, not that nothing fails.
 */
class Isolate extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The shape `page.tsx` renders: measurement as a SIBLING of the page body,
 * never a descendant of it.
 */
function renderRoute() {
  return render(
    <>
      <SiteAnalytics host={GA_HOST as any} screenId={SCREEN_ID} />
      <Isolate>
        <CatchAllClient data={{ host: GA_HOST as any }} nodes={{}} />
      </Isolate>
    </>,
  )
}

describe('analytics survive a broken plugin gate (AGL-1550)', () => {
  it('a plugin gate that NEVER resolves: the beacon and the region call still fire', async () => {
    // The AGL-1541 shape exactly — an `ensure` that never settles, so the
    // page body stays suspended forever.
    jest
      .spyOn(sitePluginLoader, 'ensure')
      .mockReturnValue(new Promise<void>(() => undefined))

    await act(async () => {
      renderRoute()
    })

    await waitFor(() => expect(beacons.length).toBe(1))
    expect(beacons[0].url).toBe('/api/analytics/collect')
    expect(beacons[0].body).toMatchObject({
      hostId: HOST_ID,
      // Per-screen attribution (AGL-151) survives the hoist.
      screenId: SCREEN_ID,
    })
    await waitFor(() => expect(regionCalls).toBeGreaterThanOrEqual(1))
  })

  it('a plugin gate that REJECTS (a 404 chunk after a deploy) still counts the visit', async () => {
    jest
      .spyOn(sitePluginLoader, 'ensure')
      .mockReturnValue(Promise.reject(new Error('chunk load failed')))

    await act(async () => {
      renderRoute()
    })

    await waitFor(() => expect(beacons.length).toBe(1))
    expect(beacons[0].body).toMatchObject({ hostId: HOST_ID })
    await waitFor(() => expect(regionCalls).toBeGreaterThanOrEqual(1))
  })

  it('a wedged gate still paints NOTHING — which is why the two calls above are made during render, not from an effect', async () => {
    // The limit this design is built around, pinned so nobody "simplifies"
    // `sendPageviewBeacon`/`primeVisitorConsent` back into a `useEffect`.
    // React will not commit a tree while any part of it is suspended, and the
    // only boundary that could isolate the page body is the page-wide Suspense
    // AGL-1541 had to delete (its reveal and hydration retry both rode
    // requestAnimationFrame). So no DOM appears here — no banner, no gtag tag,
    // no page — and an effect would never have run. The beacon and the region
    // call fire anyway because they do not wait to be committed.
    jest
      .spyOn(sitePluginLoader, 'ensure')
      .mockReturnValue(new Promise<void>(() => undefined))

    await act(async () => {
      renderRoute()
    })

    expect(document.querySelector('[data-testid="ga-src"]')).toBeNull()
    expect(document.querySelector('[data-aglyn-consent-banner]')).toBeNull()
    expect(document.querySelector('[data-aglyn-consent-pill]')).toBeNull()
    // And yet the visit was counted.
    expect(beacons.length).toBe(1)
    expect(beacons[0].url).toBe('/api/analytics/collect')
  })

  it('a REJECTED gate recovers the full surface: GA loads under implied consent', async () => {
    jest
      .spyOn(sitePluginLoader, 'ensure')
      .mockReturnValue(Promise.reject(new Error('chunk load failed')))

    await act(async () => {
      renderRoute()
    })

    // US visitor, geo posture → implied consent → the script is allowed. The
    // whole point: measurement reaches the same verdict it would on a healthy
    // page, because it never depended on the page.
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="ga-src"]')
          ?.getAttribute('data-gasrc'),
      ).toContain('G-TEST1234'),
    )
  })

  it('the consent gate is not weakened by the hoist: an EU visitor gets no script even with the gate broken', async () => {
    // The AGL-1498 bar, re-asserted inside the failure scenario itself —
    // hoisting must not have bought availability by loosening the gate.
    ;(global as any).fetch = jest.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/api/consent/region')) {
        regionCalls += 1
        return { ok: true, json: async () => ({ country: 'DE' }) }
      }
      throw new Error(`Unexpected fetch in spec: ${url}`)
    })
    jest
      .spyOn(sitePluginLoader, 'ensure')
      .mockReturnValue(Promise.reject(new Error('chunk load failed')))

    await act(async () => {
      renderRoute()
    })

    // The banner asks…
    await waitFor(() =>
      expect(document.querySelector('[data-aglyn-consent-banner]')).toBeTruthy(),
    )
    // …and gtag is nowhere.
    expect(document.querySelector('[data-testid="ga-src"]')).toBeNull()
    // The cookieless beacon is exempt on its own merits and still fires.
    expect(beacons.length).toBe(1)
  })
})
