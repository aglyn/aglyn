/**
 * AI jobs (AGL-2904, AGL-3616): who may read a job, and that nobody but the
 * server writes one — least of all its state.
 *
 * `orgs/{orgId}/aiJobs/{jobId}` IS the state machine: its status, lease,
 * step ledger, credit figures and `cancelRequested` are what stop a step
 * running twice and what a cancel decides. A cancel goes through
 * `POST /api/ai/jobs/{jobId}/cancel`, which writes it in a transaction with
 * the Admin SDK; a client that could write `status: 'canceled'` (or clear
 * `creditsSpent`, or set `cancelRequested` on someone else's job) would
 * bypass the permission check, the activity row and the credit settlement.
 *
 * ⚠️ The member READ rows are the controls: "the owner cannot write" also
 * passes against a rule that denies the owner everything, which would break
 * every job page.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-ai-jobs.spec.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-ai-jobs-rules-test'
const JOB = 'job-rules-1'
const OWNER = 'uid-aij-owner'
const EDITOR = 'uid-aij-editor'
const OUTSIDER = 'uid-aij-outsider'
const STAFF = 'uid-aij-staff'

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: '127.0.0.1',
    port: 8082,
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

const jobOf = (db) => doc(db, 'orgs', ORG, 'aiJobs', JOB)

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), { name: 'AI Jobs Rules Test', slug: 'ai-jobs-rules-test', plan: 'pro' })
  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'orgs', ORG, 'members', EDITOR), { role: 'editor', allHosts: true })
  await setDoc(jobOf(db), {
    orgId: ORG,
    hostId: 'host-abc',
    kind: 'site',
    status: 'running',
    createdBy: EDITOR,
    creditsSpent: 40,
    creditsReserved: 50,
    steps: [{ name: 'plan', status: 'done', creditsSpent: 13 }],
  })
})

const as = (uid, claims = {}) =>
  env.authenticatedContext(uid, { email_verified: true, ...claims }).firestore()

// ── Controls: the workspace and staff read their jobs ───────────────────────
await check('CONTROL — the OWNER reads a job', () => assertSucceeds(getDoc(jobOf(as(OWNER)))))
await check('CONTROL — the job’s CREATOR reads it', () => assertSucceeds(getDoc(jobOf(as(EDITOR)))))
await check('CONTROL — STAFF read a job', () => assertSucceeds(getDoc(jobOf(as(STAFF, { staff: true })))))
await check('an OUTSIDER cannot read a job', () => assertFails(getDoc(jobOf(as(OUTSIDER)))))

// ── Nobody cancels by writing the state: only the cancel route does ─────────
await check('the OWNER cannot set status canceled', () =>
  assertFails(updateDoc(jobOf(as(OWNER)), { status: 'canceled' })),
)
await check('the CREATOR cannot set status canceled', () =>
  assertFails(updateDoc(jobOf(as(EDITOR)), { status: 'canceled' })),
)
await check('the CREATOR cannot set cancelRequested', () =>
  assertFails(updateDoc(jobOf(as(EDITOR)), { cancelRequested: { at: new Date(), by: EDITOR } })),
)
await check('the CREATOR cannot clear what the job spent', () =>
  assertFails(updateDoc(jobOf(as(EDITOR)), { creditsSpent: 0, creditsReserved: 0 })),
)
await check('STAFF cannot set status canceled from a client either', () =>
  assertFails(updateDoc(jobOf(as(STAFF, { staff: true })), { status: 'canceled' })),
)
await check('the OWNER cannot create a canceled job', () =>
  assertFails(setDoc(doc(as(OWNER), 'orgs', ORG, 'aiJobs', 'job-forged'), { status: 'canceled', orgId: ORG })),
)
await check('the OWNER cannot delete a job', () => assertFails(deleteDoc(jobOf(as(OWNER)))))

// Remove ONLY what this spec seeded. Deliberately not `clearFirestore()` — the
// emulator is often shared with a running dev server.
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  for (const ref of [
    jobOf(db),
    doc(db, 'orgs', ORG, 'members', OWNER),
    doc(db, 'orgs', ORG, 'members', EDITOR),
    doc(db, 'orgs', ORG),
  ]) {
    await deleteDoc(ref)
  }
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
