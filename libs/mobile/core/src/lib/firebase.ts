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

/*==========================================
 * FIREBASE ON A PHONE (AGL-3620, AGL-3618).
 *
 * The same Firebase project and the same accounts as the console: the JS
 * SDK, with the session persisted in AsyncStorage so the app stays signed in
 * across launches. Firestore reads go through the client SDK under the same
 * security rules the console reads under; there is no admin path here.
 * Firestore auto-detects long polling, which React Native's networking
 * needs. Both talk to the local emulators when the app was configured with
 * them, the only way a development build ever sees data.
 *
 * The app is one process with one signed-in user, so this keeps one app and
 * one Auth instance per process.
 *=========================================*/

import AsyncStorage from '@react-native-async-storage/async-storage'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  // `@firebase/auth`, not `firebase/auth`: only the scoped package has a
  // `react-native` export condition, and with it the AsyncStorage
  // persistence. Every mobile file imports auth from here for the same
  // reason: the two specifiers are two different builds, and two builds are
  // two auth registries.
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from '@firebase/auth'
import { connectFirestoreEmulator, getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore'
import { getMobileConfig, type MobileConfig } from './config'

export interface MobileFirebase {
  app: FirebaseApp
  auth: Auth
  firestore: Firestore
}

let instance: MobileFirebase | null = null

export function getMobileFirebase(config: MobileConfig = getMobileConfig()): MobileFirebase {
  if (instance) return instance
  const app = getApps().length ? getApp() : initializeApp(config.firebase)
  let auth: Auth
  let firestore: Firestore
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  } catch {
    // Fast Refresh re-runs this module against an app that already has Auth.
    auth = getAuth(app)
  }
  try {
    firestore = initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
  } catch {
    firestore = getFirestore(app)
  }
  if (config.authEmulatorHost) {
    connectAuthEmulator(auth, `http://${config.authEmulatorHost}`, { disableWarnings: true })
  }
  if (config.firestoreEmulatorHost) {
    const [host, port] = config.firestoreEmulatorHost.split(':')
    connectFirestoreEmulator(firestore, host, Number(port))
  }
  instance = { app, auth, firestore }
  return instance
}
