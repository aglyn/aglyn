/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {IS_DEVELOPMENT} from '@aglyn/shared-data-enums'
import {DEFAULT_RECAPTCHA_API_KEY, defaultFirebaseAppOptions} from '@aglyn/shared-feature-fbclient'
import {NextRouterEvent, SecureLoadingOverlayComponent} from '@aglyn/shared-ui-jsx'
import {NoSsr} from '@mui/material'
import {getAnalytics, logEvent, setUserId, setUserProperties} from 'firebase/analytics'
import type {FirebaseApp, FirebaseOptions} from 'firebase/app'
import {initializeAppCheck, ReCaptchaV3Provider} from 'firebase/app-check'
import {connectAuthEmulator, getAuth} from 'firebase/auth'
import {connectDatabaseEmulator, getDatabase} from 'firebase/database'
import {
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  getFirestore,
} from 'firebase/firestore'
import {useRouter} from 'next/router'
import type {ReactNode} from 'react'
import {useEffect} from 'react'
import {
  AnalyticsProvider,
  AppCheckProvider,
  AuthProvider,
  DatabaseProvider,
  FirebaseAppProvider,
  FirestoreProvider,
  useAnalytics,
  useFirebaseApp,
  useUser,
} from 'reactfire'
// import {getDatabase, connectDatabaseEmulator} from 'firebase/database'


function AnalyticsGlobalEvents({children}) {
  const analytics = useAnalytics()
  const router = useRouter()
  const user = useUser()

  useEffect(() => {
    const logPageView = (asPath) => {
      logEvent(analytics, 'page_view', {
        page_location: asPath,
      })
    }
    const logRouteError = (error, asPath) => {
      logEvent(analytics, 'exception', {
        page_location: asPath,
        description: `code(${error.code || 'none'}): ${error.message || 'none'}`,
        fatal: !error.cancelled,
      })
    }
    router.events.on(NextRouterEvent.ROUTE_CHANGE_COMPLETE, logPageView)
    router.events.on(NextRouterEvent.ROUTE_CHANGE_ERROR, logRouteError)
    return () => {
      router.events.off(NextRouterEvent.ROUTE_CHANGE_COMPLETE, logPageView)
      router.events.off(NextRouterEvent.ROUTE_CHANGE_ERROR, logRouteError)
    }
  }, [router, analytics])

  useEffect(() => {
    const {uid, emailVerified, providerId, tenantId} = user?.data || {}
    const setAnalyticsUserId = () => {
      setUserId(analytics, uid)
    }
    const setAnalyticsUserProperties = () => {
      setUserProperties(analytics, {
        emailVerified, providerId, tenantId,
      })
    }
    if (uid) {
      setAnalyticsUserId()
      setAnalyticsUserProperties()
    }
  }, [analytics, user])


  return children
}

let connectedFirestore = null
let connectedDatabase = null
let connectedAuth = null

function GetInnerLayout({children}) {
  const app = useFirebaseApp()
  const auth = getAuth(app)
  const database = getDatabase(app)
  const store = getFirestore(app)
  let status


  // Set up development emulators
  if (!connectedFirestore) {
    try {
      if (IS_DEVELOPMENT) {
        connectFirestoreEmulator(store, 'localhost', 8080)
      }
      void enableIndexedDbPersistence(store)
      connectedFirestore = true
    }
    catch (error) {
      console.error(error)
    }
  }
  if (!connectedDatabase) {
    try {
      if (IS_DEVELOPMENT) {
        connectDatabaseEmulator(database, 'localhost', 9000)
      }
      connectedDatabase = true
    }
    catch (error) {
      console.error(error)
    }
  }
  if (!connectedAuth) {
    try {
      if (IS_DEVELOPMENT) {
        connectAuthEmulator(auth, 'http://localhost:9099')
      }
      connectedAuth = true
    }
    catch (error) {
      console.error(error)
    }
  }
  let appCheck
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(DEFAULT_RECAPTCHA_API_KEY),
      isTokenAutoRefreshEnabled: true,
    })
  }
  catch (error) {
    console.error(error)
  }
  let analytics
  try {
    analytics = getAnalytics(app)
  }
  catch (error) {
    console.error(error)
  }

  if (status === 'loading') {
    return (<SecureLoadingOverlayComponent />)
  }

  return (
    <AnalyticsProvider sdk={analytics}>
      <AuthProvider sdk={auth}>
        <AppCheckProvider sdk={appCheck}>
          <DatabaseProvider sdk={database}>
            <FirestoreProvider sdk={store}>
              {children}
            </FirestoreProvider>
          </DatabaseProvider>
        </AppCheckProvider>
      </AuthProvider>
    </AnalyticsProvider>
  )
}


export type FirebaseAppProviderOptions = {
  firebaseApp?: FirebaseApp
  firebaseConfig?: FirebaseOptions
  appName?: string
  suspense?: boolean
}

export interface FirebaseAppLayoutProps {
  children?: ReactNode
}

function FirebaseAppLayout(props: FirebaseAppLayoutProps) {
  const {children} = props

  return (
    <FirebaseAppProvider firebaseConfig={defaultFirebaseAppOptions}>
      <NoSsr>
        <GetInnerLayout>
          <AnalyticsGlobalEvents>
            {children}
          </AnalyticsGlobalEvents>
        </GetInnerLayout>
      </NoSsr>
    </FirebaseAppProvider>
  )
}
FirebaseAppLayout.displayName = 'FirebaseAppLayout'
FirebaseAppLayout.aglyn = true

export {FirebaseAppLayout}
export default FirebaseAppLayout
