/**
 * AI allotments (AGL-2942): who may read an allotment, and that nobody
 * writes one.
 *
 * `orgs/{orgId}/aiAllotments/{subject}` is a spend control keyed by subject:
 * `member:{uid}`, `collab:{hostId}:{uid}`, `host:{hostId}`, and `org` for
 * the org-wide model restriction. The subject reads their own; an org-wide
 * manager reads every one with `billing.view` or `billing.manage`; a
 * collaborator who is the ADMIN of a site reads that site's collaborator
 * and site allotments and nothing else; any member reads `org`.
 *
 * ⚠️ The control rows matter as much as the refusals. "The revoked admin is
 * refused" also passes against a rule that refuses every admin, and "the
 * site admin reads their site" is what keeps the collaborators card from
 * rendering nothing for the person it was built for.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-ai-allotments.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'

const ORG = 'org-ai-allotments-test'
const HOST_A = 'host-allot-a'
const HOST_B = 'host-allot-b'
const OWNER = 'uid-allot-owner'
const ADMIN = 'uid-allot-admin'
/** An admin whose overrides revoke BOTH admitting permissions. */
const REVOKED_ADMIN = 'uid-allot-admin-revoked'
/** The control: an admin with no permissions map at all. */
const BARE_ADMIN = 'uid-allot-admin-bare'
/** An org-wide viewer a custom role stamped with `billing.manage`. */
const BILLING_VIEWER = 'uid-allot-viewer-billing'
/** An org-wide editor with nothing stamped. */
const EDITOR = 'uid-allot-editor'
/** A collaborator scoped to site A as its ADMIN. */
const SITE_ADMIN = 'uid-allot-site-admin'
/** A collaborator scoped to site A as an editor — the subject of the collab allotment. */
const COLLABORATOR = 'uid-allot-collaborator'
const OUTSIDER = 'uid-allot-outsider'

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: '127.0.0.1',
    port: 8082,
    rules: readFileSync('cloud/firebase-firestore.rules', 'utf8'),
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

const allotmentOf = (db, subject) => doc(db, 'orgs', ORG, 'aiAllotments', subject)

const SUBJECTS = {
  org: 'org',
  editorMember: `member:${EDITOR}`,
  adminMember: `member:${ADMIN}`,
  collabA: `collab:${HOST_A}:${COLLABORATOR}`,
  collabB: `collab:${HOST_B}:${COLLABORATOR}`,
  siteA: `host:${HOST_A}`,
  siteB: `host:${HOST_B}`,
}

const seeded = (subject) => ({
  subject,
  credits: subject === 'org' ? null : 5000,
  mode: 'hard',
  models: null,
  setBy: OWNER,
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), { name: 'AI Allotments Test', slug: 'ai-allotments-test', plan: 'agency' })
  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', ADMIN), { role: 'admin', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', REVOKED_ADMIN), {
    role: 'admin',
    allHosts: true,
    permissions: { 'billing.view': false, 'billing.manage': false },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', BARE_ADMIN), { role: 'admin', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', BILLING_VIEWER), {
    role: 'viewer',
    allHosts: true,
    resolvedPermissions: { 'billing.manage': true },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', EDITOR), { role: 'editor', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', SITE_ADMIN), {
    role: 'editor',
    allHosts: false,
    hostAccess: { [HOST_A]: 'admin' },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', COLLABORATOR), {
    role: 'editor',
    allHosts: false,
    hostAccess: { [HOST_A]: 'editor', [HOST_B]: 'editor' },
  })
  for (const subject of Object.values(SUBJECTS)) {
    await setDoc(allotmentOf(db, subject), seeded(subject))
  }
})

const as = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore()

// ── Managers read every allotment ──────────────────────────────────────────
await check('an OWNER reads a member’s allotment', () =>
  assertSucceeds(getDoc(allotmentOf(as(OWNER), SUBJECTS.editorMember))),
)
await check('an ADMIN reads a site’s allotment', () =>
  assertSucceeds(getDoc(allotmentOf(as(ADMIN), SUBJECTS.siteB))),
)
await check('an ADMIN reads a collaborator’s allotment', () =>
  assertSucceeds(getDoc(allotmentOf(as(ADMIN), SUBJECTS.collabB))),
)
await check('an org-wide VIEWER stamped with billing.manage reads a member’s allotment', () =>
  assertSucceeds(getDoc(allotmentOf(as(BILLING_VIEWER), SUBJECTS.adminMember))),
)

// ── The permission layer narrows a manager ─────────────────────────────────
await check('an ADMIN with billing.view AND billing.manage revoked cannot read a member’s allotment', () =>
  assertFails(getDoc(allotmentOf(as(REVOKED_ADMIN), SUBJECTS.editorMember))),
)
// ⚠️ The control that stops the revoked case being a lockout of every admin.
await check('CONTROL — an ADMIN with NO permissions map reads it', () =>
  assertSucceeds(getDoc(allotmentOf(as(BARE_ADMIN), SUBJECTS.editorMember))),
)
await check('a bare org-wide EDITOR cannot read another member’s allotment', () =>
  assertFails(getDoc(allotmentOf(as(EDITOR), SUBJECTS.adminMember))),
)

// ── The subject reads their own ────────────────────────────────────────────
await check('a member reads their OWN member allotment', () =>
  assertSucceeds(getDoc(allotmentOf(as(EDITOR), SUBJECTS.editorMember))),
)
await check('a collaborator reads their OWN allotment on each site', async () => {
  await assertSucceeds(getDoc(allotmentOf(as(COLLABORATOR), SUBJECTS.collabA)))
  await assertSucceeds(getDoc(allotmentOf(as(COLLABORATOR), SUBJECTS.collabB)))
})
await check('a collaborator cannot read the site’s own allotment', () =>
  assertFails(getDoc(allotmentOf(as(COLLABORATOR), SUBJECTS.siteA))),
)
await check('a collaborator cannot read a member’s allotment', () =>
  assertFails(getDoc(allotmentOf(as(COLLABORATOR), SUBJECTS.editorMember))),
)

// ── A site's admin reads their site, and only their site ───────────────────
await check('CONTROL — the SITE ADMIN reads a collaborator’s allotment on their site', () =>
  assertSucceeds(getDoc(allotmentOf(as(SITE_ADMIN), SUBJECTS.collabA))),
)
await check('the SITE ADMIN reads their site’s own allotment', () =>
  assertSucceeds(getDoc(allotmentOf(as(SITE_ADMIN), SUBJECTS.siteA))),
)
await check('the SITE ADMIN cannot read another site’s allotments', async () => {
  await assertFails(getDoc(allotmentOf(as(SITE_ADMIN), SUBJECTS.collabB)))
  await assertFails(getDoc(allotmentOf(as(SITE_ADMIN), SUBJECTS.siteB)))
})
await check('the SITE ADMIN cannot read a member’s allotment', () =>
  assertFails(getDoc(allotmentOf(as(SITE_ADMIN), SUBJECTS.editorMember))),
)

// ── The org-wide restriction, and outsiders ────────────────────────────────
await check('any member reads the org-wide model restriction', async () => {
  await assertSucceeds(getDoc(allotmentOf(as(COLLABORATOR), SUBJECTS.org)))
  await assertSucceeds(getDoc(allotmentOf(as(EDITOR), SUBJECTS.org)))
})
await check('an OUTSIDER reads nothing, the restriction included', async () => {
  await assertFails(getDoc(allotmentOf(as(OUTSIDER), SUBJECTS.org)))
  await assertFails(getDoc(allotmentOf(as(OUTSIDER), `member:${OUTSIDER}`)))
})

// ── Nobody writes: an allotment is a spend control ─────────────────────────
await check('an OWNER cannot WRITE an allotment', () =>
  assertFails(setDoc(allotmentOf(as(OWNER), SUBJECTS.editorMember), seeded(SUBJECTS.editorMember))),
)
await check('the SUBJECT cannot raise their own allotment', () =>
  assertFails(setDoc(allotmentOf(as(COLLABORATOR), SUBJECTS.collabA), { ...seeded(SUBJECTS.collabA), credits: 999999 })),
)
await check('the SITE ADMIN cannot write their site’s allotment', () =>
  assertFails(setDoc(allotmentOf(as(SITE_ADMIN), SUBJECTS.siteA), seeded(SUBJECTS.siteA))),
)
await check('the SUBJECT cannot delete their own allotment', () =>
  assertFails(deleteDoc(allotmentOf(as(EDITOR), SUBJECTS.editorMember))),
)

// Remove ONLY what this spec seeded. Deliberately not `clearFirestore()` — the
// emulator is often shared with a running dev server.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const subject of Object.values(SUBJECTS)) await deleteDoc(allotmentOf(db, subject))
  for (const uid of [OWNER, ADMIN, REVOKED_ADMIN, BARE_ADMIN, BILLING_VIEWER, EDITOR, SITE_ADMIN, COLLABORATOR]) {
    await deleteDoc(doc(db, 'orgs', ORG, 'members', uid))
  }
  await deleteDoc(doc(db, 'orgs', ORG))
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
