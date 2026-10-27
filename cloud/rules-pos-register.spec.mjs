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
 * A register sale's receipt (AGL-4047): the POS routes decide on the
 * register's keys alone, not the site role, so a site viewer the workspace
 * grants `posSell` rings a sale — and the register then reads that order back
 * for its receipt (`hosts/{hostId}/orders/{orderId}`). The rules admit that
 * read for a `pos` order to a member of the site whose resolved permissions
 * say `posSell`, and to nobody else they did not admit already:
 *
 *   - a site admin or editor reads every order, as before;
 *   - a site viewer granted `posSell` (stamped, or by their own override)
 *     reads a REGISTER sale, never an online order;
 *   - a site viewer without it, one refused it, an org member who cannot
 *     reach the site, a member of another workspace and a signed-out visitor
 *     read neither;
 *   - nobody gains a write.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-pos-register.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-pos-register-test'
const OTHER_ORG = 'org-pos-register-other'
const HOST = 'host-pos-register'
const OTHER_HOST = 'host-pos-register-other'
const ADMIN = 'uid-reg-admin'
const EDITOR = 'uid-reg-editor'
const VIEWER = 'uid-reg-viewer'
const VIEWER_SELLS = 'uid-reg-viewer-sells'
const VIEWER_OVERRIDE = 'uid-reg-viewer-override'
const VIEWER_REFUSED = 'uid-reg-viewer-refused'
const ELSEWHERE = 'uid-reg-elsewhere'
const OUTSIDER = 'uid-reg-outsider'
const POS_ORDER = 'order-pos-1'
const ONLINE_ORDER = 'order-online-1'

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

const SELLS = { managePos: true, posSell: true }

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), { name: 'Register Test', slug: 'register-test', plan: 'business', ownerUid: ADMIN })
  await setDoc(doc(db, 'orgs', OTHER_ORG), { name: 'Other', slug: 'other', plan: 'business', ownerUid: OUTSIDER })
  await setDoc(doc(db, 'orgs', ORG, 'members', ADMIN), { role: 'admin', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', EDITOR), { role: 'editor', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', VIEWER), { role: 'viewer', allHosts: true })
  // Granted the register by a custom role: the projection stamped it.
  await setDoc(doc(db, 'orgs', ORG, 'members', VIEWER_SELLS), {
    role: 'viewer',
    allHosts: true,
    resolvedPermissions: SELLS,
  })
  // Granted by their own override, on a member the projection has not reached.
  await setDoc(doc(db, 'orgs', ORG, 'members', VIEWER_OVERRIDE), {
    role: 'viewer',
    allHosts: true,
    permissions: SELLS,
  })
  // The register, with the sell key refused.
  await setDoc(doc(db, 'orgs', ORG, 'members', VIEWER_REFUSED), {
    role: 'viewer',
    allHosts: false,
    hostAccess: { [HOST]: 'viewer' },
    resolvedPermissions: { managePos: true, posSell: false },
  })
  // Granted the register, on another site of the workspace only.
  await setDoc(doc(db, 'orgs', ORG, 'members', ELSEWHERE), {
    role: 'viewer',
    allHosts: false,
    hostAccess: { [OTHER_HOST]: 'viewer' },
    resolvedPermissions: SELLS,
  })
  await setDoc(doc(db, 'orgs', OTHER_ORG, 'members', OUTSIDER), {
    role: 'owner',
    allHosts: true,
    resolvedPermissions: SELLS,
  })
  await setDoc(doc(db, 'hosts', HOST), {
    orgId: ORG,
    memberRoles: {
      [ADMIN]: 'admin',
      [EDITOR]: 'editor',
      [VIEWER]: 'viewer',
      [VIEWER_SELLS]: 'viewer',
      [VIEWER_OVERRIDE]: 'viewer',
      [VIEWER_REFUSED]: 'viewer',
    },
  })
  await setDoc(doc(db, 'hosts', OTHER_HOST), { orgId: ORG, memberRoles: { [ADMIN]: 'admin', [ELSEWHERE]: 'viewer' } })
  await setDoc(doc(db, 'hosts', HOST, 'orders', POS_ORDER), {
    status: 'paid',
    channel: 'pos',
    registerId: 'front',
    totals: { totalCents: 500 },
  })
  await setDoc(doc(db, 'hosts', HOST, 'orders', ONLINE_ORDER), {
    status: 'paid',
    channel: 'online',
    email: 'shopper@example.com',
    totals: { totalCents: 1200 },
  })
})

const as = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore()
const order = (db, id) => doc(db, 'hosts', HOST, 'orders', id)

await check('control: the admin reads the site itself', () => assertSucceeds(getDoc(doc(as(ADMIN), 'hosts', HOST))))

for (const [who, uid] of [
  ['a site ADMIN', ADMIN],
  ['a site EDITOR', EDITOR],
]) {
  await check(`${who} reads a register sale`, () => assertSucceeds(getDoc(order(as(uid), POS_ORDER))))
  await check(`${who} reads an online order`, () => assertSucceeds(getDoc(order(as(uid), ONLINE_ORDER))))
}

for (const [who, uid] of [
  ['a site viewer a role granted the register', VIEWER_SELLS],
  ['a site viewer granted the register by their own override', VIEWER_OVERRIDE],
]) {
  await check(`${who} reads a register sale`, () => assertSucceeds(getDoc(order(as(uid), POS_ORDER))))
  await check(`${who} cannot read an online order`, () => assertFails(getDoc(order(as(uid), ONLINE_ORDER))))
  await check(`${who} cannot change a register sale`, () =>
    assertFails(updateDoc(order(as(uid), POS_ORDER), { status: 'refunded' })),
  )
  await check(`${who} cannot add a note to a register sale`, () =>
    assertFails(updateDoc(order(as(uid), POS_ORDER), { timeline: [] })),
  )
  await check(`${who} cannot mint an order`, () =>
    assertFails(setDoc(order(as(uid), 'minted'), { status: 'paid', channel: 'pos' })),
  )
  await check(`${who} cannot delete a register sale`, () => assertFails(deleteDoc(order(as(uid), POS_ORDER))))
}

for (const [who, db] of [
  ['a site viewer never granted the register', () => as(VIEWER)],
  ['a site viewer refused the sell key', () => as(VIEWER_REFUSED)],
  ['a member granted the register on another site only', () => as(ELSEWHERE)],
  ['a member of another workspace', () => as(OUTSIDER)],
  ['a signed-out visitor', () => env.unauthenticatedContext().firestore()],
]) {
  await check(`${who} cannot read a register sale`, () => assertFails(getDoc(order(db(), POS_ORDER))))
  await check(`${who} cannot read an online order`, () => assertFails(getDoc(order(db(), ONLINE_ORDER))))
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const id of [POS_ORDER, ONLINE_ORDER]) await deleteDoc(doc(db, 'hosts', HOST, 'orders', id))
  await deleteDoc(doc(db, 'hosts', HOST))
  await deleteDoc(doc(db, 'hosts', OTHER_HOST))
  for (const uid of [ADMIN, EDITOR, VIEWER, VIEWER_SELLS, VIEWER_OVERRIDE, VIEWER_REFUSED, ELSEWHERE]) {
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
