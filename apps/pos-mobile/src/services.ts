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

import {
  createConsoleApiClient,
  mobileConfigProblems,
  mobileFirebase,
  readMobileConfig,
} from '@aglyn/mobile-core'

/*==========================================
 * THE APP'S ONE SET OF SERVICES (AGL-3618).
 *
 * Each `EXPO_PUBLIC_*` variable is named in full: Expo inlines only member
 * expressions it can see, so `readMobileConfig(process.env)` would read an
 * empty object in a release build.
 *=========================================*/

export const config = readMobileConfig({
  EXPO_PUBLIC_CONSOLE_URL: process.env.EXPO_PUBLIC_CONSOLE_URL,
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
  EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST: process.env.EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
})

export const configProblems = mobileConfigProblems(config)

export const firebase = configProblems.length ? null : mobileFirebase(config)

export const api = createConsoleApiClient({
  origin: config.consoleOrigin,
  getIdToken: async (forceRefresh) => (await firebase?.auth.currentUser?.getIdToken(forceRefresh)) ?? null,
})

/** The only origins the register WebView loads, and the bridge answers. */
export const trustedOrigins: readonly string[] = [config.consoleOrigin]
