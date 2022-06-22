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

import { type FirebaseOptions } from 'firebase/app'

export const RECAPTCHA_API_KEY = process.env.NEXT_PUBLIC_RECPATCHA_PUBLIC_KEY
export const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY
export const FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
export const FIREBASE_DATABASE_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
export const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
export const FIREBASE_STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
export const FIREBASE_MESSAGING_SENDER_ID =
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
export const FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID
export const FIREBASE_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
export const FIREBASE_CLIENT_APP_NAME = 'DEFAULT_AGLYN'

export const fbClientAppOptions: FirebaseOptions = {
  apiKey: FIREBASE_API_KEY,
  authDomain: FIREBASE_AUTH_DOMAIN,
  databaseURL: FIREBASE_DATABASE_URL,
  projectId: FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_STORAGE_BUCKET,
  messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
  appId: FIREBASE_APP_ID,
  measurementId: FIREBASE_MEASUREMENT_ID,
}

// export let fbClientApp: FirebaseApp
//
// try {
//   fbClientApp = getApp(FIREBASE_CLIENT_APP_NAME)
// }
// catch {
//   fbClientApp = initializeApp(fbClientAppOptions, {
//     name: FIREBASE_CLIENT_APP_NAME,
//     automaticDataCollectionEnabled: true,
//   })
// }
//
// export default fbClientApp
