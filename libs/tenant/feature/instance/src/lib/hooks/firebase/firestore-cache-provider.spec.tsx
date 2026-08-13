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
 * AGL-1456, the wiring half — the sibling of `auth-persistence-provider.spec.tsx`
 * for the *other* thing this origin writes to disk.
 *
 * AGL-1379 sealed the credential. This asserts the safe behind it: the
 * `localCache` the provider **actually hands `initializeFirestore`** for each
 * host class. `firestore-cache.spec.ts` pins the helper's declaration; this
 * pins that the provider reaches it, because a helper nothing calls is exactly
 * the failure AGL-1354 was.
 *
 * Deliberately NOT a config read-back. The assertion is on the settings object
 * constructed at the call site, with the **real** `firebase/firestore`
 * factories — only `initializeFirestore` itself is intercepted, so `kind` is
 * the SDK's own verdict rather than a shape this test invented.
 *
 * What this cannot prove, and what is therefore still owed: that nothing
 * org-identifying survives in IndexedDB on a real customer-controlled origin.
 * jsdom has no IndexedDB, and the PoC that found the leak
 * (`docs/design/agl-1099a-poc-findings.md` §5) needed a real browser. That
 * check is owed against an attached custom console domain.
 */

import { render } from '@testing-library/react'

import { FirebaseServicesProvider } from './firebase-services'
import type { AuthPersistenceClass } from './auth-persistence'
import type { FirestoreSettings } from 'firebase/firestore'

const mockInitializeFirestore = jest.fn(
  (_app: unknown, _settings: FirestoreSettings) => ({}),
)

// Only `initializeFirestore` is a spy. Every cache factory is the real SDK
// one, so `localCache.kind` below is Firebase's own tag, not ours.
jest.mock('firebase/firestore', () => {
  const actual = jest.requireActual('firebase/firestore')
  return {
    __esModule: true,
    memoryLocalCache: actual.memoryLocalCache,
    memoryLruGarbageCollector: actual.memoryLruGarbageCollector,
    persistentLocalCache: actual.persistentLocalCache,
    persistentMultipleTabManager: actual.persistentMultipleTabManager,
    initializeFirestore: (app: unknown, settings: FirestoreSettings) =>
      mockInitializeFirestore(app, settings),
    getFirestore: () => ({}),
    connectFirestoreEmulator: jest.fn(),
  }
})

// `nx test` leaks the root `.env` into the worker, and the emulator branch
// carries no `localCache` at all — so pin the production branch rather than
// inherit whichever way the ambient environment happens to fall.
jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/shared-data-enums'),
  FIREBASE_AUTH_EMULATOR_ENABLED: false,
  FIREBASE_DATABASE_EMULATOR_ENABLED: false,
  FIREBASE_FIRESTORE_EMULATOR_ENABLED: false,
}))

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

const CONFIG = {
  apiKey: 'test-api-key',
  authDomain: 'aglyn-main.firebaseapp.com',
  projectId: 'aglyn-main',
  appId: '1:0:web:0',
}

let appCounter = 0

/**
 * Mount the real provider and return the settings object it built for THIS
 * app. A fresh `appName` per mount: Firestore initialization is once-per-app,
 * and the provider's guard is keyed on the app name for that reason.
 */
function firestoreSettingsFor(
  authPersistence?: AuthPersistenceClass,
): FirestoreSettings {
  const before = mockInitializeFirestore.mock.calls.length
  render(
    <FirebaseServicesProvider
      firebaseConfig={CONFIG}
      appName={`agl1456-firestore-${appCounter++}`}
      authPersistence={authPersistence}
    />,
  )
  const calls = mockInitializeFirestore.mock.calls
  // If this fails, the provider skipped initialization for this app entirely
  // and the app silently took SDK defaults — a settings assertion below would
  // then be asserting nothing.
  expect(calls.length).toBe(before + 1)
  return calls[calls.length - 1][1]
}

describe('the Firestore local cache the provider constructs, per host class', () => {
  it('writes document bodies to disk on a durable origin — *.aglyn.com is unchanged', () => {
    // The default and the explicit form must agree: `*.aglyn.com` and
    // `*.aglyn.app` keep `persistentLocalCache`, which is what the console's
    // read volume is currently priced against (AGL-1440).
    expect(firestoreSettingsFor().localCache?.kind).toBe('persistent')
    expect(firestoreSettingsFor('durable').localCache?.kind).toBe('persistent')
  })

  it('keeps every document body off disk on a custom console domain', () => {
    // The whole point of AGL-1456. D6 chose in-memory auth persistence because
    // "the customer can re-point the DNS and read this origin" — which is just
    // as true of every cached document body as it is of the refresh token.
    expect(firestoreSettingsFor('ephemeral').localCache?.kind).toBe('memory')
  })

  it('never leaves an ephemeral origin holding a persistent cache, whatever else changes', () => {
    // The property stated as the thing to disprove, rather than as an
    // implementation detail: nothing durable, on an origin someone else can
    // take back.
    const settings = firestoreSettingsFor('ephemeral')
    expect(settings.localCache?.kind).not.toBe('persistent')
    expect(settings.localCache).toBeDefined()
  })
})
