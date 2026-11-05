/**
 * A dataset on one site answers to that site, and its records take a key to read
 * (AGL-4047).
 *
 * Every kind of member in `rules-fixtures/dataset-access-principals.json` against
 * every client-direct write and read on a dataset placed on this one site, on
 * every site, on two sites, and on another site alone. The fixture's principals,
 * their `scopeTokens`, their resolved keys and both hosts' stamps are written by
 * the real projections and held to them by
 * `libs/plugins/data/src/lib/model/dataset-access-table.spec.ts`, which also
 * asks the routes and the console over the same rows, so no fixture here is
 * hand-written. A collaborator's real tokens are `['org', 'host:x']`.
 *
 * `before` is what the rules answered before this change, measured by this file
 * against them, and `after` is what they answer now. The rows below the table
 * are the ones it cannot show: a site in another workspace, a site the projection
 * has not reached, a suspended site, and staff.
 *
 * Run through `npm run test:rules`, or by hand from the repo root:
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-dataset-access.spec.mjs
 *
 * `DATASET_ACCESS_RULES=<file>` asks another rules file, and
 * `DATASET_ACCESS_WRITE=before|after` records what it answered in the fixture.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'

const FIXTURE = 'cloud/rules-fixtures/dataset-access-principals.json'
const TABLE = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const ORG = 'org-dataset-access'
const HERE = 'host-h'
const OTHER = 'host-other'
const PLACEMENTS = {
  here: [`host:${HERE}`],
  org: ['org'],
  two: [`host:${HERE}`, `host:${OTHER}`],
  other: [`host:${OTHER}`],
}

const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082').split(':')
const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: emulatorHost,
    port: Number(emulatorPort),
    // The comment-stripped artifact is what deploys (AGL-3544).
    rules: readFileSync(process.env.DATASET_ACCESS_RULES || 'cloud/firebase-firestore.deploy.rules', 'utf8'),
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

const seed = (path, data) =>
  env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), ...path), data))
const as = (uid, claims = {}) => env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()
const datasetPath = (id) => ['orgs', ORG, 'datasets', id]
const recordPath = (id) => [...datasetPath(id), 'records', 'r1']

const seedDataset = async (id, visibleTo) => {
  await seed(datasetPath(id), { displayName: id, visibleTo, model: { order: [], fields: {} } })
  await seed(recordPath(id), { values: { a: 1 } })
}
const seedDatasets = async () => {
  for (const [id, visibleTo] of Object.entries(PLACEMENTS)) await seedDataset(id, visibleTo)
}

for (const [id, stamp] of Object.entries(TABLE.hosts)) await seed(['hosts', id], { orgId: ORG, ...stamp })
for (const row of TABLE.rows) {
  await seed(['orgs', ORG, 'members', row.uid], { ...row.member, scopeTokens: row.scopeTokens, resolvedPermissions: row.resolved })
}
await seedDatasets()

/** Each client-direct act, and whether it changes what the next one finds. */
const write = (fn) => ({ fn, writes: true })
const read = (fn) => ({ fn, writes: false })
const CELLS = {
  schemaHere: write((db) => updateDoc(doc(db, ...datasetPath('here')), { model: { order: [], fields: {}, v: 2 } })),
  schemaOrg: write((db) => updateDoc(doc(db, ...datasetPath('org')), { model: { order: [], fields: {}, v: 2 } })),
  schemaTwo: write((db) => updateDoc(doc(db, ...datasetPath('two')), { model: { order: [], fields: {}, v: 2 } })),
  schemaOther: write((db) => updateDoc(doc(db, ...datasetPath('other')), { model: { order: [], fields: {}, v: 2 } })),
  shareHere: write((db) => updateDoc(doc(db, ...datasetPath('here')), { visibleTo: ['org'] })),
  shareOrg: write((db) => updateDoc(doc(db, ...datasetPath('org')), { visibleTo: [`host:${HERE}`] })),
  recordEditHere: write((db) => updateDoc(doc(db, ...recordPath('here')), { values: { a: 2 } })),
  recordEditOrg: write((db) => updateDoc(doc(db, ...recordPath('org')), { values: { a: 2 } })),
  recordEditTwo: write((db) => updateDoc(doc(db, ...recordPath('two')), { values: { a: 2 } })),
  recordEditOther: write((db) => updateDoc(doc(db, ...recordPath('other')), { values: { a: 2 } })),
  recordDeleteHere: write((db) => deleteDoc(doc(db, ...recordPath('here')))),
  recordDeleteOrg: write((db) => deleteDoc(doc(db, ...recordPath('org')))),
  readRecordsHere: read((db) => getDocs(collection(db, ...datasetPath('here'), 'records'))),
  readRecordsOrg: read((db) => getDocs(collection(db, ...datasetPath('org'), 'records'))),
}

/** What Firestore answers one member for one act. */
const answer = async (row, cell) => {
  const { fn, writes } = CELLS[cell]
  try {
    await assertSucceeds(fn(as(row.uid)))
    if (writes) await seedDatasets()
    return true
  } catch {
    return false
  }
}

const measured = {}
for (const row of TABLE.rows) {
  measured[row.name] = {}
  for (const cell of Object.keys(CELLS)) measured[row.name][cell] = await answer(row, cell)
}

const recording = process.env.DATASET_ACCESS_WRITE
if (recording) {
  for (const row of TABLE.rows) row[recording] = measured[row.name]
  writeFileSync(FIXTURE, `${JSON.stringify(TABLE, null, 1)}\n`)
} else {
  for (const row of TABLE.rows) {
    for (const cell of Object.keys(CELLS)) {
      await check(`${row.name}: ${cell} answers ${row.after[cell]}`, async () => {
        if (measured[row.name][cell] !== row.after[cell]) throw new Error(`answered ${measured[row.name][cell]}`)
      })
    }
  }
}

/*
 * ── WHAT THE TABLE CANNOT SHOW ─────────────────────────
 */
const byName = (name) => {
  const row = TABLE.rows.find((candidate) => candidate.name === name)
  if (!row) throw new Error(`No row named ${name}`)
  return row
}
const SITE_EDITOR = byName('collaborator (viewer doc) site Editor')
const RAISED = byName('viewer raised to Editor here')
const EDITOR = byName('editor')
const REFUSED_EDITOR = byName('member override refuses Manage data and Delete: editor')
const REFUSED_ADMIN = byName('member override refuses Manage data and Delete: admin')
const NARROWED = byName('editor narrowed to Viewer here')
const VIEWER = byName('viewer')
const edit = (uid, id) => () => updateDoc(doc(as(uid), ...recordPath(id)), { values: { a: 3 } })
const schema = (uid, id) => () => updateDoc(doc(as(uid), ...datasetPath(id)), { model: { order: [], fields: {}, v: 3 } })

const placeOn = async (id, hostId, stamp) => {
  await seed(['hosts', hostId], stamp)
  await seedDataset(id, [`host:${hostId}`])
}

// Another workspace's site, where the collaborator is an Admin: being an Admin there decides nothing here.
await placeOn('foreign', 'host-foreign', {
  orgId: 'org-elsewhere',
  memberRoles: { [SITE_EDITOR.uid]: 'admin', [RAISED.uid]: 'admin' },
  memberPermissions: { [SITE_EDITOR.uid]: { 'data.siteManage': true }, [RAISED.uid]: { 'data.siteManage': true } },
})
await deny('a site in another workspace adds nobody (record)', edit(RAISED.uid, 'foreign'))
await deny('a site in another workspace adds nobody (schema)', schema(RAISED.uid, 'foreign'))

// A site the projection has not reached since the key existed.
await placeOn('unstamped', 'host-unstamped', {
  orgId: ORG,
  memberRoles: {
    [RAISED.uid]: 'editor',
    [VIEWER.uid]: 'author',
    [EDITOR.uid]: 'editor',
    [REFUSED_EDITOR.uid]: 'editor',
    [REFUSED_ADMIN.uid]: 'admin',
    [NARROWED.uid]: 'viewer',
  },
})
await allow('unstamped: a viewer raised to Editor holds the preset', edit(RAISED.uid, 'unstamped'))
await deny('unstamped: a viewer at Author does not', edit(VIEWER.uid, 'unstamped'))
await allow('unstamped: an editor keeps the workspace key', edit(EDITOR.uid, 'unstamped'))
await deny('unstamped: an editor refused the key does not regain it from their site role', edit(REFUSED_EDITOR.uid, 'unstamped'))
await deny('unstamped: an admin refused the key does not regain it from their site role', edit(REFUSED_ADMIN.uid, 'unstamped'))

// A stamp with no role: no access to the site, whatever the stamp says.
await placeOn('stamp-only', 'host-stamp-only', {
  orgId: ORG,
  memberRoles: {},
  memberPermissions: { [VIEWER.uid]: { 'data.siteManage': true } },
})
await deny('a stamp with no site role adds nobody', edit(VIEWER.uid, 'stamp-only'))

// A suspended site adds nobody, and takes nothing from the workspace's key.
await placeOn('suspended', 'host-suspended', {
  orgId: ORG,
  suspendedAt: 1,
  memberRoles: { [RAISED.uid]: 'editor', [EDITOR.uid]: 'editor' },
  memberPermissions: { [RAISED.uid]: { 'data.siteManage': true }, [EDITOR.uid]: { 'data.siteManage': true } },
})
await deny('a suspended site adds nobody', edit(RAISED.uid, 'suspended'))

// A placement that only looks like one site.
await seedDataset('nested', ['host:a:b'])
await deny('a token that is not a site asks no site', edit(VIEWER.uid, 'nested'))

// An unverified address writes nothing, whatever the site says.
await deny('an unverified member is refused', () =>
  updateDoc(doc(env.authenticatedContext(RAISED.uid, { email_verified: false }).firestore(), ...recordPath('here')), { values: { a: 3 } }),
)

// Staff, and a dataset whose reads the published page never takes through here.
await allow('staff read the records whoever holds what', () =>
  getDocs(collection(as('uid-staff', { staff: true }), ...datasetPath('here'), 'records')),
)
await deny('a stranger reads no records', () => getDocs(collection(as('uid-stranger'), ...datasetPath('org'), 'records')))

// Reads did not move for the list a collaborator's Data page sends.
const collaboratorDatasets = collection(as(SITE_EDITOR.uid), 'orgs', ORG, 'datasets')
await allow('a collaborator’s filtered list of datasets is still provable', () =>
  getDocs(query(collaboratorDatasets, where('visibleTo', 'array-contains-any', SITE_EDITOR.scopeTokens))),
)
await deny('a collaborator’s unfiltered list of datasets is still refused', () => getDocs(collaboratorDatasets))

await check('every collaborator in the table carries the real tokens, `org` included', async () => {
  const collaborators = TABLE.rows.filter((row) => row.member.allHosts === false)
  if (!collaborators.length) throw new Error('No collaborators')
  for (const row of collaborators) {
    if (row.scopeTokens.join() !== `org,host:${HERE}`) throw new Error(`${row.name}: ${row.scopeTokens}`)
  }
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const id of [...Object.keys(PLACEMENTS), 'foreign', 'unstamped', 'stamp-only', 'suspended', 'nested']) {
    await deleteDoc(doc(db, ...recordPath(id)))
    await deleteDoc(doc(db, ...datasetPath(id)))
  }
})
await env.cleanup()

const failures = results.filter(([state]) => state === 'FAIL')
console.log(`${results.length - failures.length}/${results.length} passed`)
for (const [, label, message] of failures) console.log(`FAIL ${label}\n     ${message}`)
process.exit(failures.length ? 1 : 0)
