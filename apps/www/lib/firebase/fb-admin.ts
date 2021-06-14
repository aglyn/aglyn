/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import * as fbAdmin from 'firebase-admin'


export let fbAdminApp: fbAdmin.app.App

/**
 * @ignore - default module loading invokes
 */
(function main(): void {
  if (!fbAdmin.apps.length) {
    fbAdminApp = fbAdmin.initializeApp({
      credential: fbAdmin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // https://stackoverflow.com/a/41044630/1332513
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    })
    return
  }
  if (!fbAdmin) {
    fbAdminApp = fbAdmin.app()
  }
})()

export { fbAdmin }
export default fbAdmin
