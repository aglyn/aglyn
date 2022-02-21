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
import {type FirebaseApp, initializeApp} from 'firebase/app'
import {type AppCheck, initializeAppCheck, ReCaptchaV3Provider} from 'firebase/app-check'
import {
  type Auth,
  type AuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
} from 'firebase/auth'


export let firebaseApp: FirebaseApp
export let firebaseAuth: Auth
export let appCheck: AppCheck
export const googleOAuthProvider: AuthProvider = new GoogleAuthProvider()

export const getFirebaseAuth = (app?: FirebaseApp) => {
  // if (firebaseAuth) return firebaseAuth
  // firebaseAuth = getAuth(firebaseApp)
  // connectAuthEmulator(firebaseAuth, 'http://localhost:9099')
  return firebaseAuth


  if (typeof window !== 'undefined') {
    if (firebaseAuth && !app) return firebaseAuth
    const auth = getAuth(app || firebaseApp)
    connectAuthEmulator(auth, 'http://localhost:9099')
    if (!firebaseAuth && !app) {
      firebaseAuth = auth
    }
    return auth
  }
}

export const initializeFirebaseAuth = (app?: FirebaseApp) => {
  // if (typeof window !== 'undefined' && (app || firebaseApp)) {
  const auth = initializeAuth(app || firebaseApp, {
    persistence: browserLocalPersistence,
  })
  connectAuthEmulator(auth, 'http://localhost:9099')
  if (!firebaseAuth && !app) {
    firebaseAuth = auth
  }
  return auth
  // }
  return null
}

export const initializeFirebaseAppCheck = (app?: FirebaseApp) => {
  // if (typeof window !== 'undefined' && (app || firebaseApp)) {
  if (IS_DEVELOPMENT && typeof self !== 'undefined') {
    self['FIREBASE_APPCHECK_DEBUG_TOKEN'] = true
  }
  const check = initializeAppCheck(app || firebaseApp, {
    // Pass your reCAPTCHA v3 site key (public key) to activate(). Make sure this
    // key is the counterpart to the secret key you set in the Firebase console.
    provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECPATCHA_PUBLIC_KEY),
    // Optional argument. If true, the SDK automatically refreshes App Check
    // tokens as needed.
    isTokenAutoRefreshEnabled: true,
  })
  if (!appCheck && !app) {
    appCheck = check
  }
  return check
  // }
  return null
}


// export const initializeFirebaseApp = () => {
//   if (typeof window !== 'undefined') {
//     firebaseApp = initializeApp({
//       apiKey: process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY,
//       authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
//       databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
//       projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
//       storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
//       messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
//       appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
//       measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
//     })
//     initializeFirebaseAppCheck(firebaseApp)
//
//     firebaseAuth = initializeAuth(firebaseApp, {
//       persistence: browserLocalPersistence,
//     })
//     connectAuthEmulator(firebaseAuth, 'http://localhost:9099')
//     // initializeFirebaseAuth(firebaseApp)
//     return firebaseApp
//   }
//   return null
// }
(function main(): void {
  if (typeof window !== undefined && !firebaseApp) {
    firebaseApp = initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    })

    firebaseAuth = initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
    })
    connectAuthEmulator(firebaseAuth, 'http://localhost:9099')

    if (IS_DEVELOPMENT) {
      if (self) {
        self['FIREBASE_APPCHECK_DEBUG_TOKEN'] = true
      }
    }
    appCheck = initializeAppCheck(firebaseApp, {
      // Pass your reCAPTCHA v3 site key (public key) to activate(). Make sure this
      // key is the counterpart to the secret key you set in the Firebase console.
      provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECPATCHA_PUBLIC_KEY),
      // Optional argument. If true, the SDK automatically refreshes App Check
      // tokens as needed.
      isTokenAutoRefreshEnabled: true,
    })
  }
})()


export default firebaseApp
