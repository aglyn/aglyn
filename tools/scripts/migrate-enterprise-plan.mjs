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

// Moves an org that reads as Enterprise via the pre-AGL-1118 overlay
// (`plan: <base tier>` + `enterprise: true` and/or
// `subscription.customMonthlyUsd`) onto the REAL `enterprise` plan.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/migrate-enterprise-plan.mjs <orgId> [--apply]
//
// Dry-run by default: prints the doc's current billing shape and the exact
// write it WOULD make. Pass --apply to perform it.
//
// Only `plan` is written. The comped `enterprise` marker, any `discount`,
// `subscription`, `sso` and `entitlements` overrides are left exactly as they
// are — `isEnterpriseOrg` accepts all three paths, so an org keeps reading as
// Enterprise throughout, and the overlay fields stay meaningful for billing.
//
// SAFETY: refuses to run when the org's subscription is in a dead state
// (canceled/unpaid/incomplete). `resolveEffectivePlan` downgrades such an org
// to `free`, so switching its stored plan would silently strip entitlements.
// An org with NO subscription keeps its plan and is safe to migrate.
//
// Writes an `adminAudit` entry, matching the staff override path.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const args = process.argv.slice(2)
const orgId = args.find((a) => !a.startsWith('--'))
const apply = args.includes('--apply')
if (!orgId) {
  console.error(
    'Usage: node tools/scripts/migrate-enterprise-plan.mjs <orgId> [--apply]',
  )
  process.exit(1)
}

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
const firestore = getFirestore()

const DEAD_STATUSES = new Set(['canceled', 'unpaid', 'incomplete'])

const ref = firestore.collection('orgs').doc(orgId)
const snap = await ref.get()
if (!snap.exists) {
  console.error(`orgs/${orgId} does not exist`)
  process.exit(1)
}
const data = snap.data() ?? {}
const before = {
  plan: data.plan ?? null,
  enterprise: data.enterprise === true,
  subscriptionStatus: data.subscription?.status ?? null,
  customMonthlyUsd: data.subscription?.customMonthlyUsd ?? null,
  discountPercentOff: data.discount?.percentOff ?? null,
  ssoStatus: data.sso?.status ?? null,
  entitlementKeys: Object.keys(data.entitlements ?? {}),
  featureOverrides: Object.keys(data.entitlements?.features ?? {}),
}
console.log(`orgs/${orgId} (${data.name ?? data.displayName ?? '?'})`)
console.log(JSON.stringify(before, null, 2))

if (before.plan === 'enterprise') {
  console.log('\nAlready on the enterprise plan — nothing to do.')
  process.exit(0)
}

const readsEnterprise =
  before.enterprise || Number(before.customMonthlyUsd ?? 0) > 0
if (!readsEnterprise) {
  console.error(
    '\nRefusing: this org does not currently read as Enterprise ' +
      '(no `enterprise` marker and no custom price). Migrating it would ' +
      'GRANT Enterprise, which is a pricing decision, not a migration.',
  )
  process.exit(1)
}
if (before.subscriptionStatus && DEAD_STATUSES.has(before.subscriptionStatus)) {
  console.error(
    `\nRefusing: subscription status is "${before.subscriptionStatus}". ` +
      'resolveEffectivePlan downgrades such an org to `free`, so the stored ' +
      'plan must not be changed until billing is restored.',
  )
  process.exit(1)
}

console.log('\nWrite: { plan: "enterprise" } (merge) + adminAudit entry')
if (!apply) {
  console.log('Dry run — pass --apply to perform it.')
  process.exit(0)
}

await ref.set(
  { plan: 'enterprise', updatedAt: FieldValue.serverTimestamp() },
  { merge: true },
)
await firestore.collection('adminAudit').add({
  actorUid: 'script:migrate-enterprise-plan',
  action: 'org.override',
  target: `orgs/${orgId}`,
  before: { plan: before.plan },
  after: { plan: 'enterprise' },
  reason: 'AGL-1118 — enterprise is a real OrgPlan',
  at: FieldValue.serverTimestamp(),
})
const after = (await ref.get()).data() ?? {}
console.log(`\nDone. plan is now: ${after.plan}`)
