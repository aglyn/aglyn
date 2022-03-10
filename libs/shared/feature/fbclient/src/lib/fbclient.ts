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


import {type FirebaseApp, type FirebaseOptions} from 'firebase/app'
import {type AppCheck} from 'firebase/app-check'
import {type Auth, type AuthProvider} from 'firebase/auth'
import {type Firestore} from 'firebase/firestore'


export let firebaseApp: FirebaseApp
export let firebaseAuth: Auth
export let appCheck: AppCheck
export let googleOAuthProvider: AuthProvider
export let firestoreDb: Firestore

export const DEFAULT_RECAPTCHA_API_KEY = process.env.NEXT_PUBLIC_RECPATCHA_PUBLIC_KEY
export const DEFAULT_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY
export const DEFAULT_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
export const DEFAULT_FIREBASE_DATABASE_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
export const DEFAULT_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
export const DEFAULT_FIREBASE_STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
export const DEFAULT_FIREBASE_MESSAGING_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
export const DEFAULT_FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID
export const DEFAULT_FIREBASE_MEASUREMENT_ID = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID

export const defaultFirebaseAppOptions: FirebaseOptions = {
  apiKey: DEFAULT_FIREBASE_API_KEY,
  authDomain: DEFAULT_FIREBASE_AUTH_DOMAIN,
  databaseURL: DEFAULT_FIREBASE_DATABASE_URL,
  projectId: DEFAULT_FIREBASE_PROJECT_ID,
  storageBucket: DEFAULT_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: DEFAULT_FIREBASE_MESSAGING_SENDER_ID,
  appId: DEFAULT_FIREBASE_APP_ID,
  measurementId: DEFAULT_FIREBASE_MEASUREMENT_ID,
}

export const getFirebaseAuth = (app?: FirebaseApp) => {
  // if (app) return getAuth(app)
  // return firebaseAuth
}

(function main(): void {
  // if (!firebaseApp) {
  //   firebaseApp = initializeApp(defaultFirebaseAppOptions)
  // }
  //
  // if (!googleOAuthProvider) {
  //   googleOAuthProvider = new GoogleAuthProvider()
  // }
  //
  // if (!firebaseAuth) {
  //   firebaseAuth = getAuth(firebaseApp)
  //   setPersistence(firebaseAuth, browserLocalPersistence)
  //     .catch((error) => {
  //       console.error(error)
  //       // return setPersistence(firebaseAuth, browserLocalPersistence)
  //     })
  //     .catch((error) => {
  //       console.error(error)
  //     })
  //
  //   if (IS_DEVELOPMENT) {
  //     connectAuthEmulator(firebaseAuth, 'http://localhost:9099')
  //   }
  // }
  //
  // if (!firestoreDb) {
  //   firestoreDb = initializeFirestore(firebaseApp, {})
  //   if (HAS_WINDOW()) {
  //
  //     if (IS_DEVELOPMENT) {
  //       connectFirestoreEmulator(firestoreDb, 'localhost', 8080)
  //     }
  //     enableMultiTabIndexedDbPersistence(firestoreDb)
  //       .catch((error) => {
  //         console.error(error)
  //       })
  //   }
  // }
  //
  // if (!appCheck) {
  //   // appCheck = initializeAppCheck(firebaseApp, {
  //   //   // Pass your reCAPTCHA v3 site key (public key) to activate(). Make sure this
  //   //   // key is the counterpart to the secret key you set in the Firebase console.
  //   //   provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECPATCHA_PUBLIC_KEY),
  //   //   // Optional argument. If true, the SDK automatically refreshes App Check
  //   //   // tokens as needed.
  //   //   // isTokenAutoRefreshEnabled: true,
  //   // })
  // }
})()


export default firebaseApp
