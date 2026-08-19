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

// READ-ONLY audit: which orgs sit ABOVE the corrected per-site collaborator
// cap (AGL-2439). Issues reads only — no write path exists in this file.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/audit-collaborator-seat-allocation.mjs [--json]
//
// WHY THIS EXISTS
//
// `seatAddons.members` is bought once, org-wide, and `membersPerHost` is
// enforced PER SITE, so one purchased collaborator seat raised the cap on
// every site the org runs — the AGL-1775 register defect, never applied to
// `members`. AGL-2439 makes the purchase a POOL allocated per site.
//
// That is a de-facto DOWNGRADE for anybody whose sites are only under the cap
// because of the multiplication. Zach's decision is to GRANDFATHER them, so
// the population has to be counted rather than reasoned about: the count is
// what decides whether this ships quietly or with customer comms.
//
// WHAT IT REPORTS — a decomposed count, because a bare "0 affected" is
// indistinguishable from a query that looked in the wrong place:
//
//   orgsScanned           — every org doc read.
//   orgsWithAddon         — `seatAddons.members > 0`. The purchasers.
//   orgsWithMultipleHosts — purchasers running more than one site.
//   orgsOverCorrectedCap  — orgs with at least one site whose collaborator
//                           head-count exceeds the CORRECTED cap for that
//                           site (plan `membersPerHost`, clamped to
//                           `maxMembersPerHost`, with NO pool folded in —
//                           i.e. what an unallocated site resolves to).
//                           THIS is the grandfathering set.
//
// The corrected cap is computed over EVERY org, not only purchasers: an org
// can be over the plain plan cap through a staff `entitlements` override or a
// plan downgrade, and the grandfather path has to cover them too.
//
// Seat counting mirrors `countCollaboratorSeats`: org-wide members (managers)
// are excluded whatever `hostAccess` they carry, un-accepted invites DO hold
// a seat, and a person present as both a uid row and an invite is one seat.
//
// Exits non-zero when `orgsOverCorrectedCap` is non-empty, so it can gate.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const asJson = process.argv.includes('--json')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID)

// The plan table, transcribed from `PLAN_ENTITLEMENTS` in
// libs/aglyn/src/lib/app-utils/plan-entitlements.ts. Transcribed rather than
// imported because this script is plain ESM run by node against production and
// the library is TypeScript inside an nx graph. The pair is asserted by
// `collaborator-seat-audit-plan-table.spec.ts`, which reads THIS file and the
// real table and fails when they diverge — a stale copy here would silently
// mis-size the grandfathering set, which is the number the decision rests on.
export const AUDIT_PLAN_COLLABORATOR_CAPS = {
  free: { membersPerHost: 1, maxMembersPerHost: 1 },
  starter: { membersPerHost: 3, maxMembersPerHost: 10 },
  pro: { membersPerHost: 10, maxMembersPerHost: 25 },
  business: { membersPerHost: 50, maxMembersPerHost: 100 },
  scale: { membersPerHost: 75, maxMembersPerHost: 150 },
  advanced: { membersPerHost: 100, maxMembersPerHost: 250 },
  agency: { membersPerHost: 250, maxMembersPerHost: 1000 },
  enterprise: {
    membersPerHost: Number.POSITIVE_INFINITY,
    maxMembersPerHost: Number.POSITIVE_INFINITY,
  },
}

/**
 * The CORRECTED per-site cap for an unallocated site: the plan's
 * `membersPerHost` (with any staff override applied) clamped to
 * `maxMembersPerHost`, and NO purchased pool folded in.
 */
function correctedCapForOrg(org) {
  const plan = String(org.get('plan') ?? 'free')
  const table =
    AUDIT_PLAN_COLLABORATOR_CAPS[plan] ?? AUDIT_PLAN_COLLABORATOR_CAPS.free
  const overrides = org.get('entitlements') ?? {}
  const included =
    typeof overrides.membersPerHost === 'number'
      ? overrides.membersPerHost
      : table.membersPerHost
  const max =
    typeof overrides.maxMembersPerHost === 'number'
      ? overrides.maxMembersPerHost
      : table.maxMembersPerHost
  return Math.min(included, max)
}

/**
 * `isOrgWideMember`, transcribed exactly: owner/admin are managers whatever
 * the flag says, and a pre-`allHosts` row with no scoping is a manager too.
 */
function isOrgWide(entry) {
  if (!entry) return false
  if (entry.role === 'owner' || entry.role === 'admin') return true
  if (entry.allHosts === true) return true
  return (
    entry.allHosts === undefined &&
    !Object.keys(entry.hostAccess ?? {}).length
  )
}

/** `collaboratorSeatKey`: email wins, uid is the fallback identity. */
function seatKey(entry) {
  const email =
    typeof entry.email === 'string' ? entry.email.trim().toLowerCase() : ''
  if (email) return email
  const uid = typeof entry.uid === 'string' ? entry.uid.trim() : ''
  return uid ? `uid:${uid}` : ''
}

async function seatEntries(orgRef) {
  const [members, invites] = await Promise.all([
    orgRef.collection('members').get(),
    orgRef.collection('invites').get(),
  ])
  return [
    ...members.docs.map((doc) => ({ uid: doc.id, ...doc.data() })),
    ...invites.docs
      .map((doc) => doc.data())
      .filter((data) => data.acceptedAt == null),
  ]
}

function countSeatsOnHost(entries, hostId) {
  const keys = new Set()
  for (const entry of entries) {
    if (isOrgWide(entry)) continue
    if (!entry.hostAccess?.[hostId]) continue
    const key = seatKey(entry)
    if (key) keys.add(key)
  }
  return keys.size
}

async function main() {
  const orgs = await db.collection('orgs').get()
  const report = {
    projectId,
    databaseId: process.env.FIRESTORE_DATABASE_ID ?? '(default)',
    at: new Date().toISOString(),
    orgsScanned: orgs.size,
    orgsWithAddon: [],
    orgsWithMultipleHosts: [],
    orgsOverCorrectedCap: [],
  }

  for (const org of orgs.docs) {
    const purchased = Number(org.get('seatAddons.members') ?? 0)
    const correctedCap = correctedCapForOrg(org)
    const hosts = await db.collection('hosts').where('orgId', '==', org.id).get()
    const entries = await seatEntries(org.ref)

    const seatsByHost = hosts.docs.map((host) => ({
      hostId: host.id,
      collaborators: countSeatsOnHost(entries, host.id),
    }))
    const overCapHosts = seatsByHost.filter(
      (item) => item.collaborators > correctedCap,
    )
    const entry = {
      orgId: org.id,
      slug: org.get('slug') ?? null,
      plan: org.get('plan') ?? null,
      purchasedCollaboratorSeats: Number.isFinite(purchased) ? purchased : 0,
      correctedCapPerSite: correctedCap,
      hostCount: hosts.size,
      totalCollaborators: seatsByHost.reduce(
        (sum, item) => sum + item.collaborators,
        0,
      ),
      seatsByHost,
      overCapHosts,
    }
    if (entry.purchasedCollaboratorSeats > 0) report.orgsWithAddon.push(entry)
    if (entry.purchasedCollaboratorSeats > 0 && hosts.size > 1) {
      report.orgsWithMultipleHosts.push(entry)
    }
    if (overCapHosts.length) report.orgsOverCorrectedCap.push(entry)
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`project:                  ${report.projectId}`)
    console.log(`orgs scanned:             ${report.orgsScanned}`)
    console.log(`orgs with the add-on:     ${report.orgsWithAddon.length}`)
    console.log(`  …of those, 2+ sites:    ${report.orgsWithMultipleHosts.length}`)
    console.log(
      `orgs over corrected cap:  ${report.orgsOverCorrectedCap.length}   <= grandfathering set`,
    )
    for (const entry of report.orgsOverCorrectedCap) {
      console.log(
        `    ${entry.orgId} (${entry.slug ?? 'no slug'}, ${entry.plan}): ` +
          `cap ${entry.correctedCapPerSite}/site, ` +
          `${entry.purchasedCollaboratorSeats} seat(s) bought`,
      )
      for (const host of entry.overCapHosts) {
        console.log(`      ${host.hostId}: ${host.collaborators} collaborators`)
      }
    }
  }
  process.exit(report.orgsOverCorrectedCap.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
