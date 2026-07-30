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

// Strip non-IdP sign-in methods from every account in an org's SSO tenant
// (AGL-1129), for an org that has turned on `sso.enforced`.
//
// This is the ONLY trigger today. The issue assumed a staff SSO-config save
// would call the sweep inline, but no route or UI writes `org.sso` at all —
// aglyn-org's block was written by hand, and `sso.enforced` has no writer in
// the codebase (verified 2026-07-30). When that staff surface lands it should
// call `enforceSsoSignInMethods` directly and keep this as the re-run path;
// a sweep is wanted regardless, for accounts that arrive after the flip.
//
// Mirrors libs/tenant/data/admin/src/lib/server/sso-enforcement.ts, which
// holds the logic and the reasoning. Dry-run by default. Idempotent: a second
// run reports 0 changed rather than revoking anyone's tokens a second time.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/enforce-sso-signin.mjs --org <orgId> [--commit] \
//       [--actor <uid>] [--force]
//
// --force runs even when `sso.enforced` is false. ONLY for a rehearsal
// against a throwaway account: the flag is the customer's instruction, and
// acting without it removes sign-in methods nobody asked us to remove.

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

function loadLocalEnv() {
  const roots = ['.', 'apps/console', 'cloud']
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ]
  for (const file of roots.flatMap((r) => names.map((n) => `${r}/${n}`))) {
    if (!existsSync(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
loadLocalEnv()

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : fallback
}

const ORG_ID = opt('--org', '')
const COMMIT = flag('--commit')
const FORCE = flag('--force')
const ACTOR = opt('--actor', 'system')

if (!ORG_ID) {
  console.error('Usage: node tools/scripts/enforce-sso-signin.mjs --org <orgId> [--commit] [--force]')
  process.exit(1)
}

const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) {
  console.error('Missing FIREBASE_PROJECT_ID env var')
  process.exit(1)
}
if (!getApps().length) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    console.error('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
    process.exit(1)
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore()
const auth = getAuth()

const orgSnapshot = await firestore.collection('orgs').doc(ORG_ID).get()
if (!orgSnapshot.exists) {
  console.error(`No such organization: ${ORG_ID}`)
  process.exit(1)
}
const sso = orgSnapshot.get('sso') ?? {}
if (!sso.tenantId || !sso.providerId) {
  console.error(`${ORG_ID} has no SSO tenant configured`)
  process.exit(1)
}
if (sso.status !== 'active') {
  console.error(`${ORG_ID} SSO status is "${sso.status ?? 'unset'}", not active`)
  process.exit(1)
}
if (!sso.enforced && !FORCE) {
  console.error(
    `${ORG_ID} has sso.enforced = false — nothing to enforce. ` +
      'Pass --force only to rehearse against a throwaway account.',
  )
  process.exit(1)
}

console.log(
  `\nSSO enforcement sweep — project=${projectId} org=${ORG_ID} ` +
    `tenant=${sso.tenantId} idp=${sso.providerId} ` +
    `enforced=${Boolean(sso.enforced)}${FORCE ? ' (FORCED)' : ''} ` +
    `mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

const pool = auth.tenantManager().authForTenant(sso.tenantId)
const page = await pool.listUsers(1000)
const changed = []

for (const record of page.users) {
  const providers = (record.providerData ?? [])
    .map((info) => info?.providerId)
    .filter(Boolean)
  const removable = providers.filter((id) => id !== sso.providerId)
  const kept = providers.filter((id) => id === sso.providerId)
  const label = `${record.uid} (${record.email ?? 'no email'})`

  if (!removable.length) {
    console.log(`  ok      ${label} — [${providers.join(', ') || 'none'}]`)
    continue
  }
  // Never unlink down to zero: an account with nothing but removable
  // providers is misconfigured, not a bypass, and stripping it orphans it.
  if (!kept.length) {
    console.log(
      `  SKIP    ${label} — would orphan; its only providers are ` +
        `[${providers.join(', ')}] and none is ${sso.providerId}`,
    )
    continue
  }
  console.log(
    `  ${COMMIT ? 'unlink' : 'would '}  ${label} — remove ` +
      `[${removable.join(', ')}], keep [${kept.join(', ')}]`,
  )
  if (COMMIT) {
    await pool.updateUser(record.uid, { providersToUnlink: removable })
    await pool.revokeRefreshTokens(record.uid)
    await firestore.collection('adminAudit').add({
      actorUid: ACTOR,
      action: 'org.sso.enforceSignInMethods',
      target: `users/${record.uid}`,
      before: { providers },
      after: {
        providers: kept,
        orgId: ORG_ID,
        tenantId: sso.tenantId,
        unlinked: removable,
        tokensRevoked: true,
      },
      at: FieldValue.serverTimestamp(),
    })
  }
  changed.push(record.uid)
}

if (COMMIT && changed.length) {
  const batch = firestore.batch()
  for (const uid of changed) {
    batch.set(firestore.collection('users').doc(uid).collection('notifications').doc(), {
      type: 'system.signInMethodRemoved',
      title: 'Your sign-in methods changed',
      body:
        'Your organization now requires single sign-on, so other sign-in ' +
        'methods have been removed from your account. Sign in through your ' +
        'organization instead.',
      orgId: ORG_ID,
      link: '/manage/user',
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
    })
  }
  await batch.commit()
}

console.log(
  `\nScanned ${page.users.length} account(s); ${changed.length} changed.` +
    `${page.pageToken ? '\nWARNING: more accounts remain — re-run.' : ''}` +
    `${COMMIT ? '' : '\nDry run — nothing was written. Pass --commit to apply.'}\n`,
)
