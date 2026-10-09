#!/usr/bin/env node
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

// The SSO Auth-record identity backfill (AGL-3721).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-sso-auth-identity.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-sso-auth-identity.mjs --write
//
// DRY RUN BY DEFAULT. `--write` writes. Every decision is
// `lib/sso-auth-identity-backfill.mjs`'s and pinned by its test; this file
// reads, prints and writes.
//
// ## What it does
//
// A SAML sign-in leaves the Firebase Auth record's `displayName` and
// `photoURL` empty, so every staff surface that reads the record drew a grey
// initial for SSO accounts. The sign-in now fills them on the next SSO
// sign-in; this fills the accounts that have not signed in since, from what
// the platform already holds: the account's `users/{uid}` profile (seeded from
// the IdP at every sign-in), its provider entries, then its roster rows.
//
// Every SSO tenant pool is read, plus project-pool accounts with a `saml.` or
// `oidc.` provider.
//
// ## What it never does
//
// Overwrite. The record is re-read immediately before each write and the plan
// recomputed, so a name or photo set while this ran is left alone; a removed
// avatar (`photoUrlErasedAt`) is never put back.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuth } from 'firebase-admin/auth'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { connectFirestore } from './lib/firestore-backfill.mjs'
import { isSsoUserRecord, planAuthIdentityFill } from './lib/sso-auth-identity-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-sso-auth-identity',
  summary:
    'Fill the blank displayName/photoURL on SSO accounts\' Firebase Auth records from ' +
    'their profile, provider entries and roster rows. Writes with --write.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [{ flag: '--write', key: 'write', describe: 'Write. Without it, a dry run.' }],
})
const write = Boolean(args.write)

/** Every pool: the project's (tenantId null), then each SSO tenant's. */
async function pools() {
  const out = [{ tenantId: null, auth: getAuth() }]
  let pageToken
  do {
    const page = await getAuth().tenantManager().listTenants(100, pageToken)
    for (const tenant of page.tenants) {
      out.push({
        tenantId: tenant.tenantId,
        auth: getAuth().tenantManager().authForTenant(tenant.tenantId),
      })
    }
    pageToken = page.pageToken
  } while (pageToken)
  return out
}

async function* everyUser(auth) {
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const user of page.users) yield user
    pageToken = page.pageToken
  } while (pageToken)
}

/** The roster rows for one uid, through the `users/{uid}/orgs` reverse index. */
async function rosterRows(db, uid) {
  const reverse = await db.collection('users').doc(uid).collection('orgs').limit(50).get()
  const rows = await Promise.all(
    reverse.docs.map((entry) =>
      db.collection('orgs').doc(entry.id).collection('members').doc(uid).get(),
    ),
  )
  return rows.filter((row) => row.exists).map((row) => row.data() ?? {})
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply: write })
  const plans = []
  let ssoSeen = 0
  let complete = 0
  for (const pool of await pools()) {
    for await (const record of everyUser(pool.auth)) {
      if (!isSsoUserRecord(record, pool.tenantId)) continue
      ssoSeen += 1
      if (record.displayName && record.photoURL) {
        complete += 1
        continue
      }
      const profileSnapshot = await db.collection('users').doc(record.uid).get()
      const plan = planAuthIdentityFill({
        record,
        profile: profileSnapshot.exists ? (profileSnapshot.data() ?? null) : null,
        rosterRows: await rosterRows(db, record.uid),
      })
      if (plan) plans.push({ ...plan, uid: record.uid, email: record.email ?? null, pool })
    }
  }

  console.log(
    `SSO accounts: ${ssoSeen} read, ${complete} already complete, ${plans.length} to fill, ` +
      `${ssoSeen - complete - plans.length} blank with nothing to fill from`,
  )
  for (const plan of plans) {
    const fields = Object.entries(plan.fill)
      .map(([field, value]) => `${field}=${JSON.stringify(value)} (from ${plan.sources[field]})`)
      .join(', ')
    console.log(`  ${plan.pool.tenantId ?? 'project'}/${plan.uid} ${plan.email ?? ''}: ${fields}`)
  }

  if (!write) {
    console.log('Dry run — nothing was written. Re-run with --write.')
    return
  }
  let written = 0
  let raced = 0
  for (const plan of plans) {
    // Re-read and re-plan: a name or photo set since the read above wins.
    const fresh = await plan.pool.auth.getUser(plan.uid)
    const profileSnapshot = await db.collection('users').doc(plan.uid).get()
    const again = planAuthIdentityFill({
      record: fresh,
      profile: profileSnapshot.exists ? (profileSnapshot.data() ?? null) : null,
      rosterRows: await rosterRows(db, plan.uid),
    })
    if (!again) {
      raced += 1
      continue
    }
    await plan.pool.auth.updateUser(plan.uid, again.fill)
    written += 1
  }
  console.log(`filled ${written} Auth record(s); ${raced} gained their fields while this ran and were left alone`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
