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
 * Workspace keys in the rules (AGL-4047). The business profile's write asked
 * `canManageOrg` (owner, admin) and the workspace media library's writes
 * asked `canWriteOrgData` (owner, admin, editor). They ask "Business profile"
 * (`org.businessProfile`) and "Edit the workspace media library" (`org.media`)
 * through `memberKeyOr`, whose default is exactly those roles:
 *
 *   - with no stamp for the key, each answers as its role gate did;
 *   - with the member's `resolvedPermissions` stamp, the stamp decides,
 *     granting a narrower role the key or refusing a wider one;
 *   - staff, unverified members and outsiders behave as before.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-workspace-keys.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, setDoc } from 'firebase/firestore'

const ORG = 'org-workspace-keys'
const OTHER_ORG = 'org-workspace-keys-other'
const UIDS = {
  owner: 'uid-wk-owner',
  admin: 'uid-wk-admin',
  editor: 'uid-wk-editor',
  viewer: 'uid-wk-viewer',
  editorProfile: 'uid-wk-editor-profile',
  adminNoProfile: 'uid-wk-admin-no-profile',
  viewerMedia: 'uid-wk-viewer-media',
  editorNoMedia: 'uid-wk-editor-no-media',
  outsider: 'uid-wk-outsider',
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

const MEMBERS = {
  [UIDS.owner]: { role: 'owner', allHosts: true },
  [UIDS.admin]: { role: 'admin', allHosts: true },
  [UIDS.editor]: { role: 'editor', allHosts: true },
  [UIDS.viewer]: { role: 'viewer', allHosts: true },
  // The projection's stamp after a custom role or an override set the key.
  [UIDS.editorProfile]: { role: 'editor', allHosts: true, resolvedPermissions: { 'org.businessProfile': true } },
  [UIDS.adminNoProfile]: { role: 'admin', allHosts: true, resolvedPermissions: { 'org.businessProfile': false } },
  [UIDS.viewerMedia]: { role: 'viewer', allHosts: true, resolvedPermissions: { 'org.media': true } },
  [UIDS.editorNoMedia]: { role: 'editor', allHosts: true, resolvedPermissions: { 'org.media': false } },
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), { name: 'Workspace Keys', slug: 'workspace-keys', plan: 'business', ownerUid: UIDS.owner })
  await setDoc(doc(db, 'orgs', OTHER_ORG), { name: 'Other', slug: 'other-wk', plan: 'business', ownerUid: UIDS.outsider })
  await setDoc(doc(db, 'orgs', OTHER_ORG, 'members', UIDS.outsider), { role: 'owner', allHosts: true })
  for (const [uid, member] of Object.entries(MEMBERS)) await setDoc(doc(db, 'orgs', ORG, 'members', uid), member)
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
const writesProfile = (uid, claims) => setDoc(doc(as(uid, claims), 'orgs', ORG, 'businessProfile', 'defaults'), { tone: uid })
const addsMedia = (uid, claims) => setDoc(doc(as(uid, claims), 'orgs', ORG, 'media', `m-${uid}`), { fileName: 'logo.png' })
const addsFolder = (uid, claims) => setDoc(doc(as(uid, claims), 'orgs', ORG, 'mediaFolders', `f-${uid}`), { name: 'Logos' })

const allow = (label, fn) => check(label, () => assertSucceeds(fn()))
const deny = (label, fn) => check(label, () => assertFails(fn()))

// Business profile (`org.businessProfile`).
await allow('the owner writes the business profile, as before', () => writesProfile(UIDS.owner))
await allow('an admin writes it, as before', () => writesProfile(UIDS.admin))
await deny('an editor does not', () => writesProfile(UIDS.editor))
await deny('a viewer does not', () => writesProfile(UIDS.viewer))
await allow('an editor the stamp grants "Business profile" writes it', () => writesProfile(UIDS.editorProfile))
await deny('an admin the stamp refuses it does not', () => writesProfile(UIDS.adminNoProfile))
await deny('a member of another workspace does not', () => writesProfile(UIDS.outsider))
await deny('an unverified owner does not', () => writesProfile(UIDS.owner, { email_verified: false }))

// The workspace media library (`org.media`).
for (const role of ['owner', 'admin', 'editor']) {
  await allow(`a workspace ${role} adds media and folders, as before`, async () => {
    await addsMedia(UIDS[role])
    await addsFolder(UIDS[role])
  })
}
await deny('a workspace viewer adds no media', () => addsMedia(UIDS.viewer))
await deny('a workspace viewer adds no folder', () => addsFolder(UIDS.viewer))
await allow('a viewer the stamp grants "Edit the workspace media library" adds media and folders', async () => {
  await addsMedia(UIDS.viewerMedia)
  await addsFolder(UIDS.viewerMedia)
})
await deny('an editor the stamp refuses it adds no media', () => addsMedia(UIDS.editorNoMedia))
await deny('an editor the stamp refuses it adds no folder', () => addsFolder(UIDS.editorNoMedia))
await deny('a member of another workspace adds none', () => addsMedia(UIDS.outsider))

// Staff.
await allow('staff write the business profile and media', async () => {
  await writesProfile('uid-wk-staff', { staff: true })
  await addsMedia('uid-wk-staff', { staff: true })
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const uid of [...Object.values(UIDS), 'uid-wk-staff']) {
    await deleteDoc(doc(db, 'orgs', ORG, 'media', `m-${uid}`))
    await deleteDoc(doc(db, 'orgs', ORG, 'mediaFolders', `f-${uid}`))
    await deleteDoc(doc(db, 'orgs', ORG, 'members', uid))
  }
  await deleteDoc(doc(db, 'orgs', ORG, 'businessProfile', 'defaults'))
  await deleteDoc(doc(db, 'orgs', OTHER_ORG, 'members', UIDS.outsider))
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
