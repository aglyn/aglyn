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

// Grants (or removes) the `staff` custom claim that the Firestore rules and
// the admin console check (AGL-42). Run locally with admin credentials:
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/set-staff-claim.mjs <uid-or-email> [--remove]
//
// The user must sign out/in (or force-refresh the ID token) for the claim
// to take effect on the client.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const [, , identifier, flag] = process.argv
if (!identifier) {
  console.error('Usage: node tools/scripts/set-staff-claim.mjs <uid-or-email> [--remove]')
  process.exit(1)
}

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

const auth = getAuth()
const user = identifier.includes('@')
  ? await auth.getUserByEmail(identifier)
  : await auth.getUser(identifier)

const remove = flag === '--remove'
const claims = { ...(user.customClaims ?? {}) }
if (remove) delete claims.staff
else claims.staff = true

await auth.setCustomUserClaims(user.uid, claims)
console.log(
  `${remove ? 'Removed staff claim from' : 'Granted staff claim to'} ${user.uid} (${user.email ?? 'no email'})`,
)
console.log('The user must refresh their ID token (sign out/in) to pick it up.')
