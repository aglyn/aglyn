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

import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'

export let fbAdminApp: App

/**
 * @ignore - default module loading invokes
 *
 * Initializes the firebase-admin default app on import. Guarded on
 * `FIREBASE_PRIVATE_KEY`: every runtime environment sets it, so init runs
 * exactly as before there — but a BUILD without credentials (e.g. Next.js
 * page-data collection in CI/local without the secret) previously crashed
 * at module load on `undefined.replace(...)` / cert validation, taking the
 * whole build down. Skipping init when the key is absent lets the module
 * load cleanly at build time (firebase-admin is never actually invoked
 * during collection) while leaving runtime behavior untouched.
 */
;(function main(): void {
  if (getApps().length) {
    fbAdminApp = getApp()
    return
  }
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
  if (!privateKey) return
  fbAdminApp = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    serviceAccountId: process.env.FIREBASE_CLIENT_EMAIL,
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // https://stackoverflow.com/a/41044630/1332513
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  })
})()

export function verifyIdToken(idToken: string) {
  return getAuth(fbAdminApp).verifyIdToken(idToken)
}

/**
 * Compatibility facade replacing firebase-admin v14's removed namespace API
 * (`import * as admin from 'firebase-admin'`) so existing call sites
 * (`fbAdmin.firestore()`, `fbAdmin.firestore.Timestamp`, `fbAdmin.auth()`)
 * keep working unchanged, backed internally by the modular SDK.
 */
function firestoreNamespace(app?: App) {
  return getFirestore(app ?? fbAdminApp)
}
firestoreNamespace.FieldValue = FieldValue
firestoreNamespace.Timestamp = Timestamp

const fbAdmin = {
  firestore: firestoreNamespace,
  auth: (app?: App) => getAuth(app ?? fbAdminApp),
}

export { fbAdmin }
export default fbAdmin
