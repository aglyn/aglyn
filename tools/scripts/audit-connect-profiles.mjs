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

// READ-ONLY audit of Stripe Connect accounts recorded in Firestore (AGL-684).
// Writes NOTHING, to Firestore or to Stripe.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/audit-connect-profiles.mjs [--json]
//
// THERE ARE TWO UNRELATED CONNECT RELATIONSHIPS, and conflating them is what
// made AGL-684 look like an incident:
//
//   profiles/{uid}           — COMMERCE. The merchant's own account for
//                              selling products on their tenant site
//                              (plugins/commerce/server/connect.ts). Keyed by
//                              uid by design, and its ONLY fields are
//                              stripeAccountId + stripeChargesEnabled. It has
//                              no handle and is not supposed to have one.
//
//   publisherProfiles/{orgId} — MARKETPLACE. The org's account for selling
//                              listings (plugins/community). Keyed by ORG id
//                              since AGL-652, and this is the one that
//                              carries a handle and a display name.
//
// A doc in `profiles` with no handle is therefore normal, not orphaned. Only
// a `publisherProfiles` doc missing a handle is a genuine anomaly.
//
// This reports the Firestore/Auth side and stops. A connected account is a
// real financial relationship — possibly with identity documents behind KYC
// and a payout destination attached. Clearing the Firestore fields does not
// delete the Stripe account, and deleting the Stripe account is irreversible,
// so the Stripe lookup and the decision stay with a human.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
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

const auth = getAuth()
const firestore = getFirestore()

const SOURCES = [
  // kind, collection, whether a missing handle is an anomaly
  { kind: 'commerce', collection: 'profiles', handleExpected: false },
  {
    kind: 'marketplace',
    collection: 'publisherProfiles',
    handleExpected: true,
  },
]

const iso = (value) => {
  const date = value?.toDate?.()
  return date ? date.toISOString() : null
}

const rows = []
let scanned = 0
for (const source of SOURCES) {
  const snapshot = await firestore
    .collection(source.collection)
    .limit(2000)
    .get()
  scanned += snapshot.size
  for (const docSnapshot of snapshot.docs) {
  const data = docSnapshot.data()
  const stripeAccountId = data.stripeAccountId ?? null
  if (!stripeAccountId) continue

  // Commerce docs are keyed by uid, marketplace docs by org id (AGL-652).
  // Resolve both ways rather than assuming which one this is.
  const id = docSnapshot.id
  const orgSnapshot = await firestore.collection('orgs').doc(id).get()
  const authUser = await auth.getUser(id).catch(() => null)

  // Listings and hosts tell you whether the account is attached to anything
  // live, which is the difference between "dead test artifact" and "someone
  // is actually selling through this".
  const listingsSnapshot = await firestore
    .collection('communityListings')
    .where('profileId', '==', id)
    .limit(50)
    .get()
  const hostsSnapshot = orgSnapshot.exists
    ? await firestore.collection('hosts').where('orgId', '==', id).limit(50).get()
    : { size: 0, docs: [] }

  let members = 0
  if (orgSnapshot.exists) {
    const membersSnapshot = await firestore
      .collection('orgs')
      .doc(id)
      .collection('members')
      .limit(50)
      .get()
    members = membersSnapshot.size
  }

  rows.push({
    id,
    kind: source.kind,
    collection: source.collection,
    handleExpected: source.handleExpected,
    handle: data.handle ?? null,
    createTime: docSnapshot.createTime?.toDate?.().toISOString() ?? null,
    displayName: data.displayName ?? null,
    stripeAccountId,
    chargesEnabled: data.stripeChargesEnabled ?? data.chargesEnabled ?? null,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
    resolvesToOrg: orgSnapshot.exists,
    orgName: orgSnapshot.exists ? (orgSnapshot.data().name ?? null) : null,
    orgMembers: members,
    orgHosts: hostsSnapshot.size,
    resolvesToAuthUser: Boolean(authUser),
    authEmail: authUser?.email ?? null,
    authDisabled: authUser?.disabled ?? null,
    authCreatedAt: authUser?.metadata?.creationTime ?? null,
    authLastSignIn: authUser?.metadata?.lastSignInTime ?? null,
    listings: listingsSnapshot.size,
    listingIds: listingsSnapshot.docs.map((entry) => entry.id),
  })
  }
}

// Only a MARKETPLACE profile missing a handle is an anomaly; a commerce
// profile never has one.
const anomalies = rows.filter((row) => row.handleExpected && !row.handle)

if (asJson) {
  console.log(JSON.stringify({ scanned, rows, anomalies }, null, 2))
} else {
  console.log(`Scanned ${scanned} profile docs across ${SOURCES.length} collections.`)
  console.log(`${rows.length} carry a Stripe Connect account.`)
  console.log(`${anomalies.length} are anomalous (marketplace profile, no handle).\n`)
  for (const row of rows) {
    console.log(
      `${row.handleExpected && !row.handle ? '! ' : '  '}${row.id}  [${row.kind}]`,
    )
    console.log(`    collection:    ${row.collection}`)
    console.log(
      `    handle:        ${row.handle ?? '(none)'}` +
        `${row.handleExpected ? '' : ' — not applicable for commerce'}`,
    )
    console.log(`    displayName:   ${row.displayName ?? '(none)'}`)
    console.log(`    stripeAccount: ${row.stripeAccountId}`)
    console.log(`    chargesEnabled:${row.chargesEnabled}`)
    console.log(`    created/updated: ${row.createdAt} / ${row.updatedAt}`)
    console.log(
      `    resolves to:   org=${row.resolvesToOrg}` +
        `${row.orgName ? ` ("${row.orgName}")` : ''}` +
        ` authUser=${row.resolvesToAuthUser}` +
        `${row.authEmail ? ` <${row.authEmail}>` : ''}`,
    )
    console.log(
      `    attached:      hosts=${row.orgHosts} members=${row.orgMembers} listings=${row.listings}`,
    )
    if (row.listingIds.length) {
      console.log(`    listingIds:    ${row.listingIds.join(', ')}`)
    }
    console.log('')
  }
  if (anomalies.length) {
    console.log(
      'Lines marked ! are MARKETPLACE profiles with a connected account and ' +
        'no handle — genuinely anomalous. Nothing here was changed. Look each ' +
        'Stripe account up in the dashboard (identity, onboarding state, ' +
        'charges, payouts, balance) before deciding anything.',
    )
  } else {
    console.log('No anomalies. Nothing was changed by this script.')
  }
}
