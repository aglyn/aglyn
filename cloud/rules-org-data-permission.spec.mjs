/**
 * A custom role is honored by the rules, not just by the API (AGL-243
 * residual), and "Manage data" decides alone (AGL-4047).
 *
 * Dataset and record writes ask `data.manage` through `memberKeyOrOverride`:
 * the key as the projection stamped it (or, unstamped, the member's own
 * override), else its default, the owner, admin and editor. No role gate
 * stands beside it any more, so a custom role or an override that grants the
 * key to a viewer opens the client-direct writes, as `/api/orgs/datasets`
 * opens creates for them; one that takes it from an editor closes them.
 *
 * `canWriteOrgData()` read the raw `role` field against a hardcoded list (it
 * asks the key too now, `cloud/rules-crm-audience-writes.spec.mjs`).
 * `/api/orgs/datasets` resolves all three permission layers and refuses a
 * member whose `data.manage` a custom role revoked. So the same principal got
 * two different answers, and the RULES were the permissive one.
 *
 * That mattered far more than a disagreement usually does, because the API is
 * not on the path at all for most of what it is about to be disagreed with:
 * dataset UPDATES and record update/deletes go client-direct from the browser
 * SDK, gated by these rules and nothing else. An editor whose `data.manage`
 * was revoked was stopped from CREATING a dataset and kept full edit and
 * delete access to every dataset and record already stored.
 *
 * The fix is denormalization, which is the pattern this file's rules already
 * use for `scopeTokens`: `syncOrgAuthProjections` writes the resolved map onto
 * the member document and `memberResolves` reads the answer.
 *
 * ## What this asserts, and what it deliberately does not
 *
 * The verdicts come from `rules-fixtures/org-data-principals.json`, shared
 * with `apps/console/specs/dataset-write-authority-agrees.spec.ts`. That file
 * runs the SERVER's resolver over the same rows; this one asks Firestore. A
 * table neither suite owns is what makes "the two agree" an assertion rather
 * than two independent restatements of whatever each side happens to do.
 *
 * ⚠️ Half the rows exist to stop this becoming a lockout. "The revoked editor
 * is refused" also passes against a rule that refuses every editor, and
 * against one that refuses everyone with no `resolvedPermissions` field —
 * which is every member in every org until the projection has run for them.
 * The bare rows and the media/contact rows at the bottom are the load-bearing
 * half.
 *
 * ## The people and a list's people (AGL-4047)
 *
 * The CRM's twelve people collections (`canReadScopedPeople`) and a list's
 * members (`isOrgWideAudienceManager`) ask the same key for READS, also
 * through `memberKeyOrOverride` with no role beside it. They asked the owner,
 * admin or editor role AND the key (and, for the CRM, the key stamped), so
 * every member with no decision written down keeps their verdict; the table
 * below says it per principal. The one movement is on a list's people: a
 * viewer a custom role or an override GRANTS the key now reads them, as the
 * Emails page (registered on `data.manage`) already admits them.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-org-data-permission.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-data-permission-test'
const DATASET = 'ds-shared'
const RECORD = 'rec-1'
const CONTACT = 'contact-1'
const MEDIA = 'media-1'
const JOB = 'job-1'
const LIST = 'list-1'
const LIST_MEMBER = 'someone-example-com'

/** The CRM collections `canReadScopedPeople` guards, one document each. */
const PEOPLE_COLLECTIONS = [
  'contacts',
  'leads',
  'contactSegments',
  'companies',
  'pipelines',
  'deals',
  'crmTasks',
  'crmActivities',
  'contactFields',
  'crmPicklists',
  'crmViews',
  'crmEmailTemplates',
]

/**
 * Who reads the people (AGL-4047), per principal of the shared table: the
 * CRM's collections, a list's members, and whether they may take someone off
 * a list (the read, verified and not suspended). `was` is what a list's
 * members answered before, where it differs.
 */
const PEOPLE_VERDICTS = {
  'uid-owner': [true, true, true],
  'uid-editor': [true, true, true],
  'uid-viewer': [false, false, false],
  'uid-admin-bare': [true, true, true],
  // The scope refuses: the contact is the workspace's, not host-a's, and a
  // list is never a collaborator's.
  'uid-site-author': [false, false, false],
  'uid-editor-revoked': [false, false, false],
  'uid-viewer-granted': [true, true, true, 'was refused a list’s people'],
  'uid-editor-restored': [true, true, true],
  'uid-editor-bare': [true, true, true],
  'uid-viewer-bare': [false, false, false],
  'uid-editor-override-only': [false, false, false],
  'uid-editor-member-denied': [false, false, false],
  'uid-viewer-member-granted': [true, true, true, 'was refused a list’s people'],
  'uid-viewer-override-only-granted': [true, true, true, 'was refused a list’s people'],
  'uid-editor-other-key': [true, true, true],
  // A suspended workspace still reads its own people; removing is a write.
  'uid-editor-suspended': [true, true, false],
}

/**
 * Members of this spec alone, not the shared table (whose server half runs
 * the dataset routes): a site collaborator a custom role granted the key,
 * who reads the people their site shares and nothing about a list, and an
 * editor stamped false by their role and true by their own override.
 */
const PEOPLE_ONLY = {
  'uid-site-editor-granted': {
    role: 'viewer',
    allHosts: false,
    hostAccess: { 'host-a': 'editor' },
    scopeTokens: ['host:host-a'],
    resolvedPermissions: { 'data.manage': true },
  },
  'uid-admin-role-revoked': {
    role: 'admin',
    allHosts: true,
    scopeTokens: ['org'],
    roleId: 'role-limited',
    resolvedPermissions: { 'data.manage': false },
  },
}

const { principals } = JSON.parse(
  readFileSync('cloud/rules-fixtures/org-data-principals.json', 'utf8'),
)

// `emulators:exec` names the emulator it started; the fixed port is the
// fallback for one started by hand.
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
    results.push(['FAIL', label, String(error).slice(0, 200)])
  }
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), {
    name: 'Data Permission Test',
    slug: 'data-permission-test',
    plan: 'pro',
  })
  // Shared with the workspace and with host-a, so the AGL-1041 scope
  // predicate is satisfied for every principal here, the site collaborator
  // included, and cannot be what a refusal is really about.
  await setDoc(doc(db, 'orgs', ORG, 'datasets', DATASET), {
    name: 'Shared',
    visibleTo: ['org', 'host:host-a'],
  })
  await setDoc(doc(db, 'orgs', ORG, 'datasets', DATASET, 'records', RECORD), {
    values: { title: 'seed' },
  })
  await setDoc(doc(db, 'orgs', ORG, 'contacts', CONTACT), {
    email: 'someone@example.com',
    visibleTo: ['org'],
    facets: { 'host-control': { sources: {}, interactions: [] } },
  })
  await setDoc(doc(db, 'orgs', ORG, 'media', MEDIA), {
    name: 'photo.png',
    visibleTo: ['org'],
  })
  await setDoc(doc(db, 'orgs', ORG, 'transferJobs', JOB), {
    resource: 'dataset',
    status: 'done',
  })
  for (const name of PEOPLE_COLLECTIONS) {
    await setDoc(doc(db, 'orgs', ORG, name, `${name}-org`), { name: 'org only', visibleTo: ['org'] })
    await setDoc(doc(db, 'orgs', ORG, name, `${name}-site`), {
      name: 'shared with host-a',
      visibleTo: ['org', 'host:host-a'],
    })
  }
  await setDoc(doc(db, 'orgs', ORG, 'lists', LIST), { name: 'Newsletter', kind: 'static' })
  await setDoc(doc(db, 'orgs', ORG, 'lists', LIST, 'members', LIST_MEMBER), {
    email: 'someone@example.com',
    marketingConsent: true,
  })
  for (const [uid, member] of Object.entries(PEOPLE_ONLY)) {
    await setDoc(doc(db, 'orgs', ORG, 'members', uid), member)
  }
  for (const principal of principals) {
    await setDoc(
      doc(db, 'orgs', ORG, 'members', principal.uid),
      principal.member,
    )
    if (principal.customRole) {
      await setDoc(
        doc(db, 'orgs', ORG, 'roles', principal.customRole.id),
        { name: principal.customRole.id, permissions: principal.customRole.permissions },
      )
    }
  }
})

const as = (uid) =>
  env.authenticatedContext(uid, { email_verified: true }).firestore()

const datasetRef = (db) => doc(db, 'orgs', ORG, 'datasets', DATASET)
const recordRef = (db) =>
  doc(db, 'orgs', ORG, 'datasets', DATASET, 'records', RECORD)

// ── The table ───────────────────────────────────────────────────────────────
// One pair of assertions per principal: the dataset document (an update that
// leaves `visibleTo` alone, so `scopeUnchanged` is satisfied) and a record
// beneath it. Both are client-direct paths with no API in front of them.

for (const principal of principals) {
  const verb = principal.mayWriteDatasets ? 'MAY' : 'may NOT'
  const assertion = principal.mayWriteDatasets ? assertSucceeds : assertFails
  await check(`${principal.uid} ${verb} update a dataset — ${principal.note}`, () =>
    assertion(updateDoc(datasetRef(as(principal.uid)), { name: 'renamed' })),
  )
  await check(`${principal.uid} ${verb} update a record`, () =>
    assertion(
      updateDoc(recordRef(as(principal.uid)), { values: { title: 'edited' } }),
    ),
  )
  await check(`${principal.uid} ${verb} delete a record`, () =>
    assertion(
      principal.mayWriteDatasets
        ? setDoc(recordRef(as(principal.uid)), { values: { title: 'restored' } })
        : deleteDoc(recordRef(as(principal.uid))),
    ),
  )
}

// ── Controls: what `data.manage` must NOT have taken away ───────────────────
// The media library has its own key, "Edit the workspace media library"
// (`org.media`), so refusing `data.manage` leaves it alone.
// (A contact takes no client write at all since
// AGL-3338: letting one go is `crm/contact-remove`'s.)

await check('CONTROL — the revoked editor may still update org MEDIA', () =>
  assertSucceeds(
    updateDoc(doc(as('uid-editor-revoked'), 'orgs', ORG, 'media', MEDIA), {
      name: 'renamed.png',
    }),
  ),
)
// Reading is not writing. `data.manage` gates edits; a member who may see the
// Data page must keep seeing it.
await check('CONTROL — the revoked editor may still READ the dataset', () =>
  assertSucceeds(getDoc(datasetRef(as('uid-editor-revoked')))),
)
await check('CONTROL — the revoked editor may still READ its records', () =>
  assertSucceeds(getDoc(recordRef(as('uid-editor-revoked')))),
)
// The site author's refusal above is the KEY: the scope admits them, so they
// read what they may not write.
await check('CONTROL — the site author may READ the dataset its site shares', () =>
  assertSucceeds(getDoc(datasetRef(as('uid-site-author')))),
)
await check('CONTROL — the site author may READ its records', () =>
  assertSucceeds(getDoc(recordRef(as('uid-site-author')))),
)
// A grant opens the writes and nothing else: creates and dataset deletes stay
// API-only (AGL-473, AGL-945) for a viewer holding the key, as for an owner.
await check('CONTROL — a viewer granted the key still may not CREATE a record client-side', () =>
  assertFails(
    setDoc(
      doc(as('uid-viewer-granted'), 'orgs', ORG, 'datasets', DATASET, 'records', 'rec-new'),
      { values: { title: 'new' } },
    ),
  ),
)
await check('CONTROL — a viewer granted the key still may not DELETE the dataset client-side', () =>
  assertFails(deleteDoc(datasetRef(as('uid-viewer-granted')))),
)
// Transfer jobs answer to the same key (AGL-3524, AGL-4047).
await check('CONTROL — a viewer granted the key reads the workspace import jobs', () =>
  assertSucceeds(getDoc(doc(as('uid-viewer-granted'), 'orgs', ORG, 'transferJobs', JOB))),
)
await check('CONTROL — a plain viewer may not read the workspace import jobs', () =>
  assertFails(getDoc(doc(as('uid-viewer'), 'orgs', ORG, 'transferJobs', JOB))),
)
await check('CONTROL — an editor whose key is denied may not read the import jobs', () =>
  assertFails(getDoc(doc(as('uid-editor-member-denied'), 'orgs', ORG, 'transferJobs', JOB))),
)
await check('CONTROL — an unstamped editor reads the import jobs (the default)', () =>
  assertSucceeds(getDoc(doc(as('uid-editor-bare'), 'orgs', ORG, 'transferJobs', JOB))),
)
// And an outsider is refused everything, which is the control that stops a
// rule that accidentally granted the world from passing the rows above.
await check('CONTROL — an outsider may not read the dataset', () =>
  assertFails(getDoc(datasetRef(as('uid-outsider')))),
)
await check('CONTROL — an outsider may not update the dataset', () =>
  assertFails(updateDoc(datasetRef(as('uid-outsider')), { name: 'theirs' })),
)

// ── The people and a list's people: "Manage data" alone (AGL-4047) ─────────
const listMemberRef = (db) => doc(db, 'orgs', ORG, 'lists', LIST, 'members', LIST_MEMBER)
for (const principal of principals) {
  const verdict = PEOPLE_VERDICTS[principal.uid]
  if (!verdict) {
    await check(`${principal.uid} has a people verdict in this spec`, () => {
      throw new Error('add it to PEOPLE_VERDICTS')
    })
    continue
  }
  const [people, listPeople, remove, was] = verdict
  const why = `${principal.note.split('.')[0]}${was ? ` (${was})` : ''}`
  for (const name of PEOPLE_COLLECTIONS) {
    await check(`${principal.uid} ${people ? 'MAY' : 'may NOT'} read ${name} — ${why}`, () =>
      (people ? assertSucceeds : assertFails)(getDoc(doc(as(principal.uid), 'orgs', ORG, name, `${name}-org`))),
    )
  }
  await check(`${principal.uid} ${listPeople ? 'MAY' : 'may NOT'} read a list’s people — ${why}`, () =>
    (listPeople ? assertSucceeds : assertFails)(getDoc(listMemberRef(as(principal.uid)))),
  )
  // Removing is a delete, which takes the person off the list for the rows
  // below; the refusals run first and the one allowed delete is restored.
  if (!remove) {
    await check(`${principal.uid} may NOT take someone off a list`, () =>
      assertFails(deleteDoc(listMemberRef(as(principal.uid)))),
    )
  }
}
for (const name of PEOPLE_COLLECTIONS) {
  await check(`a site collaborator granted the key reads the ${name} its site shares`, () =>
    assertSucceeds(getDoc(doc(as('uid-site-editor-granted'), 'orgs', ORG, name, `${name}-site`))),
  )
  await check(`a site collaborator granted the key may NOT read the ${name} only the workspace sees`, () =>
    assertFails(getDoc(doc(as('uid-site-editor-granted'), 'orgs', ORG, name, `${name}-org`))),
  )
  await check(`an admin a custom role took the key from may NOT read ${name}`, () =>
    assertFails(getDoc(doc(as('uid-admin-role-revoked'), 'orgs', ORG, name, `${name}-org`))),
  )
}
await check('a site collaborator granted the key may NOT read a list’s people', () =>
  assertFails(getDoc(listMemberRef(as('uid-site-editor-granted')))),
)
await check('an admin a custom role took the key from may NOT read a list’s people', () =>
  assertFails(getDoc(listMemberRef(as('uid-admin-role-revoked')))),
)
await check('a viewer the key was granted to takes someone off a list (the read, verified, not suspended)', () =>
  assertSucceeds(deleteDoc(listMemberRef(as('uid-viewer-granted')))),
)
await env.withSecurityRulesDisabled(async (context) => {
  await setDoc(listMemberRef(context.firestore()), { email: 'someone@example.com', marketingConsent: true })
})
await check('CONTROL — an outsider reads no people and no list’s people', async () => {
  await assertFails(getDoc(doc(as('uid-outsider'), 'orgs', ORG, 'contacts', 'contacts-org')))
  await assertFails(getDoc(listMemberRef(as('uid-outsider'))))
})

// Remove ONLY what this spec seeded — never `clearFirestore()`, which would
// take a shared dev session's data with it.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  const refs = [
    doc(db, 'orgs', ORG, 'datasets', DATASET, 'records', RECORD),
    doc(db, 'orgs', ORG, 'datasets', DATASET),
    doc(db, 'orgs', ORG, 'contacts', CONTACT),
    doc(db, 'orgs', ORG, 'media', MEDIA),
    doc(db, 'orgs', ORG, 'transferJobs', JOB),
    ...PEOPLE_COLLECTIONS.flatMap((name) => [
      doc(db, 'orgs', ORG, name, `${name}-org`),
      doc(db, 'orgs', ORG, name, `${name}-site`),
    ]),
    doc(db, 'orgs', ORG, 'lists', LIST, 'members', LIST_MEMBER),
    doc(db, 'orgs', ORG, 'lists', LIST),
    ...Object.keys(PEOPLE_ONLY).map((uid) => doc(db, 'orgs', ORG, 'members', uid)),
    doc(db, 'orgs', ORG),
  ]
  for (const principal of principals) {
    refs.push(doc(db, 'orgs', ORG, 'members', principal.uid))
    if (principal.customRole) {
      refs.push(doc(db, 'orgs', ORG, 'roles', principal.customRole.id))
    }
  }
  for (const ref of refs) await deleteDoc(ref)
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(
    `${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`,
  )
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
