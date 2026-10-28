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
 * The site keys (AGL-4047). The rules' `canWriteHostContent`,
 * `canPublishHostContent`, `canReadHostSensitive` and the site-admin writes
 * ask "Edit site content", "Publish site content", "See orders and webhooks"
 * and "Manage site settings", whose presets are the site roles they asked for
 * before. So:
 *
 *   - with no stamp for a key (every site before the projection reaches it),
 *     each answers exactly as its role gate did: Admin, Editor and Author
 *     edit; Admin and Editor publish and read orders and webhooks; Admin
 *     manages the site's plugins and settings;
 *   - with the site's stamp (`memberPermissions[uid]`), the stamp decides,
 *     granting a narrower role a key or refusing a wider one;
 *   - staff and frozen sites behave as before.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-site-keys.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-site-keys-test'
const HOST = 'host-site-keys'
const UIDS = {
  admin: 'uid-sk-admin',
  editor: 'uid-sk-editor',
  author: 'uid-sk-author',
  viewer: 'uid-sk-viewer',
  viewerEdits: 'uid-sk-viewer-edits',
  editorReadOnly: 'uid-sk-editor-read-only',
  authorPublishes: 'uid-sk-author-publishes',
  editorNoPublish: 'uid-sk-editor-no-publish',
  authorSeesOrders: 'uid-sk-author-sees-orders',
  editorNoOrders: 'uid-sk-editor-no-orders',
  editorManages: 'uid-sk-editor-manages',
  adminNoManage: 'uid-sk-admin-no-manage',
  outsider: 'uid-sk-outsider',
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

const MEMBER_ROLES = {
  [UIDS.admin]: 'admin',
  [UIDS.editor]: 'editor',
  [UIDS.author]: 'author',
  [UIDS.viewer]: 'viewer',
  [UIDS.viewerEdits]: 'viewer',
  [UIDS.editorReadOnly]: 'editor',
  [UIDS.authorPublishes]: 'author',
  [UIDS.editorNoPublish]: 'editor',
  [UIDS.authorSeesOrders]: 'author',
  [UIDS.editorNoOrders]: 'editor',
  [UIDS.editorManages]: 'editor',
  [UIDS.adminNoManage]: 'admin',
}

/** The site's stamp, as the projection writes it after a custom role, an override or a toggle. */
const MEMBER_PERMISSIONS = {
  [UIDS.viewerEdits]: { 'site.edit': true },
  [UIDS.editorReadOnly]: { 'site.edit': false },
  [UIDS.authorPublishes]: { 'site.edit': true, 'site.publish': true },
  [UIDS.editorNoPublish]: { 'site.edit': true, 'site.publish': false },
  [UIDS.authorSeesOrders]: { 'site.sensitive': true },
  [UIDS.editorNoOrders]: { 'site.sensitive': false },
  [UIDS.editorManages]: { 'site.edit': true, 'site.manage': true },
  [UIDS.adminNoManage]: { 'site.edit': true, 'site.manage': false },
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), { name: 'Site Keys', slug: 'site-keys', plan: 'business', ownerUid: UIDS.admin })
  await setDoc(doc(db, 'hosts', HOST), { orgId: ORG, memberRoles: MEMBER_ROLES, memberPermissions: MEMBER_PERMISSIONS })
  await setDoc(doc(db, 'hosts', HOST, 'redirects', 'r1'), { from: '/old', destination: '/new', kind: 'exact' })
  await setDoc(doc(db, 'hosts', HOST, 'webhooks', 'w1'), { url: 'https://example.com/hook' })
  await setDoc(doc(db, 'hosts', HOST, 'pluginSettings', 'forms'), { enabled: true })
})

const as = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore()

const edits = (uid) => setDoc(doc(as(uid), 'hosts', HOST, 'notes', `n-${uid}`), { text: 'hello' })
const publishes = (uid) => updateDoc(doc(as(uid), 'hosts', HOST, 'redirects', 'r1'), { destination: `/new-${uid}` })
const readsWebhooks = (uid) => getDoc(doc(as(uid), 'hosts', HOST, 'webhooks', 'w1'))
const managesPlugins = (uid) => setDoc(doc(as(uid), 'hosts', HOST, 'pluginSettings', 'forms'), { enabled: uid.length % 2 === 0 })
const togglesPlugins = (uid) => updateDoc(doc(as(uid), 'hosts', HOST), { disabledPlugins: [`p-${uid}`] })

const allow = (label, fn) => check(label, () => assertSucceeds(fn()))
const deny = (label, fn) => check(label, () => assertFails(fn()))

// Edit site content (`site.edit`).
for (const role of ['admin', 'editor', 'author']) await allow(`a site ${role} edits content, as before`, () => edits(UIDS[role]))
await deny('a site viewer does not edit content', () => edits(UIDS.viewer))
await deny('someone who cannot reach the site does not edit content', () => edits(UIDS.outsider))
await allow('a viewer the stamp grants "Edit site content" edits', () => edits(UIDS.viewerEdits))
await deny('an editor the stamp refuses it does not', () => edits(UIDS.editorReadOnly))

// Publish site content (`site.publish`).
for (const role of ['admin', 'editor']) await allow(`a site ${role} publishes (a redirect), as before`, () => publishes(UIDS[role]))
await deny('a site author does not publish', () => publishes(UIDS.author))
await deny('a site viewer does not publish', () => publishes(UIDS.viewer))
await allow('an author the stamp grants "Publish site content" publishes', () => publishes(UIDS.authorPublishes))
await deny('an editor the stamp refuses it does not', () => publishes(UIDS.editorNoPublish))

// See orders and webhooks (`site.sensitive`).
for (const role of ['admin', 'editor']) await allow(`a site ${role} reads webhooks, as before`, () => readsWebhooks(UIDS[role]))
await deny('a site author does not read webhooks', () => readsWebhooks(UIDS.author))
await deny('a site viewer does not read webhooks', () => readsWebhooks(UIDS.viewer))
await allow('an author the stamp grants "See orders and webhooks" reads them', () => readsWebhooks(UIDS.authorSeesOrders))
await deny('an editor the stamp refuses it does not', () => readsWebhooks(UIDS.editorNoOrders))

// Manage site settings (`site.manage`).
await allow('a site admin changes plugin settings, as before', () => managesPlugins(UIDS.admin))
await deny('a site editor does not change plugin settings', () => managesPlugins(UIDS.editor))
await allow('an editor the stamp grants "Manage site settings" changes plugin settings', () => managesPlugins(UIDS.editorManages))
await deny('an admin the stamp refuses it does not', () => managesPlugins(UIDS.adminNoManage))
await allow('a site admin turns plugins on and off on the site, as before', () => togglesPlugins(UIDS.admin))
await deny('a site editor does not', () => togglesPlugins(UIDS.editor))
await allow('an editor the stamp grants it does', () => togglesPlugins(UIDS.editorManages))
await deny('an admin the stamp refuses it does not', () => togglesPlugins(UIDS.adminNoManage))

// Staff.
await check('staff edit, publish, read webhooks and change plugin settings', async () => {
  const staff = env.authenticatedContext('uid-sk-staff', { email_verified: true, staff: true }).firestore()
  await assertSucceeds(setDoc(doc(staff, 'hosts', HOST, 'notes', 'staff'), { text: 'hello' }))
  await assertSucceeds(updateDoc(doc(staff, 'hosts', HOST, 'redirects', 'r1'), { destination: '/staff' }))
  await assertSucceeds(getDoc(doc(staff, 'hosts', HOST, 'webhooks', 'w1')))
  await assertSucceeds(setDoc(doc(staff, 'hosts', HOST, 'pluginSettings', 'forms'), { enabled: false }))
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const uid of [...Object.values(UIDS), 'staff']) await deleteDoc(doc(db, 'hosts', HOST, 'notes', `n-${uid}`))
  await deleteDoc(doc(db, 'hosts', HOST, 'notes', 'staff'))
  await deleteDoc(doc(db, 'hosts', HOST, 'redirects', 'r1'))
  await deleteDoc(doc(db, 'hosts', HOST, 'webhooks', 'w1'))
  await deleteDoc(doc(db, 'hosts', HOST, 'pluginSettings', 'forms'))
  await deleteDoc(doc(db, 'hosts', HOST))
  await deleteDoc(doc(db, 'orgs', ORG))
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
