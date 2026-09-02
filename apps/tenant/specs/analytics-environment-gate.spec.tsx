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
 * The marketing tag exists only on a real production deployment (AGL-2067).
 *
 * `aglyn.com`'s host document carries our own measurement id, and `next dev`
 * and a Vercel preview build resolve it exactly as production does — so before
 * this gate, browsing the marketing site while building, or clicking through a
 * preview URL, produced genuine visitor hits in the live Platform property.
 *
 * This is the half of the 2026-08-18 ask that needs nobody's click: the
 * `traffic_type` stamp only separates our traffic once the GA4 data filter
 * exists, and a filter is not retroactive, while a tag that was never mounted
 * sends nothing today.
 *
 * The gate is on the RENDER CONDITION, next to the consent gate, for the
 * AGL-1608 reason: a tag that loads and is then told to be quiet still
 * re-creates `_ga` and reports on its own. Never created is the only state
 * that needs nothing else to be true.
 *
 * Planted reds, verified: drop `analyticsMayEmit()` from the condition → the
 * dev and preview cases; make `analyticsEnvironmentForcesInternal` ignore the
 * hatch → the escape-hatch case.
 *
 * ## The document URL, and the one signal these cases do NOT drive
 *
 * Every case states its own `NODE_ENV` and `NEXT_PUBLIC_DEPLOY_ENV`, but the
 * gate reads a fourth signal — the HOSTNAME — and that one is fixed per file:
 * jsdom builds `location` once and leaves it non-configurable, so it can only
 * be set through the `@jest-environment-options` pragma in the first docblock.
 * Serving the file from a real name is what keeps the two negative cases
 * honest. Under jsdom's default `localhost` they went green on the loopback
 * rule and never reached the `NODE_ENV` and deploy-environment rules they are
 * named for, which is a case that cannot fail.
 *
 * The loopback rule itself is proven on the function instead, over every form
 * of it (`127.0.0.0/8`, `::1`, `0.0.0.0`, the reserved `.localhost` tree) and
 * against the self-host default it must not swallow, in
 * `libs/aglyn/src/lib/app-utils/analytics-environment.spec.ts`.
 */
import {
  ANALYTICS_ALLOW_NONPROD_ENV,
} from '@aglyn/aglyn/app-utils/analytics-environment'
import {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_QUERY_PARAM,
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_VALUE,
} from '@aglyn/aglyn/app-utils/internal-traffic'
import { ANALYTICS_BEACON_ENDPOINT } from '@aglyn/aglyn/app-utils/analytics-beacon'
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

const HOST_ID = 'analytics-env-host'
const PLATFORM_ID = 'G-YW5PG16YTM'

/**
 * `process.env` is typed read-only for `NODE_ENV` in this app (Next ships that
 * declaration), and these cases have to state which deployment they describe
 * — see AGL-2067. One narrow cast, named, rather than one per assignment.
 */
const mutableEnv = process.env as Record<string, string | undefined>

const saved = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
  hatch: process.env[ANALYTICS_ALLOW_NONPROD_ENV],
}

/** State the deployment this case is about, then render the marketing tag. */
async function renderIn(env: {
  nodeEnv: string
  deployEnv?: string
  hatch?: string
}) {
  cleanup()
  mutableEnv.NODE_ENV = env.nodeEnv
  if (env.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = env.deployEnv
  if (env.hatch === undefined) delete process.env[ANALYTICS_ALLOW_NONPROD_ENV]
  else process.env[ANALYTICS_ALLOW_NONPROD_ENV] = env.hatch

  storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US' })
  ;(global as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ country: 'US' }),
  }))
  await act(async () => {
    render(
      <SiteAnalytics
        host={
          { $id: HOST_ID, analytics: { gaMeasurementId: PLATFORM_ID } } as any
        }
      />,
    )
  })
  return screen.queryByTestId('ga-init')
}

describe('the marketing tag is production-only (AGL-2067)', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    delete (global as any).fetch
    mutableEnv.NODE_ENV = saved.nodeEnv
    if (saved.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
    else process.env.NEXT_PUBLIC_DEPLOY_ENV = saved.deployEnv
    if (saved.hatch === undefined) delete process.env[ANALYTICS_ALLOW_NONPROD_ENV]
    else process.env[ANALYTICS_ALLOW_NONPROD_ENV] = saved.hatch
  })

  it('mounts on a real production deployment', async () => {
    // Non-vacuity: everything below asserts an absence, and an absence check
    // passes for free the day the component stops rendering at all.
    expect(
      await renderIn({ nodeEnv: 'production', deployEnv: 'production' }),
    ).not.toBeNull()
  })

  it('mounts on an UNKNOWN production deployment — the self-host default', async () => {
    // Their Firebase project, their GA property. Our leak must not be fixed
    // by breaking a customer's analytics.
    expect(await renderIn({ nodeEnv: 'production' })).not.toBeNull()
  })

  it('mounts NOTHING under next dev', async () => {
    expect(await renderIn({ nodeEnv: 'development' })).toBeNull()
  })

  it('mounts NOTHING on a Vercel preview, whose NODE_ENV is production', async () => {
    expect(
      await renderIn({ nodeEnv: 'production', deployEnv: 'preview' }),
    ).toBeNull()
  })

  it('the escape hatch re-enables the tag AND forces the internal stamp', async () => {
    // A non-production build that emits does so because one of us asked it
    // to, so its hits are ours by construction — no browser opt-in required,
    // and the hatch cannot become the leak it stands beside.
    window.localStorage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY)
    const init = await renderIn({ nodeEnv: 'development', hatch: '1' })
    expect(init).not.toBeNull()
    const text = init?.textContent ?? ''
    expect(text).toContain(
      `gtag('set',{'${INTERNAL_TRAFFIC_PARAM}':'${INTERNAL_TRAFFIC_VALUE}'});`,
    )
    // Unconditional, not the localStorage-reading form.
    expect(text).not.toContain(INTERNAL_TRAFFIC_STORAGE_KEY)
    // And still before the config call, for the same reason as ever.
    expect(text.indexOf(INTERNAL_TRAFFIC_PARAM)).toBeLessThan(
      text.indexOf("gtag('config'"),
    )
  })

  it('a PRODUCTION build with the hatch set never blanket-stamps', async () => {
    // The expensive direction: this would erase every paying customer from
    // every report the moment the GA4 filter went Active.
    const init = await renderIn({
      nodeEnv: 'production',
      deployEnv: 'production',
      hatch: '1',
    })
    const text = init?.textContent ?? ''
    // The conditional form is present; the unconditional one is not.
    expect(text).toContain(INTERNAL_TRAFFIC_STORAGE_KEY)
  })
})


/**
 * The METERED beacon is production-only too, and honors the browser opt-in.
 *
 * The gate above was applied to the GA4 mount, the GTM mount, the advertising
 * tags and Firebase Analytics — every tag that costs nothing — and not to
 * `/api/analytics/collect`, which increments the counter behind
 * `orgs/{orgId}/usage/{month}.pageViews`, the Stripe meter, the free plan's
 * bandwidth band and the abuse ceiling. `apps/tenant/.env` names the
 * PRODUCTION Firebase project, so a `next dev` and every preview deployment
 * wrote real page views into a live customer's invoice.
 *
 * These cases drive the component, not the predicate — the predicate has its
 * own file. What is asserted here is the WIRING: that `SiteAnalytics` asks
 * before it sends.
 *
 * Planted reds, verified: send through a raw `navigator.sendBeacon` instead of
 * `sendAnalyticsBeacon` → the dev, preview, hatch and internal-browser cases
 * go red together. Drop the early `analyticsBeaconMaySend()` from
 * `sendPageviewBeacon` alone → only the visit-claim case goes red, because the
 * shared sender asks the same question again before it sends; that early
 * return exists for the CLAIM, and the last case is what holds it in place.
 *
 * ⚠️ Each case navigates to its own path. `beaconed` is module state keyed by
 * host and path and deliberately outlives a `render` — a metered input must
 * not be told twice about one pageview — so two cases sharing a path would
 * leave the second asserting an absence it got for free.
 */
describe('the metered pageview beacon is production-only', () => {
  let beacons: Array<Record<string, unknown>>
  let pathCounter = 0

  /**
   * State the deployment and the browser, then render and report what the
   * collector was told.
   */
  async function beaconsFrom(env: {
    nodeEnv: string
    deployEnv?: string
    hatch?: string
    /**
     * Put the browser's internal opt-in on the URL, as a visit would:
     * `true` opts in, `false` opts back out, absent leaves the URL clean.
     */
    internal?: boolean
  }): Promise<Array<Record<string, unknown>>> {
    cleanup()
    beacons = []
    mutableEnv.NODE_ENV = env.nodeEnv
    if (env.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
    else process.env.NEXT_PUBLIC_DEPLOY_ENV = env.deployEnv
    if (env.hatch === undefined) delete process.env[ANALYTICS_ALLOW_NONPROD_ENV]
    else process.env[ANALYTICS_ALLOW_NONPROD_ENV] = env.hatch

    const query =
      env.internal === undefined
        ? ''
        : `?${INTERNAL_TRAFFIC_QUERY_PARAM}=${env.internal ? '1' : '0'}`
    window.history.replaceState(null, '', `/beacon-${++pathCounter}${query}`)
    ;(navigator as any).sendBeacon = jest.fn((url: string, body: string) => {
      if (url === ANALYTICS_BEACON_ENDPOINT) beacons.push(JSON.parse(body))
      return true
    })
    ;(global as any).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ country: 'US' }),
    }))
    const hostId = `beacon-host-${pathCounter}`
    storeVisitorConsent(hostId, { status: 'accepted', country: 'US' })
    await act(async () => {
      render(<SiteAnalytics host={{ $id: hostId } as any} />)
    })
    return beacons
  }

  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    delete (global as any).fetch
    delete (navigator as any).sendBeacon
    mutableEnv.NODE_ENV = saved.nodeEnv
    if (saved.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
    else process.env.NEXT_PUBLIC_DEPLOY_ENV = saved.deployEnv
    if (saved.hatch === undefined) delete process.env[ANALYTICS_ALLOW_NONPROD_ENV]
    else process.env[ANALYTICS_ALLOW_NONPROD_ENV] = saved.hatch
  })

  it('counts a pageview on a real production deployment', async () => {
    // Non-vacuity for every absence asserted below.
    const sent = await beaconsFrom({
      nodeEnv: 'production',
      deployEnv: 'production',
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ path: '/beacon-1' })
  })

  it('counts a pageview on an UNKNOWN production deployment — self-host', async () => {
    expect(await beaconsFrom({ nodeEnv: 'production' })).toHaveLength(1)
  })

  it('counts NOTHING under next dev', async () => {
    expect(await beaconsFrom({ nodeEnv: 'development' })).toEqual([])
  })

  it('counts NOTHING on a Vercel preview', async () => {
    expect(
      await beaconsFrom({ nodeEnv: 'production', deployEnv: 'preview' }),
    ).toEqual([])
  })

  it('counts NOTHING under the escape hatch, which the GA tag honors', async () => {
    // The one place this gate and `analyticsMayEmit` disagree on purpose. The
    // hatch buys a GA session against DebugView, whose hits are stamped ours;
    // a hit stamped ours must never reach an invoice.
    expect(
      await beaconsFrom({ nodeEnv: 'development', hatch: '1' }),
    ).toEqual([])
  })

  it('counts NOTHING from a browser carrying the internal opt-in', async () => {
    // ⚑ The visit that CARRIES `?aglyn_internal=1` is itself suppressed. GA
    // stamps that first hit and lets a data filter drop it later; a counter
    // has no later, because it is a running total that feeds a bill.
    expect(
      await beaconsFrom({
        nodeEnv: 'production',
        deployEnv: 'production',
        internal: true,
      }),
    ).toEqual([])
    // ...and the browser stays ours on the next pageview, with a clean URL.
    expect(
      await beaconsFrom({ nodeEnv: 'production', deployEnv: 'production' }),
    ).toEqual([])
  })

  it('a suppressed pageview does not spend the tab visit claim', async () => {
    // Why the gate sits ABOVE `claimDailyVisit` rather than inside the send.
    // The claim is one per tab per UTC day and it is what makes a pageview
    // report a VISITOR; spending it on a view nobody counted would make the
    // first counted view of the session look like a continuation of a visit
    // that was never recorded, and `visitors` would run under `total` by one
    // for every browser that ever opted out mid-session.
    expect(
      await beaconsFrom({
        nodeEnv: 'production',
        deployEnv: 'production',
        internal: true,
      }),
    ).toEqual([])
    const sent = await beaconsFrom({
      nodeEnv: 'production',
      deployEnv: 'production',
      internal: false,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ newVisit: true })
  })
})
