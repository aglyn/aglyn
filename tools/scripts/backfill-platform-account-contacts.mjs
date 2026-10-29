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

// Every account a contact in the operator's own CRM: the backfill.
//
//   node tools/scripts/backfill-platform-account-contacts.mjs --host=<marketingHostId>
//   node tools/scripts/backfill-platform-account-contacts.mjs --host=<marketingHostId> --out=rows.csv
//   node tools/scripts/backfill-platform-account-contacts.mjs --host=<marketingHostId> --write
//
// DRY RUN BY DEFAULT. `--write` writes. Credentials come from the root `.env`,
// as every backfill here reads them.
//
// ## What it does
//
// New accounts become a contact on the marketing host at sign-up
// (`recordPlatformAccountContact`). Accounts created before that only have one
// if they answered the marketing-email question. This walks every Auth pool
// (the project's and each SSO tenant's), finds the accounts with an address
// and no contact on the marketing host's organization, and writes each one
// through the same `recordPlatformAccountContact` the sign-up uses: source
// `account`, the `lead` stage floor, a "Created an account" row dated at the
// account's creation, and no consent either way.
//
// ## What it never does
//
// Touch an existing contact, record consent, or write for a disabled account.
// Addresses on the operator's own domain (`--internal-domain=<domain>`) are listed and
// left out unless `--include-internal` is passed. Each address is re-checked
// immediately before its write, so a contact created while this ran is left
// alone.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { loadRootEnv } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-platform-account-contacts',
  summary:
    'Make every account with an address a contact on the marketing host, as sign-up now does. ' +
    'Writes with --write.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--write', key: 'write', describe: 'Write. Without it, a dry run.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'The marketing host id (PLATFORM_MARKETING_HOST_ID).' },
    { flag: '--out', key: 'out', value: 'string', describe: 'Also write the planned rows to this CSV file.' },
    { flag: '--internal-domain', key: 'internalDomain', value: 'string', describe: "The operator's own email domain, left out by default." },
    { flag: '--include-internal', key: 'includeInternal', describe: 'Include addresses on the internal domain.' },
  ],
})
const write = Boolean(args.write)

/** Load the server libs through the workspace's path aliases. */
function loadServerLib(file) {
  const { paths } = JSON.parse(readFileSync(join(REPO_ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    const absolute = join(REPO_ROOT, target)
    if (key.endsWith('/*')) alias[key.slice(0, -1)] = absolute.slice(0, -1)
    else alias[key] = absolute
  }
  return createJiti(import.meta.url, { alias, interopDefault: true }).import(join(REPO_ROOT, file))
}

async function* everyUser(auth) {
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const user of page.users) yield user
    pageToken = page.pageToken
  } while (pageToken)
}

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

async function main() {
  loadRootEnv(REPO_ROOT)
  // The server lib initializes from the runtime's public project id, which the
  // root `.env` names only as FIREBASE_PROJECT_ID.
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= process.env.FIREBASE_PROJECT_ID
  const hostId = String(args.host ?? process.env.PLATFORM_MARKETING_HOST_ID ?? '').trim()
  if (!hostId) {
    console.error('Name the marketing host: --host=<id> or PLATFORM_MARKETING_HOST_ID. NOTHING WAS WRITTEN.')
    process.exit(2)
  }
  const internalDomain = String(args.internalDomain ?? '').trim().toLowerCase()

  const { default: firebaseAdmin } = await loadServerLib('libs/tenant/data/admin/src/lib/server/firebase-admin.ts')
  const { recordPlatformAccountContact } = await loadServerLib(
    'libs/tenant/data/admin/src/lib/server/platform-marketing-consent.ts',
  )
  const app = firebaseAdmin.app()
  const db = app.firestore()
  const auth = app.auth()

  const host = await db.collection('hosts').doc(hostId).get()
  const orgId = host.exists ? String(host.get('orgId') ?? '') : ''
  if (!orgId) {
    console.error(`Host ${hostId} has no organization. NOTHING WAS WRITTEN.`)
    process.exit(2)
  }
  const contacts = db.collection('orgs').doc(orgId).collection('contacts')
  const known = new Set()
  for (const doc of (await contacts.select('email').get()).docs) {
    const email = String(doc.get('email') ?? '').trim().toLowerCase()
    if (email) known.add(email)
  }

  const pools = [{ tenantId: null, auth }]
  let pageToken
  do {
    const page = await auth.tenantManager().listTenants(100, pageToken)
    for (const tenant of page.tenants) {
      pools.push({ tenantId: tenant.tenantId, auth: auth.tenantManager().authForTenant(tenant.tenantId) })
    }
    pageToken = page.pageToken
  } while (pageToken)

  const planned = new Map()
  const internal = []
  let read = 0
  let disabled = 0
  let noEmail = 0
  for (const pool of pools) {
    for await (const record of everyUser(pool.auth)) {
      read += 1
      const email = String(record.email ?? '').trim().toLowerCase()
      if (!email) {
        noEmail += 1
        continue
      }
      if (record.disabled) {
        disabled += 1
        continue
      }
      if (known.has(email) || planned.has(email)) continue
      const row = {
        pool: pool.tenantId ?? 'project',
        uid: record.uid,
        email,
        name: record.displayName ?? '',
        createdAtMs: Date.parse(record.metadata.creationTime),
      }
      if (internalDomain && email.endsWith(`@${internalDomain}`) && !args.includeInternal) {
        internal.push(row)
        continue
      }
      planned.set(email, row)
    }
  }

  const rows = [...planned.values()].sort((a, b) => a.createdAtMs - b.createdAtMs)
  console.log(
    `Accounts read: ${read}. Already contacts: ${known.size} addresses. No address: ${noEmail}. ` +
      `Disabled: ${disabled}. Internal, left out: ${internal.length}. To add: ${rows.length}.`,
  )
  for (const row of rows) {
    console.log(`  + ${new Date(row.createdAtMs).toISOString().slice(0, 10)}  ${row.email}  ${row.name}`)
  }
  if (args.out) {
    const lines = ['created,email,name,pool,uid']
    for (const row of rows) {
      lines.push([new Date(row.createdAtMs).toISOString(), row.email, row.name, row.pool, row.uid].map(csvCell).join(','))
    }
    writeFileSync(String(args.out), `${lines.join('\n')}\n`)
    console.log(`Rows written to ${args.out}`)
  }
  if (!write) {
    console.log('Dry run — nothing was written. Re-run with --write.')
    return
  }

  const outcomes = {}
  for (const row of rows) {
    // A contact created since the read above wins.
    const again = await contacts.where('email', '==', row.email).limit(1).get()
    if (!again.empty) {
      outcomes.raced = (outcomes.raced ?? 0) + 1
      continue
    }
    const result = await recordPlatformAccountContact({
      uid: row.uid,
      email: row.email,
      name: row.name,
      createdAtMs: row.createdAtMs,
      hostId,
      firestore: db,
    })
    const key = result.status === 'refused' ? `refused:${result.reason}` : result.status
    outcomes[key] = (outcomes[key] ?? 0) + 1
  }
  console.log('Written:', JSON.stringify(outcomes))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
