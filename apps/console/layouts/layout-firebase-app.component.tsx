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
import {SecureLoadingOverlayComponent} from '@aglyn/shared-ui-jsx'
import {getDisplayName} from '@aglyn/shared-util-tools'
import {NoSsr} from '@mui/material'
import {getAnalytics} from 'firebase/analytics'
import type {FirebaseApp, FirebaseOptions} from 'firebase/app'
import {initializeAppCheck, ReCaptchaV3Provider} from 'firebase/app-check'
import {connectAuthEmulator, getAuth} from 'firebase/auth'
import {connectDatabaseEmulator, getDatabase} from 'firebase/database'
import {
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  getFirestore,
} from 'firebase/firestore'
import type {ReactNode} from 'react'
import {
  AnalyticsProvider,
  AppCheckProvider,
  AuthProvider,
  DatabaseProvider,
  FirebaseAppProvider,
  FirestoreProvider,
  useFirebaseApp,
} from 'reactfire'
// import {getDatabase, connectDatabaseEmulator} from 'firebase/database'


console.log('displayname FirebaseAppProvider', getDisplayName(FirebaseAppProvider))

export type FirebaseAppProviderOptions = {
  firebaseApp?: FirebaseApp
  firebaseConfig?: FirebaseOptions
  appName?: string
  suspense?: boolean
}

export interface LayoutFirebaseAppComponentProps {
  children?: ReactNode
}

function LayoutFirebaseAppComponent(props: LayoutFirebaseAppComponentProps) {
  const {children} = props

  return (
    <>
      {children}
    </>
  )
}
LayoutFirebaseAppComponent.displayName = 'LayoutFirebaseAppComponent'
LayoutFirebaseAppComponent.getLayout = (children) => {
  return (
    <GetLayout>
      {children}
    </GetLayout>
  )
}
LayoutFirebaseAppComponent.layoutProps = {
  FirebaseAppProvider: {
    firebaseConfig: defaultFirebaseAppOptions,
  },
}

export {LayoutFirebaseAppComponent}
export default LayoutFirebaseAppComponent


function GetLayout({children}) {
  return (
    <FirebaseAppProvider firebaseConfig={defaultFirebaseAppOptions}>
      <NoSsr>
        <GetInnerLayout>
          {children}
        </GetInnerLayout>
      </NoSsr>
    </FirebaseAppProvider>
  )
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
