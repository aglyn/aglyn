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
 * The console declares its region-conditional consent default BEFORE the tag
 * boots (AGL-1597).
 *
 * `app.aglyn.com` ran GA4 with no consent declaration of any kind, which is
 * not "analytics on by default where that is lawful" — it is analytics on
 * everywhere, ad storage included, in the prior-consent regions too.
 *
 * ORDERING is the entire mechanism and it is what these cases pin. A consent
 * `default` that lands after `gtag('config', …)` is not a default; the tag has
 * already taken its first hit under whatever state it invented. The SDK issues
 * that `config` from inside `initializeAnalytics`, so the assertion that
 * matters is not "the declaration exists" but "the declaration was already in
 * `dataLayer` at the moment `initializeAnalytics` was called".
 *
 * Hence the mock captures a SNAPSHOT of the queue at call time rather than
 * reading `window.dataLayer` afterwards. Reading it afterwards would pass just
 * as happily with the push moved below the init — the exact defect this file
 * exists to catch, and a test that cannot tell the two apart is testing that
 * some code ran somewhere.
 *
 * PLANTED REDS (both verified):
 *  1. Remove the `pushPlatformConsentDefault` call → every case fails.
 *  2. Move the call BELOW `initializeAnalyticsInstance` → the ordering cases
 *     fail while the queue is still populated, which is the point.
 */

import { render } from '@testing-library/react'
import {
  PLATFORM_CONSENT_DEFAULT_COMMANDS,
  PLATFORM_PRIOR_CONSENT_REGIONS,
} from '@aglyn/aglyn/app-utils/platform-consent-default'
import { FirebaseServicesProvider } from './firebase-services'

/**
 * The queue as it stood when the SDK was asked to boot. Captured inside the
 * mock, because that instant is the whole assertion — see the file comment.
 */
let queueAtInit: unknown[] | null = null

const initializeAnalytics = jest.fn((_app: unknown, _options?: unknown) => {
  const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer
  queueAtInit = layer === undefined ? null : [...layer]
  return {}
})

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  initializeAnalytics: (...args: Parameters<typeof initializeAnalytics>) =>
    initializeAnalytics(...args),
  getAnalytics: () => ({}),
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
      appName={`agl1597-consent-${appCounter++}`}
    >
      <div />
    </FirebaseServicesProvider>,
  )
}

/**
 * These cases describe a PRODUCTION deployment and have to say so (AGL-2067):
 * outside one, `analyticsMayEmit()` is false, no tag is created, and no
 * consent declaration is needed because nothing would read it.
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

/** The consent commands present in a queue snapshot, in order. */
function consentCommands(queue: unknown[] | null): Record<string, unknown>[] {
  if (queue === null) return []
  return queue
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((args) => args[0] === 'consent' && args[1] === 'default')
    .map((args) => args[2] as Record<string, unknown>)
}

describe('the console consent default (AGL-1597)', () => {
  beforeEach(() => {
    queueAtInit = null
    initializeAnalytics.mockClear()
    delete (window as unknown as { dataLayer?: unknown[] }).dataLayer
    delete (window as unknown as { __aglynConsentDefaultPushed?: boolean })
      .__aglynConsentDefaultPushed
  })

  it('is already queued when the SDK is asked to boot the tag', () => {
    mountProvider()

    expect(initializeAnalytics).toHaveBeenCalled()
    expect(consentCommands(queueAtInit)).toHaveLength(2)
  })

  it('grants analytics by default, and denies it for the prior-consent regions', () => {
    mountProvider()

    const [globalDefault, regional] = consentCommands(queueAtInit)
    expect(globalDefault.analytics_storage).toBe('granted')
    expect(globalDefault.region).toBeUndefined()
    expect(regional.analytics_storage).toBe('denied')
    expect(regional.region).toEqual(PLATFORM_PRIOR_CONSENT_REGIONS)
  })

  it('moves the ad signals TOGETHER with analytics, in both declarations', () => {
    mountProvider()

    const commands = consentCommands(queueAtInit)
    // Asserted BEFORE the loop, and this is not belt-and-braces: a `for` over
    // an empty list passes every expectation inside it. Without this line the
    // case stays green when the declaration is missing entirely — which is
    // precisely the state it is here to rule out.
    expect(commands).toHaveLength(2)
    for (const command of commands) {
      // The relation, not the values. Aglyn advertises, remarkets and
      // retargets on this surface and the Privacy Policy names it, so the ad
      // signals follow the same posture analytics does — granted where consent
      // is implied, denied where it must be asked for first. What must never
      // be reachable is advertising running while analytics does not: the
      // visitor's refusal is one refusal, and every surface clamps it that way.
      expect(command.ad_storage).toBe(command.analytics_storage)
      expect(command.ad_user_data).toBe(command.analytics_storage)
      expect(command.ad_personalization).toBe(command.analytics_storage)
    }
    // …and the two declarations really do differ, so the relation above is not
    // satisfied by a declaration that denies everything everywhere.
    const [globalDefault, regional] = commands
    expect(globalDefault.ad_storage).toBe('granted')
    expect(regional.ad_storage).toBe('denied')
  })

  it('queues `arguments` objects, which is the only form gtag.js reads', () => {
    mountProvider()

    // `dataLayer.push(['consent', …])` is the classic silent no-op: no error,
    // and no declaration. The queue would look populated and mean nothing.
    const queue = queueAtInit ?? []
    // Same reason as above — an empty queue must fail here, not pass quietly.
    expect(queue.length).toBeGreaterThanOrEqual(2)
    for (const entry of queue) {
      expect(Array.isArray(entry)).toBe(false)
      expect(Object.prototype.toString.call(entry)).toBe('[object Arguments]')
    }
  })

  it('declares exactly what the shared module ships', () => {
    mountProvider()

    // Not a re-stated literal: if the shared declaration changes, this
    // follows it, and if the console stops using the shared declaration this
    // fails.
    expect(consentCommands(queueAtInit)).toEqual([
      ...PLATFORM_CONSENT_DEFAULT_COMMANDS,
    ])
  })
})
