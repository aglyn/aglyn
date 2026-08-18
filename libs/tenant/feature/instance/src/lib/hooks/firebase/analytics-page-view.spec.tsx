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
 */

/**
 * AGL-1643, the half that decides whether the console's pageviews are counted
 * once or twice.
 *
 * Booting Firebase Analytics issues `gtag('config', <id>, configProperties)`,
 * and the vendored SDK's own comment on that call reads: "This will trigger a
 * page_view event unless 'send_page_view' is set to false in
 * configProperties". `getAnalytics(app)` cannot pass `configProperties` at
 * all, so the key was never present and that hit always fired — on top of the
 * `page_view` the console layout sends from its own effect on mount.
 *
 * What this pins is the SUPPRESSION and its DIRECTION. The layout's hit is the
 * one kept because it fires on mount AND on every `usePathname` change, so it
 * is a superset of the SDK's once-per-document hit; suppressing the layout's
 * instead would have halved console pageviews by silently dropping every
 * client-side navigation, and the reports would have looked entirely healthy.
 *
 * `firebase/app` and `firebase/auth` are REAL here; only the services this
 * test says nothing about are mocked.
 */

import { render } from '@testing-library/react'
import { ANALYTICS_ALLOW_NONPROD_ENV } from '@aglyn/aglyn/app-utils/analytics-environment'
import { FirebaseServicesProvider } from './firebase-services'

/**
 * The SDK's real second parameter: `initializeAnalytics(app, options?)`, whose
 * `options.config` is the only thing forwarded to the `gtag('config', …)` call.
 * The mock is declared with that exact arity deliberately — the arity IS the
 * finding this spec pins. `getAnalytics(app)` takes no options at all, which is
 * why `send_page_view: false` could never be passed and the startup hit always
 * fired; a nullary mock would have let the spec pass while describing a
 * function the SDK does not have.
 */
type AnalyticsSettings = { config?: Record<string, unknown> }

const initializeAnalytics = jest.fn(
  (_app: unknown, _options?: AnalyticsSettings) => ({}),
)
const getAnalytics = jest.fn((_app: unknown) => ({}))

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  initializeAnalytics: (...args: Parameters<typeof initializeAnalytics>) =>
    initializeAnalytics(...args),
  // The provider DOES have a `getAnalytics` fallback now (AGL-1979) — it is
  // how a conflicting re-init still yields a usable instance instead of the
  // `undefined` every consumer then dereferenced. It is spied rather than
  // omitted because the point this file protects is that the fallback stays a
  // FALLBACK: `getAnalytics` cannot pass `config`, so reaching it on a healthy
  // boot would silently drop `send_page_view: false` and `content_group` and
  // every assertion below would still pass.
  getAnalytics: (...args: Parameters<typeof getAnalytics>) =>
    getAnalytics(...args),
}))
jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  getRemoteConfig: () => ({ settings: {} }),
}))
jest.mock('firebase/storage', () => ({
  __esModule: true,
  getStorage: () => ({}),
}))
jest.mock('firebase/database', () => ({
  __esModule: true,
  getDatabase: () => ({}),
  connectDatabaseEmulator: jest.fn(),
}))
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({}),
  initializeFirestore: () => ({}),
  connectFirestoreEmulator: jest.fn(),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
}))
const CONFIG = {
  apiKey: 'test-api-key',
  authDomain: 'aglyn-main.firebaseapp.com',
  projectId: 'aglyn-main',
  appId: '1:0:web:0',
}

let appCounter = 0

function mountProvider(): void {
  render(
    <FirebaseServicesProvider
      firebaseConfig={CONFIG}
      appName={`agl1643-analytics-${appCounter++}`}
    >
      <div />
    </FirebaseServicesProvider>,
  )
}


/**
 * These cases describe a PRODUCTION deployment, and now have to say so
 * (AGL-2067): outside one, `analyticsMayEmit()` is false and no tag is
 * created at all. Declared per file rather than in a jest setup, because
 * `NODE_ENV` changes far more than analytics and a global override would
 * quietly move other behaviour under every spec in the repo.
 */
const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}
beforeAll(() => {
  process.env.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
})
afterAll(() => {
  process.env.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
})

describe('console analytics boot (AGL-1643)', () => {
  beforeEach(() => {
    initializeAnalytics.mockClear()
    getAnalytics.mockClear()
  })

  it('suppresses the SDK startup page_view so the layout owns pageviews', () => {
    mountProvider()

    expect(initializeAnalytics).toHaveBeenCalled()
    const [, options] = initializeAnalytics.mock.calls[0]
    expect(options?.config?.send_page_view).toBe(false)
  })

  it('passes the flag as `config`, the only key gtag reads it from', () => {
    mountProvider()

    const [, options] = initializeAnalytics.mock.calls[0]
    // A `send_page_view` at the top level of AnalyticsSettings is inert — the
    // SDK forwards `options.config` and nothing else to the gtag config call.
    expect(options).not.toHaveProperty('send_page_view')
    expect(options).toHaveProperty('config')
  })

  it("stamps content_group: 'console' on the tag config (AGL-1857)", () => {
    mountProvider()

    const [, options] = initializeAnalytics.mock.calls[0]
    // The one-click marketing/docs/console split in GA4 standard reports.
    // Config-level, so it rides every hit on the Firebase-injected tag —
    // the manual page_view, the taxonomy events, and the SDK's automatics.
    expect(options?.config?.content_group).toBe('console')
  })

  it('never boots through `getAnalytics` — the config-less door (AGL-1979)', () => {
    // `getAnalytics(app)` takes no options at all, so a boot that goes
    // through it configures the tag with neither `send_page_view: false` nor
    // `content_group` — the exact tag a poisoned app leaves behind. It is
    // reachable only from the provider's catch, and on a healthy boot nothing
    // throws, so nothing may reach it.
    mountProvider()

    expect(initializeAnalytics).toHaveBeenCalled()
    expect(getAnalytics).not.toHaveBeenCalled()
  })
})

/**
 * And the same boot, refused (AGL-2067).
 *
 * This provider used to call `initializeAnalytics` unconditionally, while
 * `apps/console/.env.development.local` points at the PRODUCTION measurement
 * id — so every `next dev` session and every Vercel preview build produced
 * real `session_start` / `first_visit` / `page_view` hits in the live
 * property. The archived Marketing property's whole year-to-date history is
 * mostly preview `/signin` views, which is what that looks like from the
 * reporting side.
 *
 * NOT initialized rather than initialized-and-suppressed: a resident tag
 * reports on its own (AGL-1608 is the same lesson from the consent side), and
 * `useAnalytics()` returning undefined is already a supported state
 * everywhere (AGL-1979) — which is what makes this a two-line gate rather
 * than an audit.
 *
 * Planted reds, verified: drop the `analyticsMayEmit()` condition → the dev
 * and preview cases; make the escape hatch unconditional → nothing, which is
 * why the production case above is asserted in the same file.
 */
describe('analytics is not booted outside production (AGL-2067)', () => {
  const saved = {
    nodeEnv: process.env.NODE_ENV,
    deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
    hatch: process.env[ANALYTICS_ALLOW_NONPROD_ENV],
  }

  function inEnv(env: {
    nodeEnv: string
    deployEnv?: string
    hatch?: string
  }): void {
    process.env.NODE_ENV = env.nodeEnv
    if (env.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
    else process.env.NEXT_PUBLIC_DEPLOY_ENV = env.deployEnv
    if (env.hatch === undefined) delete process.env[ANALYTICS_ALLOW_NONPROD_ENV]
    else process.env[ANALYTICS_ALLOW_NONPROD_ENV] = env.hatch
  }

  beforeEach(() => {
    initializeAnalytics.mockClear()
    getAnalytics.mockClear()
  })

  afterEach(() => {
    process.env.NODE_ENV = saved.nodeEnv
    if (saved.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
    else process.env.NEXT_PUBLIC_DEPLOY_ENV = saved.deployEnv
    if (saved.hatch === undefined) delete process.env[ANALYTICS_ALLOW_NONPROD_ENV]
    else process.env[ANALYTICS_ALLOW_NONPROD_ENV] = saved.hatch
  })

  it('boots nothing under next dev', () => {
    inEnv({ nodeEnv: 'development' })
    mountProvider()
    expect(initializeAnalytics).not.toHaveBeenCalled()
    // And not through the fallback door either — that would boot a tag with
    // NO config, i.e. one that also sends the startup page_view.
    expect(getAnalytics).not.toHaveBeenCalled()
  })

  it('boots nothing on a Vercel preview, whose NODE_ENV is production', () => {
    inEnv({ nodeEnv: 'production', deployEnv: 'preview' })
    mountProvider()
    expect(initializeAnalytics).not.toHaveBeenCalled()
    expect(getAnalytics).not.toHaveBeenCalled()
  })

  it('boots on an unknown production deployment — the self-host default', () => {
    // Their Firebase project and their GA property; our leak must not be
    // fixed by silencing a customer's analytics.
    inEnv({ nodeEnv: 'production' })
    mountProvider()
    expect(initializeAnalytics).toHaveBeenCalled()
  })

  it('boots when the escape hatch is deliberately set', () => {
    inEnv({ nodeEnv: 'development', hatch: '1' })
    mountProvider()
    expect(initializeAnalytics).toHaveBeenCalled()
  })
})
