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
 * The analytics consent gate is STRUCTURAL: no tag is created while it says
 * no.
 *
 * The distinction this file exists to keep is between a gate and a
 * suppression. A suppressed tag is a tag: gtag.js has been fetched,
 * `window.gtag` exists, GA4 enhanced measurement fires on its own, and the
 * shared `deliver()` in `analytics-events.ts` uses `window.gtag` as its
 * fallback whenever no transport is registered. So "we set a flag afterwards"
 * is not the same claim as "nothing was collected", and only the second one is
 * worth making. Every assertion below is therefore about whether
 * `initializeAnalytics` was CALLED, never about a boolean the code could have
 * set and ignored.
 *
 * Each case names one thing whose removal turns it red, and every negative
 * case has a positive control beside it — a suite where the tag is never
 * created for any reason would otherwise pass completely while proving
 * nothing.
 *
 * PLANTED REDS (all three run, counts observed):
 *  1. Delete the `analyticsConsentAllows()` clause in
 *     `analyticsForConsentState` → 4 fail, 2 pass. The two that pass are the
 *     controls, which is what says the suite is not vacuous.
 *  2. Make the unregistered default `false` instead of `true` → 1 fails, and
 *     it is the self-hosted case; nothing else moves.
 *  3. Delete the `VISITOR_CONSENT_CHANGED_EVENT` listener in the provider →
 *     2 fail — deferred grant and withdrawal — while the synchronous cases
 *     stay green. That is the difference between a gate read once and a gate
 *     honoured for the life of the document.
 */

import { act, render } from '@testing-library/react'
import { VISITOR_CONSENT_CHANGED_EVENT } from '@aglyn/aglyn/app-utils/visitor-consent'
import {
  FirebaseServicesProvider,
  setAnalyticsConsentGate,
  useAnalytics,
} from './firebase-services'

const initializeAnalytics = jest.fn((_app: unknown, _options?: unknown) => ({
  tag: 'analytics',
}))

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  initializeAnalytics: (...args: Parameters<typeof initializeAnalytics>) =>
    initializeAnalytics(...args),
  getAnalytics: () => ({ tag: 'analytics' }),
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

/** What `useAnalytics()` saw on the most recent render. */
let seen: unknown

function Probe(): null {
  seen = useAnalytics()
  return null
}

/**
 * A FRESH app name per mount. `initializeAnalytics` is once-per-app and the
 * provider caches the instance per app, so reusing a name would let one case's
 * tag satisfy the next case's assertion — the shape that makes a gate look
 * honoured when it is not.
 */
function mountProvider(): void {
  render(
    <FirebaseServicesProvider
      firebaseConfig={CONFIG}
      appName={`consent-gate-${appCounter++}`}
    >
      <Probe />
    </FirebaseServicesProvider>,
  )
}

/**
 * These cases describe a PRODUCTION deployment and have to say so: outside
 * one, `analyticsMayEmit()` is false and NO tag is created for any visitor —
 * under which every negative case below would pass for the wrong reason.
 */
const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}
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
  process.env.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
})
afterAll(() => {
  process.env.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) {
    delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  } else {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
  }
})

beforeEach(() => {
  initializeAnalytics.mockClear()
  seen = undefined
  setAnalyticsConsentGate(null)
})
afterEach(() => setAnalyticsConsentGate(null))

describe('the analytics consent gate', () => {
  it('creates NO tag while the gate refuses', () => {
    setAnalyticsConsentGate(() => false)
    mountProvider()
    // The whole claim. Not "a flag was set", not "the instance was hidden":
    // the SDK was never asked, so gtag.js is never fetched and `window.gtag`
    // never comes into existence for `deliver()` to fall back onto.
    expect(initializeAnalytics).not.toHaveBeenCalled()
    expect(seen).toBeUndefined()
  })

  it('creates the tag when the gate grants — the control for the case above', () => {
    setAnalyticsConsentGate(() => true)
    mountProvider()
    expect(initializeAnalytics).toHaveBeenCalledTimes(1)
    expect(seen).toEqual({ tag: 'analytics' })
  })

  it('treats a gate that THROWS as a refusal', () => {
    // Storage throws in private mode, and "we could not tell" is the one state
    // this mechanism resolves to no. A gate wrapped in a bare try/catch that
    // returned `true` on failure would fail exactly the visitors most likely
    // to care.
    setAnalyticsConsentGate(() => {
      throw new Error('localStorage is not available')
    })
    mountProvider()
    expect(initializeAnalytics).not.toHaveBeenCalled()
  })

  it('creates the tag when NO gate is registered', () => {
    // The tenant runtime and self-hosted consoles never register one. Silently
    // switching them off because Aglyn's own surface grew a gate would be a
    // failure an operator cannot diagnose from their own GA property.
    mountProvider()
    expect(initializeAnalytics).toHaveBeenCalledTimes(1)
  })

  it('boots the tag when consent arrives AFTER the first render', () => {
    // The rest-of-world first visit: resolving the region is a network call,
    // so the visitor is undecided at the instant the provider first renders
    // and is granted a moment later, in the same document. Without this the
    // synchronous gate would quietly mean "a first visit is never measured".
    let granted = false
    setAnalyticsConsentGate(() => granted)
    mountProvider()
    expect(initializeAnalytics).not.toHaveBeenCalled()

    granted = true
    act(() => {
      window.dispatchEvent(new CustomEvent(VISITOR_CONSENT_CHANGED_EVENT))
    })
    expect(initializeAnalytics).toHaveBeenCalledTimes(1)
    expect(seen).toEqual({ tag: 'analytics' })
  })

  it('drops the instance when consent is WITHDRAWN mid-session', () => {
    // Dropping it unmounts every binding hung off it, which is what
    // unregisters the analytics transport. The resident tag cannot be
    // unloaded — the shared consent writer sets `ga-disable-<id>` and sends a
    // denied `consent update` for that half — but nothing of ours may keep
    // handing it hits.
    let granted = true
    setAnalyticsConsentGate(() => granted)
    mountProvider()
    expect(seen).toEqual({ tag: 'analytics' })

    granted = false
    act(() => {
      window.dispatchEvent(new CustomEvent(VISITOR_CONSENT_CHANGED_EVENT))
    })
    expect(seen).toBeUndefined()
  })
})
