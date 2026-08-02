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
 * Listing `hosts` needs a membership constraint (AGL-1145).
 *
 * The rule on `/hosts/{hostId}` is per-document:
 *
 *     allow read: if isStaff() || (isSignedIn() &&
 *       resource.data.get('memberRoles', {}).get(request.auth.uid, null) != null);
 *
 * AGL-1145 raised two possible consequences of querying it with only an
 * `orgId` filter and could not say which one bites: a live functional break
 * for scoped collaborators, or a latent cache-poisoning risk. They point at
 * different fixes, so this settles it before anything changes.
 *
 * Firestore evaluates a LIST against the QUERY, not the results — it will not
 * run a query that *could* return a document the rule denies, even if today's
 * data happens to contain none. So the answer should be the harsh one, and the
 * fix should be the query filter rather than a server round-trip.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main   (in cloud/)
 *   node cloud/hosts-list-constraint.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  limit,
} from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: '127.0.0.1',
    port: 8082,
    rules: readFileSync('cloud/firebase-firestore.rules', 'utf8'),
  },
})

const results = []
const check = async (label, fn) => {
  try {
    await fn()
    results.push(['ok  ', label])
  } catch (error) {
    results.push(['FAIL', label, String(error).slice(0, 160)])
  }
}

const ORG = 'org-1'
const COLLABORATOR = 'uid-collaborator'
const ROLES = ['admin', 'editor', 'viewer']

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  // The org has two sites. The collaborator is on exactly one — which is what
  // "scoped collaborator" means, and the case the console's own orgs happen
  // not to have, which is why this went unnoticed.
  await setDoc(doc(db, 'hosts', 'host-mine'), {
    orgId: ORG,
    name: 'Mine',
    memberRoles: { [COLLABORATOR]: 'editor' },
  })
  await setDoc(doc(db, 'hosts', 'host-theirs'), {
    orgId: ORG,
    name: 'Theirs',
    memberRoles: { 'uid-someone-else': 'admin' },
  })
})

const asCollaborator = env.authenticatedContext(COLLABORATOR).firestore()
const asStaff = env.authenticatedContext('uid-staff', { staff: true }).firestore()

const byOrgOnly = (db) =>
  query(collection(db, 'hosts'), where('orgId', '==', ORG), limit(200))

const byOrgAndMembership = (db, uid) =>
  query(
    collection(db, 'hosts'),
    where(`memberRoles.${uid}`, 'in', ROLES),
    where('orgId', '==', ORG),
    limit(200),
  )

// THE QUESTION AGL-1145 ASKS.
await check(
  'an orgId-only list is DENIED OUTRIGHT for a scoped collaborator',
  () => assertFails(getDocs(byOrgOnly(asCollaborator))),
)

await check(
  'the membership-constrained list succeeds, and returns only their site',
  async () => {
    const snap = await assertSucceeds(
      getDocs(byOrgAndMembership(asCollaborator, COLLABORATOR)),
    )
    const names = snap.docs.map((d) => d.id)
    if (names.length !== 1 || names[0] !== 'host-mine') {
      throw new Error(`expected only host-mine, got ${JSON.stringify(names)}`)
    }
  },
)

// The negative control for the whole finding. If an orgId-only list also
// failed for staff, the cause would be something other than the membership
// rule and the fix above would be aimed at the wrong thing.
await check('staff may still list by orgId alone — the isStaff branch', () =>
  assertSucceeds(getDocs(byOrgOnly(asStaff))),
)

// Why the console's orgs never showed this: when the caller happens to be on
// EVERY site, the unconstrained query still fails. It is the query shape that
// is rejected, not the result set — so "it works for me" was never evidence.
await check(
  'an orgId-only list fails even for someone on every site in the org',
  async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'hosts', 'host-theirs'), {
        orgId: ORG,
        name: 'Theirs',
        memberRoles: { 'uid-someone-else': 'admin', [COLLABORATOR]: 'admin' },
      })
    })
    await assertFails(getDocs(byOrgOnly(asCollaborator)))
  },
)

await env.cleanup()

for (const row of results) console.log(row.join(' '))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
