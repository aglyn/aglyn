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
 * The rules that asked `canManageOrg()` (owner or admin) ask keys (AGL-4047).
 *
 *   - The workspace document's member branch: the `crm` map asks "Change CRM
 *     settings" (`crm.settings`), every other field "Organization settings"
 *     (`org.settings`), a no-op `org.settings`; the deny-list is unchanged.
 *   - Invites read: "Manage members" (`members.manage`).
 *   - A plugin's workspace settings write: "Organization settings".
 *   - A consent group change's job read: "Organization settings" and "Manage
 *     data" (`data.manage`), as its route asks them.
 *   - Website ownership claims read: "Bring a site in" (`ai.import`).
 *
 * Each through `memberKeyOrOverride` with the key's default, the owner and
 * admins (`data.manage`: and editors), so:
 *
 *   - with nothing decided, each answers as the role gate did;
 *   - a `resolvedPermissions` stamp, or the member's own override when never
 *     stamped, decides it, granting a narrower role the key or refusing a
 *     wider one;
 *   - a member stamped before a key existed answers by the default;
 *   - all of it stays org-wide: a site collaborator granted every key reads
 *     and changes nothing here, and staff, unverified members and outsiders
 *     behave as before.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-workspace-manage-org.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-manage-org-keys'
const OTHER_ORG = 'org-manage-org-keys-other'
const HOST = 'host-manage-org-keys'
const DOMAIN = 'manage-org-keys.test'

/** Every key the converted rules ask, granted: what a collaborator is stamped with below. */
const EVERY_KEY = {
  'crm.settings': true,
  'org.settings': true,
  'members.manage': true,
  'data.manage': true,
  'ai.import': true,
}

/** The roster: each member as the projection writes them. */
const MEMBERS = {
  owner: { role: 'owner', allHosts: true },
  admin: { role: 'admin', allHosts: true },
  editor: { role: 'editor', allHosts: true },
  viewer: { role: 'viewer', allHosts: true },
  // Stamped before `crm.settings` and `ai.import` existed: the default answers.
  adminStampedWithout: {
    role: 'admin',
    allHosts: true,
    resolvedPermissions: { 'org.settings': true, 'members.manage': true, 'data.manage': true },
  },
  editorStampedDefaults: {
    role: 'editor',
    allHosts: true,
    resolvedPermissions: {
      'crm.settings': false,
      'org.settings': false,
      'members.manage': false,
      'data.manage': true,
      'ai.import': false,
    },
  },
  // A custom role grants an editor the CRM settings, and only them.
  editorCrm: {
    role: 'editor',
    allHosts: true,
    roleId: 'crm-lead',
    resolvedPermissions: { 'crm.settings': true, 'org.settings': false, 'data.manage': true },
  },
  // A viewer never stamped, whose own override grants the CRM settings.
  viewerCrmOverride: { role: 'viewer', allHosts: true, permissions: { 'crm.settings': true } },
  // A custom role takes the CRM settings from an admin, and leaves the rest.
  adminNoCrm: {
    role: 'admin',
    allHosts: true,
    roleId: 'no-crm',
    resolvedPermissions: { 'crm.settings': false, 'org.settings': true, 'data.manage': true },
  },
  // A custom role takes the workspace settings from an admin, and leaves the CRM's.
  adminNoSettings: {
    role: 'admin',
    allHosts: true,
    roleId: 'no-settings',
    resolvedPermissions: { 'crm.settings': true, 'org.settings': false, 'data.manage': true },
  },
  editorSettings: {
    role: 'editor',
    allHosts: true,
    roleId: 'settings',
    resolvedPermissions: { 'org.settings': true, 'data.manage': true },
  },
  editorMembers: { role: 'editor', allHosts: true, roleId: 'people', resolvedPermissions: { 'members.manage': true } },
  adminNoMembers: { role: 'admin', allHosts: true, roleId: 'no-people', resolvedPermissions: { 'members.manage': false } },
  editorImport: { role: 'editor', allHosts: true, permissions: { 'ai.import': true } },
  adminNoImport: { role: 'admin', allHosts: true, roleId: 'no-import', resolvedPermissions: { 'ai.import': false } },
  // An admin whose custom role keeps the workspace settings and takes "Manage data".
  adminNoData: {
    role: 'admin',
    allHosts: true,
    roleId: 'no-data',
    resolvedPermissions: { 'org.settings': true, 'data.manage': false },
  },
  // A scoped collaborator, the admin of one site, stamped with every key.
  collaborator: { role: 'editor', allHosts: false, hostAccess: { [HOST]: 'admin' }, resolvedPermissions: EVERY_KEY },
}

const uidOf = (name) => `uid-mo-${name}`
const OUTSIDER = uidOf('outsider')
const STAFF = uidOf('staff')

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
const allow = (label, fn) => check(label, () => assertSucceeds(fn()))
const deny = (label, fn) => check(label, () => assertFails(fn()))

const ORG_DOC = { name: 'Manage Org Keys', slug: 'manage-org-keys', plan: 'agency', ownerUid: uidOf('owner') }

/** The workspace document as it stood before each write, so every row starts from the same fields. */
const resetOrg = () =>
  env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'orgs', ORG), ORG_DOC)
  })

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), ORG_DOC)
  await setDoc(doc(db, 'orgs', OTHER_ORG), { name: 'Other', slug: 'manage-org-keys-other', plan: 'agency' })
  await setDoc(doc(db, 'orgs', OTHER_ORG, 'members', OUTSIDER), { role: 'owner', allHosts: true })
  for (const [name, member] of Object.entries(MEMBERS)) {
    await setDoc(doc(db, 'orgs', ORG, 'members', uidOf(name)), member)
  }
  await setDoc(doc(db, 'orgs', ORG, 'invites', 'invite-1'), { email: 'new@example.com', role: 'editor' })
  await setDoc(doc(db, 'orgs', ORG, 'consentGroupChanges', 'change-1'), { status: 'running', step: 'carry' })
  await setDoc(doc(db, 'orgs', ORG, 'domainOwnershipClaims', DOMAIN), { status: 'pending', token: 't' })
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
const member = (name, claims) => as(uidOf(name), claims)
const orgRef = (db) => doc(db, 'orgs', ORG)

const renames = (name, claims) => updateDoc(orgRef(member(name, claims)), { name: `Renamed by ${name}` })
const setsCrm = (name, claims) => updateDoc(orgRef(member(name, claims)), { 'crm.autoCreateCompanies': true })
const setsBoth = (name) =>
  updateDoc(orgRef(member(name)), { name: `Both by ${name}`, 'crm.autoCreateCompanies': true })
const noOp = (name) => updateDoc(orgRef(member(name)), { name: ORG_DOC.name })
const readsInvite = (db) => getDoc(doc(db, 'orgs', ORG, 'invites', 'invite-1'))
const writesPluginSettings = (db) => setDoc(doc(db, 'orgs', ORG, 'pluginSettings', 'marketing'), { fromName: 'Acme' })
const readsConsentJob = (db) => getDoc(doc(db, 'orgs', ORG, 'consentGroupChanges', 'change-1'))
const readsClaim = (db) => getDoc(doc(db, 'orgs', ORG, 'domainOwnershipClaims', DOMAIN))

// ── The workspace document: the rename and the CRM settings map ─────────────
const ORG_WRITES = [
  // [who, renames, sets crm, why]
  ['owner', true, true, 'the owner, nothing decided'],
  ['admin', true, true, 'an admin, nothing decided'],
  ['adminStampedWithout', true, true, 'an admin stamped before "Change CRM settings" existed'],
  ['editor', false, false, 'an editor, nothing decided'],
  ['viewer', false, false, 'a viewer, nothing decided'],
  ['editorStampedDefaults', false, false, 'an editor stamped with the defaults'],
  ['editorCrm', false, true, 'an editor a custom role grants "Change CRM settings"'],
  ['viewerCrmOverride', false, true, 'a viewer whose own override grants "Change CRM settings"'],
  ['adminNoCrm', true, false, 'an admin a custom role refuses "Change CRM settings"'],
  ['adminNoSettings', false, true, 'an admin a custom role refuses "Organization settings"'],
  ['editorSettings', true, false, 'an editor a custom role grants "Organization settings"'],
  ['collaborator', false, false, 'a site collaborator stamped with every key'],
]
for (const [name, rename, crm, why] of ORG_WRITES) {
  await resetOrg()
  await (rename ? allow : deny)(`${why} ${rename ? 'renames' : 'cannot rename'} the workspace`, () => renames(name))
  await resetOrg()
  await (crm ? allow : deny)(`${why} ${crm ? 'changes' : 'cannot change'} a CRM setting`, () => setsCrm(name))
}

await resetOrg()
await allow('the owner changes the name and a CRM setting in one write', () => setsBoth('owner'))
await resetOrg()
await deny('one write of both needs both keys: the CRM-only editor cannot', () => setsBoth('editorCrm'))
await resetOrg()
await deny('one write of both needs both keys: the admin refused the CRM settings cannot', () => setsBoth('adminNoCrm'))
await resetOrg()
await allow('a no-op update asks "Organization settings": the owner may', () => noOp('owner'))
await resetOrg()
await deny('a no-op update asks "Organization settings": the CRM-only editor may not', () => noOp('editorCrm'))

// The deny-list is the same list: a key changes who writes, never what.
await resetOrg()
await deny('the owner still cannot change the plan', () => updateDoc(orgRef(member('owner')), { plan: 'free' }))
await resetOrg()
await deny('the CRM-only editor cannot ride the plan in beside a CRM setting', () =>
  updateDoc(orgRef(member('editorCrm')), { 'crm.autoCreateCompanies': true, plan: 'free' }),
)
await resetOrg()
await deny('the owner still cannot write the capture token', () =>
  updateDoc(orgRef(member('owner')), { crmInbound: { token: 'stolen' } }),
)
await resetOrg()
await deny('an unverified owner renames nothing', () => renames('owner', { email_verified: false }))
await resetOrg()
await deny('an unverified owner changes no CRM setting', () => setsCrm('owner', { email_verified: false }))
await resetOrg()
await deny('another workspace’s owner changes nothing here', () =>
  updateDoc(orgRef(as(OUTSIDER)), { 'crm.autoCreateCompanies': true }),
)
await resetOrg()
await allow('super staff still rename it', () =>
  updateDoc(orgRef(as(STAFF, { staff: true, staffRole: 'super' })), { name: 'Staffed' }),
)

// ── Invites: "Manage members" ───────────────────────────────────────────────
const INVITES = [
  ['owner', true, 'the owner'],
  ['admin', true, 'an admin'],
  ['adminStampedWithout', true, 'an admin stamped with the key'],
  ['editor', false, 'an editor'],
  ['viewer', false, 'a viewer'],
  ['editorMembers', true, 'an editor a custom role grants "Manage members"'],
  ['adminNoMembers', false, 'an admin a custom role refuses "Manage members"'],
  ['collaborator', false, 'a site collaborator stamped with every key'],
]
for (const [name, reads, why] of INVITES) {
  await (reads ? allow : deny)(`${why} ${reads ? 'reads' : 'cannot read'} an invite`, () => readsInvite(member(name)))
}
await allow('staff read an invite', () => readsInvite(as(STAFF, { staff: true })))
await deny('another workspace’s owner reads no invite', () => readsInvite(as(OUTSIDER)))

// ── A plugin's workspace settings: "Organization settings" ──────────────────
const PLUGIN_SETTINGS = [
  ['owner', true, 'the owner'],
  ['admin', true, 'an admin'],
  ['adminStampedWithout', true, 'an admin stamped with the key'],
  ['editor', false, 'an editor'],
  ['viewer', false, 'a viewer'],
  ['editorSettings', true, 'an editor a custom role grants "Organization settings"'],
  ['adminNoSettings', false, 'an admin a custom role refuses "Organization settings"'],
  ['collaborator', false, 'a site collaborator stamped with every key'],
]
for (const [name, writes, why] of PLUGIN_SETTINGS) {
  await (writes ? allow : deny)(`${why} ${writes ? 'writes' : 'cannot write'} a plugin’s workspace settings`, () =>
    writesPluginSettings(member(name)),
  )
}
await deny('an unverified owner writes no plugin settings', () =>
  writesPluginSettings(member('owner', { email_verified: false })),
)
await allow('staff write a plugin’s workspace settings', () => writesPluginSettings(as(STAFF, { staff: true })))
await allow('CONTROL — any member still reads them', () =>
  getDoc(doc(member('viewer'), 'orgs', ORG, 'pluginSettings', 'marketing')),
)

// ── A consent group change's job: both of its keys ──────────────────────────
const CONSENT = [
  ['owner', true, 'the owner'],
  ['admin', true, 'an admin'],
  ['adminStampedWithout', true, 'an admin stamped with both keys'],
  ['editor', false, 'an editor'],
  ['viewer', false, 'a viewer'],
  ['editorSettings', true, 'an editor a custom role grants "Organization settings" (editors manage data)'],
  ['adminNoSettings', false, 'an admin a custom role refuses "Organization settings"'],
  ['adminNoData', false, 'an admin a custom role refuses "Manage data"'],
  ['collaborator', false, 'a site collaborator stamped with every key'],
]
for (const [name, reads, why] of CONSENT) {
  await (reads ? allow : deny)(`${why} ${reads ? 'reads' : 'cannot read'} a consent group change`, () =>
    readsConsentJob(member(name)),
  )
}
await allow('staff read a consent group change', () => readsConsentJob(as(STAFF, { staff: true })))
await deny('nobody writes it, the owner included', () =>
  updateDoc(doc(member('owner'), 'orgs', ORG, 'consentGroupChanges', 'change-1'), { status: 'done' }),
)

// ── Website ownership claims: "Bring a site in" ─────────────────────────────
const CLAIMS = [
  ['owner', true, 'the owner'],
  ['admin', true, 'an admin'],
  ['adminStampedWithout', true, 'an admin stamped before "Bring a site in" existed'],
  ['editor', false, 'an editor'],
  ['viewer', false, 'a viewer'],
  ['editorStampedDefaults', false, 'an editor stamped with the defaults'],
  ['editorImport', true, 'an editor whose own override grants "Bring a site in"'],
  ['adminNoImport', false, 'an admin a custom role refuses "Bring a site in"'],
  ['collaborator', false, 'a site collaborator stamped with every key'],
]
for (const [name, reads, why] of CLAIMS) {
  await (reads ? allow : deny)(`${why} ${reads ? 'reads' : 'cannot read'} a website ownership claim`, () =>
    readsClaim(member(name)),
  )
}
await deny('another workspace’s owner reads no claim', () => readsClaim(as(OUTSIDER)))
await deny('nobody writes a claim, the owner included', () =>
  setDoc(doc(member('owner'), 'orgs', ORG, 'domainOwnershipClaims', DOMAIN), { status: 'proven' }),
)

// Remove ONLY what this spec seeded.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const name of Object.keys(MEMBERS)) await deleteDoc(doc(db, 'orgs', ORG, 'members', uidOf(name)))
  await deleteDoc(doc(db, 'orgs', ORG, 'invites', 'invite-1'))
  await deleteDoc(doc(db, 'orgs', ORG, 'consentGroupChanges', 'change-1'))
  await deleteDoc(doc(db, 'orgs', ORG, 'domainOwnershipClaims', DOMAIN))
  await deleteDoc(doc(db, 'orgs', ORG, 'pluginSettings', 'marketing'))
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
