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
 * Initializes the firebase-admin default app on import. Guarded on the
 * FULL credential (`FIREBASE_PRIVATE_KEY` + `NEXT_PUBLIC_FIREBASE_PROJECT_ID`):
 * every runtime environment sets both, so init runs exactly as before there —
 * but a BUILD with partial credentials previously crashed at module load
 * (App Router page-data collection evaluates route modules; the workspace
 * root `.env` supplies the private key but not the NEXT_PUBLIC project id,
 * so `cert()` threw "must contain a string project_id"), taking the whole
 * build down. Skipping init when any piece is absent lets the module load
 * cleanly at build time (firebase-admin is never actually invoked during
 * collection) while leaving runtime behavior untouched.
 */
;(function main(): void {
  if (getApps().length) {
    fbAdminApp = getApp()
    return
  }
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  // ALL THREE, because `cert()` requires all three (AGL-1152). This guard
  // checked two of them and let a missing `FIREBASE_CLIENT_EMAIL` through to
  // throw "must contain a string client_email" at module load — the very
  // partial-credential crash the comment above describes, from the one field
  // it forgot to name. Nine tenant suites failed to load on it.
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  if (!privateKey || !projectId || !clientEmail) return
  fbAdminApp = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    serviceAccountId: clientEmail,
    credential: cert({
      projectId,
      clientEmail,
      // https://stackoverflow.com/a/41044630/1332513
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  })
})()

/**
 * `checkRevoked: true`, unconditionally (AGL-1881).
 *
 * This helper sits BELOW the nx boundary that holds the console's cached
 * revocation check, so it cannot share it — and it is a bare `verifyIdToken`
 * exported from a shared lib, which is the exact shape that spread the
 * problem in the first place: 172 of 175 call sites had the flag off. Paying
 * Firebase's own round trip here is the honest price of a door that cannot
 * reach the cheap check. It has no callers today, so the price is zero and
 * the next caller inherits the strict behaviour rather than the loose one.
 */
export function verifyIdToken(idToken: string) {
  return getAuth(fbAdminApp).verifyIdToken(idToken, true)
}

/**
 * Optional Firestore database override (AGL-1490). Unset — the default in
 * every environment today — targets the `(default)` database exactly as
 * before. Set, it points every Admin-SDK Firestore accessor at the named
 * database (e.g. one created by `gcloud firestore databases restore` during
 * disaster recovery, see docs/DISASTER_RECOVERY.md) by configuration instead
 * of a code change. Read at call time, not module load, so a process
 * restarted with new env — and a spec toggling `process.env` — sees the
 * current value. An empty string is normalized to undefined so the SDK's own
 * `(default)` fallback applies.
 */
export function firestoreDatabaseId(): string | undefined {
  return process.env.FIRESTORE_DATABASE_ID || undefined
}

/**
 * Compatibility facade replacing firebase-admin v14's removed namespace API
 * (`import * as admin from 'firebase-admin'`) so existing call sites
 * (`fbAdmin.firestore()`, `fbAdmin.firestore.Timestamp`, `fbAdmin.auth()`)
 * keep working unchanged, backed internally by the modular SDK.
 */
function firestoreNamespace(app?: App) {
  // `getFirestore(app, undefined)` resolves to the `(default)` database —
  // the SDK falls back via `databaseId || DEFAULT_DATABASE_ID` — so behavior
  // with FIRESTORE_DATABASE_ID unset is identical to `getFirestore(app)`.
  return getFirestore(app ?? fbAdminApp, firestoreDatabaseId())
}
firestoreNamespace.FieldValue = FieldValue
firestoreNamespace.Timestamp = Timestamp

const fbAdmin = {
  firestore: firestoreNamespace,
  auth: (app?: App) => getAuth(app ?? fbAdminApp),
}

export { fbAdmin }
export default fbAdmin
