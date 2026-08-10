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
 * AGL-1379: the in-memory-persistence property is one public call from being
 * undone, and six such calls already exist.
 *
 * `docs/design/agl-1099a-poc-findings.md` §4 measured it on a real instance
 * created with `inMemoryPersistence`:
 *
 * ```
 * before setPersistence   refresh token in persistent storage: ABSENT
 * setPersistence(auth, browserLocalPersistence)   → RESOLVED "accepted"
 * after  setPersistence   refresh token in persistent storage: PRESENT
 * ```
 *
 * No error, no warning. On a custom console domain — an origin whose DNS the
 * customer can re-point at their own server after a detach — that is a
 * durable account-takeover primitive back in full.
 *
 * These run against the **real** `firebase/auth`, not a mock. A mocked
 * `setPersistence` would prove nothing: the property under test is that the
 * SDK's own delegation (`getModularInstance(auth).setPersistence(...)`)
 * lands on the sealed member.
 */

import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth'

import {
  AUTH_PERSISTENCE_SEALED_CODE,
  createAuthInstance,
  isAuthPersistenceSealed,
} from './auth-persistence'

const CONFIG = {
  apiKey: 'test-api-key',
  authDomain: 'aglyn-main.firebaseapp.com',
  projectId: 'aglyn-main',
  appId: '1:0:web:0',
}

let appCounter = 0
const apps: FirebaseApp[] = []

/** A fresh Firebase app per test — `initializeAuth` is once-per-app. */
function freshApp(): FirebaseApp {
  const app = initializeApp(CONFIG, `agl1379-${appCounter++}`)
  apps.push(app)
  return app
}

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => undefined)))
})

describe('ephemeral auth refuses setPersistence', () => {
  /**
   * THE guard test. Delete the `Object.defineProperty` block in
   * `sealPersistence` and this is the test that goes red — verified by doing
   * exactly that, see the AGL-1379 commit message.
   */
  it('refuses the modular setPersistence on an ephemeral instance', () => {
    const auth = createAuthInstance(freshApp(), 'ephemeral')

    expect(() => setPersistence(auth, browserLocalPersistence)).toThrow(
      /sealed/i,
    )
    // Every persistence the SDK offers, not just the one the six call sites
    // happen to pass today.
    expect(() => setPersistence(auth, indexedDBLocalPersistence)).toThrow()
    expect(() => setPersistence(auth, browserSessionPersistence)).toThrow()
  })

  it('carries a recognisable code so a caller can tell this from a Firebase error', () => {
    const auth = createAuthInstance(freshApp(), 'ephemeral')

    let thrown: { code?: string } | undefined
    try {
      setPersistence(auth, browserLocalPersistence)
    } catch (error) {
      thrown = error as { code?: string }
    }
    expect(thrown?.code).toBe(AUTH_PERSISTENCE_SEALED_CODE)
  })

  it('refuses the method form too, not only the modular free function', () => {
    const auth = createAuthInstance(freshApp(), 'ephemeral')

    expect(() => auth.setPersistence(browserLocalPersistence)).toThrow(/sealed/i)
  })

  it('cannot be un-sealed by assignment or redefinition', () => {
    const auth = createAuthInstance(freshApp(), 'ephemeral')

    expect(() => {
      // The bypass a determined caller would reach for first.
      ;(auth as { setPersistence: unknown }).setPersistence = () =>
        Promise.resolve()
    }).toThrow(TypeError)
    expect(() =>
      Object.defineProperty(auth, 'setPersistence', {
        value: () => Promise.resolve(),
      }),
    ).toThrow(TypeError)
    // Still sealed after both attempts.
    expect(() => setPersistence(auth, browserLocalPersistence)).toThrow(/sealed/i)
  })

  it('is idempotent, so re-entering the factory does not crash', () => {
    const app = freshApp()
    const first = createAuthInstance(app, 'ephemeral')
    // `usePresence` re-enters its effect on every room change; `initializeAuth`
    // returns the existing instance for deep-equal options, and re-defining a
    // non-configurable property is a TypeError.
    const second = createAuthInstance(app, 'ephemeral')

    expect(second).toBe(first)
    expect(isAuthPersistenceSealed(second)).toBe(true)
  })

  it('is still D6: no popupRedirectResolver, so the federated family cannot run', async () => {
    const auth = createAuthInstance(freshApp(), 'ephemeral')

    // Asserted on the instance, not through `signInWithPopup`'s error code.
    // The absent resolver IS the mechanism — `_withDefaultResolver` asserts
    // this exact field and that is where PoC §3's `auth/argument-error` came
    // from — but jsdom short-circuits the popup family one step earlier with
    // `auth/operation-not-supported-in-this-environment`, so pinning the code
    // here would test the test environment rather than the instance.
    expect(
      (auth as unknown as { _popupRedirectResolver?: unknown })
        ._popupRedirectResolver,
    ).toBeFalsy()
    await expect(
      signInWithPopup(auth, new GoogleAuthProvider()),
    ).rejects.toThrow()
  })
})

describe('durable auth — the positive control', () => {
  /**
   * The console persists today, on purpose: it runs on `*.aglyn.com`, where a
   * 14-day session is the product and we own the DNS forever. A guard that
   * also broke this would be a behaviour change, not a guard.
   */
  it('accepts setPersistence on a durable instance', async () => {
    const auth = createAuthInstance(freshApp(), 'durable')

    expect(isAuthPersistenceSealed(auth)).toBe(false)
    await expect(
      setPersistence(auth, browserLocalPersistence),
    ).resolves.toBeUndefined()
  })

  it('is the same instance a bare getAuth(app) returns', async () => {
    const app = freshApp()
    const auth = createAuthInstance(app, 'durable')
    const { getAuth } = await import('firebase/auth')

    expect(getAuth(app)).toBe(auth)
  })
})
