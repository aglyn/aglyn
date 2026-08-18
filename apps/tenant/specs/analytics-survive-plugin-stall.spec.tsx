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
 *
 * The boundary these specs render is the REAL one (AGL-1556). It used to be a
 * three-line `Isolate` class defined right here, annotated "in production this
 * role is played by the route boundary" — which was not true: `apps/tenant/app`
 * had no `error.tsx`, no `loading.tsx` and no `global-error.tsx` anywhere, so
 * the reject cases below passed only because the spec supplied a boundary
 * production did not have. Measured in the real shape, a rejecting gate threw
 * straight out of the root and `SiteAnalytics` painted nothing at all. AGL-1556
 * shipped `PageBodyBoundary` to close that gap, and importing it here is the
 * point: these specs now exercise what the route actually renders.
 *
 * ## The real shape changed again (AGL-2074), and the invariant got sharper
 *
 * `apps/tenant/app` now HAS segment boundaries — `[host]/not-found.tsx`,
 * `[host]/error.tsx`, `app/error.tsx`, `app/global-error.tsx` — because their
 * absence meant every customer site on the platform served Next's unstyled
 * `404 | This page could not be found`. This file used to forbid those
 * filenames outright, and that ban has to be reconsidered rather than
 * deleted, because the reasoning behind it was correct.
 *
 * The stated fear: an `error.tsx` sits ABOVE `page.tsx`, and `page.tsx` is
 * what renders `SiteAnalytics` — so a segment boundary that catches a
 * rejecting plugin gate would replace the measurement surface along with the
 * page, and that is AGL-1541 rebuilt.
 *
 * MEASURED, in the real nesting, with a genuinely rejecting `ensure`
 * (`analytics survive a segment error boundary` below): the gate's throw
 * never reaches the segment boundary at all. `PageBodyBoundary` is the INNER
 * boundary and catches it first, `SiteAnalytics` is its sibling and keeps
 * rendering, the beacon fires, and the branded error screen does not appear.
 * Removing `PageBodyBoundary` from that same arrangement flips it
 * immediately — the throw reaches the segment boundary and the error screen
 * takes the page. So `PageBodyBoundary` is not redundant with the new
 * boundaries; it is precisely what makes them safe.
 *
 * That is the invariant, and it is narrower and more useful than "these
 * filenames must not exist":
 *
 *   The plugin gate's failure must be caught INSIDE `page.tsx`, by a boundary
 *   wrapping only `CatchAllClient`, with `SiteAnalytics` as its sibling —
 *   before any segment boundary can see it.
 *
 * `loading.tsx` is a different animal and stays banned outright: it is not an
 * error boundary at all, it makes Next wrap the segment in SUSPENSE, and that
 * is AGL-1541 verbatim rather than by analogy.
 */
import { act, render, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import CatchAllClient from '../app/[host]/[[...slug]]/catch-all-client'
import PageBodyBoundary from '../app/[host]/[[...slug]]/page-body-boundary'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'
import HostError from '../app/[host]/error'
import { HostBrandProvider } from '../app/[host]/host-brand.context'
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
 * The shape `page.tsx` renders, component for component: measurement as a
 * SIBLING of the page body, never a descendant of it, with the page body — and
 * only the page body — inside `PageBodyBoundary`.
 */
function renderRouteTree() {
  return (
    <>
      <SiteAnalytics host={GA_HOST as any} screenId={SCREEN_ID} />
      <PageBodyBoundary>
        <CatchAllClient data={{ host: GA_HOST as any }} nodes={{}} />
      </PageBodyBoundary>
    </>
  )
}

function renderRoute() {
  return render(renderRouteTree())
}


/**
 * These cases describe a PRODUCTION deployment, and now have to say so
 * (AGL-2067): outside one, `analyticsMayEmit()` is false and no tag is
 * created at all. Declared per file rather than in a jest setup, because
 * `NODE_ENV` changes far more than analytics and a global override would
 * quietly move other behaviour under every spec in the repo.
 */
/**
 * `process.env` is typed read-only for `NODE_ENV` in this app (Next ships that
 * declaration), and these cases have to state which deployment they describe
 * — see AGL-2067. One narrow cast, named, rather than one per assignment.
 */
const mutableEnv = process.env as Record<string, string | undefined>

const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}
beforeAll(() => {
  mutableEnv.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
})
afterAll(() => {
  mutableEnv.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
})

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
    // React will not commit a tree while any part of it is suspended, and
    // `PageBodyBoundary` does not change that — an ERROR boundary is
    // transparent to suspension, which is exactly why it was safe to add. So
    // no DOM appears here — no banner, no gtag tag, no page — and an effect
    // would never have run. The beacon and the region call fire anyway
    // because they do not wait to be committed.
    //
    // The only boundary that WOULD isolate a suspended body is the page-wide
    // Suspense AGL-1541 had to delete (its reveal and its hydration retry both
    // rode requestAnimationFrame, which never fires in hidden, occluded or
    // prerendered tabs). AGL-1556 asked whether AGL-1541's status-stamped
    // `ensure` makes that safe "for warm renders only", and the answer is no:
    // the stamp lives on a per-module-instance promise cache that every fresh
    // server instance starts EMPTY (nothing warms it — `instrumentation.ts`
    // warms Firestore and nothing else), so the first render on each instance
    // still suspends and would still emit the late-streamed rAF-gated segment.
    // Emitting the boundary only on warm renders is not available either:
    // React writes `<!--$-->` markers for every Suspense boundary, so a
    // server-conditional one is a hydration mismatch. The boundary would be
    // inert exactly when it is not needed and reproduce AGL-1541 exactly when
    // it is. That avenue is closed; do not reopen it without new evidence.
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

  it('analytics survive a segment error boundary above the page (AGL-2074)', async () => {
    // The measurement AGL-2074 owed this file. `[host]/error.tsx` now exists,
    // and it sits ABOVE `page.tsx` — which renders `SiteAnalytics`. If a
    // rejecting plugin gate unwound into it, the branded error screen would
    // replace the measurement surface along with the page, and AGL-1541 would
    // be back in a new costume: a 404-ing chunk after a deploy taking
    // analytics down on every tenant site at once, invisibly.
    //
    // It does not, and the reason is ordering, not luck: `PageBodyBoundary`
    // is the INNER boundary, so it catches the gate's throw before anything
    // outside `page.tsx` sees it. Measured both ways — remove
    // `PageBodyBoundary` from this arrangement and the error screen takes the
    // page immediately (`error screen shown: true`), which is what makes it
    // load-bearing rather than redundant.
    const reactModule = jest.requireActual('react') as typeof import('react')
    class SegmentBoundary extends reactModule.Component<
      { children?: any },
      { error: Error | null }
    > {
      override state = { error: null as Error | null }
      static getDerivedStateFromError(error: Error) {
        return { error }
      }
      override render() {
        return this.state.error ? (
          <HostError error={this.state.error} reset={() => undefined} />
        ) : (
          this.props.children
        )
      }
    }

    jest
      .spyOn(sitePluginLoader, 'ensure')
      .mockReturnValue(Promise.reject(new Error('chunk load failed')))

    await act(async () => {
      render(
        <HostBrandProvider brandName="Stall Site">
          <SegmentBoundary>{renderRouteTree()}</SegmentBoundary>
        </HostBrandProvider>,
      )
    })

    await waitFor(() => expect(beacons.length).toBe(1))
    expect(beacons[0].body).toMatchObject({ hostId: HOST_ID, screenId: SCREEN_ID })
    await waitFor(() => expect(regionCalls).toBeGreaterThanOrEqual(1))
    // And the branded screen never activated — the inner boundary held.
    expect(document.body.textContent).not.toContain('Something went wrong')
  })

  it('the boundary reports what it catches — isolation must not buy silence (AGL-1556)', async () => {
    // The failure this issue is about was a SILENT one, so the fix must not
    // create another. React 19 sends errors an error boundary catches to
    // `console.error` and only UNCAUGHT ones to `reportError`, which means a
    // quiet boundary would drop a crashing plugin chunk out of Cloud Error
    // Reporting entirely. `PageBodyBoundary` re-reports, and `reportError`
    // dispatches the `window` 'error' event that `installErrorBeacon`
    // (AGL-1538) listens on.
    const reported: unknown[] = []
    ;(window as any).reportError = (error: unknown) => reported.push(error)
    jest
      .spyOn(sitePluginLoader, 'ensure')
      .mockReturnValue(Promise.reject(new Error('chunk load failed')))

    await act(async () => {
      renderRoute()
    })

    await waitFor(() => expect(reported.length).toBeGreaterThanOrEqual(1))
    expect((reported[0] as Error).message).toBe('chunk load failed')
    delete (window as any).reportError
  })
})

/**
 * The SHAPE is load-bearing and completely invisible at the call site, which
 * is how it would get undone by someone reaching for the ordinary Next.js
 * tool for an ordinary Next.js problem (AGL-1541/AGL-1556/AGL-2074).
 *
 * This used to assert that `loading.tsx`, `error.tsx` and `global-error.tsx`
 * did not exist anywhere under `app/`. Two of those three are now REQUIRED —
 * see the header — so the guard asserts the thing the ban was standing in
 * for, plus the presence of the boundaries, so that neither rule can be
 * satisfied by quietly deleting the other.
 */
describe('the tenant route keeps the shape that protects measurement (AGL-1541/AGL-1556/AGL-2074)', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [join(dir, entry.name)],
    )
  }

  const APP = join(__dirname, '..', 'app')

  it('no loading.tsx anywhere under app/ — that one is still fatal', () => {
    // Not an error boundary at all. It makes Next wrap the segment in a
    // Suspense boundary, so the page body leaves the streamed shell for a
    // late `<div hidden>` segment whose reveal AND hydration retry both ride
    // requestAnimationFrame — which never fires in hidden, occluded or
    // prerendered tabs. That is AGL-1541 verbatim, and no error boundary
    // anywhere changes it. The long note on the "paints NOTHING" case above
    // records why the obvious escapes (warm-render-only, server-conditional)
    // are all closed.
    const found = walk(APP)
      .map((file) => file.split('/').pop() as string)
      .filter((name) => name === 'loading.tsx')
    expect(found).toEqual([])
  })

  it('no error.tsx in the catch-all segment — the isolation belongs INSIDE page.tsx', () => {
    // An `error.tsx` at `[[...slug]]` wraps that segment's PAGE, and the page
    // is what renders `SiteAnalytics`. Someone adding one here would almost
    // certainly be reaching for the isolation `PageBodyBoundary` already
    // provides, and would get it one level too high — measurement inside the
    // blast radius instead of beside it. The boundaries that legitimately
    // exist live at `[host]/` and `app/`, above this segment, where
    // `PageBodyBoundary` still catches the plugin gate first.
    const segment = join(APP, '[host]', '[[...slug]]')
    const found = walk(segment)
      .map((file) => file.split('/').pop() as string)
      .filter((name) => name === 'error.tsx')
    expect(found).toEqual([])
  })

  it('page.tsx keeps SiteAnalytics OUTSIDE PageBodyBoundary', () => {
    // The structural half of the invariant. The behavioural tests above
    // prove the arrangement works; this proves it is still the arrangement,
    // because re-nesting the sibling under the boundary is a two-line edit
    // that no behavioural test in a file nobody re-reads would catch until
    // traffic stopped.
    const page = readFileSync(join(APP, '[host]', '[[...slug]]', 'page.tsx'), 'utf8')
    const analyticsAt = page.indexOf('<SiteAnalytics')
    const boundaryAt = page.indexOf('<PageBodyBoundary>')
    expect(analyticsAt).toBeGreaterThan(-1)
    expect(boundaryAt).toBeGreaterThan(-1)
    expect(analyticsAt).toBeLessThan(boundaryAt)
  })

  it('the AGL-2074 boundaries are still there', () => {
    // Stated as a requirement in the same breath as the bans, so a future
    // reader cannot satisfy one rule by deleting the other and leave every
    // customer site back on the framework's raw page.
    for (const relative of [
      '[host]/not-found.tsx',
      '[host]/error.tsx',
      'error.tsx',
      'global-error.tsx',
      'not-found.tsx',
    ]) {
      expect(readFileSync(join(APP, relative), 'utf8')).toContain('export default')
    }
  })
})
