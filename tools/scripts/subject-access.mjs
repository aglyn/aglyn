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

// Subject-access assembly, by hand (AGL-1974). The staff path for a request
// self-serve cannot reach: a person who has lost access to their account, an
// SSO user whose IdP is gone, a request arriving by email from somebody who
// will never sign in again — the shapes a DSAR actually arrives in.
//
// THIS SCRIPT ASSEMBLES NOTHING OF ITS OWN. It calls `exportUserData` /
// `exportOrgData` — the same functions `/api/account/export` and
// `/api/orgs/export-data` call. That is the `erase-tenant.mjs` lesson applied
// before it can bite: within a week of four sweeps landing in `eraseOrg`, the
// script that reimplemented it was missing all four and reporting success.
// An access request answered from a second, drifting enumeration
// under-discloses in exactly the same silent way, and the symptom is a file
// that looks complete.
//
// ALWAYS OFFER SELF-SERVE FIRST. `/manage/user` → Download my data is a
// STRONGER answer than this one, not merely an easier one: it is served to
// the account's own signed-in session, so it cannot act on the wrong account
// (docs/PRIVACY_REQUESTS.md §3). Reach for this only when they cannot sign in.
//
// ⚠️ THE FILE THIS WRITES IS THE MOST PERSONAL PAYLOAD THE PLATFORM PRODUCES.
// Secrets are redacted to a presence marker and an API key's id is withheld,
// but everything else is real: names, addresses, phone numbers, support prose,
// customers' orders and form submissions. Send it to the verified subject and
// delete your local copy. Do not leave it in a shared directory, and do not
// attach it to a ticket.
//
// Usage (the root .env carries the service account):
//   set -a && source .env && set +a && \
//     node tools/scripts/subject-access.mjs --uid <uid>   [--out <file>]
//     node tools/scripts/subject-access.mjs --email <addr> [--out <file>]
//     node tools/scripts/subject-access.mjs --org <orgId>  [--out <file>]
//
// `--email` resolves across the project pool AND every SSO tenant pool
// (AGL-1122), because an Enterprise member's account does not exist at project
// level and looking only there answers "we hold no account for this address"
// about somebody we plainly do.
//
// With no `--out`, the JSON goes to stdout, which is the safer default: it
// leaves nothing on disk unless the operator asks for it, and it composes with
// a pipe into whatever secure channel the reply is going out through.

import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { writeFileSync } from 'node:fs'
import { importWorkspaceModule } from './lib/workspace-module.mjs'

const USAGE = `Usage:
  node tools/scripts/subject-access.mjs --uid <uid> [--out <file>]
  node tools/scripts/subject-access.mjs --email <address> [--out <file>]
  node tools/scripts/subject-access.mjs --org <orgId> [--out <file>]

Assembles everything we hold about a person or a workspace, for a GDPR
Art. 15 access request or an Art. 20 portability request. Read-only.

Offer /manage/user -> Download my data first: it verifies itself.`

function parseArgs(argv) {
  const read = (flag) => {
    const at = argv.indexOf(flag)
    return at === -1 ? null : (argv[at + 1] ?? null)
  }
  return {
    uid: read('--uid'),
    email: read('--email'),
    orgId: read('--org'),
    out: read('--out'),
  }
}

function initAdmin() {
  if (getApps().length) return
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        'aglyn-main',
    })
    return
  }
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
        'FIREBASE_PRIVATE_KEY — `set -a && source .env && set +a` first.',
    )
    process.exit(1)
  }
  initializeApp({
    projectId,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    serviceAccountId: clientEmail,
    credential: cert({ projectId, clientEmail, privateKey }),
  })
}

async function main() {
  const { uid, email, orgId, out } = parseArgs(process.argv.slice(2))
  const named = [uid, email, orgId].filter(Boolean).length
  if (named !== 1) {
    console.error(USAGE)
    return 1
  }

  initAdmin()
  const { exportUserData, exportOrgData, exportFilename } =
    await importWorkspaceModule(
      'libs/tenant/data/admin/src/lib/server/personal-data-export.ts',
    )

  let subjectUid = uid
  if (email) {
    const { findUserByEmailAcrossPools } = await importWorkspaceModule(
      'libs/tenant/data/admin/src/lib/server/auth-pools.ts',
    )
    const found = await findUserByEmailAcrossPools(email)
    if (!found) {
      // A complete and correct answer to an access request, and it must not
      // be preceded by asking them for identity documents to prove a negative
      // (docs/PRIVACY_REQUESTS.md §3).
      console.error(
        `No account exists for ${email}. "We hold no account for this ` +
          'address" is a complete answer — reply with it.',
      )
      return 2
    }
    subjectUid = found.record?.uid ?? found.uid
  }

  const exported = orgId
    ? await exportOrgData(orgId)
    : await exportUserData(subjectUid)

  const json = JSON.stringify(exported, null, 2)
  if (out) {
    writeFileSync(out, json, 'utf8')
    const rows = Object.values(exported.data).reduce(
      (total, list) => total + list.length,
      0,
    )
    console.error(
      `Wrote ${out} — ${rows} documents across ` +
        `${Object.keys(exported.data).length} sources. ` +
        `Suggested name: ${exportFilename(exported)}\n` +
        'Send it to the VERIFIED subject and delete your local copy.',
    )
  } else {
    process.stdout.write(`${json}\n`)
  }
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
