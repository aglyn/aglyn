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
 * AGL-2049 — App Check is not registered without a site key.
 *
 * ## What went wrong, and why no test existed
 *
 * On the `aglyn-tenant` Vercel project the site-key variable was misspelled
 * `NEXT_PUBLIC_RECPATCHA_PUBLIC_KEY` for three years and eleven months, so
 * `process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` was `undefined` in every
 * tenant build ever made. `new ReCaptchaV3Provider(undefined)` does not throw:
 * it stores the value, `initializeAppCheck` returns normally, and the SDK then
 * requests `recaptcha/api.js?render=undefined` — a failure that happens
 * ASYNCHRONOUSLY, past the `try/catch` around the call. So the app held a
 * provider it could never mint a token for, and said nothing.
 *
 * The typo lived only in a dashboard, so no lint rule or review could have
 * caught it. Every existing spec that touches this code mocks
 * `initializeAppCheck` away and asserts nothing about whether it ran. This is
 * the first test that does, and it drives BOTH directions — a guard only
 * proved in the direction that skips is a guard that might always skip.
 *
 * The same hole is the documented self-host path: `.env.selfhost.example`
 * ships the variable empty.
 */

import { render } from '@testing-library/react'

import {
  appCheckSiteKey,
  APP_CHECK_KEY_MISSING_MESSAGE,
} from '../../constants/firebase-config'
import { FirebaseServicesProvider } from './firebase-services'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  getAnalytics: () => ({}),
  initializeAnalytics: () => ({}),
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

const KEY_VAR = 'NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY'
const original = process.env[KEY_VAR]
let appCounter = 0

/** A fresh app name per mount: the provider reuses an app of the same name. */
function mountProvider(): void {
  render(
    <FirebaseServicesProvider
      firebaseConfig={CONFIG}
      appName={`agl2049-app-check-${appCounter++}`}
    >
      <div />
    </FirebaseServicesProvider>,
  )
}

afterAll(() => {
  if (original === undefined) delete process.env[KEY_VAR]
  else process.env[KEY_VAR] = original
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('appCheckSiteKey (AGL-2049)', () => {
  it('returns the key when one is set', () => {
    process.env[KEY_VAR] = '6LfnSnAb-test-site-key'
    expect(appCheckSiteKey()).toBe('6LfnSnAb-test-site-key')
  })

  it('trims surrounding whitespace rather than passing it through', () => {
    process.env[KEY_VAR] = '  6LfnSnAb-test-site-key  '
    expect(appCheckSiteKey()).toBe('6LfnSnAb-test-site-key')
  })

  it.each([
    ['unset', undefined],
    ['empty — the shape `.env.selfhost.example` ships', ''],
    ['whitespace only', '   '],
    // An env var interpolated from an unset shell variable arrives as the
    // literal four characters, which is also the exact value that would end up
    // in the SDK's `?render=` query.
    ['the literal string "undefined"', 'undefined'],
  ])('answers null when the key is %s', (_label, value) => {
    if (value === undefined) delete process.env[KEY_VAR]
    else process.env[KEY_VAR] = value
    expect(appCheckSiteKey()).toBeNull()
  })
})

describe('FirebaseServicesProvider App Check registration (AGL-2049)', () => {
  it('registers App Check when a site key is present', () => {
    // The direction that proves the skip below is a decision and not the only
    // thing this code can do.
    process.env[KEY_VAR] = '6LfnSnAb-test-site-key'
    mountProvider()

    expect(ReCaptchaV3Provider).toHaveBeenCalledWith('6LfnSnAb-test-site-key')
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
    expect(
      (initializeAppCheck as jest.Mock).mock.calls[0][1],
    ).toMatchObject({ isTokenAutoRefreshEnabled: true })
  })

  it('registers NOTHING when the site key is missing', () => {
    delete process.env[KEY_VAR]
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    mountProvider()

    // Not "constructed with undefined and then caught" — never constructed.
    // A provider built on `undefined` fails asynchronously, so the catch
    // around `initializeAppCheck` cannot see it, and the app is left holding
    // one that can never mint a token.
    expect(ReCaptchaV3Provider).not.toHaveBeenCalled()
    expect(initializeAppCheck).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(APP_CHECK_KEY_MISSING_MESSAGE)
    warn.mockRestore()
  })

  it('says so out loud — the silence was the defect', () => {
    // Four years of a misspelled variable produced no signal of any kind. The
    // message names the variable, so a search for the variable finds the log.
    expect(APP_CHECK_KEY_MISSING_MESSAGE).toContain(KEY_VAR)
    expect(APP_CHECK_KEY_MISSING_MESSAGE).toMatch(/DISABLED/)
  })
})
