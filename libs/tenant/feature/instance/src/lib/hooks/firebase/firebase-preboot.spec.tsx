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
 * `prebootFirebaseServices` (AGL-3660): the console starts Auth, App Check
 * and Firestore at module scope, and the provider adopts those instances on
 * its first render instead of building a second set.
 */
import { render } from '@testing-library/react'
import { initializeApp } from 'firebase/app'
import { initializeAppCheck } from 'firebase/app-check'
import { getAuth, initializeAuth } from 'firebase/auth'

import {
  FirebaseServicesProvider,
  prebootFirebaseServices,
  useAuth,
} from './firebase-services'

jest.mock('firebase/app', () => ({
  __esModule: true,
  getApps: jest.fn(() => []),
  initializeApp: jest.fn((_options: unknown, name: string) => ({
    name,
    options: {},
  })),
}))
jest.mock('firebase/auth', () => ({
  __esModule: true,
  ...jest.requireActual('firebase/auth'),
  getAuth: jest.fn((app: { name: string }) => ({ kind: 'durable', app })),
  initializeAuth: jest.fn((app: { name: string }) => ({ kind: 'ephemeral', app })),
  inMemoryPersistence: {},
  connectAuthEmulator: jest.fn(),
  onIdTokenChanged: jest.fn(() => () => undefined),
}))
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
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({}),
  initializeFirestore: () => ({}),
  connectFirestoreEmulator: jest.fn(),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
  memoryLocalCache: jest.fn(),
  memoryLruGarbageCollector: jest.fn(),
}))

const CONFIG = {
  apiKey: 'test-api-key',
  authDomain: 'aglyn-main.firebaseapp.com',
  projectId: 'aglyn-main',
  appId: '1:0:web:0',
}

const KEY_VAR = 'NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY'
const originalKey = process.env[KEY_VAR]
let counter = 0
const nextAppName = () => `agl3660-preboot-${counter++}`

let seenAuth: unknown
function CaptureAuth() {
  seenAuth = useAuth()
  return null
}

function mount(appName: string, authPersistence?: 'durable' | 'ephemeral') {
  return render(
    <FirebaseServicesProvider
      firebaseConfig={CONFIG}
      appName={appName}
      authPersistence={authPersistence}
    >
      <CaptureAuth />
    </FirebaseServicesProvider>,
  )
}

beforeAll(() => {
  process.env[KEY_VAR] = '6LfnSnAb-test-site-key'
})
afterAll(() => {
  if (originalKey === undefined) delete process.env[KEY_VAR]
  else process.env[KEY_VAR] = originalKey
})
beforeEach(() => {
  jest.clearAllMocks()
  seenAuth = undefined
})

describe('prebootFirebaseServices (AGL-3660)', () => {
  it('starts Auth and App Check before any provider renders', () => {
    const appName = nextAppName()
    prebootFirebaseServices({ firebaseConfig: CONFIG, appName })

    expect(initializeApp).toHaveBeenCalledTimes(1)
    expect(getAuth).toHaveBeenCalledTimes(1)
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
  })

  it('is adopted by the first provider, which initializes nothing again', () => {
    const appName = nextAppName()
    prebootFirebaseServices({ firebaseConfig: CONFIG, appName })
    const prebootAuth = (getAuth as jest.Mock).mock.results[0]?.value

    mount(appName)

    expect(initializeApp).toHaveBeenCalledTimes(1)
    expect(getAuth).toHaveBeenCalledTimes(1)
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
    expect(seenAuth).toBe(prebootAuth)
  })

  it('runs once per app and persistence class', () => {
    const appName = nextAppName()
    prebootFirebaseServices({ firebaseConfig: CONFIG, appName })
    prebootFirebaseServices({ firebaseConfig: CONFIG, appName })

    expect(initializeApp).toHaveBeenCalledTimes(1)
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
  })

  it('is never adopted under a different persistence class', () => {
    const appName = nextAppName()
    prebootFirebaseServices({
      firebaseConfig: CONFIG,
      appName,
      authPersistence: 'durable',
    })

    mount(appName, 'ephemeral')

    // The provider built its own, sealed, in-memory Auth rather than taking
    // the durable one the preboot made.
    expect(initializeAuth).toHaveBeenCalledTimes(1)
    expect((seenAuth as { kind: string }).kind).toBe('ephemeral')
  })

  it('is taken once: a later mount boots as it always did', () => {
    const appName = nextAppName()
    prebootFirebaseServices({ firebaseConfig: CONFIG, appName })
    mount(appName).unmount()
    jest.clearAllMocks()

    mount(appName)

    expect(getAuth).toHaveBeenCalledTimes(1)
  })

  it('a provider with no preboot boots exactly as before', () => {
    mount(nextAppName())

    expect(initializeApp).toHaveBeenCalledTimes(1)
    expect(getAuth).toHaveBeenCalledTimes(1)
    expect(initializeAppCheck).toHaveBeenCalledTimes(1)
  })

  it('never throws when the boot fails, leaving the provider to boot', () => {
    ;(initializeApp as jest.Mock).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const appName = nextAppName()

    expect(() =>
      prebootFirebaseServices({ firebaseConfig: CONFIG, appName }),
    ).not.toThrow()
    mount(appName)

    expect(initializeApp).toHaveBeenCalledTimes(2)
    expect(seenAuth).toBeTruthy()
    error.mockRestore()
  })
})
