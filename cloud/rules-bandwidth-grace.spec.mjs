/**
 * Business profile + AI memory (AGL-3661): who may read and write a site's
 * business profile, the workspace defaults, and what Aglyn AI remembers.
 *
 * - `hosts/{hostId}/businessProfile/profile` is authored by the site's
 *   writers on Setup → Business profile, through the host catch-all.
 * - `orgs/{orgId}/businessProfile/defaults` speaks for every site, so only a
 *   manager writes it; every member reads it.
 * - `hosts/{hostId}/aiMemory/{id}` is written by the assist edit route on the
 *   Admin SDK and read into every later AI prompt for the site. A client may
 *   read and DELETE (the owner clears one) and never create or change one.
 *
 * Each refusal has a control beside it, so "nobody can" is never the
 * reason a row passes.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main

/**
 * The free plan's bandwidth pause is SERVER-OWNED (AGL-4232): a site admin or
 * a workspace owner must not be able to give a site a second one-time grace by
 * clearing a grace stamp, nor lift a pause by editing the marker. Each denial
 * is paired with a control write the same person may make.
 */

import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { deleteField, doc, setDoc, updateDoc } from 'firebase/firestore'

const ORG = 'org-bandwidth-grace-test'
const HOST = 'host-bandwidth-grace'
const OWNER = 'uid-bw-owner'
const SITE_ADMIN = 'uid-bw-site-admin'

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: '127.0.0.1',
    port: Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8082),
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

const MONTH = new Date().toISOString().slice(0, 7)

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'orgs', ORG), {
    name: 'Bandwidth Grace Test',
    slug: 'bw-test',
    ownerUid: OWNER,
    bandwidthGraceUsedAt: 1,
    bandwidthCap: { month: MONTH, engagedAt: 1 },
  })
  await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), { role: 'owner', allHosts: true })
  await setDoc(doc(db, 'hosts', HOST), {
    orgId: ORG,
    subdomain: 'bw-test',
    displayName: 'Grace test',
    bandwidthGraceUsedAt: 1,
    memberRoles: { [SITE_ADMIN]: 'admin', [OWNER]: 'admin' },
  })
})

const as = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore()
const host = (db) => doc(db, 'hosts', HOST)
const org = (db) => doc(db, 'orgs', ORG)

// ── The site's grace stamp ──────────────────────────────────────────────────
await check('CONTROL — a site admin edits the site name', () =>
  assertSucceeds(updateDoc(host(as(SITE_ADMIN)), { displayName: 'Renamed' })),
)
await check('a site admin cannot CLEAR the site grace stamp', () =>
  assertFails(updateDoc(host(as(SITE_ADMIN)), { bandwidthGraceUsedAt: deleteField() })),
)
await check('a site admin cannot REWRITE the site grace stamp', () =>
  assertFails(updateDoc(host(as(SITE_ADMIN)), { bandwidthGraceUsedAt: 0 })),
)
await check('the workspace owner cannot clear the site grace stamp either', () =>
  assertFails(updateDoc(host(as(OWNER)), { bandwidthGraceUsedAt: deleteField() })),
)

// ── The workspace's grace stamp and the pause marker ───────────────────────
await check('CONTROL — the workspace owner renames the workspace', () =>
  assertSucceeds(updateDoc(org(as(OWNER)), { name: 'Renamed workspace' })),
)
await check('the owner cannot CLEAR the workspace grace stamp', () =>
  assertFails(updateDoc(org(as(OWNER)), { bandwidthGraceUsedAt: deleteField() })),
)
await check('the owner cannot REWRITE the workspace grace stamp', () =>
  assertFails(updateDoc(org(as(OWNER)), { bandwidthGraceUsedAt: 0 })),
)
await check('the owner cannot lift the pause by clearing the marker', () =>
  assertFails(updateDoc(org(as(OWNER)), { bandwidthCap: deleteField() })),
)
await check('the owner cannot extend a grace by writing the marker', () =>
  assertFails(
    updateDoc(org(as(OWNER)), {
      bandwidthCap: { month: MONTH, engagedAt: 1, graceUntil: Date.now() + 86_400_000 },
    }),
  ),
)
await check('a site admin cannot write the marker', () =>
  assertFails(updateDoc(org(as(SITE_ADMIN)), { bandwidthCap: deleteField() })),
)

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await updateDoc(doc(db, 'hosts', HOST), { displayName: 'Grace test' }).catch(() => undefined)
})

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(`${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`)
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
