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

import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app'
import {
  type AppCheck,
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'firebase/app-check'
import { defaultAppConfig } from './controllers/app-controller'

export let firebaseApp: FirebaseApp
export let appCheck: AppCheck

/**
 * @ignore - default module loading invokes (browser only)
 */
;(function main(): void {
  if (typeof window === 'undefined' || firebaseApp) return

  firebaseApp = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: defaultAppConfig.apiKey,
        authDomain: defaultAppConfig.authDomain,
        databaseURL: defaultAppConfig.databaseURL,
        projectId: defaultAppConfig.projectId,
        storageBucket: defaultAppConfig.storageBucket,
        messagingSenderId: defaultAppConfig.messagingSenderId,
        appId: defaultAppConfig.appId,
        measurementId: defaultAppConfig.measurementId,
      })

  if (process.env.NODE_ENV !== 'production' && self) {
    self['FIREBASE_APPCHECK_DEBUG_TOKEN'] = true
  }
  appCheck = initializeAppCheck(firebaseApp, {
    // Pass your reCAPTCHA v3 site key (public key) to activate(). Make sure
    // this key is the counterpart to the secret key set in the Firebase
    // console.
    provider: new ReCaptchaV3Provider(
      process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY,
    ),
    // If true, the SDK automatically refreshes App Check tokens as needed.
    isTokenAutoRefreshEnabled: true,
  })
})()

export default firebaseApp
