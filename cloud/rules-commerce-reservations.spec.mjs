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
 * A site's stays and what they book (AGL-4047): `hosts/{hostId}/reservations`
 * and `hosts/{hostId}/resources` are decided by "Manage reservations"
 * (`commerce.reservations`), not by the content-write role, and the key's
 * preset IS that role, so:
 *
 *   - with no stamp for the key (every site before the projection reaches
 *     it), a site Admin, Editor or Author writes and a Viewer, someone who
 *     cannot reach the site, an unverified member and a signed-out visitor
 *     do not: exactly the catch-all's `canWriteHostContent`;
 *   - with the site's stamp (`memberPermissions[uid]`), the stamp decides: a
 *     viewer a custom role granted it writes, an editor a role or the site
 *     refused it does not, and the catch-all does not write it back for them;
 *   - staff write while the site is frozen, members do not;
 *   - reads stay with the catch-all, and other content stays on it.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-commerce-reservations.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-stays-test'
const HOST = 'host-stays'
const FROZEN = 'host-stays-frozen'
const ADMIN = 'uid-stays-admin'
const EDITOR = 'uid-stays-editor'
const AUTHOR = 'uid-stays-author'
const VIEWER = 'uid-stays-viewer'
const VIEWER_GRANTED = 'uid-stays-viewer-granted'
const EDITOR_REFUSED = 'uid-stays-editor-refused'
const AUTHOR_OTHER_KEYS = 'uid-stays-author-other-keys'
const OUTSIDER = 'uid-stays-outsider'
const STAFF = 'uid-stays-staff'

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

const MEMBER_ROLES = {
  [ADMIN]: 'admin',
  [EDITOR]: 'editor',
  [AUTHOR]: 'author',
  [VIEWER]: 'viewer',
  [VIEWER_GRANTED]: 'viewer',
  [EDITOR_REFUSED]: 'editor',
  [AUTHOR_OTHER_KEYS]: 'author',
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), { name: 'Stays Test', slug: 'stays-test', plan: 'business', ownerUid: ADMIN })
  for (const [uid, role] of Object.entries(MEMBER_ROLES)) {
    await setDoc(doc(db, 'orgs', ORG, 'members', uid), {
      role: role === 'author' ? 'viewer' : role,
      allHosts: role !== 'author',
      ...(role === 'author' ? { hostAccess: { [HOST]: 'author' } } : {}),
    })
  }
  await setDoc(doc(db, 'hosts', HOST), {
    orgId: ORG,
    memberRoles: MEMBER_ROLES,
    // The site's stamp, as the projection writes it: a viewer a custom role
    // granted the key, an editor refused it, and an author whose stamp was
    // written before the key existed (other keys only).
    memberPermissions: {
      [VIEWER_GRANTED]: { 'commerce.reservations': true, 'commerce.walkIns': true },
      [EDITOR_REFUSED]: { 'commerce.reservations': false, 'commerce.walkIns': false },
      [AUTHOR_OTHER_KEYS]: { 'ai.use': true },
    },
  })
  await setDoc(doc(db, 'hosts', FROZEN), {
    orgId: ORG,
    memberRoles: { [EDITOR]: 'editor' },
    suspendedAt: new Date(),
  })
  for (const host of [HOST, FROZEN]) {
    await setDoc(doc(db, 'hosts', host, 'reservations', 'stay-1'), { resourceId: 'cabin', status: 'confirmed' })
    await setDoc(doc(db, 'hosts', host, 'resources', 'cabin'), { name: 'Cabin', nightlyRateUsd: 120 })
  }
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()

/** Every client write to a stay or a resource, for one caller. */
async function writes(db, host, id) {
  await setDoc(doc(db, 'hosts', host, 'reservations', `new-${id}`), { resourceId: 'cabin', status: 'confirmed' })
  await updateDoc(doc(db, 'hosts', host, 'reservations', 'stay-1'), { status: 'checked_in' })
  await setDoc(doc(db, 'hosts', host, 'resources', `res-${id}`), { name: 'Tent site', nightlyRateUsd: 20 })
  await updateDoc(doc(db, 'hosts', host, 'resources', 'cabin'), { nightlyRateUsd: 125 })
  await deleteDoc(doc(db, 'hosts', host, 'reservations', `new-${id}`))
  await deleteDoc(doc(db, 'hosts', host, 'resources', `res-${id}`))
}

/** No single client write to a stay or a resource lands for this caller. */
async function refused(db, host, id) {
  await assertFails(setDoc(doc(db, 'hosts', host, 'reservations', `new-${id}`), { resourceId: 'cabin', status: 'confirmed' }))
  await assertFails(updateDoc(doc(db, 'hosts', host, 'reservations', 'stay-1'), { status: 'cancelled' }))
  await assertFails(deleteDoc(doc(db, 'hosts', host, 'reservations', 'stay-1')))
  await assertFails(setDoc(doc(db, 'hosts', host, 'resources', `res-${id}`), { name: 'Tent site', nightlyRateUsd: 20 }))
  await assertFails(updateDoc(doc(db, 'hosts', host, 'resources', 'cabin'), { nightlyRateUsd: 1 }))
  await assertFails(deleteDoc(doc(db, 'hosts', host, 'resources', 'cabin')))
}

// With no stamp for the key: the content-write role, exactly.
for (const [label, uid] of [
  ['a site admin', ADMIN],
  ['a site editor', EDITOR],
  ['a site author', AUTHOR],
]) {
  await check(`${label} edits stays and resources, as the content-write role did`, () =>
    assertSucceeds(writes(as(uid), HOST, uid)),
  )
}
await check('a site viewer edits neither', () => refused(as(VIEWER), HOST, VIEWER))
await check('a member who cannot reach the site edits neither', () => refused(as(OUTSIDER), HOST, OUTSIDER))
await check('an unverified editor edits neither', () =>
  refused(env.authenticatedContext(EDITOR, { email_verified: false }).firestore(), HOST, 'unverified'),
)
await check('a signed-out visitor edits neither', () => refused(env.unauthenticatedContext().firestore(), HOST, 'anon'))

// With the site's stamp: the stamp decides, either way.
await check('a viewer the stamp grants "Manage reservations" edits stays and resources', () =>
  assertSucceeds(writes(as(VIEWER_GRANTED), HOST, VIEWER_GRANTED)),
)
await check('an editor the stamp refuses it edits neither, and the catch-all does not write it back', () =>
  refused(as(EDITOR_REFUSED), HOST, EDITOR_REFUSED),
)
await check('an author whose stamp predates the key falls back to the site role’s preset', () =>
  assertSucceeds(writes(as(AUTHOR_OTHER_KEYS), HOST, AUTHOR_OTHER_KEYS)),
)

// Frozen sites, staff.
await check('an editor writes nothing on a frozen site', () => refused(as(EDITOR), FROZEN, 'frozen'))
await check('staff write on a frozen site', () => assertSucceeds(writes(as(STAFF, { staff: true }), FROZEN, 'staff')))

// Reads and the rest of the site are unchanged.
await check('a site viewer still reads the stays and resources', async () => {
  await assertSucceeds(getDoc(doc(as(VIEWER), 'hosts', HOST, 'reservations', 'stay-1')))
  await assertSucceeds(getDoc(doc(as(VIEWER), 'hosts', HOST, 'resources', 'cabin')))
})
await check('someone who cannot reach the site reads neither', async () => {
  await assertFails(getDoc(doc(as(OUTSIDER), 'hosts', HOST, 'reservations', 'stay-1')))
  await assertFails(getDoc(doc(as(OUTSIDER), 'hosts', HOST, 'resources', 'cabin')))
})
await check('other site content stays on the content-write role', async () => {
  await assertSucceeds(setDoc(doc(as(EDITOR_REFUSED), 'hosts', HOST, 'notes', 'n1'), { text: 'hello' }))
  await assertFails(setDoc(doc(as(VIEWER_GRANTED), 'hosts', HOST, 'notes', 'n2'), { text: 'hello' }))
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const host of [HOST, FROZEN]) {
    await deleteDoc(doc(db, 'hosts', host, 'reservations', 'stay-1'))
    await deleteDoc(doc(db, 'hosts', host, 'resources', 'cabin'))
    await deleteDoc(doc(db, 'hosts', host))
  }
  await deleteDoc(doc(db, 'hosts', HOST, 'notes', 'n1'))
  for (const uid of Object.keys(MEMBER_ROLES)) await deleteDoc(doc(db, 'orgs', ORG, 'members', uid))
  await deleteDoc(doc(db, 'orgs', ORG))
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
