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
'use client'

import {
  type FirebaseApp,
  type FirebaseOptions,
  getApps,
  initializeApp,
} from 'firebase/app'
import {
  type Analytics,
  getAnalytics as getAnalyticsInstance,
} from 'firebase/analytics'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import {
  type Auth,
  connectAuthEmulator,
  getAuth as getAuthInstance,
  onIdTokenChanged,
  type User,
} from 'firebase/auth'
import {
  type Database,
  connectDatabaseEmulator,
  getDatabase as getDatabaseInstance,
} from 'firebase/database'
import {
  type Firestore,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import {
  type RemoteConfig,
  getRemoteConfig as getRemoteConfigInstance,
} from 'firebase/remote-config'
import { type FirebaseStorage, getStorage as getStorageInstance } from 'firebase/storage'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  FIREBASE_AUTH_EMULATOR_ENABLED,
  FIREBASE_DATABASE_EMULATOR_ENABLED,
  FIREBASE_FIRESTORE_EMULATOR_ENABLED,
} from '@aglyn/shared-data-enums'
import { RECAPTCHA_API_KEY } from '../../constants/firebase-config'

/**
 * Drop-in replacement for reactfire's `ObservableStatus<T>` — reactfire is
 * unmaintained against firebase majors past v9, but its shape is preserved
 * here so `helpers/use-doc.ts`'s already-battle-tested onSnapshot+retry
 * implementation (AGL-216/223) didn't need to change.
 */
export interface ObservableStatus<T> {
  status: 'loading' | 'error' | 'success'
  hasEmitted: boolean
  isComplete: boolean
  data: T
  error: Error | undefined
  firstValuePromise: Promise<void>
  /**
   * The emitted `data` includes local writes the server has NOT
   * acknowledged (`snapshot.metadata.hasPendingWrites`).
   *
   * Carried rather than dropped because a caller cannot otherwise tell "the
   * store holds this" from "my browser holds this". `persistentLocalCache`
   * replays a queued write into the very first snapshot after a reload, so a
   * caller that treats every snapshot as authoritative will adopt its own
   * unacknowledged edit as the saved state — which is how the besigner ended
   * up unable to save real changes (AGL-1262).
   */
  hasPendingWrites: boolean
  /**
   * The emitted `data` came from the local cache and the server has NOT
   * confirmed it (`snapshot.metadata.fromCache`).
   *
   * Carried because it is the only per-listener ground truth about
   * freshness the SDK offers, and the console needs it (AGL-1066). Under
   * `persistentLocalCache` a listener whose server listen is being REFUSED
   * still emits cached snapshots and still reports `status: 'success'` —
   * the retry budget is reset by each cached emission and never spends, so
   * `status` can never reveal the fault (see
   * `use-firestore-collection-cached-retry.spec.ts`).
   *
   * Prefer this over `session-health`'s `staleSession` for anything that
   * asks "is what I am looking at live?". `staleSession` is a heuristic
   * needing two denied collections inside a window, and it is unreachable
   * on listener-only pages; this is a fact about THIS listener, costs
   * nothing, and clears itself the instant a server snapshot lands.
   */
  fromCache: boolean
  /**
   * The server has REFUSED this listen for longer than the retry budget, and
   * no server snapshot has arrived since (AGL-1066).
   *
   * `fromCache` says "unconfirmed", which is also true offline and true for
   * the first snapshot of a perfectly healthy load. This says "refused" —
   * only `permission-denied` counts it, and it takes a whole budget's worth
   * in a row, so it cannot fire offline and cannot fire on the AGL-216/217
   * post-sign-in token race.
   *
   * It is what `status` would say if the retry budget were spendable. It is
   * carried separately because correcting `status` in place would blank
   * every surface that renders cached data through an `error` branch — see
   * the note on `attempt = 0` in `use-firestore-collection`.
   */
  serverDenied: boolean
}

/** Replaces reactfire's `ReactFireOptions<T>` — drops the `suspense` field, which was never read. */
export interface FirestoreDocOptions<T> {
  idField?: string
  initialData?: T
}

interface FirebaseServices {
  app: FirebaseApp
  firestore: Firestore
  auth: Auth
  database: Database
  storage: FirebaseStorage
  analytics: Analytics
  remoteConfig: RemoteConfig
}

const FirebaseServicesContext = createContext<FirebaseServices | undefined>(undefined)

// Module-scope guards so HMR / remounts don't re-run emulator connection
// (which throws if called twice) or double-initialize Firestore's
// persistent cache.
let connectedFirestore = false
let connectedDatabase = false
let connectedAuth = false

export interface FirebaseServicesProviderProps {
  firebaseConfig: FirebaseOptions
  appName: string
  children?: ReactNode
}

export function FirebaseServicesProvider(props: FirebaseServicesProviderProps) {
  const { firebaseConfig, appName, children } = props
  const servicesRef = useRef<FirebaseServices | undefined>(undefined)

  if (!servicesRef.current) {
    const app =
      getApps().find((existing) => existing.name === appName) ??
      initializeApp(firebaseConfig, appName)
    const auth = getAuthInstance(app)
    const database = getDatabaseInstance(app)

    if (!connectedFirestore) {
      try {
        // Under the emulator (dev/e2e only): force long-polling and skip
        // the persistent multi-tab cache. The emulator's WebChannel
        // streaming misbehaves in automated Chrome — listeners serve the
        // initial empty from-cache snapshot and the server sync never
        // arrives, which looks like "empty pages with zero errors"
        // (the AGL-217 mystery). Production keeps the default transport
        // and persistent cache.
        //
        // ⚠️ CONSEQUENCE, and it will cost you hours if you do not know it
        // (AGL-1066): every stale-session/stale-cache fault is UNREPRODUCIBLE
        // locally through the app, because the cache that causes them is off
        // in exactly the configuration you would reach for to reproduce one.
        // A listener that keeps serving arbitrarily-old data while the server
        // refuses it, a `noDocument` tombstone that 404s a live host, the
        // retry budget that never spends because a cached emission resets it
        // — none of them can happen here. Test that behaviour with the unit
        // seams instead (`use-firestore-collection-cached-retry.spec.ts`
        // drives cached emissions and denials directly), or against a
        // deployed environment. Do NOT "fix" it by turning the cache on for
        // the emulator: the AGL-217 empty-pages-with-zero-errors mystery is
        // what that produces.
        initializeFirestore(
          app,
          FIREBASE_FIRESTORE_EMULATOR_ENABLED
            ? { experimentalForceLongPolling: true }
            : {
                localCache: persistentLocalCache({
                  tabManager: persistentMultipleTabManager(),
                }),
              },
        )
        if (FIREBASE_FIRESTORE_EMULATOR_ENABLED) {
          connectFirestoreEmulator(getFirestore(app), 'localhost', 8082)
        }
      } catch {
        // already initialized (e.g. HMR reset the module flag) — getFirestore() returns the existing instance
      } finally {
        connectedFirestore = true
      }
    }
    const firestore = getFirestore(app)

    if (!connectedDatabase) {
      try {
        if (FIREBASE_DATABASE_EMULATOR_ENABLED) {
          connectDatabaseEmulator(database, 'localhost', 9000)
        }
        connectedDatabase = true
      } catch (error) {
        console.error(error)
      }
    }
    if (!connectedAuth) {
      try {
        if (FIREBASE_AUTH_EMULATOR_ENABLED) {
          connectAuthEmulator(auth, 'http://localhost:9099')
        }
        connectedAuth = true
      } catch (error) {
        console.error(error)
      }
    }
    // App Check must be skipped under the emulators: there is no App
    // Check emulator, so ReCaptcha would hit the real backend and its
    // 403s break emulator auth (the AGL-216 emulator sessions hit this).
    if (
      !FIREBASE_AUTH_EMULATOR_ENABLED &&
      !FIREBASE_FIRESTORE_EMULATOR_ENABLED
    ) {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(RECAPTCHA_API_KEY),
          isTokenAutoRefreshEnabled: true,
        })
      } catch (error) {
        console.error(error)
      }
    }
    let analytics: Analytics
    try {
      analytics = getAnalyticsInstance(app)
    } catch (error) {
      console.error(error)
    }
    // Remote Config (AGL-228): release-flag delivery. Browser-only like
    // analytics; consumers set defaultConfig before their first getValue so
    // gating never blocks on the network.
    let remoteConfig: RemoteConfig
    try {
      remoteConfig = getRemoteConfigInstance(app)
      remoteConfig.settings.minimumFetchIntervalMillis =
        process.env.NODE_ENV === 'production' ? 3_600_000 : 60_000
    } catch (error) {
      console.error(error)
    }

    servicesRef.current = {
      app,
      firestore,
      auth,
      database,
      storage: getStorageInstance(app),
      analytics,
      remoteConfig,
    }
  }

  return (
    <FirebaseServicesContext.Provider value={servicesRef.current}>
      {children}
    </FirebaseServicesContext.Provider>
  )
}
FirebaseServicesProvider.displayName = 'FirebaseServicesProvider'

function useFirebaseServices(): FirebaseServices {
  const services = useContext(FirebaseServicesContext)
  if (!services) {
    throw new Error(
      'Firebase hooks must be used within a <FirebaseServicesProvider>',
    )
  }
  return services
}

export function useFirebaseApp(): FirebaseApp {
  return useFirebaseServices().app
}
export function useFirestore(): Firestore {
  return useFirebaseServices().firestore
}
export function useAuth(): Auth {
  return useFirebaseServices().auth
}
export function useDatabase(): Database {
  return useFirebaseServices().database
}
export function useStorage(): FirebaseStorage {
  return useFirebaseServices().storage
}
export function useAnalytics(): Analytics {
  return useFirebaseServices().analytics
}
export function useRemoteConfig(): RemoteConfig {
  return useFirebaseServices().remoteConfig
}

/**
 * Replaces reactfire's `useUser()`. Reactfire subscribes via
 * `onIdTokenChanged` rather than `onAuthStateChanged` so fields like
 * `emailVerified` stay live across token refresh (e.g. after
 * `user.reload()` post-email-verification), not just sign-in/out — matched
 * here for behavioral parity.
 *
 * THREE states, not two (AGL-1261): `undefined` = auth has not resolved yet,
 * `null` = resolved, signed OUT, a `User` = resolved, signed in. This used to
 * collapse the emitted `null` into `undefined`, which made "signed out" and
 * "still loading" the same value — a state that, for a signed-out visitor,
 * never left "loading". `useSessionCookie` gates its whole body on
 * `user === undefined`, so its silent restore from the shared `__session`
 * cookie could never run: the cookie exchange returned a valid custom token
 * and nothing ever asked for it.
 */
export function useUser(): { data: User | null | undefined } {
  const auth = useAuth()
  const [user, setUser] = useState<User | null | undefined>(
    auth.currentUser ?? undefined,
  )

  useEffect(() => {
    return onIdTokenChanged(auth, (nextUser) => {
      // `?? null`, never `?? undefined` — see the note above.
      setUser(nextUser ?? null)
    })
  }, [auth])

  return { data: user }
}

export interface SigninCheckResult {
  signedIn: boolean
  user: User | null
}

/** Replaces reactfire's `useSigninCheck()` — same `onIdTokenChanged` basis as `useUser()`. */
export function useSigninCheck(): {
  status: 'loading' | 'success' | 'error'
  data: SigninCheckResult | undefined
  error: Error | undefined
} {
  const auth = useAuth()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [data, setData] = useState<SigninCheckResult | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)

  useEffect(() => {
    return onIdTokenChanged(
      auth,
      (user) => {
        setStatus('success')
        setError(undefined)
        setData({ signedIn: !!user, user: user ?? null })
      },
      (err) => {
        setStatus('error')
        setError(err)
      },
    )
  }, [auth])

  return { status, data, error }
}
