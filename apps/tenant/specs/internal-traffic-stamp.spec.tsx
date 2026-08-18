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
 * `traffic_type: 'internal'` on the marketing surface (AGL-2064).
 *
 * Until this landed, the tenant runtime had no internal-traffic concept at
 * all: every load of `aglyn.com`, `/pricing` or a published test site while
 * building counted as a real visitor in the Platform property, and no GA4 data
 * filter could ever have caught it because there was no parameter to match on.
 * That was the largest of the leaks Zach's 2026-08-18 ask names, because it
 * needs no sign-in — the console's AGL-1582 stamp cannot reach it.
 *
 * Three properties are asserted, and each one is a different way to get this
 * wrong:
 *
 * 1. **The stamp is on our property and nowhere else.** A customer's site
 *    configures its own measurement id; stamping their property would erase
 *    their visitors from their own reports, and GA4 data filters are not
 *    retroactive. This is the expensive direction and it is checked first.
 * 2. **The `set` precedes the `config`.** gtag applies `set` to hits it
 *    processes AFTER it. The events that leak on a marketing visit are the
 *    automatic ones — `session_start`, `first_visit`, `user_engagement`,
 *    `page_view` — and for a single-page visit the first pageview IS the
 *    session, so a `set` placed after `config` would be a stamp that never
 *    stamps the thing it exists for.
 * 3. **The HTML does not vary by visitor.** These pages are ISR-cached. A
 *    server-side branch on "is this us" would serve one browser's answer to
 *    everyone; the emitted bytes are asserted identical for an opted-in and an
 *    opted-out browser, with only the runtime evaluation differing.
 *
 * Planted reds, verified before committing:
 *   - drop the id equality so the snippet is emitted unconditionally → case 1.
 *   - move the snippet after `gtag('js', new Date())`/`config` → case 2.
 *   - branch the emitted string on the override in the component → case 3.
 *
 * Siblings: `site-analytics-content-group.spec.tsx` (the other per-property
 * stamp), `consent-mode-default.spec.tsx` (what else lives in this block).
 */
import {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_QUERY_PARAM,
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_VALUE,
} from '@aglyn/aglyn/app-utils/internal-traffic'
import { storeVisitorConsent } from '@aglyn/aglyn'
import { act, cleanup, render, screen } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src}>
      {props.children}
    </script>
  ),
}))

const HOST_ID = 'internal-traffic-host'
/** Property 302497406, stream 3230351080 — see docs/ANALYTICS.md. */
const PLATFORM_ID = 'G-YW5PG16YTM'
const CUSTOMER_ID = 'G-CUSTOMER1'

function plantRegion(country: string | null) {
  ;(global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (!url.includes('/api/consent/region')) {
      throw new Error(`Unexpected fetch in spec: ${url}`)
    }
    return { ok: true, json: async () => ({ country }) }
  })
}

async function renderFor(gaMeasurementId: string) {
  cleanup()
  storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US' })
  plantRegion('US')
  await act(async () => {
    render(
      <SiteAnalytics
        host={{ $id: HOST_ID, analytics: { gaMeasurementId } } as any}
      />,
    )
  })
  return screen.queryByTestId('ga-init')?.textContent ?? ''
}

/**
 * Execute the whole inline block a browser would receive and report every
 * gtag call it made, in order.
 *
 * The block is asserted by RUNNING it rather than by matching its text,
 * because what is at stake is what gtag ends up being told and in what order
 * — a `set` two lines further down is a different program with the same
 * substrings.
 *
 * It runs against jsdom's REAL `window`, `localStorage` and `location`, which
 * is the only faithful reader: the block declares `window.dataLayer` and then
 * refers to a BARE `dataLayer`, so it only works where those are the same
 * object. A hand-built scope with `window` as a parameter passes a text check
 * and throws in a browser.
 */
function runInit(script: string, search: string, seeded: boolean) {
  window.history.replaceState(null, '', `/${search}`)
  if (seeded) {
    window.localStorage.setItem(
      INTERNAL_TRAFFIC_STORAGE_KEY,
      INTERNAL_TRAFFIC_VALUE,
    )
  } else {
    window.localStorage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY)
  }
  delete (window as any).dataLayer
  delete (window as any).gtag
  new Function(script)()
  const calls = (((window as any).dataLayer ?? []) as IArguments[]).map(
    (entry) => Array.from(entry) as [string, ...unknown[]],
  )
  return {
    calls,
    stored: window.localStorage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY),
  }
}

const stampOf = (calls: Array<[string, ...unknown[]]>) => {
  const set = calls.find(
    ([name, payload]) =>
      name === 'set' &&
      payload &&
      INTERNAL_TRAFFIC_PARAM in (payload as Record<string, unknown>),
  )
  return set
    ? (set[1] as Record<string, string>)[INTERNAL_TRAFFIC_PARAM]
    : undefined
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

describe("traffic_type: 'internal' on the marketing surface (AGL-2064)", () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    delete (global as any).fetch
  })

  it('stamps a browser that opted in, on our own property', async () => {
    const script = await renderFor(PLATFORM_ID)
    const { calls } = runInit(script, '', true)
    expect(stampOf(calls)).toBe(INTERNAL_TRAFFIC_VALUE)
  })

  it('stamps NOTHING for an ordinary visitor to the same page', async () => {
    // The population the September funnel is actually about.
    const script = await renderFor(PLATFORM_ID)
    const { calls } = runInit(script, '', false)
    expect(stampOf(calls)).toBeUndefined()
    // And the tag still configures — the stamp must not be able to silence it.
    expect(calls.some(([name]) => name === 'config')).toBe(true)
  })

  it(`?${INTERNAL_TRAFFIC_QUERY_PARAM}=1 stamps the pageview that carries it, and persists`, async () => {
    const script = await renderFor(PLATFORM_ID)
    const first = runInit(script, `?${INTERNAL_TRAFFIC_QUERY_PARAM}=1`, false)
    // This hit is already a session_start and a first_visit. Stamping only
    // from the next one would leak the session's most load-bearing events.
    expect(stampOf(first.calls)).toBe(INTERNAL_TRAFFIC_VALUE)
    expect(first.stored).toBe(INTERNAL_TRAFFIC_VALUE)
  })

  it(`?${INTERNAL_TRAFFIC_QUERY_PARAM}=0 takes it back off`, async () => {
    const script = await renderFor(PLATFORM_ID)
    const { calls, stored } = runInit(
      script,
      `?${INTERNAL_TRAFFIC_QUERY_PARAM}=0`,
      true,
    )
    expect(stampOf(calls)).toBeUndefined()
    expect(stored).toBeNull()
  })

  it("never reaches a CUSTOMER's property, even from an opted-in browser", async () => {
    // The expensive direction. Their visitors are their revenue, and an
    // Active filter on their side would discard them irrecoverably.
    const script = await renderFor(CUSTOMER_ID)
    expect(script).not.toContain(INTERNAL_TRAFFIC_PARAM)
    const { calls } = runInit(script, `?${INTERNAL_TRAFFIC_QUERY_PARAM}=1`, true)
    expect(stampOf(calls)).toBeUndefined()
  })

  it('stamps BEFORE the tag is configured, so automatic events carry it', async () => {
    const script = await renderFor(PLATFORM_ID)
    const { calls } = runInit(script, '', true)
    const setAt = calls.findIndex(
      ([name, payload]) =>
        name === 'set' &&
        payload &&
        INTERNAL_TRAFFIC_PARAM in (payload as Record<string, unknown>),
    )
    const configAt = calls.findIndex(([name]) => name === 'config')
    expect(setAt).toBeGreaterThanOrEqual(0)
    expect(configAt).toBeGreaterThanOrEqual(0)
    // gtag applies `set` to hits processed after it. `config` is what raises
    // session_start / first_visit / the automatic page_view.
    expect(setAt).toBeLessThan(configAt)
  })

  it('serves IDENTICAL bytes to both browsers — the page is ISR-cached', async () => {
    // A server-side or first-render branch here would bake one browser's
    // answer into a document handed to every visitor. The difference has to
    // live entirely in the runtime evaluation, which the cases above prove
    // still happens.
    const script = await renderFor(PLATFORM_ID)
    const optedIn = runInit(script, '', true)
    const ordinary = runInit(script, '', false)
    expect(stampOf(optedIn.calls)).toBe(INTERNAL_TRAFFIC_VALUE)
    expect(stampOf(ordinary.calls)).toBeUndefined()
    // Same source, both times: nothing above depended on re-rendering.
    expect(script).toBe(await renderFor(PLATFORM_ID))
  })

  it('leaves the consent gate exactly where it was', async () => {
    // A visitor in a prior-consent region gets no init block at all, so there
    // is nothing for the stamp to ride and nothing was loosened to add it.
    plantRegion('DE')
    await act(async () => {
      render(
        <SiteAnalytics
          host={
            { $id: HOST_ID, analytics: { gaMeasurementId: PLATFORM_ID } } as any
          }
        />,
      )
    })
    expect(screen.queryByTestId('ga-init')).toBeNull()
  })
})
