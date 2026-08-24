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
// THE RE-RUN PATH, not the only trigger (AGL-2254). This header used to say
// "no route or UI writes `org.sso` at all — `sso.enforced` has no writer in
// the codebase (verified 2026-07-30)", and asked that the staff surface call
// `enforceSsoSignInMethods` inline when it landed. It landed, and it does:
//
//   apps/console/app/api/orgs/sso/route.ts
//     action 'enforce-preview' -> dry-run rehearsal (force: true)
//     action 'enforce-apply'   -> sets sso.enforced = true, THEN sweeps
//     action 'enforce-off'     -> sets sso.enforced = false
//
// with `apps/console/components/org-sso-card.component.tsx` rendering all
// three. AGL-1210 shipped that two weeks before this comment was corrected,
// so the claim was false for the whole of that time — and it is the kind of
// false claim that costs more than it looks: a capability audit grepping for
// writers of `sso.enforced` reads "no writer in the codebase" and files SSO
// enforcement as an unbuilt feature. One did.
//
// THIS SCRIPT NO LONGER WRITES ANYTHING (AGL-1888). It reports, and that is
// all it can do.
//
// It used to take `--commit` and perform the sweep itself, mirroring
// `libs/tenant/data/admin/src/lib/server/sso-enforcement.ts`. The mirror had
// drifted into something dangerous, in two ways that compound:
//
//  1. **No lockout pre-flight, and never any.** `enforceSsoSignInMethods`
//     refuses to strip a pool unless the org keeps a way in the IdP does not
//     mediate. This script asked no such question, so `--commit` was a way to
//     walk straight past the control the console cannot be made to skip — on
//     an org the console would have refused.
//  2. **It ignored `sso.breakGlassUids`.** The engine deliberately spares a
//     DESIGNATED break-glass account. This script did not know the field
//     existed, so a re-run would unlink the password off precisely the account
//     the org had nominated as its spare key, and report it as ordinary
//     convergence.
//
// The obvious repair — copy the pre-flight in here — is the wrong one. Two
// copies of a security control diverge, and the laxer copy is the one that
// decides. So the write path is gone instead, and the sweep has exactly one
// implementation, behind the guard, at:
//
//   apps/console/app/api/orgs/sso/route.ts
//     action 'enforce-preview' -> dry-run rehearsal (force: true)
//     action 'enforce-apply'   -> pre-flight, then sso.enforced = true, then sweep
//     action 'enforce-off'     -> sets sso.enforced = false
//
// Nothing is lost by this. `enforce-apply` is idempotent and re-sweeps an
// already-enforced org, which is what the re-run was for; `enforce-preview` is
// the rehearsal; both walk the same 1000-account page this did. What remains
// here is the diagnostic that has no console equivalent: a per-account view of
// the pool read straight from the Admin SDK, for when the question is "what is
// actually in this tenant" rather than "make it so".
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/enforce-sso-signin.mjs --org <orgId>

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

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

if (!ORG_ID) {
  console.error('Usage: node tools/scripts/enforce-sso-signin.mjs --org <orgId>')
  process.exit(1)
}
// Refuse the removed flags rather than ignoring them. Somebody with the old
// invocation in their shell history must not get a silent dry run they read as
// a completed sweep — the failure mode of a no-op that looks like a success is
// exactly what this script is being pulled back from.
for (const removed of ['--commit', '--force', '--actor']) {
  if (flag(removed)) {
    console.error(
      `${removed} no longer exists — this script cannot write (AGL-1888).\n` +
        'Run enforcement from the organization\'s Single sign-on card, which\n' +
        'carries the lockout pre-flight this script never had.',
    )
    process.exit(1)
  }
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
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
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

// The org's DESIGNATED break-glass accounts (AGL-1888). Reported because the
// engine spares them: a report that omitted them would describe a sweep the
// console will not perform, which is how this script's output stopped matching
// its behaviour in the first place.
const breakGlass = new Set(
  Array.isArray(sso.breakGlassUids) ? sso.breakGlassUids.map(String) : [],
)

console.log(
  `\nSSO pool report (READ-ONLY) — project=${projectId} org=${ORG_ID} ` +
    `tenant=${sso.tenantId} idp=${sso.providerId} ` +
    `enforced=${Boolean(sso.enforced)} ` +
    `break-glass designations=${breakGlass.size}\n`,
)

const pool = auth.tenantManager().authForTenant(sso.tenantId)
const page = await pool.listUsers(1000)
let wouldChange = 0
/** Accounts holding a credential the org's IdP does not mediate. */
let retainNonIdp = 0

for (const record of page.users) {
  const providers = (record.providerData ?? [])
    .map((info) => info?.providerId)
    .filter(Boolean)
  const removable = providers.filter((id) => id !== sso.providerId)
  const kept = providers.filter((id) => id === sso.providerId)
  const label = `${record.uid} (${record.email ?? 'no email'})`

  if (!removable.length) {
    console.log(`  ok         ${label} — [${providers.join(', ') || 'none'}]`)
    continue
  }
  // A DESIGNATED break-glass account keeps everything. The engine skips it;
  // this report used to say it would be stripped, which is the opposite of
  // what happens and the more alarming of the two directions to be wrong in.
  if (breakGlass.has(record.uid)) {
    console.log(
      `  BREAKGLASS ${label} — designated; keeps [${providers.join(', ')}]`,
    )
    retainNonIdp += 1
    continue
  }
  // Never unlink down to zero: an account with nothing but removable
  // providers is misconfigured, not a bypass, and stripping it orphans it.
  if (!kept.length) {
    console.log(
      `  SKIP       ${label} — would orphan; its only providers are ` +
        `[${providers.join(', ')}] and none is ${sso.providerId}`,
    )
    continue
  }
  console.log(
    `  would      ${label} — remove [${removable.join(', ')}], ` +
      `keep [${kept.join(', ')}]`,
  )
  wouldChange += 1
}

console.log(
  `\nScanned ${page.users.length} account(s); ${wouldChange} would change; ` +
    `${retainNonIdp} designated account(s) would retain a non-IdP credential.` +
    `${page.pageToken ? '\nWARNING: more accounts remain — the console sweeps the same 1000.' : ''}` +
    '\n\nThis script cannot write. Enforcement runs from the organization\'s' +
    '\nSingle sign-on card, which refuses to strip a pool that would leave the' +
    '\norganization with no way in (AGL-1888). This report does NOT run that' +
    '\npre-flight: it counts designations, it does not check for an org owner' +
    '\noutside the pool, so it cannot tell you whether enforcement will be' +
    '\nallowed. Use the card\'s rehearsal for that.\n',
)
