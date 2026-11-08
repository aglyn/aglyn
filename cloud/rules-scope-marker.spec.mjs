/**
 * "All sites except some": the marker is the server's, and it takes one-site
 * verdicts away (AGL-4047).
 *
 * A document shared that way holds the sites it reaches today in `visibleTo` and
 * carries `scopeMode` and `scopeExcept` beside it. This file pins four things, in
 * the comment-stripped artifact that deploys:
 *
 *   1. FROZEN. No client creates a document with either key, or adds, changes,
 *      removes or nulls either, in any collection the sweep walks, whatever the
 *      member holds. The sweep and the routes use the admin SDK. The same member's
 *      plain edit of the same document passes, so each refusal is about the marker.
 *   2. NO ONE-SITE VERDICT. A marked document down to one site answers exactly as
 *      one on several sites, for every member kind in the two measured tables, so
 *      an except list shrinking to one site hands that site's Admins nothing. A
 *      field delete brings the verdict back; a stored null does not.
 *   3. 250 TOKENS. `hasAny` answers with `visibleTo` and a member's tokens at 250,
 *      and the list queries stay provable: filtered passes, unfiltered is refused.
 *      Measured in the emulator, which is what can be measured.
 *   4. NEGATIVE CONTROL. The same rules with the freeze taken out let every forgery
 *      above through.
 *
 * Tokens come from the real `projectMemberScopeTokens`, or from the fixtures
 * `dataset-access-table.spec.ts` and `campaign-verdict-table.spec.ts` hold to it.
 *
 * Run through `npm run test:rules`, or by hand from the repo root:
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-scope-marker.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from 'firebase/firestore'

function workspaceAliases(paths) {
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    if (key.endsWith('/*')) alias[key.slice(0, -2)] = join(process.cwd(), target.replace(/\/\*$/, ''))
    else if (!(`${key}/*` in paths)) alias[key] = join(process.cwd(), target)
  }
  return alias
}
const { createJiti } = createRequire(import.meta.url)('jiti')
const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  fsCache: false,
  alias: workspaceAliases(JSON.parse(readFileSync('tsconfig.base.json', 'utf8')).compilerOptions.paths),
})
const { projectMemberScopeTokens } = await jiti.import(
  new URL('../libs/aglyn/src/lib/app-utils/organizations.ts', import.meta.url).pathname,
)
const { listScopeSharingCollections } = await jiti.import(
  new URL('../libs/aglyn/src/lib/plugin-manager/plugin-scope-sharing.ts', import.meta.url).pathname,
)

const RULES = readFileSync('cloud/firebase-firestore.deploy.rules', 'utf8')
const DATASET_TABLE = JSON.parse(readFileSync('cloud/rules-fixtures/dataset-access-principals.json', 'utf8'))
const CAMPAIGN_TABLE = JSON.parse(readFileSync('cloud/rules-fixtures/campaign-verdict-principals.json', 'utf8'))

const ORG = 'org-scope-marker'
const HERE = 'host-h'
const OTHER = 'host-other'
const ONE = [`host:${HERE}`]
const TWO = [`host:${HERE}`, `host:${OTHER}`]
const MARKER = { scopeMode: 'allExcept', scopeExcept: [`host:${OTHER}`] }

const [emulatorHost, emulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082').split(':')
const environment = async (projectId, rules = RULES) => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: emulatorHost, port: Number(emulatorPort), rules },
  })
  await env.clearFirestore()
  return env
}

const results = []
const check = async (label, fn) => {
  try {
    await fn()
    results.push(['PASS', label])
  } catch (error) {
    results.push(['FAIL', label, String(error).slice(0, 200)])
  }
}
const allow = (label, fn) => check(label, () => assertSucceeds(fn()))
const deny = (label, fn) => check(label, () => assertFails(fn()))
const passes = async (fn) => {
  try {
    await assertSucceeds(fn())
    return true
  } catch {
    return false
  }
}
const same = (label, actual, expected) =>
  check(label, async () => {
    if (actual !== expected) throw new Error(`answered ${actual}, expected ${expected}`)
  })

// One client per member: a context per call is most of what a table this size costs.
const contextOf = (env) => {
  const clients = new Map()
  const as = (uid, claims = {}) => {
    const key = `${uid}:${JSON.stringify(claims)}`
    if (!clients.has(key)) clients.set(key, env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore())
    return clients.get(key)
  }
  const seed = (path, data) => env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), ...path), data))
  return { as, seed }
}

/*
 * ── 1. FROZEN ──────────────────────────────────────────
 *
 * Every collection the sweep walks. `create: true` where a client creates one
 * today. `contacts` and `automations` take no client write at all, so no marker
 * can be forged there and there is no plain edit to compare with.
 */
const COLLECTIONS = {
  datasets: { writes: true, create: false, fields: { displayName: 'A', model: { order: [], fields: {} } } },
  // Since AGL-4047 no client creates or re-scopes media: uploads and every
  // sharing change go through Admin-SDK routes, and the rules freeze
  // `visibleTo` on a media document for clients.
  media: { writes: true, create: false, rescope: false, fields: { fileName: 'a.png' } },
  mediaFolders: { writes: true, create: true, fields: { name: 'A' } },
  emailCampaigns: { writes: true, create: true, fields: { name: 'A' } },
  leads: { writes: true, create: false, fields: { status: 'new' } },
  companies: { writes: true, create: true, fields: { name: 'A' } },
  deals: { writes: true, create: true, fields: { name: 'A', stageId: 's1' } },
  crmTasks: { writes: true, create: true, fields: { title: 'A' } },
  crmActivities: { writes: true, create: true, fields: { body: 'A' } },
  contacts: { writes: false, fields: { firstName: 'A' } },
  automations: { writes: false, fields: { name: 'A' } },
}

await check('this file covers every collection the sweep walks', async () => {
  const declared = listScopeSharingCollections().map(({ name }) => name).sort().join()
  const covered = Object.keys(COLLECTIONS).sort().join()
  if (declared !== covered) throw new Error(`declared ${declared}; covered ${covered}`)
})

const WRITERS = {
  owner: { role: 'owner', allHosts: true },
  editor: { role: 'editor', allHosts: true },
  // A collaborator on one site who holds every write key: the reach the freeze must also hold.
  siteOnly: { role: 'editor', allHosts: false, hostAccess: { [HERE]: 'admin' } },
}

const seedWorkspace = async (seed, org = ORG) => {
  await seed(['orgs', org], { name: 'Marker', slug: org, plan: 'agency', hosts: { [HERE]: true, [OTHER]: true } })
  for (const hostId of [HERE, OTHER]) {
    await seed(['hosts', hostId], { orgId: org, memberRoles: { siteOnly: 'admin', owner: 'admin', editor: 'editor' } })
  }
  for (const [uid, member] of Object.entries(WRITERS)) {
    await seed(['orgs', org, 'members', uid], { ...member, scopeTokens: projectMemberScopeTokens(member) })
  }
}

/** The forgeries on a document with no marker, and on one that has it. */
const FORGE_UNMARKED = {
  'adds scopeMode': (ref) => updateDoc(ref, { scopeMode: 'allExcept' }),
  'adds scopeExcept': (ref) => updateDoc(ref, { scopeExcept: [`host:${OTHER}`] }),
  'adds both': (ref) => updateDoc(ref, MARKER),
  'stores a null marker': (ref) => updateDoc(ref, { scopeMode: null, scopeExcept: null }),
}
const FORGE_MARKED = {
  'changes scopeMode': (ref) => updateDoc(ref, { scopeMode: 'selected' }),
  'changes scopeExcept': (ref) => updateDoc(ref, { scopeExcept: [] }),
  'removes scopeMode': (ref) => updateDoc(ref, { scopeMode: deleteField() }),
  'removes scopeExcept': (ref) => updateDoc(ref, { scopeExcept: deleteField() }),
  'removes both': (ref) => updateDoc(ref, { scopeMode: deleteField(), scopeExcept: deleteField() }),
  'nulls the marker': (ref) => updateDoc(ref, { scopeMode: null, scopeExcept: null }),
}
const CREATE_FORGERIES = {
  scopeMode: { scopeMode: 'allExcept' },
  scopeExcept: { scopeExcept: [`host:${OTHER}`] },
  both: MARKER,
  'a null marker': { scopeMode: null, scopeExcept: null },
}

const seedCollections = async (seed, org = ORG) => {
  for (const [name, { fields }] of Object.entries(COLLECTIONS)) {
    await seed(['orgs', org, name, 'plain'], { ...fields, visibleTo: ONE })
    await seed(['orgs', org, name, 'marked'], { ...fields, visibleTo: ONE, ...MARKER })
  }
}

{
  const env = await environment('aglyn-scope-marker-freeze')
  const { as, seed } = contextOf(env)
  await seedWorkspace(seed)
  await seedCollections(seed)
  let edits = 0

  for (const uid of Object.keys(WRITERS)) {
    const db = as(uid)
    for (const [name, { writes, create, fields }] of Object.entries(COLLECTIONS)) {
      const plain = doc(db, 'orgs', ORG, name, 'plain')
      const marked = doc(db, 'orgs', ORG, name, 'marked')
      const row = `${uid} on ${name}`

      if (!writes) {
        await allow(`${row}: reads a marked document`, () => getDoc(marked))
        await deny(`${row}: no client write, plain`, () => updateDoc(plain, { label: 'x' }))
        await deny(`${row}: no client write, forged`, () => updateDoc(plain, MARKER))
        continue
      }

      // The control: everything refused below differs from these only in the marker.
      await allow(`${row}: plain edit of a document with no marker`, () => updateDoc(plain, { label: `e${++edits}` }))
      await allow(`${row}: plain edit of a marked document keeps the marker`, () => updateDoc(marked, { label: `e${++edits}` }))
      for (const [act, forge] of Object.entries(FORGE_UNMARKED)) {
        await deny(`${row}: ${act}`, () => forge(plain))
      }
      for (const [act, forge] of Object.entries(FORGE_MARKED)) {
        await deny(`${row}: ${act}`, () => forge(marked))
      }
      await deny(`${row}: a whole-document save that drops the marker`, () =>
        setDoc(marked, { ...fields, visibleTo: ONE }),
      )
      await allow(`${row}: a whole-document save that carries the marker`, () =>
        setDoc(marked, { ...fields, visibleTo: ONE, ...MARKER }),
      )
      await deny(`${row}: an edit carrying a forged marker along with it`, () =>
        updateDoc(plain, { label: `e${++edits}`, ...MARKER }),
      )

      if (create) {
        await allow(`${row}: creates a document with no marker`, () =>
          setDoc(doc(db, 'orgs', ORG, name, `new-${uid}`), { ...fields, visibleTo: ONE }),
        )
        for (const [act, extra] of Object.entries(CREATE_FORGERIES)) {
          await deny(`${row}: creates one with ${act}`, () =>
            setDoc(doc(db, 'orgs', ORG, name, `forged-${uid}`), { ...fields, visibleTo: ONE, ...extra }),
          )
        }
      }
    }
  }

  // Staff keep the bypass every one of these rules gives them, for support.
  await allow('staff may correct a marker', () =>
    updateDoc(doc(as('uid-staff', { staff: true }), 'orgs', ORG, 'media', 'plain'), { scopeMode: 'allExcept' }),
  )
  await seed(['orgs', ORG, 'media', 'plain'], { ...COLLECTIONS.media.fields, visibleTo: ONE })

  // A client cannot re-scope a marked document, or it would leave the marker
  // describing sharing the document no longer has. Only the set-sharing route writes
  // the two together. A document with no marker re-scopes as it always has.
  for (const [name, { writes, rescope = true, fields }] of Object.entries(COLLECTIONS)) {
    if (!writes) continue
    await seed(['orgs', ORG, name, 're-scope'], { ...fields, visibleTo: ONE })
    for (const uid of ['owner', 'editor']) {
      const db = as(uid)
      await deny(`${uid} on ${name}: cannot widen a marked document`, () =>
        updateDoc(doc(db, 'orgs', ORG, name, 'marked'), { visibleTo: ['org'] }),
      )
      await deny(`${uid} on ${name}: cannot narrow a marked document`, () =>
        updateDoc(doc(db, 'orgs', ORG, name, 'marked'), { visibleTo: TWO }),
      )
      await deny(`${uid} on ${name}: cannot re-scope a marked document along with an edit`, () =>
        updateDoc(doc(db, 'orgs', ORG, name, 'marked'), { label: `e${++edits}`, visibleTo: TWO }),
      )
    }
    // Where no client re-scopes at all, the unmarked re-scope is denied too.
    const rescopes = rescope ? allow : deny
    await rescopes(`owner on ${name}: ${rescope ? 're-scopes' : 'cannot re-scope'} a document with no marker`, () =>
      updateDoc(doc(as('owner'), 'orgs', ORG, name, 're-scope'), { visibleTo: TWO }),
    )
    await rescopes(`editor on ${name}: ${rescope ? 're-scopes' : 'cannot re-scope'} a document with no marker`, () =>
      // The owner's attempt was refused, so the stored value is still ONE and
      // only a different value is a re-scope.
      updateDoc(doc(as('editor'), 'orgs', ORG, name, 're-scope'), { visibleTo: rescope ? ONE : TWO }),
    )
    await deny(`a collaborator on ${name}: cannot re-scope a marked document`, () =>
      updateDoc(doc(as('siteOnly'), 'orgs', ORG, name, 'marked'), { visibleTo: TWO }),
    )
  }

  await env.cleanup()
}

/*
 * ── 2. NO ONE-SITE VERDICT ─────────────────────────────
 *
 * Datasets, over every member kind in the measured table. Marked and on one site
 * must answer as on two, and differ from the same document unmarked.
 */
const DAMAGED = {
  marked: MARKER,
  'half a marker, scopeMode': { scopeMode: 'allExcept' },
  'half a marker, scopeExcept': { scopeExcept: [`host:${OTHER}`] },
  'a stored null': { scopeMode: null, scopeExcept: null },
}
const slug = (text) => text.replace(/[^a-z]+/gi, '-')

{
  const env = await environment('aglyn-scope-marker-datasets')
  const { as, seed } = contextOf(env)
  const datasetPath = (id) => ['orgs', ORG, 'datasets', id]
  const recordPath = (id) => [...datasetPath(id), 'records', 'r1']
  const seedDataset = async (id, visibleTo, extra = {}) => {
    await seed(datasetPath(id), { displayName: id, visibleTo, model: { order: [], fields: {} }, ...extra })
    await seed(recordPath(id), { values: { a: 1 } })
  }
  const IDS = { plain: [ONE, {}], two: [TWO, {}] }
  for (const [name, extra] of Object.entries(DAMAGED)) IDS[slug(name)] = [ONE, extra]
  const reseed = ([id, [visibleTo, extra]]) => seedDataset(id, visibleTo, extra)
  const seedAll = async () => {
    for (const entry of Object.entries(IDS)) await reseed(entry)
  }

  for (const [id, stamp] of Object.entries(DATASET_TABLE.hosts)) await seed(['hosts', id], { orgId: ORG, ...stamp })
  for (const row of DATASET_TABLE.rows) {
    await seed(['orgs', ORG, 'members', row.uid], {
      ...row.member,
      scopeTokens: row.scopeTokens,
      resolvedPermissions: row.resolved,
    })
  }
  await seedAll()

  const ACTS = {
    schema: (db, id) => updateDoc(doc(db, ...datasetPath(id)), { model: { order: [], fields: {}, v: 2 } }),
    recordEdit: (db, id) => updateDoc(doc(db, ...recordPath(id)), { values: { a: 2 } }),
    recordDelete: (db, id) => deleteDoc(doc(db, ...recordPath(id))),
  }
  const answer = async (row, act, id) => {
    const answered = await passes(() => ACTS[act](as(row.uid), id))
    if (answered) await reseed([id, IDS[id]])
    return answered
  }

  const moved = new Set()
  for (const row of DATASET_TABLE.rows) {
    for (const act of Object.keys(ACTS)) {
      const onTwo = await answer(row, act, 'two')
      const plain = await answer(row, act, 'plain')
      if (act === 'schema') await same(`${row.name}: the unmarked one-site row still reads as the table`, plain, row.after.schemaHere)
      if (act === 'recordEdit') await same(`${row.name}: the unmarked one-site record still reads as the table`, plain, row.after.recordEditHere)
      for (const name of Object.keys(DAMAGED)) {
        const answered = await answer(row, act, slug(name))
        await same(`${row.name}: ${act} on ${name} answers as on two sites`, answered, onTwo)
        if (name === 'marked' && answered !== plain) moved.add(`${row.name}: ${act}: ${plain} to ${answered}`)
      }
    }
  }

  // If nothing moved, the table never touched the verdict and the rows above prove nothing.
  const name = (text) => {
    if (!DATASET_TABLE.rows.some((row) => row.name === text)) throw new Error(`No row named ${text}`)
    return text
  }
  await check('the site Editor who writes it unmarked does not write it marked', async () => {
    const key = `${name('collaborator (viewer doc) site Editor')}: schema: true to false`
    if (!moved.has(key)) throw new Error(`Moved: ${[...moved].join('; ')}`)
  })
  await check('the editor a site narrows there keeps the workspace verdict on it marked', async () => {
    const key = `${name('editor narrowed to Viewer here')}: schema: false to true`
    if (!moved.has(key)) throw new Error(`Moved: ${[...moved].join('; ')}`)
  })

  // A field delete, as the sweep writes one, brings the verdict back.
  const siteEditor = DATASET_TABLE.rows.find((row) => row.name === 'collaborator (viewer doc) site Editor')
  await seedDataset('collapsed', ONE, MARKER)
  await deny('marked: the site Editor is refused', () => ACTS.schema(as(siteEditor.uid), 'collapsed'))
  await env.withSecurityRulesDisabled((context) =>
    updateDoc(doc(context.firestore(), ...datasetPath('collapsed')), { scopeMode: deleteField(), scopeExcept: deleteField() }),
  )
  await allow('after a field delete: the site verdict answers again', () => ACTS.schema(as(siteEditor.uid), 'collapsed'))

  await env.cleanup()
}

// Campaigns: the same, over the campaign table.
{
  const env = await environment('aglyn-scope-marker-campaigns')
  const { as, seed } = contextOf(env)
  const KEY = 'marketing.campaigns'
  const campaign = (db, id) => doc(db, 'orgs', ORG, 'emailCampaigns', id)
  const CAMPAIGNS = { plain: { visibleTo: ONE }, two: { visibleTo: TWO } }
  for (const [name, extra] of Object.entries(DAMAGED)) CAMPAIGNS[slug(name)] = { visibleTo: ONE, ...extra }
  const reseed = (id) => seed(['orgs', ORG, 'emailCampaigns', id], { name: 'A', ...CAMPAIGNS[id] })
  for (const [id, stamp] of Object.entries(CAMPAIGN_TABLE.hosts)) await seed(['hosts', id], { orgId: ORG, ...stamp })
  for (const row of CAMPAIGN_TABLE.rows) {
    await seed(['orgs', ORG, 'members', row.uid], {
      ...row.member,
      scopeTokens: row.scopeTokens,
      resolvedPermissions: { [KEY]: row.resolvedKey },
    })
  }
  for (const id of Object.keys(CAMPAIGNS)) await reseed(id)

  const moved = []
  for (const row of CAMPAIGN_TABLE.rows) {
    const db = as(row.uid)
    const answer = async (id) => {
      const answered = await passes(() => updateDoc(campaign(db, id), { name: 'B' }))
      if (answered) await reseed(id)
      return answered
    }
    const onTwo = await answer('two')
    const plain = await answer('plain')
    for (const name of Object.keys(DAMAGED)) {
      const answered = await answer(slug(name))
      await same(`${row.name}: a campaign with ${name} answers as on two sites`, answered, onTwo)
      if (name === 'marked' && answered !== plain) moved.push(row.name)
    }
    await deny(`${row.name}: creates no marked campaign on one site`, () =>
      setDoc(campaign(db, `forged-${row.uid}`), { name: 'A', visibleTo: ONE, ...MARKER }),
    )
  }
  await check('the site Admin who edits it unmarked does not edit it marked', async () => {
    if (!moved.includes('collaborator (viewer doc) site Admin')) throw new Error(`Moved: ${moved.join('; ')}`)
  })
  const admin = CAMPAIGN_TABLE.rows.find((row) => row.name === 'collaborator (viewer doc) site Admin')
  await allow('the site Admin still creates an unmarked campaign on the site', () =>
    setDoc(campaign(as(admin.uid), 'new-unmarked'), { name: 'A', visibleTo: ONE }),
  )

  await env.cleanup()
}

// A lead with a marker has no sole holder, however few sites it reaches today.
{
  const env = await environment('aglyn-scope-marker-leads')
  const { as, seed } = contextOf(env)
  await seedWorkspace(seed)
  const lead = (db, id) => doc(db, 'orgs', ORG, 'leads', id)
  const seedLeads = async () => {
    await seed(['orgs', ORG, 'leads', 'plain'], { status: 'new', visibleTo: ONE })
    await seed(['orgs', ORG, 'leads', 'two'], { status: 'new', visibleTo: TWO })
    for (const [name, extra] of Object.entries(DAMAGED)) {
      await seed(['orgs', ORG, 'leads', slug(name)], { status: 'new', visibleTo: ONE, ...extra })
    }
  }
  await seedLeads()
  const siteOnly = as('siteOnly')
  await allow('a collaborator deletes the lead their site alone holds', () => deleteDoc(lead(siteOnly, 'plain')))
  await deny('a collaborator cannot delete a lead on two sites', () => deleteDoc(lead(siteOnly, 'two')))
  for (const name of Object.keys(DAMAGED)) {
    await deny(`a collaborator cannot delete a lead with ${name}`, () => deleteDoc(lead(siteOnly, slug(name))))
    await allow(`an org-wide member can delete a lead with ${name}`, () => deleteDoc(lead(as('editor'), slug(name))))
  }
  await env.cleanup()
}

/*
 * ── 3. 250 TOKENS ──────────────────────────────────────
 *
 * The largest workspace has 23 sites today. Every read in every swept collection,
 * by `get`, filtered list and unfiltered list, with a marked document's `visibleTo`
 * at 250 tokens and, separately, a member's `scopeTokens` at 250.
 */
{
  const env = await environment('aglyn-scope-marker-250')
  const { as, seed } = contextOf(env)
  const hostId = (n) => `site-${String(n).padStart(3, '0')}`
  const VISIBLE = Array.from({ length: 250 }, (_, n) => `host:${hostId(n)}`)
  const EXCEPT = ['host:site-excluded']
  const accessTo = (ids) => Object.fromEntries(ids.map((id) => [id, 'editor']))
  const collaborator = (ids) => ({ role: 'editor', allHosts: false, hostAccess: accessTo(ids) })
  const MEMBERS = {
    owner: { role: 'owner', allHosts: true },
    // The last token in the document: no early exit from the walk answers for this one.
    lastSite: collaborator([hostId(249)]),
    excluded: collaborator(['site-excluded']),
    // 250 tokens of their own, including the document's last.
    wide: collaborator(Array.from({ length: 250 }, (_, n) => hostId(n + 249))),
    // 250 tokens of their own, none of them the document's.
    wideElsewhere: collaborator(Array.from({ length: 250 }, (_, n) => hostId(n + 1000))),
  }
  await seed(['orgs', ORG], { name: 'Wide', slug: 'wide', plan: 'agency' })
  for (const [uid, member] of Object.entries(MEMBERS)) {
    await seed(['orgs', ORG, 'members', uid], { ...member, scopeTokens: projectMemberScopeTokens(member) })
  }
  await seed(['hosts', hostId(249)], { orgId: ORG, memberRoles: { lastSite: 'editor', wide: 'editor', owner: 'admin' } })
  await seed(['hosts', 'site-excluded'], { orgId: ORG, memberRoles: { excluded: 'editor', owner: 'admin' } })

  await check('the fixtures are the size this section claims', async () => {
    const tokens = projectMemberScopeTokens(MEMBERS.wide)
    if (VISIBLE.length !== 250) throw new Error(`visibleTo ${VISIBLE.length}`)
    // `org` plus 250 sites.
    if (tokens.length !== 251 || tokens[0] !== 'org') throw new Error(`scopeTokens ${tokens.length}`)
    if (projectMemberScopeTokens(MEMBERS.lastSite).join() !== `org,host:${hostId(249)}`) throw new Error('lastSite')
  })

  for (const [name, { fields }] of Object.entries(COLLECTIONS)) {
    await seed(['orgs', ORG, name, 'wide'], { ...fields, visibleTo: VISIBLE, scopeMode: 'allExcept', scopeExcept: EXCEPT })
  }
  await seed(['orgs', ORG, 'datasets', 'wide', 'records', 'r1'], { values: { a: 1 } })
  await seed(['orgs', ORG, 'campaignSequenceReports', 'wide'], { enrolled: 1 })

  for (const name of Object.keys(COLLECTIONS)) {
    const ref = (uid) => doc(as(uid), 'orgs', ORG, name, 'wide')
    const list = (uid) => collection(as(uid), 'orgs', ORG, name)
    const filtered = (uid, tokens) =>
      query(list(uid), where('visibleTo', 'array-contains-any', tokens), limit(10))
    const tokensOf = (uid) => projectMemberScopeTokens(MEMBERS[uid])

    await allow(`${name}: the owner reads it`, () => getDoc(ref('owner')))
    await allow(`${name}: a member of its last site reads it`, () => getDoc(ref('lastSite')))
    await deny(`${name}: a member of the excluded site does not`, () => getDoc(ref('excluded')))
    await allow(`${name}: a member with 250 sites of their own reads it`, () => getDoc(ref('wide')))
    await deny(`${name}: a member with 250 other sites does not`, () => getDoc(ref('wideElsewhere')))

    await allow(`${name}: the owner's unfiltered list is provable`, () => getDocs(list('owner')))
    await check(`${name}: the owner's list finds it`, async () => {
      const snap = await getDocs(list('owner'))
      if (snap.size !== 1) throw new Error(`found ${snap.size}`)
    })
    await check(`${name}: a site's filtered list is provable and finds it`, async () => {
      const snap = await assertSucceeds(getDocs(filtered('lastSite', tokensOf('lastSite'))))
      if (snap.size !== 1) throw new Error(`found ${snap.size}`)
    })
    await deny(`${name}: a site's unfiltered list stays refused`, () => getDocs(list('lastSite')))
    await check(`${name}: the excluded site's filtered list is provable and does not find it`, async () => {
      const snap = await assertSucceeds(getDocs(filtered('excluded', tokensOf('excluded'))))
      if (snap.size !== 0) throw new Error(`found ${snap.size}`)
    })
    // A query asks for at most 30, so a member past that asks in slices of their tokens.
    await check(`${name}: 30 of a wide member's tokens, the document's among them, are provable and find it`, async () => {
      const tokens = tokensOf('wide').slice(1, 31)
      if (tokens.length !== 30) throw new Error(`asked ${tokens.length}`)
      const snap = await assertSucceeds(getDocs(filtered('wide', tokens)))
      if (snap.size !== 1) throw new Error(`found ${snap.size}`)
    })
    await check(`${name}: 30 of the other wide member's tokens are provable and do not find it`, async () => {
      const snap = await assertSucceeds(getDocs(filtered('wideElsewhere', tokensOf('wideElsewhere').slice(1, 31))))
      if (snap.size !== 0) throw new Error(`found ${snap.size}`)
    })
    await deny(`${name}: asking for a token the member does not hold is refused`, () =>
      getDocs(filtered('excluded', [`host:${hostId(249)}`])),
    )
    await allow(`${name}: an org-wide member can find marked documents by the marker`, () =>
      getDocs(query(list('owner'), where('scopeMode', '==', 'allExcept'))),
    )
    await deny(`${name}: a site cannot, without asking for its tokens`, () =>
      getDocs(query(list('lastSite'), where('scopeMode', '==', 'allExcept'))),
    )
  }

  // Writes that walk the same list, and the reads that reach it through a parent.
  for (const name of ['media', 'mediaFolders', 'emailCampaigns', 'leads', 'companies', 'deals', 'crmTasks', 'crmActivities', 'datasets']) {
    await allow(`${name}: a member of its last site edits it`, () =>
      updateDoc(doc(as('lastSite'), 'orgs', ORG, name, 'wide'), { label: 'x' }),
    )
    await allow(`${name}: a member with 250 sites of their own edits it`, () =>
      updateDoc(doc(as('wide'), 'orgs', ORG, name, 'wide'), { label: 'y' }),
    )
    await deny(`${name}: a member of the excluded site does not`, () =>
      updateDoc(doc(as('excluded'), 'orgs', ORG, name, 'wide'), { label: 'x' }),
    )
  }
  const records = (uid) => collection(as(uid), 'orgs', ORG, 'datasets', 'wide', 'records')
  await allow('records: a member of its last site reads them through the parent', () => getDocs(records('lastSite')))
  await deny('records: a member of the excluded site does not', () => getDocs(records('excluded')))
  await allow('records: a member of its last site edits one', () =>
    updateDoc(doc(as('lastSite'), 'orgs', ORG, 'datasets', 'wide', 'records', 'r1'), { values: { a: 2 } }),
  )
  await deny('records: a member of the excluded site does not', () =>
    updateDoc(doc(as('excluded'), 'orgs', ORG, 'datasets', 'wide', 'records', 'r1'), { values: { a: 2 } }),
  )
  await allow('records: a member with 250 sites of their own edits one', () =>
    updateDoc(doc(as('wide'), 'orgs', ORG, 'datasets', 'wide', 'records', 'r1'), { values: { a: 3 } }),
  )
  await allow('a campaign rollup answers through the parent at 250', () =>
    getDoc(doc(as('lastSite'), 'orgs', ORG, 'campaignSequenceReports', 'wide')),
  )
  await deny('and not for the excluded site', () =>
    getDoc(doc(as('excluded'), 'orgs', ORG, 'campaignSequenceReports', 'wide')),
  )

  await env.cleanup()
}

/*
 * ── 4. NEGATIVE CONTROL ────────────────────────────────
 *
 * The same artifact with the freeze taken out. Each forgery above now passes, so
 * what refused it was the freeze, and each replacement is asserted to have matched
 * so a rename cannot quietly turn this section into nothing.
 */
{
  let unfrozen = RULES
  const take = (pattern, replacement) => {
    const next = unfrozen.replace(pattern, replacement)
    if (next === unfrozen) throw new Error(`The negative control no longer matches ${pattern}`)
    unfrozen = next
  }
  const body = (name, param = '') =>
    new RegExp(`function ${name}\\(${param}\\) \\{\\s*return [^;]+;\\s*\\}`)
  take(body('scopeMarkerUnchanged'), 'function scopeMarkerUnchanged() { return true; }')
  take(body('scopeMarkerAbsent'), 'function scopeMarkerAbsent() { return true; }')
  take(body('scopeUnmarked', 'data'), 'function scopeUnmarked(data) { return true; }')
  take(/\['sharing', 'writeTo', 'scopeMode', 'scopeExcept'\]/g, "['sharing', 'writeTo']")

  const env = await environment('aglyn-scope-marker-unfrozen', unfrozen)
  const { as, seed } = contextOf(env)
  await seedWorkspace(seed)
  await seedCollections(seed)
  const db = as('owner')
  for (const [name, { writes, create, rescope = true, fields }] of Object.entries(COLLECTIONS)) {
    if (!writes) continue
    await allow(`control: without the freeze, ${name} takes a forged marker`, () =>
      updateDoc(doc(db, 'orgs', ORG, name, 'plain'), MARKER),
    )
    // Media's `visibleTo` is frozen by a separate rule, so lifting the marker
    // freeze alone does not let a client re-scope it.
    if (rescope) {
      await allow(`control: without the freeze, ${name} is re-scoped with its marker on`, () =>
        updateDoc(doc(db, 'orgs', ORG, name, 'marked'), { visibleTo: TWO }),
      )
    }
    await allow(`control: without the freeze, ${name} loses its marker`, () =>
      updateDoc(doc(db, 'orgs', ORG, name, 'marked'), { scopeMode: deleteField(), scopeExcept: deleteField() }),
    )
    if (create) {
      await allow(`control: without the freeze, ${name} is created marked`, () =>
        setDoc(doc(db, 'orgs', ORG, name, 'forged'), { ...fields, visibleTo: ONE, ...MARKER }),
      )
    }
  }

  // And the one-site verdicts come back on a marked document.
  const datasetRow = DATASET_TABLE.rows.find((row) => row.name === 'collaborator (viewer doc) site Editor')
  const campaignRow = CAMPAIGN_TABLE.rows.find((row) => row.name === 'collaborator (viewer doc) site Admin')
  const hostStamp = {
    orgId: ORG,
    memberRoles: { [datasetRow.uid]: 'editor', 'campaign-admin': 'admin' },
    memberPermissions: {
      [datasetRow.uid]: { 'data.siteManage': true },
      'campaign-admin': { 'marketing.campaigns': true },
    },
  }
  await seed(['hosts', HERE], hostStamp)
  await seed(['orgs', ORG, 'members', datasetRow.uid], {
    ...datasetRow.member,
    scopeTokens: datasetRow.scopeTokens,
    resolvedPermissions: datasetRow.resolved,
  })
  await seed(['orgs', ORG, 'members', 'campaign-admin'], {
    ...campaignRow.member,
    scopeTokens: campaignRow.scopeTokens,
    resolvedPermissions: { 'marketing.campaigns': campaignRow.resolvedKey },
  })
  await seed(['orgs', ORG, 'datasets', 'one'], { displayName: 'A', visibleTo: ONE, model: {}, ...MARKER })
  await seed(['orgs', ORG, 'emailCampaigns', 'one'], { name: 'A', visibleTo: ONE, ...MARKER })
  await seed(['orgs', ORG, 'leads', 'one'], { status: 'new', visibleTo: ONE, ...MARKER })
  await allow('control: without the freeze, a site Editor writes a marked dataset on one site', () =>
    updateDoc(doc(as(datasetRow.uid), 'orgs', ORG, 'datasets', 'one'), { displayName: 'B' }),
  )
  await allow('control: without the freeze, a site Admin edits a marked campaign on one site', () =>
    updateDoc(doc(as('campaign-admin'), 'orgs', ORG, 'emailCampaigns', 'one'), { name: 'B' }),
  )
  await allow('control: without the freeze, a collaborator deletes a marked lead on one site', () =>
    deleteDoc(doc(as('siteOnly'), 'orgs', ORG, 'leads', 'one')),
  )

  await env.cleanup()
}

const failures = results.filter(([state]) => state === 'FAIL')
console.log(`rules-scope-marker: ${results.length - failures.length}/${results.length} passed`)
for (const [, label, message] of failures) console.log(`FAIL ${label}\n     ${message}`)
process.exit(failures.length ? 1 : 0)
