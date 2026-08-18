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

// READ-ONLY audit: who would be downgraded by making the POS register add-on
// per-host (AGL-1775). Issues reads only — no write path exists in this file.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/audit-pos-register-allocation.mjs [--json]
//
// WHY THIS EXISTS
//
// `seatAddons.posRegisters` is bought once, org-wide, and enforced per host,
// so one $89/mo purchase raises the register cap on every site the org runs
// (AGL-1775). Zach's 2026-08-17 decision is to enforce it per host through an
// allocation pool. That is a de-facto DOWNGRADE for anybody already running
// registers on more than one site off a single purchase — so before the
// enforcement changes, the population has to be asked directly rather than
// reasoned about. No individual code path can answer it.
//
// WHAT IT REPORTS — a decomposed count, because a bare "0 affected" is
// indistinguishable from a query that looked in the wrong place:
//
//   orgsScanned          — every org doc read.
//   orgsWithAddon        — `seatAddons.posRegisters > 0`. The purchasers.
//   orgsWithMultipleHosts— purchasers running more than one site.
//   orgsAtRisk           — purchasers with registers live on 2+ hosts. THIS
//                          is the grandfathering set; anything above zero
//                          means customer comms before the enforcement flips.
//   registersByHost      — per at-risk org, the decomposition, so the sum is
//                          auditable rather than merely precise (AGL-1402).
//
// Exits non-zero when `orgsAtRisk` is non-empty, so it can gate the change.

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

/**
 * Registers do NOT soft-delete (`RESOURCES.register` in
 * apps/console/app/api/hosts/resources/route.ts carries no `softDeletes`), so
 * a plain count is the live count. If that ever changes this must filter on
 * `deletedAt == null` or it will over-report the at-risk set.
 */
async function liveRegisterCount(hostRef) {
  const snapshot = await hostRef.collection('registers').count().get()
  return Number(snapshot.data().count ?? 0)
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
    orgsAtRisk: [],
  }

  for (const org of orgs.docs) {
    const purchased = Number(org.get('seatAddons.posRegisters') ?? 0)
    if (!Number.isFinite(purchased) || purchased <= 0) continue

    const hosts = await db.collection('hosts').where('orgId', '==', org.id).get()
    const registersByHost = []
    for (const host of hosts.docs) {
      registersByHost.push({
        hostId: host.id,
        registers: await liveRegisterCount(host.ref),
      })
    }
    const hostsRunningRegisters = registersByHost.filter(
      (entry) => entry.registers > 0,
    )
    const entry = {
      orgId: org.id,
      slug: org.get('slug') ?? null,
      plan: org.get('plan') ?? null,
      purchasedRegisterAddons: purchased,
      hostCount: hosts.size,
      hostsRunningRegisters: hostsRunningRegisters.length,
      totalLiveRegisters: registersByHost.reduce(
        (sum, item) => sum + item.registers,
        0,
      ),
      registersByHost,
    }
    report.orgsWithAddon.push(entry)
    if (hosts.size > 1) report.orgsWithMultipleHosts.push(entry)
    // AT RISK is registers live on 2+ hosts, not merely 2+ hosts: an org with
    // five sites and registers on one loses nothing when the pool is
    // allocated to that one site.
    if (hostsRunningRegisters.length > 1) report.orgsAtRisk.push(entry)
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`project:               ${report.projectId}`)
    console.log(`orgs scanned:          ${report.orgsScanned}`)
    console.log(`orgs with the add-on:  ${report.orgsWithAddon.length}`)
    console.log(`  …of those, 2+ sites: ${report.orgsWithMultipleHosts.length}`)
    console.log(`  …registers on 2+:    ${report.orgsAtRisk.length}   <= grandfathering set`)
    for (const entry of report.orgsAtRisk) {
      console.log(
        `    ${entry.orgId} (${entry.slug ?? 'no slug'}, ${entry.plan}): ` +
          `${entry.purchasedRegisterAddons} bought, ` +
          `${entry.totalLiveRegisters} live across ${entry.hostsRunningRegisters} sites`,
      )
      for (const host of entry.registersByHost) {
        console.log(`      ${host.hostId}: ${host.registers}`)
      }
    }
  }
  process.exit(report.orgsAtRisk.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
