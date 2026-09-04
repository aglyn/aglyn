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
 * @jest-environment-options {"url": "https://console.aglyn.com/"}
 */

/**
 * A refusal on the CONSOLE actually stops collection — asserted on the wire,
 * not on a flag.
 *
 * The console reports into GA4 `G-YW5PG16YTM` through its own Firebase
 * Analytics instance, and it had no consent gate of any kind: `/signin` — the
 * console's most-collected public page, where there is no account menu and no
 * signed-in user — was measured for every visitor, European ones included. The
 * region-scoped consent-mode default narrowed what the tag could STORE and
 * never stopped it loading, which is the specific thing prior-consent law
 * prohibits.
 *
 * ## Why these cases assert on `window.gtag` and on the transport
 *
 * Because that is where a hit would actually go, and because the two ways this
 * could be faked both survive a boolean assertion:
 *
 *  - `deliver()` in `analytics-events.ts` falls back to `window.gtag` whenever
 *    no transport is registered. On a surface where the SDK has already
 *    injected gtag, dropping the transport is not a refusal — it is a change
 *    of route.
 *  - a tag that has loaded reports on its own, through GA4 enhanced
 *    measurement, with no call site anywhere.
 *
 * So the mocked SDK below does exactly what the real one does: booting the tag
 * installs `window.gtag`. If the gate leaks, `window.gtag` exists and the
 * event lands on it, and these cases say so.
 *
 * The child mirrors the ONE line in `firebase-app.layout.tsx` that mounts the
 * analytics bindings — `analytics ? <Bindings/> : null`. That the real layout
 * has no ungated binding beside it is pinned separately, by
 * `analytics-instance-gate.spec.ts`, so it is not re-litigated here.
 *
 * PLANTED REDS (all four run, counts observed):
 *  1. Register no gate at all — the state this work found the console in —
 *     → 5 fail. The two that survive are the rest-of-world cases, which is
 *     exactly right: they describe behaviour that did not change.
 *  2. Let an ABSENT record grant (`?.analytics !== false`) → 4 fail. Being
 *     undecided has to mean no, whatever the reason for it.
 *  3. Resolve an unknown region to `opt-out` → 1 fails, and it is the
 *     unknown-region case; nothing else moves, which is what says that case
 *     is about the region and not about the gate.
 *  4. Delete the refusing-transport branch → 1 fails, the withdrawal case,
 *     and only that one — because it is the only case where a tag is already
 *     resident when the refusal arrives. That is the whole reason the branch
 *     exists, isolated.
 */

import { act, render } from '@testing-library/react'
import {
  configureAnalyticsTransport,
  resetAnalyticsTransport,
  trackEvent,
} from '@aglyn/aglyn/app-utils/analytics-events'
import {
  decidePlatformConsent,
  platformAnalyticsAllowed,
  PLATFORM_CONSENT_REGION_CACHE_KEY,
  PLATFORM_CONSENT_SUBJECT,
  resetPlatformConsentPriming,
  storePlatformConsent,
} from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { visitorConsentStorageKey } from '@aglyn/aglyn/app-utils/visitor-consent'
import {
  FirebaseServicesProvider,
  setAnalyticsConsentGate,
  useAnalytics,
} from '@aglyn/tenant-feature-instance'
import { useEffect } from 'react'

/** Every hit the page hands to gtag, however it got there. */
const mockGtag = jest.fn()

/**
 * The SDK's observable side effect: booting a tag installs `window.gtag`.
 * Modelled, because the refusal claim is about that global existing at all —
 * a mock that returned an instance and left the window clean would let a
 * leaking gate pass.
 */
const mockInitializeAnalytics = jest.fn(() => {
  ;(window as unknown as { gtag?: unknown }).gtag = mockGtag
  return { tag: 'analytics' }
})
const mockLogEvent = jest.fn()

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  initializeAnalytics: () => mockInitializeAnalytics(),
  getAnalytics: () => mockInitializeAnalytics(),
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
  setUserId: jest.fn(),
  setUserProperties: jest.fn(),
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

/** The layout's binding gate, and the transport registration it carries. */
function Bindings({ analytics }: { analytics: unknown }): null {
  useEffect(() => {
    configureAnalyticsTransport((name, params) => {
      mockLogEvent(analytics, name, params)
    })
    return () => configureAnalyticsTransport(null)
  }, [analytics])
  return null
}

/**
 * The refusing transport the layout mounts when consent is withheld. Without
 * it, tearing down the bindings only re-routes hits: `deliver()` falls back to
 * `window.gtag`, which the SDK has already injected and which no page can
 * unload.
 */
function Refusal(): null {
  useEffect(() => {
    configureAnalyticsTransport(() => undefined)
    return () => configureAnalyticsTransport(null)
  }, [])
  return null
}

/**
 * `AnalyticsGlobalEvents`, reduced to the two branches that decide delivery.
 *
 * A mirror, and the risk of a mirror is that it drifts from the thing it
 * mirrors and keeps passing. `analytics-instance-gate.spec.ts` is what stops
 * that: it reads the real component's source and fails if either branch
 * changes shape.
 */
function Gate(): JSX.Element {
  const analytics = useAnalytics()
  return (
    <>
      {analytics ? <Bindings analytics={analytics} /> : null}
      {!analytics && !platformAnalyticsAllowed() ? <Refusal /> : null}
    </>
  )
}

function mountConsole(): void {
  render(
    <FirebaseServicesProvider
      firebaseConfig={CONFIG}
      appName={`console-consent-${appCounter++}`}
    >
      <Gate />
    </FirebaseServicesProvider>,
  )
}

/**
 * The zone the browser reports, driven per case. Only the READING is mocked;
 * the zone-to-posture mapping stays real.
 */
let mockTimeZone = 'Etc/GMT+3'
jest.mock('@aglyn/aglyn/app-utils/timezone-geo-hint', () => ({
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/timezone-geo-hint',
  ),
  readBrowserTimeZone: () => mockTimeZone,
}))

/** Answer the region endpoint with one country, as the edge would. */
function serveRegion(country: string | null): void {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ country }),
  }))
}

const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}
const savedFetch = (global as unknown as { fetch?: unknown }).fetch

/**
 * A production deployment is also a real HOSTNAME, which is why this file's
 * first docblock names a document URL (AGL-2067). jsdom serves every spec from
 * `localhost`, and `analyticsMayEmit` reads a loopback host as a machine
 * talking to itself — it stays silent however the variables below are set, so
 * the two halves only describe a deployment together.
 *
 * The pragma counts only in the FIRST docblock of the file. jest reads no
 * other one, and ignores a later one without saying so.
 */
beforeAll(() => {
  // A PRODUCTION deployment, said out loud: outside one no tag is created for
  // anybody, under which every refusal case here would pass for the wrong
  // reason.
  ;(process.env as Record<string, string>).NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
})
afterAll(() => {
  ;(process.env as Record<string, string>).NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) {
    delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  } else {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
  }
  ;(global as unknown as { fetch?: unknown }).fetch = savedFetch
})

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete (window as unknown as { gtag?: unknown }).gtag
  mockGtag.mockClear()
  mockLogEvent.mockClear()
  mockInitializeAnalytics.mockClear()
  resetAnalyticsTransport()
  resetPlatformConsentPriming()
  mockTimeZone = 'Etc/GMT+3'
  // The console's real wiring, registered exactly as
  // `firebase-app.layout.tsx` registers it at module scope.
  setAnalyticsConsentGate(platformAnalyticsAllowed)
})
afterEach(() => {
  setAnalyticsConsentGate(null)
  resetAnalyticsTransport()
})

/** Everything a hit could have reached, in one place. */
function collected(): { gtag: number; transport: number } {
  return { gtag: mockGtag.mock.calls.length, transport: mockLogEvent.mock.calls.length }
}

describe('console visitor consent stops collection', () => {
  it('sends NOTHING for a prior-consent-region visitor with no record', async () => {
    serveRegion('DE')
    await act(async () => {
      await decidePlatformConsent()
    })
    mountConsole()
    trackEvent('login', { method: 'password' })

    // No tag was ever created, so there is no `window.gtag` for `deliver()`'s
    // fallback to find and no instance for a transport to be built on.
    expect(mockInitializeAnalytics).not.toHaveBeenCalled()
    expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined()
    expect(collected()).toEqual({ gtag: 0, transport: 0 })
    // And nothing was recorded on their behalf either — an undecided visitor
    // stays undecided rather than being defaulted in.
    expect(
      window.localStorage.getItem(
        visitorConsentStorageKey(PLATFORM_CONSENT_SUBJECT),
      ),
    ).toBeNull()
  })

  it('sends for a rest-of-world visitor — the control for the case above', async () => {
    serveRegion('US')
    await act(async () => {
      await decidePlatformConsent()
    })
    mountConsole()
    trackEvent('login', { method: 'password' })

    expect(mockInitializeAnalytics).toHaveBeenCalled()
    expect(collected().transport).toBe(1)
  })

  it('sends NOTHING when the region cannot be determined', async () => {
    // No geo header AND a zone that says nothing — a locked-down browser, a
    // fixed UTC offset, a visitor hiding their clock. Unknown resolves to the
    // strict side, because the asymmetry is a few lost events against
    // pre-consent tracking of a European visitor.
    mockTimeZone = 'Etc/GMT+3'
    serveRegion(null)
    await act(async () => {
      await decidePlatformConsent()
    })
    mountConsole()
    trackEvent('login', { method: 'password' })

    expect(mockInitializeAnalytics).not.toHaveBeenCalled()
    expect(collected()).toEqual({ gtag: 0, transport: 0 })
  })

  it('sends for a headerless visit whose ZONE places it outside those regions', async () => {
    // The self-hosted shape: a container behind a plain reverse proxy sets no
    // geo header on any request, so every visitor would otherwise read as
    // unlocatable and be asked to opt in — a banner the operator cannot switch
    // off and cannot diagnose. The zone is the last resort and it only ever
    // decides the posture; no country is claimed on the record.
    mockTimeZone = 'America/Chicago'
    serveRegion(null)
    await act(async () => {
      await decidePlatformConsent()
    })
    mountConsole()
    trackEvent('login', { method: 'password' })

    expect(collected().transport).toBe(1)
  })

  it('stops sending when a rest-of-world visitor WITHDRAWS', async () => {
    serveRegion('US')
    await act(async () => {
      await decidePlatformConsent()
    })
    mountConsole()
    trackEvent('login', { method: 'password' })
    expect(collected().transport).toBe(1)

    // The account menu's panel, saving a refusal.
    act(() => {
      storePlatformConsent({ status: 'opted-out', country: 'US' })
    })
    mockGtag.mockClear()
    mockLogEvent.mockClear()
    trackEvent('login', { method: 'password' })

    // The transport is gone with the instance it was built on. The tag itself
    // cannot be unloaded — `storeVisitorConsent` sets `ga-disable-<id>` and
    // sends a denied `consent update` for that half — but nothing of ours
    // hands it another hit.
    expect(collected()).toEqual({ gtag: 0, transport: 0 })
  })

  it('starts sending when consent arrives after the page has rendered', async () => {
    // The rest-of-world FIRST visit, in the order it really happens: the
    // provider renders before the region endpoint has answered. Without the
    // deferred boot this reads as "a first visit is never measured", and it
    // would be invisible — a quiet undercount, not an error.
    serveRegion('US')
    mountConsole()
    expect(mockInitializeAnalytics).not.toHaveBeenCalled()

    await act(async () => {
      await decidePlatformConsent()
    })
    trackEvent('login', { method: 'password' })
    expect(collected().transport).toBe(1)
  })

  it('honours an explicit accept from a prior-consent region', async () => {
    // The other half of case one: the banner is not decoration. Same region,
    // same absent record, one click of Allow between them.
    serveRegion('DE')
    await act(async () => {
      await decidePlatformConsent()
    })
    mountConsole()
    expect(mockInitializeAnalytics).not.toHaveBeenCalled()

    act(() => {
      storePlatformConsent({ status: 'accepted', country: 'DE' })
    })
    trackEvent('login', { method: 'password' })
    expect(collected().transport).toBe(1)
  })

  it('caches the region answer for the visit, not for the visitor', async () => {
    // One lookup per visit. Session storage, never local: a country pinned
    // across visits is a country that follows someone through a border.
    serveRegion('FR')
    await act(async () => {
      await decidePlatformConsent()
    })
    expect(
      window.sessionStorage.getItem(PLATFORM_CONSENT_REGION_CACHE_KEY),
    ).toBe(JSON.stringify({ country: 'FR' }))
    expect(
      window.localStorage.getItem(PLATFORM_CONSENT_REGION_CACHE_KEY),
    ).toBeNull()
  })
})
