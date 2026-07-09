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
        initializeFirestore(app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        })
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
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(RECAPTCHA_API_KEY),
        isTokenAutoRefreshEnabled: true,
      })
    } catch (error) {
      console.error(error)
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
 */
export function useUser(): { data: User | undefined } {
  const auth = useAuth()
  const [user, setUser] = useState<User | undefined>(auth.currentUser ?? undefined)

  useEffect(() => {
    return onIdTokenChanged(auth, (nextUser) => {
      setUser(nextUser ?? undefined)
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
