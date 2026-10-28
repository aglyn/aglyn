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
 * POS hardware orders (AGL-4038): `orgs/{orgId}/hardwareOrders` is written by
 * the commerce plugin's webhook and staff route only, so NO client writes one —
 * not the owner, not an admin, not staff. Reads are open to staff, to an
 * org-wide member who may run the register, and to an org-wide member granted
 * "Buy point of sale hardware" without it (AGL-4047); a site-scoped
 * collaborator (granted it or not), a viewer, an editor whose `managePos` is
 * switched off, a member of another workspace and a signed-out visitor are
 * refused.
 *
 * The retained sale records beside them, `posHardwareSales/{orderId}`, are
 * the platform's tax and accounting records and outlive the workspace: NO
 * client reads, lists or writes one — not the buying workspace's owner, and
 * not staff, who read them through the server.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-pos-hardware.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-pos-hardware-test'
const OTHER_ORG = 'org-pos-hardware-other'
const OWNER = 'uid-hw-owner'
const ADMIN = 'uid-hw-admin'
const EDITOR = 'uid-hw-editor'
const EDITOR_NO_POS = 'uid-hw-editor-no-pos'
const VIEWER = 'uid-hw-viewer'
const BUYER = 'uid-hw-buyer'
const BUYER_OVERRIDE = 'uid-hw-buyer-override'
const SCOPED = 'uid-hw-scoped'
const SCOPED_BUYER = 'uid-hw-scoped-buyer'
const OUTSIDER = 'uid-hw-outsider'
const STAFF = 'uid-hw-staff'
const ORDER = 'hw_0123456789abcdef0123'
const ORDER_DATA = {
  orgId: ORG,
  hostId: 'host-hw',
  status: 'paid',
  totalCents: 12345,
  lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 12345, lineCents: 12345 }],
  createdAtMs: 1,
}

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

const orderRef = (db, id = ORDER) => doc(db, 'orgs', ORG, 'hardwareOrders', id)
const saleRef = (db, id = ORDER) => doc(db, 'posHardwareSales', id)
const SALE_DATA = {
  orderId: ORDER,
  orgId: ORG,
  status: 'paid',
  taxCents: 0,
  totalCents: 12345,
  shipTo: { country: 'US', state: 'TX', postalCode: '78701' },
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), { name: 'Hardware Test', slug: 'hardware-test', plan: 'business', ownerUid: OWNER })
  await setDoc(doc(db, 'orgs', OTHER_ORG), { name: 'Other', slug: 'other', plan: 'business', ownerUid: OUTSIDER })
  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', ADMIN), { role: 'admin', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', EDITOR), { role: 'editor', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', EDITOR_NO_POS), {
    role: 'editor',
    allHosts: true,
    permissions: { managePos: false },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', VIEWER), { role: 'viewer', allHosts: true })
  // A bookkeeper: granted the hardware shop by a role, without the register.
  await setDoc(doc(db, 'orgs', ORG, 'members', BUYER), {
    role: 'viewer',
    allHosts: true,
    resolvedPermissions: { managePos: false, posBuyHardware: true },
  })
  // The same, by their own override, before the projection reached them.
  await setDoc(doc(db, 'orgs', ORG, 'members', BUYER_OVERRIDE), {
    role: 'viewer',
    allHosts: true,
    permissions: { posBuyHardware: true },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', SCOPED), {
    role: 'editor',
    allHosts: false,
    hostAccess: { 'host-hw': 'editor' },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', SCOPED_BUYER), {
    role: 'viewer',
    allHosts: false,
    hostAccess: { 'host-hw': 'viewer' },
    resolvedPermissions: { posBuyHardware: true },
  })
  await setDoc(doc(db, 'orgs', OTHER_ORG, 'members', OUTSIDER), { role: 'owner', allHosts: true })
  await setDoc(orderRef(db), ORDER_DATA)
  await setDoc(saleRef(db), SALE_DATA)
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()

const mayRead = [
  ['the OWNER', () => as(OWNER)],
  ['an ADMIN', () => as(ADMIN)],
  ['an org-wide EDITOR', () => as(EDITOR)],
  ['an org-wide member granted buying hardware without the register', () => as(BUYER)],
  ['an org-wide member granted buying hardware by their own override', () => as(BUYER_OVERRIDE)],
  ['STAFF', () => as(STAFF, { staff: true })],
]
const mayNotRead = [
  ['an editor whose managePos is off', () => as(EDITOR_NO_POS)],
  ['a VIEWER', () => as(VIEWER)],
  ['a site-scoped collaborator', () => as(SCOPED)],
  ['a site-scoped collaborator granted buying hardware', () => as(SCOPED_BUYER)],
  ['a member of another workspace', () => as(OUTSIDER)],
  ['a signed-out visitor', () => env.unauthenticatedContext().firestore()],
]

await check('control: the owner reads the organization itself', () => assertSucceeds(getDoc(doc(as(OWNER), 'orgs', ORG))))

for (const [who, db] of mayRead) {
  await check(`${who} reads an order`, () => assertSucceeds(getDoc(orderRef(db()))))
  await check(`${who} lists the orders`, () => assertSucceeds(getDocs(collection(db(), 'orgs', ORG, 'hardwareOrders'))))
}
for (const [who, db] of mayNotRead) {
  await check(`${who} cannot read an order`, () => assertFails(getDoc(orderRef(db()))))
  await check(`${who} cannot list the orders`, () =>
    assertFails(getDocs(collection(db(), 'orgs', ORG, 'hardwareOrders'))),
  )
}
for (const [who, db] of [...mayRead, ...mayNotRead]) {
  await check(`${who} cannot create an order`, () =>
    assertFails(setDoc(orderRef(db(), 'hw_ffffffffffffffffffff'), ORDER_DATA)),
  )
  await check(`${who} cannot mark an order shipped`, () =>
    assertFails(updateDoc(orderRef(db()), { status: 'shipped', tracking: { carrier: 'UPS', number: '1Z' } })),
  )
  await check(`${who} cannot delete an order`, () => assertFails(deleteDoc(orderRef(db()))))
}

for (const [who, db] of [...mayRead, ...mayNotRead]) {
  await check(`${who} cannot read a retained sale record`, () => assertFails(getDoc(saleRef(db()))))
  await check(`${who} cannot list the retained sale records`, () =>
    assertFails(getDocs(collection(db(), 'posHardwareSales'))),
  )
  await check(`${who} cannot create a sale record`, () =>
    assertFails(setDoc(saleRef(db(), 'hw_ffffffffffffffffffff'), SALE_DATA)),
  )
  await check(`${who} cannot change a sale record`, () => assertFails(updateDoc(saleRef(db()), { totalCents: 1 })))
  await check(`${who} cannot delete a sale record`, () => assertFails(deleteDoc(saleRef(db()))))
  // 4G (AGL-4038): server-only, for every client.
  for (const name of ['posCellularReaders', 'posCellularCharges']) {
    await check(`${who} cannot read ${name}`, () => assertFails(getDoc(doc(db(), name, 'host-hw_tmr_1'))))
    await check(`${who} cannot list ${name}`, () => assertFails(getDocs(collection(db(), name))))
    await check(`${who} cannot write ${name}`, () =>
      assertFails(setDoc(doc(db(), name, 'host-hw_tmr_2'), { orgId: ORG, enabled: true })),
    )
  }
}
// The record outlives the workspace: with the org and its roster gone, it
// is still unreadable to the former owner.
await env.withSecurityRulesDisabled(async (context) => {
  await deleteDoc(doc(context.firestore(), 'orgs', ORG, 'members', OWNER))
})
await check('the former owner of an erased workspace cannot read its sale record', () =>
  assertFails(getDoc(saleRef(as(OWNER)))),
)

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await deleteDoc(orderRef(db))
  await deleteDoc(saleRef(db))
  for (const uid of [OWNER, ADMIN, EDITOR, EDITOR_NO_POS, VIEWER, BUYER, BUYER_OVERRIDE, SCOPED, SCOPED_BUYER]) {
    await deleteDoc(doc(db, 'orgs', ORG, 'members', uid))
  }
  await deleteDoc(doc(db, 'orgs', OTHER_ORG, 'members', OUTSIDER))
  await deleteDoc(doc(db, 'orgs', ORG))
  await deleteDoc(doc(db, 'orgs', OTHER_ORG))
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
