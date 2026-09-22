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

// The rows AGL-3248 stopped writing, removed from the inboxes that already
// hold them.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/reap-canary-staff-notifications.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/reap-canary-staff-notifications.mjs --apply
//
// DRY RUN BY DEFAULT.
//
// AGL-3225 gave staff two growth notifications and the hourly signup canary
// tripped both on every walk for as long as both existed. AGL-3248 closed
// the source; this closes the backlog. Every row it removes points at an org
// or an account the walk itself deleted minutes later, so each one is a link
// to an admin page that 404s — there is nothing behind them to preserve.
//
// ## Why the roster and not a collection group
//
// Staff are a custom claim, not a Firestore query, so the inboxes are found
// the way `notifyStaff` finds them: paginate every auth pool for the claim,
// then read `users/{uid}/notifications` per holder. A collection-group sweep
// would need an index that does not exist and would reach every customer's
// notifications to find a handful of our own.
//
// ## What counts as the canary's, and what deliberately does not
//
// The DATA, never the prose. A workspace row is matched on the slug its body
// carries and an account row on the address's plus tag — the same two facts
// the live path now tests — so a title reworded later cannot make this miss,
// and a customer who wrote "Signup canary" in their workspace name cannot
// make it delete their row.
//
// Only the two `staff.` types are ever considered. Nothing else in the
// taxonomy is reachable from a signup walk, and a sweep that could touch
// `billing.*` or `support.*` would be one bad predicate away from deleting a
// dispute nobody has read yet.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuth } from 'firebase-admin/auth'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { collect, commitAll, connectFirestore } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/**
 * Held with `libs/aglyn/src/lib/app-utils/health-report.ts`, which this file
 * cannot import — the script runs outside the workspace on the Admin SDK,
 * the same arrangement `tools/e2e/signup-canary.mjs` lives under.
 */
const CANARY_SLUG_PREFIX = 'signup-canary-'
const CANARY_EMAIL_TAG = 'signup-canary'

const { apply } = parseDeployArgs({
  command: 'node tools/scripts/reap-canary-staff-notifications.mjs',
  summary:
    "Removes the signup canary's own rows from staff notification inboxes (AGL-3248).",
  effect: { present: 'write', past: 'WRITTEN', failure: 'could not write' },
  flags: [{ flag: '--apply', key: 'apply', description: 'Delete the rows (default: dry run).' }],
})

/** `${email} created ${name} (/${slug}).` — the slug is the fact. */
const isCanaryWorkspaceRow = (body) =>
  typeof body === 'string' && body.includes(`(/${CANARY_SLUG_PREFIX}`)

/** `${email} signed up.` — the address is the fact. */
const isCanaryAccountRow = (body) => {
  if (typeof body !== 'string') return false
  const address = body.split(/\s+/)[0]?.toLowerCase() ?? ''
  const local = address.split('@')[0] ?? ''
  const plus = local.indexOf('+')
  return plus >= 0 && local.slice(plus + 1).startsWith(CANARY_EMAIL_TAG)
}

const isCanaryRow = (row) =>
  (row.type === 'staff.orgCreated' && isCanaryWorkspaceRow(row.body)) ||
  (row.type === 'staff.userSignedUp' && isCanaryAccountRow(row.body))

async function staffUids(auth) {
  const scan = async (pool) => {
    const found = []
    let pageToken
    do {
      const page = await pool.listUsers(1000, pageToken)
      for (const record of page.users) {
        if (record.customClaims?.['staff']) found.push(record.uid)
      }
      pageToken = page.pageToken
    } while (pageToken)
    return found
  }
  const uids = await scan(auth)
  // Staff who sign in through enterprise SSO live in a GCIP tenant pool, and
  // `notifyStaff` reaches them — so a sweep that skipped the tenants would
  // leave exactly the inboxes hardest to notice.
  let pageToken
  do {
    const page = await auth.tenantManager().listTenants(1000, pageToken)
    for (const tenant of page.tenants) {
      try {
        uids.push(...(await scan(auth.tenantManager().authForTenant(tenant.tenantId))))
      } catch (error) {
        console.error(`tenant ${tenant.tenantId} scan failed: ${String(error).slice(0, 120)}`)
      }
    }
    pageToken = page.pageToken
  } while (pageToken)
  return uids
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const uids = await staffUids(getAuth())
  console.log(`${uids.length} staff inbox(es)`)

  const writes = []
  let workspaces = 0
  let accounts = 0
  let kept = 0
  for (const uid of uids) {
    const inbox = db.collection('users').doc(uid).collection('notifications')
    const rows = await collect(inbox)
    let mine = 0
    for (const row of rows) {
      if (row.data.type !== 'staff.orgCreated' && row.data.type !== 'staff.userSignedUp') {
        continue
      }
      if (!isCanaryRow(row.data)) {
        kept += 1
        continue
      }
      if (row.data.type === 'staff.orgCreated') workspaces += 1
      else accounts += 1
      mine += 1
      writes.push({ kind: 'delete', ref: inbox.doc(row.id) })
    }
    if (mine) console.log(`  ${uid}: ${mine} of ${rows.length}`)
  }

  console.log(
    `\n${writes.length} canary row(s): ${workspaces} workspace, ${accounts} account.` +
      `\n${kept} real growth row(s) left alone.`,
  )
  if (!writes.length) {
    console.log('Nothing to do.')
    return
  }
  if (!apply) {
    console.log('DRY RUN — nothing was written. Re-run with --apply.')
    return
  }
  await commitAll(db, writes)
  console.log(`Deleted ${writes.length} row(s).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
