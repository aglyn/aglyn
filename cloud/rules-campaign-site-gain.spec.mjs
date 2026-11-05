/**
 * A campaign container adds the site's verdict, and nobody loses (AGL-4047).
 *
 * `canWriteCampaignContainers()` is the workspace's verdict on "Run email
 * campaigns". `canWriteOneSiteCampaign()` adds, on a campaign placed on exactly
 * one site, that site's verdict as the campaign routes read it, for a member
 * with access to the site. It adds and takes nothing away, so:
 *
 *   - every Yes in the table's `before` column is still a Yes, including the
 *     rows where the rule allows and the route refuses, which stay on purpose;
 *   - the only cells that move are create and update on the one site, and only
 *     for a member the route already admits there;
 *   - a campaign on every site or on several answers exactly as it did.
 *
 * The principals, their `scopeTokens` and both hosts' stamps are in
 * `rules-fixtures/campaign-verdict-principals.json`, written by the real
 * projections and held to them by
 * `libs/plugins/marketing/src/lib/model/campaign-verdict-table.spec.ts`. A
 * collaborator's real tokens are `['org', 'host:x']`. That `'org'` is what a
 * hand-written `[SITE_TOKEN]` fixture hides: the table's Yes on a workspace-wide
 * campaign for a collaborator on the editor role is today's real answer, and
 * this lane deliberately leaves it as it is.
 *
 * The rows below the table are the ones the table cannot show: a site in another
 * workspace, a site the projection has not reached, a suspended site, a
 * placement that only looks like one site, and the writes a Yes today must
 * survive whatever the new branch makes of them.
 *
 * Run through `npm run test:rules`, or by hand from the repo root:
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-campaign-site-gain.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'

const TABLE = JSON.parse(readFileSync('cloud/rules-fixtures/campaign-verdict-principals.json', 'utf8'))
const ORG = 'org-campaign-site-gain'
const HERE = 'host-h'
const OTHER = 'host-other'
const KEY = 'marketing.campaigns'
const token = (hostId) => `host:${hostId}`

const byName = (name) => {
  const row = TABLE.rows.find((candidate) => candidate.name === name)
  if (!row) throw new Error(`No row named ${name}`)
  return row
}
/** Holds the workspace's verdict: admitted before, and by the same branch now. */
const WORKSPACE_EDITOR = byName('editor')
/** The whole workspace's viewer, Editor on the one site: gains, and `isOrgWideMember` is true. */
const RAISED_VIEWER = byName('workspace viewer raised to Editor here')
/** A site collaborator, Admin of the one site, on the viewer role: gains. */
const COLLABORATOR = byName('collaborator (viewer doc) site Admin')
/** A site collaborator, Author of the one site: gains nothing. */
const AUTHOR = byName('collaborator (viewer doc) site Author')
const WORKSPACE_VIEWER = byName('viewer')

/** A copy of the collaborator, stamped suspended by the projection. */
const SUSPENDED_UID = 'uid-suspended'
/** In the site's projection and no member of this workspace. */
const STRANGER_UID = 'uid-stranger'

const editorHere = { [KEY]: true }
const HOSTS = {
  ...Object.fromEntries(Object.entries(TABLE.hosts).map(([id, stamp]) => [id, { orgId: ORG, ...stamp }])),
  // Another workspace's site, where the raised viewer and the collaborator are Admins.
  'host-foreign': {
    orgId: 'org-elsewhere',
    memberRoles: { [RAISED_VIEWER.uid]: 'admin', [COLLABORATOR.uid]: 'admin' },
    memberPermissions: { [RAISED_VIEWER.uid]: editorHere, [COLLABORATOR.uid]: editorHere },
  },
  // A site the projection has not reached since the key existed: the role's preset.
  'host-unstamped': {
    orgId: ORG,
    memberRoles: { [RAISED_VIEWER.uid]: 'editor', [WORKSPACE_VIEWER.uid]: 'author' },
  },
  // A stamp with no role: no access to the site, whatever the stamp says.
  'host-stamp-only': {
    orgId: ORG,
    memberRoles: {},
    memberPermissions: { [WORKSPACE_VIEWER.uid]: editorHere },
  },
  'host-suspended': {
    orgId: ORG,
    suspendedAt: 1,
    memberRoles: { [RAISED_VIEWER.uid]: 'admin' },
    memberPermissions: { [RAISED_VIEWER.uid]: editorHere },
  },
  // No workspace named at all.
  'host-no-org': {
    memberRoles: { [RAISED_VIEWER.uid]: 'admin' },
    memberPermissions: { [RAISED_VIEWER.uid]: editorHere },
  },
}
HOSTS[HERE] = {
  ...HOSTS[HERE],
  memberRoles: { ...HOSTS[HERE].memberRoles, [SUSPENDED_UID]: 'admin', [STRANGER_UID]: 'admin' },
  memberPermissions: { ...HOSTS[HERE].memberPermissions, [STRANGER_UID]: editorHere, [SUSPENDED_UID]: editorHere },
}

const memberDoc = (row) => ({
  ...row.member,
  scopeTokens: row.scopeTokens,
  resolvedPermissions: { [KEY]: row.resolvedKey },
})

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
const expectThat = (allowed, label, fn) => (allowed ? allow : deny)(label, fn)

const seeded = []
const seedDoc = async (path, data) => {
  seeded.push(path)
  await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), ...path), data))
}

const campaignPath = (id) => ['orgs', ORG, 'emailCampaigns', id]
const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
const campaign = (uid, id, claims) => {
  const path = campaignPath(id)
  seeded.push(path)
  return doc(as(uid, claims), ...path)
}
const seedCampaign = (id, visibleTo) =>
  seedDoc(campaignPath(id), { name: 'Seed', ...(visibleTo ? { visibleTo } : {}) })

for (const [hostId, data] of Object.entries(HOSTS)) await seedDoc(['hosts', hostId], data)
for (const row of TABLE.rows) await seedDoc(['orgs', ORG, 'members', row.uid], memberDoc(row))
await seedDoc(['orgs', ORG, 'members', SUSPENDED_UID], { ...memberDoc(COLLABORATOR), orgSuspended: true })

/*
 * ── EVERY ROW OF THE TABLE ─────────────────────────────────────────────────
 * Each write gets a document of its own, because an allowed re-scope moves the
 * one it wrote.
 */
const PLACEMENT = { here: [token(HERE)], org: ['org'], other: [token(OTHER)], two: [token(HERE), token(OTHER)] }
const WRITES = {
  createHere: (row, id) => setDoc(campaign(row.uid, id), { name: 'New', visibleTo: PLACEMENT.here }),
  createOrg: (row, id) => setDoc(campaign(row.uid, id), { name: 'New', visibleTo: PLACEMENT.org }),
  createOther: (row, id) => setDoc(campaign(row.uid, id), { name: 'New', visibleTo: PLACEMENT.other }),
  updateHere: (row, id) => updateDoc(campaign(row.uid, id), { name: 'Renamed' }),
  updateOrg: (row, id) => updateDoc(campaign(row.uid, id), { name: 'Renamed' }),
  updateOther: (row, id) => updateDoc(campaign(row.uid, id), { name: 'Renamed' }),
  updateTwoSites: (row, id) => updateDoc(campaign(row.uid, id), { name: 'Renamed' }),
  rescopeHere: (row, id) => updateDoc(campaign(row.uid, id), { visibleTo: PLACEMENT.two }),
}
const SEEDED_AT = {
  updateHere: PLACEMENT.here,
  updateOrg: PLACEMENT.org,
  updateOther: PLACEMENT.other,
  updateTwoSites: PLACEMENT.two,
  rescopeHere: PLACEMENT.here,
}
for (const row of TABLE.rows) {
  for (const [write, run] of Object.entries(WRITES)) {
    const id = `${row.uid}-${write}`
    if (SEEDED_AT[write]) await seedCampaign(id, SEEDED_AT[write])
    await expectThat(row.after[write], `${row.name}: ${write} ${row.after[write] ? 'allowed' : 'refused'}`, () => run(row, id))
  }
  await seedCampaign(`${row.uid}-delete`, PLACEMENT.here)
  await deny(`${row.name}: a client delete stays the manage route's`, () => deleteDoc(campaign(row.uid, `${row.uid}-delete`)))
}

/*
 * ── THE TABLE ITSELF ───────────────────────────────────────────────────────
 * Nobody's Yes turns No, the only cells that move are the two on the one site,
 * and they move only for a member the route admits there.
 */
for (const row of TABLE.rows) {
  for (const write of Object.keys(WRITES)) {
    await check(`${row.name}: ${write} keeps every Yes and moves only by the gain`, async () => {
      const moved = row.after[write] !== row.before[write]
      if (row.before[write] && !row.after[write]) throw new Error('A Yes turned No')
      if (moved && !(['createHere', 'updateHere'].includes(write) && row.routeSite)) {
        throw new Error('A cell moved that the gain does not cover')
      }
    })
  }
}
const gained = TABLE.rows.filter((row) => row.after.updateHere !== row.before.updateHere).map((row) => row.name)
await check('the gain reaches exactly the members the route admits and the rule refused', async () => {
  const expected = TABLE.rows.filter((row) => row.routeSite && !row.before.updateHere).map((row) => row.name)
  if (gained.join('|') !== expected.join('|') || gained.length === 0) throw new Error(gained.join('|'))
})

/*
 * ── A SITE THAT IS NOT THIS WORKSPACE'S, OR NOT ANSWERING ──────────────────
 */
for (const row of [RAISED_VIEWER, COLLABORATOR]) {
  await deny(`${row.name}: being a site's Admin in another workspace creates nothing here`, () =>
    setDoc(campaign(row.uid, `${row.uid}-foreign-create`), { name: 'New', visibleTo: [token('host-foreign')] }),
  )
  await seedCampaign(`${row.uid}-foreign-update`, [token('host-foreign')])
  await deny(`${row.name}: nor edits a campaign placed on that site`, () =>
    updateDoc(campaign(row.uid, `${row.uid}-foreign-update`), { name: 'Renamed' }),
  )
}
await allow('a site the projection has not reached answers by the preset: an Editor there', () =>
  setDoc(campaign(RAISED_VIEWER.uid, 'unstamped-editor'), { name: 'New', visibleTo: [token('host-unstamped')] }),
)
await deny('a site the projection has not reached answers by the preset: an Author there', () =>
  setDoc(campaign(WORKSPACE_VIEWER.uid, 'unstamped-author'), { name: 'New', visibleTo: [token('host-unstamped')] }),
)
await deny('a stamp without access to the site admits nobody', () =>
  setDoc(campaign(WORKSPACE_VIEWER.uid, 'stamp-only'), { name: 'New', visibleTo: [token('host-stamp-only')] }),
)
await deny('a suspended site adds nobody', () =>
  setDoc(campaign(RAISED_VIEWER.uid, 'suspended-site'), { name: 'New', visibleTo: [token('host-suspended')] }),
)
await deny('a site naming no workspace adds nobody', () =>
  setDoc(campaign(RAISED_VIEWER.uid, 'no-org-site'), { name: 'New', visibleTo: [token('host-no-org')] }),
)
await deny('a site that does not exist adds nobody', () =>
  setDoc(campaign(RAISED_VIEWER.uid, 'missing-site'), { name: 'New', visibleTo: [token('host-missing')] }),
)

/*
 * ── WHAT IS NOT THE SITE STAYS ─────────────────────────────────────────────
 */
await deny('an unverified site Admin gains nothing', () =>
  setDoc(campaign(COLLABORATOR.uid, 'unverified', { email_verified: false }), { name: 'New', visibleTo: PLACEMENT.here }),
)
await deny('a suspended workspace’s site Admin gains nothing', () =>
  setDoc(campaign(SUSPENDED_UID, 'suspended-org'), { name: 'New', visibleTo: PLACEMENT.here }),
)
await deny('a site Admin who is no member of this workspace gains nothing', () =>
  setDoc(campaign(STRANGER_UID, 'stranger'), { name: 'New', visibleTo: PLACEMENT.here }),
)
await deny('a site Author gains nothing', () =>
  setDoc(campaign(AUTHOR.uid, 'author'), { name: 'New', visibleTo: PLACEMENT.here }),
)

/*
 * ── EXACTLY ONE SITE ───────────────────────────────────────────────────────
 * The raised viewer is the sharp case: `isOrgWideMember` is true, so nothing
 * else on the create or the update stands between them and these.
 */
const NOT_ONE_SITE = [
  ['the site beside the whole workspace', [token(HERE), 'org']],
  ['the site twice', [token(HERE), token(HERE)]],
  ['two sites', [token(HERE), token(OTHER)]],
  ['the whole workspace', ['org']],
  ['nowhere', []],
  ['a bare prefix', ['host:']],
  ['a token with a second part', [`${token(HERE)}:x`]],
  ['a token holding a path', [`${token(HERE)}/x`]],
  ['a string, not a list', token(HERE)],
]
for (const [what, visibleTo] of NOT_ONE_SITE) {
  await deny(`the site's verdict does not create a campaign placed on ${what}`, () =>
    setDoc(campaign(RAISED_VIEWER.uid, `shape-${what.replaceAll(' ', '-')}`), { name: 'New', visibleTo }),
  )
}
await deny('the site’s verdict does not create a campaign placed nowhere at all', () =>
  setDoc(campaign(RAISED_VIEWER.uid, 'shape-absent'), { name: 'New' }),
)
for (const row of [RAISED_VIEWER, COLLABORATOR]) {
  for (const [what, visibleTo] of [
    ['the whole workspace', ['org']],
    ['another site', [token(OTHER)]],
    ['nowhere', []],
  ]) {
    const id = `${row.uid}-move-${what.replaceAll(' ', '-')}`
    await seedCampaign(id, PLACEMENT.here)
    await deny(`${row.name}: the site's verdict does not move a campaign to ${what}`, () =>
      updateDoc(campaign(row.uid, id), { visibleTo }),
    )
  }
}

/*
 * ── A YES TODAY THAT THE NEW BRANCH MUST NOT DISTURB ───────────────────────
 * Whatever the second branch would make of these, it cannot take them from a
 * member the first branch admits.
 */
for (const [what, visibleTo] of [
  ['a site that does not exist', [token('host-missing')]],
  ['another workspace’s site', [token('host-foreign')]],
  ['a suspended site', [token('host-suspended')]],
  ['nowhere', []],
]) {
  await allow(`the workspace’s verdict still creates a campaign placed on ${what}`, () =>
    setDoc(campaign(WORKSPACE_EDITOR.uid, `ws-create-${what.replaceAll(' ', '-')}`), { name: 'New', visibleTo }),
  )
  await seedCampaign(`ws-update-${what.replaceAll(' ', '-')}`, visibleTo)
  await allow(`the workspace’s verdict still edits a campaign placed on ${what}`, () =>
    updateDoc(campaign(WORKSPACE_EDITOR.uid, `ws-update-${what.replaceAll(' ', '-')}`), { name: 'Renamed' }),
  )
}
await allow('the workspace’s verdict still creates a campaign with no placement', () =>
  setDoc(campaign(WORKSPACE_EDITOR.uid, 'ws-create-absent'), { name: 'New' }),
)
await seedCampaign('ws-update-absent', null)
await allow('the workspace’s verdict still edits a campaign with no placement', () =>
  updateDoc(campaign(WORKSPACE_EDITOR.uid, 'ws-update-absent'), { name: 'Renamed' }),
)

/*
 * ── READS DID NOT MOVE ─────────────────────────────────────────────────────
 * Gate writes, not reads: the list a collaborator's site hub sends stays
 * provable, and the unfiltered one stays refused (AGL-1047).
 */
const memberCampaigns = (uid) => collection(as(uid), 'orgs', ORG, 'emailCampaigns')
await allow('a collaborator’s filtered list is still provable', () =>
  getDocs(query(memberCampaigns(COLLABORATOR.uid), where('visibleTo', 'array-contains-any', COLLABORATOR.scopeTokens))),
)
await deny('a collaborator’s unfiltered list is still refused', () => getDocs(memberCampaigns(COLLABORATOR.uid)))

/*
 * ── THE FIXTURE IS THE REAL ONE ────────────────────────────────────────────
 */
await check('every collaborator in the table carries the real tokens, `org` included', async () => {
  const collaborators = TABLE.rows.filter((row) => row.member.allHosts === false)
  if (!collaborators.length) throw new Error('No collaborators')
  for (const row of collaborators) {
    if (row.scopeTokens.join() !== `org,${token(HERE)}`) throw new Error(`${row.name}: ${row.scopeTokens}`)
  }
})

for (const path of seeded) {
  await env.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), ...path)))
}
await env.cleanup()

const failures = results.filter(([state]) => state === 'FAIL')
console.log(`${results.length - failures.length}/${results.length} passed`)
for (const [, label, message] of failures) console.log(`FAIL ${label}\n     ${message}`)
process.exit(failures.length ? 1 : 0)
