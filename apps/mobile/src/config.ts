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

/**
 * Reads this build's `EXPO_PUBLIC_*` variables into the foundation's
 * configuration, once, before anything renders (AGL-3620). Each variable is
 * spelled out in full: Expo inlines only those.
 */

import { configureMobile, mobileConfigProblems, readMobileConfig, type MobileConfig } from '@aglyn/mobile-core'
import Constants from 'expo-constants'

export function configureFromEnv(): MobileConfig {
  const config = readMobileConfig(
    {
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
      EXPO_PUBLIC_BRAND_NAME: process.env.EXPO_PUBLIC_BRAND_NAME,
    },
    'aglyn',
  )
  const problems = mobileConfigProblems(config)
  if (problems.length) throw new Error(`This build is not configured:\n${problems.join('\n')}`)
  configureMobile(config)
  return config
}

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'
