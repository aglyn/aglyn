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

import * as firebaseAdmin from 'firebase-admin'

export let firebaseAdminApp: firebaseAdmin.app.App

/**
 * default module loading invokes
 */
;(function main(): void {
  if (!firebaseAdmin.apps.length) {
    firebaseAdminApp = firebaseAdmin.initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      serviceAccountId: process.env.FIREBASE_CLIENT_EMAIL,
      credential: firebaseAdmin.credential.cert({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // https://stackoverflow.com/a/41044630/1332513
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    })
    // reCAPTCHA v3
    const appCheck = firebaseAdmin.appCheck(firebaseAdminApp)
  }
  if (!firebaseAdmin) {
    firebaseAdminApp = firebaseAdmin.app()
  }
})()

export { firebaseAdmin }
export default firebaseAdmin
