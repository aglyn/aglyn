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
 * AGL-3803: another tab signing in to a DIFFERENT pool threw
 * `auth/tenant-id-mismatch` out of this tab's cross-tab sync listener.
 *
 * The durable instance keeps one user record per browser profile, under a key
 * that does not name the pool (`firebase:authUser:<apiKey>:<appName>`). When a
 * peer tab writes a user from another pool, the SDK's `_onStorageEvent` hands
 * it to `_updateCurrentUser(user, true)`, whose pool assertion
 * (`auth.tenantId === user.tenantId`) throws, and the tab silently keeps its
 * old user.
 *
 * These run against the **real** `firebase/auth`, and against its BROWSER
 * build — the `jest.mock` below. The Nx preset's export conditions resolve the
 * Node build, where `browserLocalPersistence` is an alias of memory and
 * `getAuth` syncs nothing across tabs, so the bug cannot exist there. In the
 * browser build,
 * `createAuthInstance(app, 'durable')` is the exact `getAuth(app)` the console
 * calls; jsdom has no IndexedDB, so it lands on the hierarchy's localStorage
 * tier, whose cross-tab channel is the window `storage` event. "Another tab"
 * is a direct write to the shared record followed by the `StorageEvent` a
 * browser would deliver.
 */

import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  onAuthStateChanged,
  updateCurrentUser,
  type Auth,
  type User,
} from 'firebase/auth'

import { createAuthInstance } from './auth-persistence'

// The build app.aglyn.com ships, for every importer in this file's graph.
// `package.json` is the one subpath the package exports that locates it.
jest.mock('firebase/auth', () => {
  const { dirname, join } = require('node:path') as typeof import('node:path')
  return jest.requireActual(
    join(dirname(require.resolve('@firebase/auth/package.json')), 'dist/browser-cjs/index.js'),
  )
})

const API_KEY = 'test-api-key'
const CONFIG = {
  apiKey: API_KEY,
  authDomain: 'aglyn-main.firebaseapp.com',
  projectId: 'aglyn-main',
  appId: '1:0:web:0',
}
const TENANT = 'aglyn-org-y5v14'

let appCounter = 0
const apps: FirebaseApp[] = []

function freshApp(): FirebaseApp {
  const app = initializeApp(CONFIG, `agl3803-${appCounter++}`)
  apps.push(app)
  return app
}

// A restore reloads the persisted user over the network, and clears it on any
// answer but a network failure. Offline keeps every restored user signed in
// without reaching Identity Toolkit with a fake key.
const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = jest.fn(() => Promise.reject(new TypeError('offline'))) as typeof fetch
})

afterEach(() => {
  window.localStorage.clear()
})

afterAll(() => {
  globalThis.fetch = realFetch
})

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => undefined)))
})

/** The profile-wide record every tab of this app reads and writes. */
function recordKey(appName: string): string {
  return `firebase:authUser:${API_KEY}:${appName}`
}

/** A persisted user, in the shape `UserImpl.toJSON()` writes. */
function persistedUser(appName: string, uid: string, tenantId: string | null) {
  return JSON.stringify({
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    isAnonymous: false,
    providerData: [],
    stsTokenManager: {
      refreshToken: `refresh-${uid}`,
      accessToken: `access-${uid}`,
      expirationTime: Date.now() + 60 * 60 * 1000,
    },
    createdAt: '0',
    lastLoginAt: '0',
    apiKey: API_KEY,
    appName,
    ...(tenantId ? { tenantId } : {}),
  })
}

/** What a peer tab's sign-in (or sign-out) looks like from this tab. */
function peerTabWrites(appName: string, value: string | null): void {
  const key = recordKey(appName)
  const oldValue = window.localStorage.getItem(key)
  if (value === null) window.localStorage.removeItem(key)
  else window.localStorage.setItem(key, value)
  window.dispatchEvent(
    new StorageEvent('storage', {
      key,
      oldValue,
      newValue: value,
      storageArea: window.localStorage,
    }),
  )
}

/** A durable instance restored as `uid` in `tenantId`, the console's steady state. */
async function signedInTab(uid: string, tenantId: string | null): Promise<Auth> {
  const app = freshApp()
  window.localStorage.setItem(recordKey(app.name), persistedUser(app.name, uid, tenantId))
  const auth = createAuthInstance(app, 'durable')
  await auth.authStateReady()
  // What `useSessionCookie` does on a restore (AGL-2486).
  auth.tenantId = auth.currentUser?.tenantId ?? null
  return auth
}

/** Resolve with the next auth state matching `uid`, or `'timeout'`. */
function nextState(auth: Auth, uid: string | null, ms = 1000): Promise<User | null | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe()
      resolve('timeout')
    }, ms)
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if ((user?.uid ?? null) !== uid) return
      clearTimeout(timer)
      unsubscribe()
      resolve(user)
    })
  })
}

type StorageSync = { _onStorageEvent(): Promise<void> }

describe('cross-tab sync across pools (AGL-3803)', () => {
  it('follows a peer tab that signs in to the project pool while this tab is in a tenant', async () => {
    const auth = await signedInTab('sso-user', TENANT)
    expect(auth.tenantId).toBe(TENANT)

    const followed = nextState(auth, 'pool-user')
    peerTabWrites(auth.name, persistedUser(auth.name, 'pool-user', null))

    expect(await followed).not.toBe('timeout')
    expect(auth.currentUser?.uid).toBe('pool-user')
    expect(auth.currentUser?.tenantId).toBeNull()
    expect(auth.tenantId).toBeNull()
  })

  it('follows a peer tab that signs in to a tenant while this tab is in the project pool', async () => {
    const auth = await signedInTab('pool-user', null)
    window.localStorage.setItem(
      recordKey(auth.name),
      persistedUser(auth.name, 'sso-user', TENANT),
    )

    // The SDK's own handler, awaited: before the fix this REJECTED with
    // `auth/tenant-id-mismatch`, which in a browser is the unhandled
    // rejection the client-errors log recorded.
    await expect((auth as unknown as StorageSync)._onStorageEvent()).resolves.toBeUndefined()
    expect(auth.currentUser?.uid).toBe('sso-user')
    expect(auth.tenantId).toBe(TENANT)
  })

  it('still follows a same-pool sign-out and leaves the pool alone', async () => {
    const auth = await signedInTab('sso-user', TENANT)

    const signedOut = nextState(auth, null)
    peerTabWrites(auth.name, null)

    expect(await signedOut).toBeNull()
    expect(auth.currentUser).toBeNull()
    expect(auth.tenantId).toBe(TENANT)
  })

  it('still follows a same-pool user switch', async () => {
    const auth = await signedInTab('sso-user', TENANT)

    const followed = nextState(auth, 'sso-colleague')
    peerTabWrites(auth.name, persistedUser(auth.name, 'sso-colleague', TENANT))

    expect(await followed).not.toBe('timeout')
    expect(auth.tenantId).toBe(TENANT)
  })

  it('keeps the SDK assertion for every in-tab sign-in', async () => {
    const tenantTab = await signedInTab('sso-user', TENANT)
    const tenantUser = tenantTab.currentUser as User
    const poolTab = await signedInTab('pool-user', null)

    await expect(updateCurrentUser(poolTab, tenantUser)).rejects.toMatchObject({
      code: 'auth/tenant-id-mismatch',
    })
    expect(poolTab.currentUser?.uid).toBe('pool-user')
    expect(poolTab.tenantId).toBeNull()
  })

  it('is installed by createAuthInstance, once per instance however often it is adopted', () => {
    const own = (auth: Auth) =>
      Object.getOwnPropertyDescriptor(auth, '_updateCurrentUser')?.value as unknown
    const app = freshApp()
    const first = createAuthInstance(app, 'durable')
    const installed = own(first)
    expect(installed).toBeInstanceOf(Function)
    const second = createAuthInstance(app, 'durable')
    expect(second).toBe(first)
    expect(own(second)).toBe(installed)
    expect(own(createAuthInstance(freshApp(), 'ephemeral'))).toBeInstanceOf(Function)
  })
})
