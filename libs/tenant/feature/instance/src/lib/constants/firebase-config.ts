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

export const RECAPTCHA_API_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY
export const FIREBASE_CLIENT_APP_NAME = 'DEFAULT_AGLYN'

/**
 * Firebase client-side configuration assembled directly from NEXT_PUBLIC_*
 * environment variables so that Next.js webpack DefinePlugin substitutes
 * them at build time and no intermediate constant indirection can carry a
 * stale undefined value across a cached compilation.
 */
export const fbClientAppOptions: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
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
