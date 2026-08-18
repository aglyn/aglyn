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
 * AGL-1979 — why `analytics` could be `undefined`, and why that then crashed
 * the console two frames away.
 *
 * `firebase/analytics` is REAL in this file, deliberately. The bug lives
 * entirely in the SDK's re-initialization contract, and a mock of
 * `initializeAnalytics` cannot have that contract — the existing
 * `analytics-page-view.spec.tsx` mocks it, which is exactly why it stayed
 * green while the provider handed every consumer `undefined`.
 *
 * Only the services this file says nothing about are mocked.
 */

import { render } from '@testing-library/react'
import { initializeApp } from 'firebase/app'
import * as firebaseAppInternal from '@firebase/app'
import { type Analytics, initializeAnalytics, logEvent } from 'firebase/analytics'
import { FirebaseServicesProvider, useAnalytics } from './firebase-services'

/**
 * `_getProvider` is a real, stable runtime export of `@firebase/app` — it is
 * how `firebase/analytics` itself reaches the provider — but the package's
 * published types deliberately withhold it: `package.json` points `types` at
 * `dist/app-public.d.ts`, which carries a comment reading
 * "Excluded from this release type: _getProvider". The full declaration
 * exists in `dist/app.d.ts`, which nothing resolves to.
 *
 * So a plain `import { _getProvider } from '@firebase/app'` runs correctly and
 * fails `tsc` with TS2305. This spec needs the real provider precisely because
 * the bug it pins lives in the SDK's re-initialization contract — mocking it
 * would rebuild the blind spot AGL-1979 came from — so the shim declares the
 * one internal signature used here rather than dropping the SDK for a fake.
 */
const { _getProvider } = firebaseAppInternal as unknown as {
  _getProvider: (
    app: unknown,
    name: 'analytics',
  ) => { getImmediate: () => Analytics }
}

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
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

/**
 * A distinct `appId` per case. `@firebase/analytics` keeps a module-scope
 * `initializationPromisesMap` keyed by appId, so sharing one across cases
 * makes every case after the first throw `already-exists` and the file would
 * "pass" while testing a completely different error. (It did, the first time
 * this was written.)
 */
let appIdCounter = 0
const configFor = () => ({
  apiKey: 'test-api-key',
  authDomain: 'aglyn-main.firebaseapp.com',
  projectId: 'aglyn-main',
  appId: `1:0:web:${appIdCounter++}`,
  measurementId: 'G-TEST',
})

let consoleError: jest.SpyInstance

beforeEach(() => {
  // The async half of `_initializeAnalytics` fetches the dynamic config. A
  // promise that never settles keeps it from resolving into the test's
  // teardown; nothing here asserts on it.
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(
    () => new Promise(() => undefined),
  )
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

function mountAndReadAnalytics(appName: string): Analytics | undefined {
  let seen: Analytics | undefined
  function Probe() {
    seen = useAnalytics()
    return null
  }
  render(
    <FirebaseServicesProvider
      firebaseConfig={configFor()}
      appName={appName}
    >
      <Probe />
    </FirebaseServicesProvider>,
  )
  return seen
}

describe('the SDK contract the provider re-enters (characterization)', () => {
  it('re-entry with EQUAL options returns the existing instance — remounts are not the bug', () => {
    // This is the fact that rules out the obvious suspects. StrictMode's
    // double invoke, a remount and a Fast Refresh all re-run the provider's
    // init block with a fresh object literal, and none of them can throw:
    // the SDK's `deepEqual` is a true recursive compare, not a reference
    // check. Anything blaming those is blaming the wrong thing.
    const app = initializeApp(configFor(), 'reentry-equal-options')

    const first = initializeAnalytics(app, {
      config: { send_page_view: false, content_group: 'console' },
    })
    const second = initializeAnalytics(app, {
      config: { send_page_view: false, content_group: 'console' },
    })

    expect(second).toBe(first)
  })

  it('an options-less initialization POISONS the app: every later call throws', () => {
    // The reachable cause. `getAnalytics()` is one door;
    // `@firebase/remote-config` is the other and needs no help from us —
    // `addExperimentToAnalytics` calls `analyticsProvider.getImmediate({
    // optional: true })`, and `optional` only suppresses the throw, it does
    // not stop the initialization. Either way the provider is left holding
    // `{}` for options, and the conflict is permanent for the document.
    const app = initializeApp(configFor(), 'reentry-poisoned')
    _getProvider(app as never, 'analytics').getImmediate()

    expect(() =>
      initializeAnalytics(app, {
        config: { send_page_view: false, content_group: 'console' },
      }),
    ).toThrow(/already-initialized/)
  })

  it('`logEvent` with no instance throws the TypeError seen on app.aglyn.com', () => {
    // Why the provider may not hand a consumer `undefined`, and why the
    // console gates its bindings on having an instance: this is the exact
    // production error, `Cannot read properties of undefined (reading 'app')`.
    expect(() =>
      (logEvent as (...args: unknown[]) => void)(undefined, 'page_view', {}),
    ).toThrow(TypeError)
  })
})

describe('the provider survives a poisoned app (AGL-1979)', () => {
  it('yields the already-initialized instance instead of undefined', () => {
    // The regression. Before the fix the provider caught the
    // `already-initialized` throw, assigned nothing, and published
    // `analytics: undefined` — and `useAnalytics()` is typed as always
    // returning an `Analytics` with strictNullChecks off repo-wide, so every
    // consumer dereferenced it in good faith.
    const appName = 'provider-poisoned-app'
    const app = initializeApp(configFor(), appName)
    const poisoned = _getProvider(app as never, 'analytics').getImmediate()

    const seen = mountAndReadAnalytics(appName)

    expect(seen).toBeDefined()
    expect(seen).toBe(poisoned)
  })

  it('says so out loud — a degraded tag is reported, never swallowed', () => {
    // The recovered instance is attached to a tag configured without
    // `content_group` and without `send_page_view: false`. That is a real
    // loss (an unstamped surface, a duplicated startup page_view), so the
    // conflict has to remain visible rather than being papered over.
    const appName = 'provider-poisoned-app-logs'
    const app = initializeApp(configFor(), appName)
    _getProvider(app as never, 'analytics').getImmediate()

    mountAndReadAnalytics(appName)

    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes('already-initialized'),
      ),
    ).toBe(true)
  })

  it('a healthy app is untouched: the instance comes from the CONFIGURED init', () => {
    // The fallback must never become the normal path — it would silently
    // drop `send_page_view: false` and `content_group`. On a healthy app
    // nothing throws, so nothing falls back.
    const seen = mountAndReadAnalytics('provider-healthy-app')

    expect(seen).toBeDefined()
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes('already-initialized'),
      ),
    ).toBe(false)
  })
})
