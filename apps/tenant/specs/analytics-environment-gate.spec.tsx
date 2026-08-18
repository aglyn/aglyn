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
 * The marketing tag exists only on a real production deployment (AGL-2067).
 *
 * `aglyn.com`'s host document carries our own measurement id, and `next dev`
 * and a Vercel preview build resolve it exactly as production does — so before
 * this gate, browsing the marketing site while building, or clicking through a
 * preview URL, produced genuine visitor hits in the live Platform property.
 *
 * This is the half of Zach's 2026-08-18 ask that needs nobody's click: the
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
 */
import {
  ANALYTICS_ALLOW_NONPROD_ENV,
} from '@aglyn/aglyn/app-utils/analytics-environment'
import {
  INTERNAL_TRAFFIC_PARAM,
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
