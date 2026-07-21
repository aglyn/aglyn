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

// READ-ONLY audit of the `staff` / `staffRole` custom claims (AGL-683).
// Writes nothing — pair it with set-staff-claim.mjs to act on what it finds.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/audit-staff-claims.mjs [--json]
//
// Why this exists: AGL-495 inverted the staff-role default. `staffRole ?? 'super'`
// (a missing claim meant FULL access) became `staffRole ?? 'support'`. Correct —
// but every account granted staff before that change carries `staff: true` with
// NO staffRole, so they all silently dropped to `support`. Nothing errors; the
// super-only routes just start returning 403.
//
// Role-less accounts are therefore ambiguous by construction: the claim cannot
// tell you whether someone was meant to be super or support. Each one is a
// human decision, which is why this script reports and does not fix.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const asJson = process.argv.includes('--json')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

const auth = getAuth()

/** Every user carrying `staff: true`, paged through the whole directory. */
const staff = []
let pageToken
let scanned = 0
do {
  const page = await auth.listUsers(1000, pageToken)
  for (const user of page.users) {
    scanned += 1
    const claims = user.customClaims ?? {}
    if (claims['staff'] !== true) continue
    staff.push({
      uid: user.uid,
      email: user.email ?? null,
      staffRole: claims['staffRole'] ?? null,
      disabled: user.disabled,
      lastSignIn: user.metadata.lastSignInTime ?? null,
    })
  }
  pageToken = page.pageToken
} while (pageToken)

const roleless = staff.filter((s) => s.staffRole == null)
const supers = staff.filter((s) => s.staffRole === 'super')
const support = staff.filter((s) => s.staffRole === 'support')
const odd = staff.filter(
  (s) => s.staffRole != null && !['super', 'support'].includes(s.staffRole),
)

if (asJson) {
  console.log(
    JSON.stringify({ project: projectId, scanned, staff, roleless }, null, 2),
  )
} else {
  const row = (s) =>
    `  ${s.email ?? '(no email)'}  ${s.uid}` +
    `${s.disabled ? '  [DISABLED]' : ''}` +
    `${s.lastSignIn ? `  last sign-in ${s.lastSignIn}` : '  never signed in'}`

  console.log(`Project ${projectId} — scanned ${scanned} users, ${staff.length} staff\n`)
  console.log(`super (${supers.length}):`)
  supers.forEach((s) => console.log(row(s)))
  console.log(`\nsupport (${support.length}):`)
  support.forEach((s) => console.log(row(s)))
  if (odd.length) {
    console.log(`\nUNRECOGNISED staffRole (${odd.length}) — treated as support:`)
    odd.forEach((s) => console.log(`${row(s)}  staffRole=${String(s.staffRole)}`))
  }
  console.log(
    `\nNO staffRole (${roleless.length}) — effectively support since AGL-495:`,
  )
  roleless.forEach((s) => console.log(row(s)))
  if (roleless.length) {
    console.log(
      '\nDecide each one deliberately — do NOT blanket-promote. To grant:\n' +
        '  node tools/scripts/set-staff-claim.mjs <uid-or-email> --role=super\n' +
        'The identifier is POSITIONAL (not --email=…), and the user must sign\n' +
        'out and back in before the new claim reaches their ID token.',
    )
  }
}
