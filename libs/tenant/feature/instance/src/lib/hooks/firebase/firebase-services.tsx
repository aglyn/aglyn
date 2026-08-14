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
  initializeAnalytics as initializeAnalyticsInstance,
} from 'firebase/analytics'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import {
  type Auth,
  connectAuthEmulator,
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
import {
  type AuthPersistenceClass,
  createAuthInstance,
} from './auth-persistence'
import { localCacheFor } from './firestore-cache'

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
  /**
   * The persistence class `auth` was actually created with (AGL-1379).
   *
   * Published so a **second** auth instance derives its class from the
   * primary rather than re-deciding it. `apps/console/hooks/use-presence.ts`
   * builds its own Firebase app and its own `Auth`; before this it took the
   * SDK default unconditionally, so configuring only the provider would have
   * left presence persisting a refresh token on an origin the provider had
   * just been careful not to persist one on.
   */
  authPersistence: AuthPersistenceClass
}

const FirebaseServicesContext = createContext<FirebaseServices | undefined>(undefined)

// Module-scope guards so HMR / remounts don't re-run emulator connection
// (which throws if called twice) or double-initialize Firestore's
// persistent cache.
//
// Firestore's is keyed by app NAME, not a bare boolean (AGL-1456): Firestore
// initialization is once-per-app, so a module-global flag made the FIRST app
// to mount decide for every later one — a second app would silently skip
// `initializeFirestore` and take SDK defaults. That mattered the moment the
// cache stopped being the same on every host.
const firestoreInitialized = new Set<string>()
let connectedDatabase = false
let connectedAuth = false

export interface FirebaseServicesProviderProps {
  firebaseConfig: FirebaseOptions
  appName: string
  /**
   * How much of *anything* this origin may keep on disk. Defaults to
   * `durable`, which is what every host serving this provider today is:
   * `*.aglyn.com` and `*.aglyn.app`, whose DNS we own and whose 14-day
   * session is the product.
   *
   * A **custom console domain** (AGL-1099c) must pass `ephemeral`. That is
   * the whole reason this is a prop rather than a constant: the class differs
   * per origin, not per build, and the decision belongs to whoever knows
   * which origin is being served.
   *
   * **It governs two things, and the name only names one.** It selects the
   * `Auth` persistence class (AGL-1379) *and* the Firestore `localCache`
   * (AGL-1456) — because both answer the same question about the same origin,
   * and splitting them into two props is precisely how the cache came to be
   * unconditional while the credential was hardened. See `firestore-cache.ts`.
   */
  authPersistence?: AuthPersistenceClass
  children?: ReactNode
}

export function FirebaseServicesProvider(props: FirebaseServicesProviderProps) {
  const { firebaseConfig, appName, authPersistence = 'durable', children } = props
  const servicesRef = useRef<FirebaseServices | undefined>(undefined)

  if (!servicesRef.current) {
    const app =
      getApps().find((existing) => existing.name === appName) ??
      initializeApp(firebaseConfig, appName)
    // `durable` resolves to the same `getAuth(app)` this always called.
    const auth = createAuthInstance(app, authPersistence)
    const database = getDatabaseInstance(app)

    if (!firestoreInitialized.has(appName)) {
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
            : // NOT unconditional (AGL-1456). `persistentLocalCache` writes
              // document bodies to this origin's IndexedDB, so on a custom
              // console domain it is the same exposure D6 removed from the
              // refresh token — see `firestore-cache.ts` for why one
              // declaration governs both.
              { localCache: localCacheFor(authPersistence) },
        )
        if (FIREBASE_FIRESTORE_EMULATOR_ENABLED) {
          connectFirestoreEmulator(getFirestore(app), 'localhost', 8082)
        }
      } catch {
        // already initialized (e.g. HMR reset the module flag) — getFirestore() returns the existing instance
      } finally {
        firestoreInitialized.add(appName)
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
    // `initializeAnalytics`, not `getAnalytics`, for exactly one reason: it is
    // the only form that can pass `config`, and `send_page_view: false` is the
    // only way to stop the SDK's own startup `page_view` (AGL-1643).
    //
    // Booting Analytics issues `gtag('config', <id>, configProperties)`, and
    // the vendored SDK's own comment on that line reads "This will trigger a
    // page_view event unless 'send_page_view' is set to false in
    // configProperties". `getAnalytics(app)` passes no config at all, so the
    // key was never there and the hit always fired — on top of the manual
    // `page_view` the console's layout sends on mount. Two hits, one page.
    //
    // The SDK's is the one suppressed rather than the layout's, and the
    // direction is the whole decision: the SDK fires ONCE per document load,
    // while the layout fires on mount AND on every `usePathname` change. In a
    // client-routed app the layout's is a superset — killing it instead would
    // have left every in-app navigation unreported, halving console pageviews
    // rather than correcting them, and the reports would have looked fine.
    //
    // Nothing else about attribution moves: the surviving hit is sent from the
    // same document at mount, so `document.referrer` — which gtag resolves for
    // `page_referrer` itself, and which is what carries marketing traffic
    // source into the session — is still the external referrer at that moment.
    //
    // Safe to re-enter: `initializeAnalytics` returns the existing instance
    // when the options deep-equal the first call's, and throws only on a
    // CONFLICTING re-init. This is the sole call site, so the options are
    // always these.
    let analytics: Analytics
    try {
      analytics = initializeAnalyticsInstance(app, {
        config: { send_page_view: false },
      })
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
      authPersistence,
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
/**
 * The persistence class the provider's `Auth` was created with (AGL-1379).
 *
 * Read it — never re-derive it — when building a **second** Firebase app on
 * the same origin, so the second instance cannot end up more persistent than
 * the first. `apps/console/hooks/use-presence.ts` is the existing case.
 */
export function useAuthPersistence(): AuthPersistenceClass {
  return useFirebaseServices().authPersistence
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
