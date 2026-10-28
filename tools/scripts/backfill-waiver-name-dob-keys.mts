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
 * STAMP EVERY SIGNED WAIVER WITH ITS NAME AND BIRTH DATE MATCH KEYS (AGL-4042).
 *
 * Check-in matches a rider to a signed waiver by email first and, when the
 * email matches nothing, by full name and date of birth together. That second
 * match is a query on `nameDobKeys` (one key per person a signature covers,
 * the signer and each minor), which signing writes. Signatures taken before
 * carry none, so check-in could not find them by name and birth date. This
 * stamps them.
 *
 * It writes only `nameDobKeys`; nothing a signer, a store or the console
 * shows changes. The keys are made by the same rule signing uses
 * (`waiverNameDobKeys`, through `backfillWaiverNameDobKeys`).
 *
 * Dry-run by default: reads, prints counts, writes nothing. Each signature
 * is written with a precondition on the document it was judged from, so one
 * changed in between is skipped and picked up by a re-run.
 *
 *   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
 *   SWC_NODE_PROJECT=tsconfig.base.json \
 *     node --import @swc-node/register/esm-register \
 *     tools/scripts/backfill-waiver-name-dob-keys.mts [--org <orgId>] [--commit]
 *
 * With FIRESTORE_EMULATOR_HOST set it needs only FIREBASE_PROJECT_ID.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { backfillWaiverNameDobKeys } from '../../libs/plugins/waivers/src/lib/server/name-dob-backfill'

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const orgFlag = args.indexOf('--org')
const ONLY_ORG = orgFlag >= 0 ? args[orgFlag + 1] : undefined

const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) {
  console.error('Missing FIREBASE_PROJECT_ID env var')
  process.exit(1)
}
if (!getApps().length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId })
  } else {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    if (!clientEmail || !privateKey) {
      console.error('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
      process.exit(1)
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }
}

console.log(
  `\nStamp signed waivers with their name and birth date match keys — project=${projectId} ` +
    `${ONLY_ORG ? `org=${ONLY_ORG} ` : ''}mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

const counts = await backfillWaiverNameDobKeys(getFirestore(), {
  orgId: ONLY_ORG,
  commit: COMMIT,
  warn: (line) => console.warn(line),
})

console.log(`signatures read:     ${counts.read}`)
console.log(`  already stamped:   ${counts.current}`)
console.log(`  to stamp:          ${counts.toStamp}`)
console.log(`  skipped:           ${counts.skipped}`)
if (COMMIT) {
  console.log(`\nstamped ${counts.stamped} signature(s).`)
} else {
  console.log('\nDry run: nothing written. Re-run with --commit to stamp.')
}
process.exit(0)
