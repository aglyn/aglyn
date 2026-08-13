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

// GDPR erasure, by hand (AGL-206 / AGL-485). The manual path staff reach for
// when the automated one is stuck:
//
//   1. An erasure request is filed — by staff in the admin console, or by an
//      org owner via self-serve "Delete organization" — which sets
//      `orgs/{orgId}.erasureRequestedAt` (audited). Reversible until the hold
//      elapses.
//   2. Normally `/api/admin/run-erasures` executes it on a schedule. When that
//      is stuck, staff run this after the 7-day hold.
//
// THIS SCRIPT PERFORMS NO ERASURE OF ITS OWN. It calls `eraseOrg` — the same
// function the cron route calls (AGL-1481). It used to be a second
// implementation, and a second implementation of a cascade delete is a
// divergence with a schedule: within a week of `eraseOrgApiKeys` (AGL-1444)
// and the SSO, console-domain and org-keyed index sweeps (AGL-1448) landing in
// the shared function, this script had none of them, so an erasure run here
// left a live API credential, live domain reservations, `orgSlugs` tombstones
// and a `stripeCustomers` reverse index standing — and reported success.
// Anything this needs that the served path does not belongs in
// `EraseOrgOptions`, never back in here.
//
// IT ALSO WRITES NO FILE. It used to write `erasure-org-{orgId}-{now}.json`
// into the operator's current working directory: a complete verbatim copy of
// the org tree and every host tree, including `webhooks.secret`,
// `orders.paymentLinkUrl` (a live payable bearer URL),
// `screens.protection.passwordHash` and `ssoDomains.token`. That left a file
// of working customer credentials on somebody's laptop, in whatever directory
// they were standing in, with no retention and no access control, for a
// customer who had just been told their workspace was gone. AGL-1443 deleted
// the same write from the served path; this was the other producer. If a
// workspace genuinely needs inspecting before it is erased, that is a separate
// deliberate export with its own handling — not a side effect of the delete
// tool.
//
// Without --confirm it PLANS: every sweep runs its query and skips its write,
// so the counts printed are the counts the real run reports, produced by the
// same code rather than by a second list.
//
// Usage (the root .env carries the service account):
//   set -a && source .env && set +a && \
//     node tools/scripts/erase-tenant.mjs --org <orgId> [--confirm] \
//       [--actor <uid>]
//
// `--actor` names the staff member answerable for the erasure in the
// `adminAudit` row; it defaults to `script:erase-tenant`.
//
// `--tenant <uid>` is GONE. The legacy `tenants/{uid}` collection was retired
// by AGL-238 (`tools/scripts/retire-legacy-tenants.mjs`) and has had no rules
// block since; personal-account erasure is served by `eraseUser` (AGL-1140)
// from the staff console and from self-serve Close account. What that mode
// actually still did was erase ORGS through a third copy of the cascade, with
// the same missing sweeps and the same dump.

import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { runEraseOrgCli } from './lib/erase-org-cli.mjs'
import { importWorkspaceModule } from './lib/workspace-module.mjs'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

/**
 * Initialize the firebase-admin default app BEFORE the workspace module is
 * loaded: `libs/shared/util/fbserver` initializes it on import if the env
 * carries a full credential, and doing it here means this script decides which
 * project it is pointed at rather than inheriting whatever `.env` happens to
 * hold.
 *
 * The emulator branch exists so a plan can be rehearsed against
 * `npm run firebase:emulate` without a credential at all — and it is what the
 * AGL-1481 spec drives to prove this script writes nothing to the working
 * directory. `runEraseOrgCli` refuses `--confirm` in that mode: there is no
 * Storage emulator, so the storage sweeps would address the real bucket.
 */
function initAdmin() {
  if (getApps().length) return
  if (EMULATED) {
    initializeApp({
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        'aglyn-main',
    })
    return
  }
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID
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
  initAdmin()
  const { eraseOrg } = await importWorkspaceModule(
    'libs/tenant/data/admin/src/lib/server/erase.ts',
  )
  return runEraseOrgCli({
    argv: process.argv.slice(2),
    eraseOrg,
    emulated: EMULATED,
  })
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
