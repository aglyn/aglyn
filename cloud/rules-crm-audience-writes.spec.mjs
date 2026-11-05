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
 * The CRM's and the workspace audience's client-direct writes ask keys
 * (AGL-4047).
 *
 *   - `canWriteOrgData()`, `canWriteScopedOrgData()` and `canWriteScopedCrm()`
 *     (segments, companies, pipelines, deals, tasks, activities, leads) and
 *     `canWriteOrgWideData()` (topics, lists) ask "Manage data" (`data.manage`).
 *   - Campaign containers ask "Run email campaigns" (`marketing.campaigns`).
 *
 * Each through `memberKeyOrOverride` with the key's default, the owner, admins
 * and editors the rule asked by name, so:
 *
 *   - with nothing decided, each answers as the role gate did, including for a
 *     member stamped before the key existed and a site collaborator whose
 *     workspace role is editor or viewer;
 *   - a `resolvedPermissions` stamp, or the member's own override when never
 *     stamped, decides it, granting a viewer the key or refusing an editor;
 *   - the two keys are independent;
 *   - everything that is not the role stays: verified, not suspended, the
 *     reach, the scope, the CRM suite, and each collection's field limits.
 *   - no client update changes where a deal stands, or a contact's stage:
 *     those are the routes', which ask "Move contacts and deals between stages".
 *   - no client creates a deal already won or lost: closing is the same route's.
 *   - a colleague's personal email template asks "Change colleagues' email
 *     templates" over the whole workspace on top of "Manage data": every role's
 *     by default, so those two already decided it and still do until a custom
 *     role or an override refuses the key.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-crm-audience-writes.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-crm-audience-keys'
const NO_SUITE_ORG = 'org-crm-audience-free'
const HOST = 'host-crm-audience-keys'
const OTHER_HOST = 'host-crm-audience-other'
const SITE_TOKEN = `host:${HOST}`
const OTHER_TOKEN = `host:${OTHER_HOST}`
const ORG_TOKEN = 'org'
/**
 * A site collaborator's `scopeTokens` as `projectMemberScopeTokens` writes them
 * (`libs/aglyn/src/lib/app-utils/organizations.ts`): `'org'`, and each named
 * site. `'org'` is what lets a collaborator read what the whole workspace
 * shares, and it is why the writes below reach those records too.
 */
const COLLABORATOR_TOKENS = [ORG_TOKEN, SITE_TOKEN]

/** The roster, each as the projection writes them, with what they may do. */
const MEMBERS = {
  owner: { role: 'owner', allHosts: true },
  admin: { role: 'admin', allHosts: true },
  editor: { role: 'editor', allHosts: true },
  viewer: { role: 'viewer', allHosts: true },
  // Stamped before either key existed: the default answers.
  editorStampedWithout: { role: 'editor', allHosts: true, resolvedPermissions: { 'site.edit': true } },
  viewerStampedWithout: { role: 'viewer', allHosts: true, resolvedPermissions: { 'site.edit': false } },
  // Stamped with the defaults, as `syncOrgAuthProjections` writes them.
  editorStampedDefaults: {
    role: 'editor',
    allHosts: true,
    resolvedPermissions: { 'data.manage': true, 'marketing.campaigns': true },
  },
  viewerStampedDefaults: {
    role: 'viewer',
    allHosts: true,
    resolvedPermissions: { 'data.manage': false, 'marketing.campaigns': false },
  },
  // Explicit decisions, one key at a time, so each key's rows prove themselves.
  viewerGrantedData: {
    role: 'viewer',
    allHosts: true,
    roleId: 'data-clerk',
    resolvedPermissions: { 'data.manage': true, 'marketing.campaigns': false },
  },
  viewerGrantedCampaigns: {
    role: 'viewer',
    allHosts: true,
    roleId: 'campaign-clerk',
    resolvedPermissions: { 'data.manage': false, 'marketing.campaigns': true },
  },
  viewerOverride: { role: 'viewer', allHosts: true, permissions: { 'data.manage': true, 'marketing.campaigns': true } },
  editorRefusedData: {
    role: 'editor',
    allHosts: true,
    roleId: 'no-data',
    resolvedPermissions: { 'data.manage': false, 'marketing.campaigns': true },
  },
  adminRefusedCampaigns: {
    role: 'admin',
    allHosts: true,
    roleId: 'no-campaigns',
    resolvedPermissions: { 'data.manage': true, 'marketing.campaigns': false },
  },
  editorOverrideRefused: { role: 'editor', allHosts: true, permissions: { 'data.manage': false, 'marketing.campaigns': false } },
  // Site collaborators: a workspace role, a reach of one site.
  collabEditor: { role: 'editor', allHosts: false, hostAccess: { [HOST]: 'editor' }, scopeTokens: COLLABORATOR_TOKENS },
  collabViewer: { role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'admin' }, scopeTokens: COLLABORATOR_TOKENS },
  collabViewerGranted: {
    role: 'viewer',
    allHosts: false,
    hostAccess: { [HOST]: 'editor' },
    scopeTokens: COLLABORATOR_TOKENS,
    resolvedPermissions: { 'data.manage': true, 'marketing.campaigns': true },
  },
  collabEditorRefused: {
    role: 'editor',
    allHosts: false,
    hostAccess: { [HOST]: 'editor' },
    scopeTokens: COLLABORATOR_TOKENS,
    resolvedPermissions: { 'data.manage': false, 'marketing.campaigns': false },
  },
  // Every key held, and still stopped by something that is not the role.
  suspended: { role: 'owner', allHosts: true, orgSuspended: true },
  // "Change colleagues' email templates" decided, one way and the other.
  adminRefusedTemplates: {
    role: 'admin',
    allHosts: true,
    roleId: 'no-templates',
    resolvedPermissions: { 'data.manage': true, 'crm.colleagueTemplates': false },
  },
  editorOverrideRefusedTemplates: { role: 'editor', allHosts: true, permissions: { 'crm.colleagueTemplates': false } },
  collabGrantedTemplates: {
    role: 'editor',
    allHosts: false,
    hostAccess: { [HOST]: 'editor' },
    scopeTokens: COLLABORATOR_TOKENS,
    resolvedPermissions: { 'data.manage': true, 'crm.colleagueTemplates': true },
  },
}

/** The verdicts: [name, holds "Manage data", holds "Run email campaigns", org-wide, why]. */
const ROWS = [
  ['owner', true, true, true, 'the owner, nothing decided'],
  ['admin', true, true, true, 'an admin, nothing decided'],
  ['editor', true, true, true, 'an editor, nothing decided'],
  ['viewer', false, false, true, 'a viewer, nothing decided'],
  ['editorStampedWithout', true, true, true, 'an editor stamped before the keys existed'],
  ['viewerStampedWithout', false, false, true, 'a viewer stamped before the keys existed'],
  ['editorStampedDefaults', true, true, true, 'an editor stamped with the defaults'],
  ['viewerStampedDefaults', false, false, true, 'a viewer stamped with the defaults'],
  ['viewerGrantedData', true, false, true, 'a viewer a custom role grants "Manage data" alone'],
  ['viewerGrantedCampaigns', false, true, true, 'a viewer a custom role grants "Run email campaigns" alone'],
  ['viewerOverride', true, true, true, 'a viewer never stamped, whose own override grants both'],
  ['editorRefusedData', false, true, true, 'an editor a custom role refuses "Manage data"'],
  ['adminRefusedCampaigns', true, false, true, 'an admin a custom role refuses "Run email campaigns"'],
  ['editorOverrideRefused', false, false, true, 'an editor never stamped, whose own override refuses both'],
  ['collabEditor', true, true, false, 'a site collaborator whose workspace role is editor'],
  ['collabViewer', false, false, false, 'a site collaborator whose workspace role is viewer, Admin of the site'],
  ['collabViewerGranted', true, true, false, 'a site collaborator on the viewer role granted both'],
  ['collabEditorRefused', false, false, false, 'a site collaborator on the editor role refused both'],
  ['suspended', false, false, true, 'a suspended owner'],
]

const uidOf = (name) => `uid-ca-${name}`

const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082').split(':')

// The comment-stripped artifact is what deploys (AGL-3544).
const RULES = readFileSync('cloud/firebase-firestore.deploy.rules', 'utf8')
const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: emulatorHost,
    port: Number(emulatorPort),
    rules: RULES,
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
const expectThat = (allowed, label, fn) => (allowed ? allow : deny)(label, fn)

const seeded = []
const seed = (db, ...path) => {
  seeded.push(path)
  return doc(db, ...path)
}

const SITE_RECORD = { name: 'Seed', visibleTo: [SITE_TOKEN] }
const OTHER_RECORD = { name: 'Elsewhere', visibleTo: [OTHER_TOKEN] }
const WHOLE_WORKSPACE_RECORD = { name: 'Everyone', visibleTo: [ORG_TOKEN] }
/** A deal as a create leaves it, in a stage of a pipeline. */
const DEAL_IN_A_STAGE = {
  title: 'Seed',
  visibleTo: [SITE_TOKEN],
  pipelineId: 'default',
  stageId: 'qualification',
  status: 'open',
  stageChangedAtMs: 1_700_000_000_000,
  probability: 10,
  forecastCategory: 'pipeline',
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(seed(db, 'orgs', ORG), { name: 'CRM audience keys', slug: 'crm-audience-keys', plan: 'agency' })
  await setDoc(seed(db, 'orgs', NO_SUITE_ORG), { name: 'Free', slug: 'crm-audience-free', plan: 'free' })
  await setDoc(seed(db, 'orgs', NO_SUITE_ORG, 'members', uidOf('admin')), { role: 'admin', allHosts: true })
  for (const [name, member] of Object.entries(MEMBERS)) {
    await setDoc(seed(db, 'orgs', ORG, 'members', uidOf(name)), member)
  }
  await setDoc(seed(db, 'orgs', ORG, 'lists', 'list-1'), { name: 'Seed list', kind: 'static' })
  await setDoc(seed(db, 'orgs', ORG, 'emailTopics', 'topic-1'), { name: 'Seed topic' })
  await setDoc(seed(db, 'orgs', ORG, 'contactSegments', 'segment-site'), SITE_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'contactSegments', 'segment-other'), OTHER_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'contactSegments', 'segment-org'), WHOLE_WORKSPACE_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'contactSegments', 'segment-org-delete'), WHOLE_WORKSPACE_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'companies', 'company-org'), WHOLE_WORKSPACE_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'companies', 'company-org-delete'), WHOLE_WORKSPACE_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'companies', 'company-site'), SITE_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'companies', 'company-other'), OTHER_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'companies', 'company-shared'), {
    name: 'Shared to this site to read',
    visibleTo: [OTHER_TOKEN, SITE_TOKEN],
    writeTo: [OTHER_TOKEN],
  })
  await setDoc(seed(db, 'orgs', ORG, 'deals', 'deal-site'), { title: 'Seed', visibleTo: [SITE_TOKEN] })
  await setDoc(seed(db, 'orgs', ORG, 'deals', 'deal-staged'), DEAL_IN_A_STAGE)
  await setDoc(seed(db, 'orgs', ORG, 'deals', 'deal-lost'), {
    ...DEAL_IN_A_STAGE,
    stageId: 'lost',
    status: 'lost',
    closedAtMs: 1_700_000_100_000,
    lostReason: 'Went elsewhere',
  })
  await setDoc(seed(db, 'orgs', ORG, 'contacts', 'contact-site'), {
    email: 'seed@example.com',
    visibleTo: [SITE_TOKEN],
    facets: { 'group-site': { lifecycleStage: 'lead' } },
  })
  await setDoc(seed(db, 'orgs', ORG, 'crmTasks', 'task-site'), { title: 'Seed', visibleTo: [SITE_TOKEN] })
  await setDoc(seed(db, 'orgs', ORG, 'leads', 'lead-site'), { name: 'Seed', visibleTo: [SITE_TOKEN], status: 'new' })
  await setDoc(seed(db, 'orgs', ORG, 'emailCampaigns', 'campaign-site'), SITE_RECORD)
  await setDoc(seed(db, 'orgs', ORG, 'emailCampaigns', 'campaign-org'), { name: 'Org', visibleTo: [ORG_TOKEN] })
  await setDoc(seed(db, 'orgs', NO_SUITE_ORG, 'contactSegments', 'segment-1'), { name: 'Free', visibleTo: [ORG_TOKEN] })
})

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
const member = (name, claims) => as(uidOf(name), claims)
const ref = (name, ...path) => doc(member(name), 'orgs', ORG, ...path)
let serial = 0
const newId = (prefix) => {
  serial += 1
  return `${prefix}-${serial}`
}
/** A new document, remembered so the spec removes only what it wrote. */
const creates = async (name, collection, fields) => {
  const id = newId(collection)
  seeded.push(['orgs', ORG, collection, id])
  await setDoc(ref(name, collection, id), fields)
}
/** The scope a member's creates carry: the org's when org-wide, else their own site's. */
const scopeOf = (orgWide) => [orgWide ? ORG_TOKEN : SITE_TOKEN]

for (const [name, data, campaigns, orgWide, why] of ROWS) {
  const visibleTo = scopeOf(orgWide)

  // ── canWriteOrgData() and what is built on it: the CRM's collections ──────
  await expectThat(data, `${why}: ${data ? 'creates' : 'cannot create'} a segment`, () =>
    creates(name, 'contactSegments', { name: 'New', visibleTo }),
  )
  await expectThat(data, `${why}: ${data ? 'creates' : 'cannot create'} a deal`, () =>
    creates(name, 'deals', { title: 'New', visibleTo }),
  )
  await expectThat(data, `${why}: ${data ? 'creates' : 'cannot create'} a task`, () =>
    creates(name, 'crmTasks', { title: 'New', visibleTo }),
  )
  // canWriteScopedOrgData()
  await expectThat(data, `${why}: ${data ? 'updates' : 'cannot update'} a segment in reach`, () =>
    updateDoc(ref(name, 'contactSegments', 'segment-site'), { name: `Renamed by ${name}` }),
  )
  await expectThat(data, `${why}: ${data ? 'updates' : 'cannot update'} a task in reach`, () =>
    updateDoc(ref(name, 'crmTasks', 'task-site'), { title: `Renamed by ${name}` }),
  )
  // canWriteScopedCrm()
  await expectThat(data, `${why}: ${data ? 'updates' : 'cannot update'} a company in reach`, () =>
    updateDoc(ref(name, 'companies', 'company-site'), { name: `Renamed by ${name}` }),
  )
  await expectThat(data, `${why}: ${data ? 'updates' : 'cannot update'} a deal in reach`, () =>
    updateDoc(ref(name, 'deals', 'deal-site'), { title: `Renamed by ${name}` }),
  )
  await expectThat(data, `${why}: ${data ? 'updates' : 'cannot update'} a lead in reach`, () =>
    updateDoc(ref(name, 'leads', 'lead-site'), { status: `worked-by-${name}` }),
  )

  // ── canWriteOrgWideData(): the reach AND the key ──────────────────────────
  const audience = data && orgWide
  await expectThat(audience, `${why}: ${audience ? 'creates' : 'cannot create'} a list`, () =>
    creates(name, 'lists', { name: 'New', kind: 'static' }),
  )
  await expectThat(audience, `${why}: ${audience ? 'updates' : 'cannot update'} a list`, () =>
    updateDoc(ref(name, 'lists', 'list-1'), { name: `Renamed by ${name}` }),
  )
  await expectThat(audience, `${why}: ${audience ? 'creates' : 'cannot create'} an email topic`, () =>
    creates(name, 'emailTopics', { name: 'New' }),
  )
  await expectThat(audience, `${why}: ${audience ? 'updates' : 'cannot update'} an email topic`, () =>
    updateDoc(ref(name, 'emailTopics', 'topic-1'), { name: `Renamed by ${name}` }),
  )

  // ── Campaign containers: their own key ────────────────────────────────────
  // The workspace's verdict: no host is seeded here, so no site's verdict can
  // count. That, and what a real collaborator's tokens reach, is the table in
  // `rules-campaign-site-gain.spec.mjs`.
  await expectThat(campaigns, `${why}: ${campaigns ? 'creates' : 'cannot create'} a campaign`, () =>
    creates(name, 'emailCampaigns', { name: 'New', visibleTo }),
  )
  await expectThat(campaigns, `${why}: ${campaigns ? 'updates' : 'cannot update'} a campaign in reach`, () =>
    updateDoc(ref(name, 'emailCampaigns', 'campaign-site'), { name: `Renamed by ${name}` }),
  )
  await deny(`${why}: cannot delete a campaign, which is the manage route's`, () =>
    deleteDoc(ref(name, 'emailCampaigns', 'campaign-site')),
  )
}

// ── What is not the role stays ──────────────────────────────────────────────
const UNVERIFIED = { email_verified: false }
await deny('an unverified owner cannot create a segment', () =>
  setDoc(doc(member('owner', UNVERIFIED), 'orgs', ORG, 'contactSegments', 'unverified'), { name: 'New', visibleTo: [ORG_TOKEN] }),
)
await deny('an unverified owner cannot update a list', () =>
  updateDoc(doc(member('owner', UNVERIFIED), 'orgs', ORG, 'lists', 'list-1'), { name: 'Unverified' }),
)
await deny('an unverified owner cannot create a campaign', () =>
  setDoc(doc(member('owner', UNVERIFIED), 'orgs', ORG, 'emailCampaigns', 'unverified'), { name: 'New', visibleTo: [ORG_TOKEN] }),
)
await deny('a stranger creates no segment', () =>
  setDoc(doc(as('uid-ca-stranger'), 'orgs', ORG, 'contactSegments', 'stranger'), { name: 'New', visibleTo: [ORG_TOKEN] }),
)
await deny('a stranger creates no campaign', () =>
  setDoc(doc(as('uid-ca-stranger'), 'orgs', ORG, 'emailCampaigns', 'stranger'), { name: 'New', visibleTo: [ORG_TOKEN] }),
)

// The scope: a collaborator holding the key reaches their own site and what the
// whole workspace shares, and no further. Reaching the whole workspace's records
// is the documented behavior (`custom-roles.md`, the sharing pages): nothing a
// collaborator writes there changes what a record is shared with.
for (const name of ['collabEditor', 'collabViewerGranted']) {
  await allow(`${name} may update a segment shared with the whole workspace`, () =>
    updateDoc(ref(name, 'contactSegments', 'segment-org'), { name: `Reached by ${name}` }),
  )
  await allow(`${name} may update a company shared with the whole workspace`, () =>
    updateDoc(ref(name, 'companies', 'company-org'), { name: `Reached by ${name}` }),
  )
  await allow(`${name} may update a campaign placed on the whole workspace`, () =>
    updateDoc(ref(name, 'emailCampaigns', 'campaign-org'), { name: `Reached by ${name}` }),
  )
  await deny(`${name} cannot narrow a company shared with the whole workspace`, () =>
    updateDoc(ref(name, 'companies', 'company-org'), { visibleTo: [SITE_TOKEN] }),
  )
  await deny(`${name} cannot update a segment on another site`, () =>
    updateDoc(ref(name, 'contactSegments', 'segment-other'), { name: 'Reached' }),
  )
  await deny(`${name} cannot update a company on another site`, () =>
    updateDoc(ref(name, 'companies', 'company-other'), { name: 'Reached' }),
  )
  await deny(`${name} cannot update a company only shared to this site to read`, () =>
    updateDoc(ref(name, 'companies', 'company-shared'), { name: 'Reached' }),
  )
  await allow(`${name} may create a segment for the whole workspace`, () =>
    setDoc(ref(name, 'contactSegments', `org-${name}`), { name: 'Wide', visibleTo: [ORG_TOKEN] }),
  )
  await deny(`${name} cannot create a campaign for another site`, () =>
    setDoc(ref(name, 'emailCampaigns', `other-${name}`), { name: 'Elsewhere', visibleTo: [OTHER_TOKEN] }),
  )
  await deny(`${name} cannot re-scope a campaign`, () =>
    updateDoc(ref(name, 'emailCampaigns', 'campaign-site'), { visibleTo: [SITE_TOKEN, OTHER_TOKEN] }),
  )
}
// One delete each, so the second collaborator isn't asked about a document gone.
await allow('a collaborator holding the key may delete a segment shared with the whole workspace', () =>
  deleteDoc(ref('collabEditor', 'contactSegments', 'segment-org-delete')),
)
await allow('a collaborator granted the key may delete a company shared with the whole workspace', () =>
  deleteDoc(ref('collabViewerGranted', 'companies', 'company-org-delete')),
)
// The key still decides it: the reach alone writes nothing.
for (const name of ['collabViewer', 'collabEditorRefused']) {
  await deny(`${name}, without the key, cannot update a company shared with the whole workspace`, () =>
    updateDoc(ref(name, 'companies', 'company-org'), { name: 'Reached' }),
  )
  await deny(`${name}, without the key, cannot delete a company shared with the whole workspace`, () =>
    deleteDoc(ref(name, 'companies', 'company-org')),
  )
}
await allow('an org-wide editor may re-scope a campaign', () =>
  updateDoc(ref('editor', 'emailCampaigns', 'campaign-org'), { visibleTo: [ORG_TOKEN] }),
)

// The plan and each collection's own limits.
await deny('an admin of a workspace without the suite cannot update a CRM record', () =>
  updateDoc(doc(as(uidOf('admin')), 'orgs', NO_SUITE_ORG, 'contactSegments', 'segment-1'), { name: 'Over' }),
)
await deny('an admin of a workspace without the suite cannot create a CRM record', () =>
  setDoc(doc(as(uidOf('admin')), 'orgs', NO_SUITE_ORG, 'deals', 'deal-1'), { title: 'Over', visibleTo: [ORG_TOKEN] }),
)
await deny('an owner cannot clear a lead’s email state', () =>
  updateDoc(ref('owner', 'leads', 'lead-site'), { emailState: 'ok' }),
)
await deny('an owner cannot write a deal’s sharing', () =>
  updateDoc(ref('owner', 'deals', 'deal-site'), { writeTo: [SITE_TOKEN] }),
)
await deny('an owner cannot attach more files to a deal than the ceiling', () =>
  updateDoc(ref('owner', 'deals', 'deal-site'), { mediaIds: Array.from({ length: 21 }, (_, index) => `m${index}`) }),
)
await deny('a viewer granted "Manage data" still creates no contact, which is the server’s', () =>
  setDoc(ref('viewerGrantedData', 'contacts', 'c-1'), { email: 'a@example.com', visibleTo: [ORG_TOKEN] }),
)

// ── Where a deal stands is the server's once it exists (AGL-4047) ──────────
// Everyone who may edit a deal is refused each field the stage route writes,
// alone and riding along with an edit they are allowed. The route's Admin SDK
// write passes no rule, so it is the one way these change.
const STAGE_WRITERS_SCOPED = new Set(['collabEditor'])
const STAGE_WRITERS = [
  ['owner', 'the owner'],
  ['admin', 'an admin'],
  ['editor', 'an editor'],
  ['viewerGrantedData', 'a viewer a custom role grants "Manage data"'],
  ['viewerOverride', 'a viewer whose own override grants "Manage data"'],
  ['collabEditor', 'a site collaborator'],
]
for (const [name, who] of STAGE_WRITERS) {
  const staged = () => ref(name, 'deals', 'deal-staged')
  await deny(`${who} cannot move a deal to another stage`, () => updateDoc(staged(), { stageId: 'negotiation' }))
  await deny(`${who} cannot move a deal to another pipeline`, () => updateDoc(staged(), { pipelineId: 'wholesale' }))
  await deny(`${who} cannot mark a deal won`, () => updateDoc(staged(), { status: 'won' }))
  await deny(`${who} cannot stamp when a deal changed stage`, () => updateDoc(staged(), { stageChangedAtMs: 1 }))
  await deny(`${who} cannot stamp when a deal closed`, () => updateDoc(staged(), { closedAtMs: 1 }))
  await deny(`${who} cannot write a lost reason`, () => updateDoc(staged(), { lostReason: 'No budget' }))
  await deny(`${who} cannot slip a stage in beside an edit`, () =>
    updateDoc(staged(), { title: 'Renamed', stageId: 'negotiation' }),
  )
  await deny(`${who} cannot move a deal with the apps' merged write`, () =>
    setDoc(staged(), { stageId: 'negotiation' }, { merge: true }),
  )
  await deny(`${who} cannot reopen a lost deal`, () =>
    updateDoc(ref(name, 'deals', 'deal-lost'), { stageId: 'qualification', status: 'open' }),
  )
  await deny(`${who} cannot clear a lost reason`, () =>
    updateDoc(ref(name, 'deals', 'deal-lost'), { lostReason: deleteField() }),
  )

  // What the console's drawer and products card, and the apps' edit sheet, write today.
  await allow(`${who} still edits a deal's fields in a stage`, () =>
    updateDoc(staged(), { title: `Edited by ${name}`, titleLower: 'edited', amountCents: 500, notes: 'Note', updatedAt: new Date() }),
  )
  await allow(`${who} still sets a deal's probability and forecast category`, () =>
    updateDoc(staged(), { probability: 40, forecastCategory: 'best-case' }),
  )
  await allow(`${who} still clears a deal's probability`, () => updateDoc(staged(), { probability: deleteField() }))
  await allow(`${who} still sets a deal's owner`, () => updateDoc(staged(), { ownerUid: uidOf(name) }))
  await allow(`${who} still saves with the apps' merged write`, () =>
    setDoc(staged(), { nextStep: 'Call', updatedAt: new Date() }, { merge: true }),
  )
  // A write that repeats the stage it holds changes nothing, so it is no move.
  await allow(`${who} may save a deal repeating the stage it is in`, () =>
    updateDoc(staged(), { title: 'Same stage', pipelineId: 'default', stageId: 'qualification', status: 'open' }),
  )
  await allow(`${who} still edits a closed deal`, () => updateDoc(ref(name, 'deals', 'deal-lost'), { notes: 'Later' }))

  // A create still sets the first stage, as the drawer and the apps do.
  const scope = STAGE_WRITERS_SCOPED.has(name) ? SITE_TOKEN : ORG_TOKEN
  await allow(`${who} still creates a deal in its first stage`, () =>
    creates(name, 'deals', { ...DEAL_IN_A_STAGE, title: 'New', visibleTo: [scope] }),
  )
  // Closing is the route's, on a create too: its stamps and its events travel with it.
  await deny(`${who} cannot create a deal already won`, () =>
    creates(name, 'deals', { ...DEAL_IN_A_STAGE, title: 'New', visibleTo: [scope], status: 'won' }),
  )
  await deny(`${who} cannot create a deal already lost`, () =>
    creates(name, 'deals', {
      ...DEAL_IN_A_STAGE,
      title: 'New',
      visibleTo: [scope],
      status: 'lost',
      lostReason: 'Went elsewhere',
    }),
  )
}
await deny('a member without "Manage data" cannot move a deal either', () =>
  updateDoc(ref('viewer', 'deals', 'deal-staged'), { stageId: 'negotiation' }),
)
await deny('a member a custom role refuses "Manage data" cannot edit a deal in a stage', () =>
  updateDoc(ref('editorRefusedData', 'deals', 'deal-staged'), { title: 'Refused' }),
)
await allow('staff keep their support create of a closed deal', () =>
  setDoc(doc(as('uid-ca-staff', { staff: true }), 'orgs', ORG, 'deals', 'staff-closed'), {
    ...DEAL_IN_A_STAGE,
    visibleTo: [ORG_TOKEN],
    status: 'won',
  }),
)
await allow('staff keep their support write to a deal', () =>
  updateDoc(doc(as('uid-ca-staff', { staff: true }), 'orgs', ORG, 'deals', 'deal-staged'), { stageId: 'qualification', notes: 'Support' }),
)
// A contact's stage and lifecycle live in its holder's facet, and the whole
// document is already the server's: `crm/contact-stage` is the way they move.
for (const [name, who] of STAGE_WRITERS) {
  await deny(`${who} cannot write a contact's lifecycle stage`, () =>
    updateDoc(ref(name, 'contacts', 'contact-site'), { 'facets.group-site.lifecycleStage': 'customer' }),
  )
}

/*
 * A COLLEAGUE'S PERSONAL EMAIL TEMPLATE. Every member who could tidy one before the
 * key existed still can, row by row: the verdict is the row's "Manage data" and its
 * reach, and only a refusal of the key itself takes it away.
 */
const TEMPLATE_AUTHOR = 'uid-ca-template-author'
const TEMPLATE = {
  name: 'Follow-up',
  subject: 'Hello',
  body: 'Still keen?',
  kind: 'template',
  hostId: HOST,
  visibleTo: [SITE_TOKEN],
  createdByUid: TEMPLATE_AUTHOR,
  createdAtMs: 1,
  updatedAtMs: 1,
}
const PERSONAL_TEMPLATE = { ...TEMPLATE, visibility: 'personal', ownerUid: TEMPLATE_AUTHOR }
const SHARED_TEMPLATE = { ...TEMPLATE, visibility: 'shared' }
const seedTemplate = (db, id, fields) => {
  seeded.push(['orgs', ORG, 'crmEmailTemplates', id])
  return setDoc(doc(db, 'orgs', ORG, 'crmEmailTemplates', id), fields)
}
const TEMPLATE_ROWS = [
  ...ROWS.map(([name, data, , orgWide, who]) => [name, data && orgWide, who]),
  ['adminRefusedTemplates', false, 'an admin a custom role refuses the key'],
  ['editorOverrideRefusedTemplates', false, 'an editor never stamped, whose own override refuses the key'],
  ['collabGrantedTemplates', false, 'a site collaborator granted the key, whose reach is still one site'],
]
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const [name] of TEMPLATE_ROWS) {
    await seedTemplate(db, `personal-${name}`, PERSONAL_TEMPLATE)
    await seedTemplate(db, `delete-${name}`, PERSONAL_TEMPLATE)
  }
  await seedTemplate(db, 'shared-site', SHARED_TEMPLATE)
})
for (const [name, tidies, who] of TEMPLATE_ROWS) {
  await expectThat(tidies, `${who} ${tidies ? 'may' : 'may not'} change a colleague's personal template`, () =>
    updateDoc(ref(name, 'crmEmailTemplates', `personal-${name}`), { name: 'Tidied' }),
  )
  await expectThat(tidies, `${who} ${tidies ? 'may' : 'may not'} delete a colleague's personal template`, () =>
    deleteDoc(ref(name, 'crmEmailTemplates', `delete-${name}`)),
  )
}
// Refused the key, an admin is left what any member of the site has.
await allow('an admin refused the key still changes a shared template', () =>
  updateDoc(ref('adminRefusedTemplates', 'crmEmailTemplates', 'shared-site'), { body: 'Still there?' }),
)
await deny('an admin refused the key cannot re-file a shared template', () =>
  updateDoc(ref('adminRefusedTemplates', 'crmEmailTemplates', 'shared-site'), { visibleTo: [ORG_TOKEN] }),
)
await allow('an admin holding the key can', () =>
  updateDoc(ref('admin', 'crmEmailTemplates', 'shared-site'), { visibleTo: [ORG_TOKEN] }),
)

/*
 * NEGATIVE CONTROL. The same artifact without the two clauses this lane added: what
 * refused the rows above was those clauses and nothing else. Each replacement is
 * asserted to have matched, so a rename cannot turn this into nothing.
 */
{
  let open = RULES
  const take = (needle, replacement) => {
    if (!open.includes(needle)) throw new Error(`The negative control no longer matches ${needle}`)
    open = open.replace(needle, replacement)
  }
  take("memberKeyOrOverride('crm.colleagueTemplates', ['owner', 'admin', 'editor', 'viewer'])", 'true')
  take("request.resource.data.get('status', 'open') == 'open'", 'true')
  const controlEnv = await initializeTestEnvironment({
    projectId: 'aglyn-crm-audience-control',
    firestore: { host: emulatorHost, port: Number(emulatorPort), rules: open },
  })
  await controlEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'orgs', ORG), { name: 'CRM audience keys', slug: 'crm-audience-keys', plan: 'agency' })
    await setDoc(doc(db, 'orgs', ORG, 'members', uidOf('adminRefusedTemplates')), MEMBERS.adminRefusedTemplates)
    await setDoc(doc(db, 'orgs', ORG, 'crmEmailTemplates', 'personal'), PERSONAL_TEMPLATE)
  })
  const db = controlEnv.authenticatedContext(uidOf('adminRefusedTemplates'), { email_verified: true }).firestore()
  await allow('control: without the clause, an admin refused the key changes a colleague\'s template', () =>
    updateDoc(doc(db, 'orgs', ORG, 'crmEmailTemplates', 'personal'), { name: 'Tidied' }),
  )
  await allow('control: without the clause, a client creates a deal already won', () =>
    setDoc(doc(db, 'orgs', ORG, 'deals', 'won'), { ...DEAL_IN_A_STAGE, visibleTo: [ORG_TOKEN], status: 'won' }),
  )
  await controlEnv.cleanup()
}

// Remove ONLY what this spec seeded.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const path of seeded.reverse()) await deleteDoc(doc(db, ...path))
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
