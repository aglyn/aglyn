/**
 * Per-user AI usage (AGL-2928): who may read a person's month.
 *
 * `orgs/{orgId}/aiUsageByUser/{uid}/months/{YYYY-MM}` is integers about a
 * PERSON, so the read is narrower than the org rollup's. The person reads
 * their own months; an org-wide member reads everyone's with `billing.view`
 * (the Usage page's gate) or `org.auditLog` (the team page's); a scoped
 * collaborator sees nobody's but their own; nobody writes.
 *
 * ⚠️ Half the rows are controls against a lockout. "The revoked admin is
 * refused" also passes against a rule that refuses every admin — every
 * paying customer's Usage page — and against one that refuses every member
 * with no `resolvedPermissions` map, which is every member the projection
 * has not reached. The bare-admin and bare-owner rows are the load-bearing
 * half.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-ai-usage-by-user.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'

const ORG = 'org-ai-usage-by-user-test'
const MONTH = '2026-09'
const OWNER = 'uid-aiu-owner'
const ADMIN = 'uid-aiu-admin'
/** An admin whose per-member overrides revoke BOTH admitting permissions. */
const REVOKED_ADMIN = 'uid-aiu-admin-revoked'
/** An admin whose override revokes only `billing.view` — `org.auditLog` still admits. */
const HALF_REVOKED_ADMIN = 'uid-aiu-admin-half-revoked'
/** The control: an admin with no permissions map at all. */
const BARE_ADMIN = 'uid-aiu-admin-bare'
/** An org-wide viewer whose custom role STAMPS `org.auditLog` on them. */
const AUDIT_VIEWER = 'uid-aiu-viewer-audit'
/** An org-wide viewer with nothing stamped. */
const ORG_VIEWER = 'uid-aiu-viewer'
/** A scoped site collaborator — the subject of one month document. */
const COLLABORATOR = 'uid-aiu-collaborator'
const OUTSIDER = 'uid-aiu-outsider'

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

const monthDocOf = (db, uid) =>
  doc(db, 'orgs', ORG, 'aiUsageByUser', uid, 'months', MONTH)

const seededMonth = (uid) => ({
  uid,
  month: MONTH,
  credits: 120,
  estCostUsd: 0.12,
  requests: 4,
  refusals: 0,
  byKind: { assist: 120 },
  byHost: { 'host-abc': 120 },
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), {
    name: 'AI Usage By User Test',
    slug: 'ai-usage-by-user-test',
    plan: 'pro',
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', ADMIN), { role: 'admin', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', REVOKED_ADMIN), {
    role: 'admin',
    allHosts: true,
    permissions: { 'billing.view': false, 'org.auditLog': false },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', HALF_REVOKED_ADMIN), {
    role: 'admin',
    allHosts: true,
    permissions: { 'billing.view': false },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', BARE_ADMIN), { role: 'admin', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', AUDIT_VIEWER), {
    role: 'viewer',
    allHosts: true,
    resolvedPermissions: { 'org.auditLog': true },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', ORG_VIEWER), { role: 'viewer', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', COLLABORATOR), {
    role: 'editor',
    allHosts: false,
    hostAccess: { 'host-abc': 'editor' },
  })
  await setDoc(monthDocOf(db, COLLABORATOR), seededMonth(COLLABORATOR))
  await setDoc(monthDocOf(db, ADMIN), seededMonth(ADMIN))
})

const as = (uid) =>
  env.authenticatedContext(uid, { email_verified: true }).firestore()

// ── Managers read everyone's month ──────────────────────────────────────────
await check('an OWNER reads a collaborator’s month', () =>
  assertSucceeds(getDoc(monthDocOf(as(OWNER), COLLABORATOR))),
)
await check('an ADMIN reads a collaborator’s month', () =>
  assertSucceeds(getDoc(monthDocOf(as(ADMIN), COLLABORATOR))),
)
await check('an OWNER lists a person’s months', () =>
  assertSucceeds(
    getDocs(collection(as(OWNER), 'orgs', ORG, 'aiUsageByUser', COLLABORATOR, 'months')),
  ),
)

// ── The permission layer narrows a manager ──────────────────────────────────
await check('an ADMIN with BOTH billing.view and org.auditLog revoked cannot read it', () =>
  assertFails(getDoc(monthDocOf(as(REVOKED_ADMIN), COLLABORATOR))),
)
await check('an ADMIN with only billing.view revoked still reads it — org.auditLog admits', () =>
  assertSucceeds(getDoc(monthDocOf(as(HALF_REVOKED_ADMIN), COLLABORATOR))),
)
// ⚠️ The control that stops the revoked case being a lockout of every admin.
await check('CONTROL — an ADMIN with NO permissions map still reads it', () =>
  assertSucceeds(getDoc(monthDocOf(as(BARE_ADMIN), COLLABORATOR))),
)

// ── A stamped permission admits a non-manager ───────────────────────────────
await check('an org-wide VIEWER stamped with org.auditLog reads it', () =>
  assertSucceeds(getDoc(monthDocOf(as(AUDIT_VIEWER), COLLABORATOR))),
)
await check('a bare org-wide VIEWER cannot read another person’s month', () =>
  assertFails(getDoc(monthDocOf(as(ORG_VIEWER), COLLABORATOR))),
)

// ── The subject reads their own, and only their own ─────────────────────────
await check('a scoped COLLABORATOR reads their OWN month', () =>
  assertSucceeds(getDoc(monthDocOf(as(COLLABORATOR), COLLABORATOR))),
)
await check('a scoped COLLABORATOR lists their OWN months', () =>
  assertSucceeds(
    getDocs(collection(as(COLLABORATOR), 'orgs', ORG, 'aiUsageByUser', COLLABORATOR, 'months')),
  ),
)
await check('a scoped COLLABORATOR cannot read an ADMIN’s month', () =>
  assertFails(getDoc(monthDocOf(as(COLLABORATOR), ADMIN))),
)
await check('an OUTSIDER cannot read any month, their own uid included', () =>
  assertFails(getDoc(monthDocOf(as(OUTSIDER), OUTSIDER))),
)

// ── Nobody writes: the document is a meter ──────────────────────────────────
await check('an OWNER cannot WRITE a month', () =>
  assertFails(setDoc(monthDocOf(as(OWNER), COLLABORATOR), { credits: 0 })),
)
await check('the SUBJECT cannot clear their own month', () =>
  assertFails(setDoc(monthDocOf(as(COLLABORATOR), COLLABORATOR), { credits: 0 })),
)
await check('the SUBJECT cannot delete their own month', () =>
  assertFails(deleteDoc(monthDocOf(as(COLLABORATOR), COLLABORATOR))),
)

// Remove ONLY what this spec seeded. Deliberately not `clearFirestore()` — the
// emulator is often shared with a running dev server.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const ref of [
    monthDocOf(db, COLLABORATOR),
    monthDocOf(db, ADMIN),
    doc(db, 'orgs', ORG, 'members', OWNER),
    doc(db, 'orgs', ORG, 'members', ADMIN),
    doc(db, 'orgs', ORG, 'members', REVOKED_ADMIN),
    doc(db, 'orgs', ORG, 'members', HALF_REVOKED_ADMIN),
    doc(db, 'orgs', ORG, 'members', BARE_ADMIN),
    doc(db, 'orgs', ORG, 'members', AUDIT_VIEWER),
    doc(db, 'orgs', ORG, 'members', ORG_VIEWER),
    doc(db, 'orgs', ORG, 'members', COLLABORATOR),
    doc(db, 'orgs', ORG),
  ]) {
    await deleteDoc(ref)
  }
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
