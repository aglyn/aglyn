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
 * Accounting (AGL-3614): nobody reads or writes a workspace's ledger
 * connection, its sync log or its pending OAuth states from a client — not
 * the owner, not an admin, not staff.
 *
 * `orgs/{orgId}/accountingConnections` holds the sealed grant to the
 * business's QuickBooks or Xero books; `accountingSyncItems` holds the order
 * snapshots each posting was made from; `accountingOAuthStates` is the
 * pending record that makes a connect single-use. No rule names any of them
 * and the org block has no catch-all, so each is refused by default, and the
 * console reads them only through the accounting plugin's routes. These rows
 * prove that default reaches them, so a wildcard added to the org block one
 * day cannot quietly open them.
 *
 * The control row — the owner reading the org document itself — keeps the
 * suite from passing against an emulator that refuses everything.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-accounting.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-accounting-test'
const OWNER = 'uid-accounting-owner'
const ADMIN = 'uid-accounting-admin'
const STAFF = 'uid-accounting-staff'

const COLLECTIONS = [
  {
    name: 'accountingConnections',
    id: 'quickbooks',
    data: { provider: 'quickbooks', status: 'connected', sealedRefreshToken: 'sb1.fixture.not.a.real.token' },
  },
  {
    name: 'accountingSyncItems',
    id: 'sale_host_order',
    data: { kind: 'sale', status: 'synced', amountCents: 4930 },
  },
  {
    name: 'accountingOAuthStates',
    id: 'state-accounting-owner',
    data: { orgId: ORG, uid: OWNER, nonceDigest: 'digest', expiresAtMs: Date.now() + 600_000 },
  },
]

const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082').split(':')

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: emulatorHost,
    port: Number(emulatorPort),
    // The comment-stripped artifact is what deploys (AGL-3544).
    rules: readFileSync('cloud/firebase-firestore.deploy.rules', 'utf8'),
  },
})

const results = []
const check = async (label, fn) => {
  try {
    await fn()
    results.push(['PASS', label])
  } catch (error) {
    results.push(['FAIL', label, String(error).slice(0, 160)])
  }
}

const docOf = (db, { name, id }) => doc(db, 'orgs', ORG, name, id)

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), {
    name: 'Accounting Test',
    slug: 'accounting-test',
    plan: 'business',
    ownerUid: OWNER,
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', ADMIN), {
    role: 'admin',
    allHosts: true,
    resolvedPermissions: { 'accounting.manage': true },
  })
  for (const entry of COLLECTIONS) await setDoc(docOf(db, entry), entry.data)
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
const readers = [
  ['the OWNER', () => as(OWNER)],
  ['an ADMIN holding accounting.manage', () => as(ADMIN)],
  ['STAFF', () => as(STAFF, { staff: true })],
  ['a signed-out visitor', () => env.unauthenticatedContext().firestore()],
]

await check('control: the owner reads the organization itself', () => assertSucceeds(getDoc(doc(as(OWNER), 'orgs', ORG))))

for (const entry of COLLECTIONS) {
  for (const [who, db] of readers) {
    await check(`${entry.name}: ${who} cannot get a document`, () => assertFails(getDoc(docOf(db(), entry))))
    await check(`${entry.name}: ${who} cannot list the collection`, () =>
      assertFails(getDocs(collection(db(), 'orgs', ORG, entry.name))),
    )
    await check(`${entry.name}: ${who} cannot create a document`, () =>
      assertFails(setDoc(docOf(db(), { name: entry.name, id: `${entry.id}-new` }), entry.data)),
    )
    await check(`${entry.name}: ${who} cannot change a document`, () =>
      assertFails(updateDoc(docOf(db(), entry), { status: 'pending' })),
    )
    await check(`${entry.name}: ${who} cannot delete a document`, () => assertFails(deleteDoc(docOf(db(), entry))))
  }
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const entry of COLLECTIONS) {
    await deleteDoc(docOf(db, entry))
    await deleteDoc(docOf(db, { name: entry.name, id: `${entry.id}-new` }))
  }
  for (const uid of [OWNER, ADMIN]) await deleteDoc(doc(db, 'orgs', ORG, 'members', uid))
  await deleteDoc(doc(db, 'orgs', ORG))
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
