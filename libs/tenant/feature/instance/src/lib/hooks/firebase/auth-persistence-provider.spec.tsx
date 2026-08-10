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
 * AGL-1379, the wiring half: a guard that exists but is never reached is
 * exactly the failure AGL-1354 was.
 *
 * `auth-persistence.spec.ts` proves the seal holds on an instance built by
 * calling the factory directly. This proves the instance the console's
 * `useAuth()` actually hands out comes from that factory — so declaring
 * `authPersistence="ephemeral"` on a custom console domain (AGL-1099c) is
 * enough, and nobody has to remember to construct auth differently.
 *
 * It also pins the other direction, which matters more today: with no prop,
 * the provider is `durable` and its `setPersistence` still works. The console
 * runs on `*.aglyn.com`, where persisting is correct.
 *
 * `firebase/auth` and `firebase/app` are REAL here; only the services this
 * test says nothing about are mocked.
 */

import { render } from '@testing-library/react'
import { browserLocalPersistence, setPersistence } from 'firebase/auth'

import {
  FirebaseServicesProvider,
  useAuth,
  useAuthPersistence,
} from './firebase-services'
import { isAuthPersistenceSealed } from './auth-persistence'
import type { Auth } from 'firebase/auth'
import type { AuthPersistenceClass } from './auth-persistence'

jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
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

/** Renders the real provider and returns what its consumers would see. */
function mountProvider(authPersistence?: AuthPersistenceClass): {
  auth: Auth
  declared: AuthPersistenceClass
} {
  const seen: { auth?: Auth; declared?: AuthPersistenceClass } = {}
  function Probe() {
    seen.auth = useAuth()
    seen.declared = useAuthPersistence()
    return null
  }
  render(
    <FirebaseServicesProvider
      firebaseConfig={CONFIG}
      // A fresh app per mount: `initializeAuth` is once-per-app, and the
      // provider reuses an app of the same name across renders.
      appName={`agl1379-provider-${appCounter++}`}
      authPersistence={authPersistence}
    >
      <Probe />
    </FirebaseServicesProvider>,
  )
  return { auth: seen.auth, declared: seen.declared }
}

describe('FirebaseServicesProvider persistence class', () => {
  it('defaults to durable, and durable still persists — the console is unchanged', async () => {
    const { auth, declared } = mountProvider()

    expect(declared).toBe('durable')
    expect(isAuthPersistenceSealed(auth)).toBe(false)
    await expect(
      setPersistence(auth, browserLocalPersistence),
    ).resolves.toBeUndefined()
  })

  it('seals the instance useAuth() hands out when the origin is ephemeral', () => {
    const { auth, declared } = mountProvider('ephemeral')

    expect(declared).toBe('ephemeral')
    expect(isAuthPersistenceSealed(auth)).toBe(true)
    // The call the six existing call sites make, against the instance they
    // would actually be handed on a custom console domain.
    expect(() => setPersistence(auth, browserLocalPersistence)).toThrow(/sealed/i)
  })

  it('publishes the class so a second Firebase app inherits it', () => {
    // `usePresence` builds its own app and its own Auth. It reads this rather
    // than re-deciding, which is why configuring the provider alone is now
    // enough (AGL-1379 item 2).
    expect(mountProvider('ephemeral').declared).toBe('ephemeral')
    expect(mountProvider('durable').declared).toBe('durable')
    expect(mountProvider().declared).toBe('durable')
  })
})
