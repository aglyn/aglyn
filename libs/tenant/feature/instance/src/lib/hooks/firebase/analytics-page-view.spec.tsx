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

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  // Deliberately NO `getAnalytics`: if the provider ever falls back to it,
  // this mock makes that a hard failure instead of a silent regression.
  initializeAnalytics: (...args: Parameters<typeof initializeAnalytics>) =>
    initializeAnalytics(...args),
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

describe('console analytics boot (AGL-1643)', () => {
  beforeEach(() => {
    initializeAnalytics.mockClear()
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
})
