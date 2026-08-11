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

// READ-ONLY audit of the marketplace install counters (AGL-1418).
// Writes nothing.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/audit-install-counters.mjs [--json]
//
// Why this exists: the same two quantities are stored twice — once on
// `marketplaceListings/{id}` and once per version doc — by different code,
// under different trigger conditions, each swallowing its own failures. AGL-1418
// found them disagreeing on 6 of 8 production listings, which is how one
// listing came to advertise `7 installs · 2 active` above a version history
// totalling `3 · 1` for its ONLY version.
//
// `reconcileInstallTallies` makes the PAGE consistent. It cannot make the
// stored data true, because neither stored level is ground truth: the pins are.
// This script is the only thing that reads them, because counting pins in the
// product would need a COLLECTION_GROUP_ASC index on `installs.listingId` that
// does not exist. It walks `orgs` and `hosts` directly instead, which needs no
// index and is why it belongs in a script rather than on a request path.
//
// Pin counts are meaningful for PLUGINS only. Every other artifact type
// installs by copying itself into the site, so it holds no pin and a zero there
// is expected rather than a defect.

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

const firestore = getFirestore()

/** Every live pin, keyed by listing. One pin is one install, org-wide or not. */
async function livePinsByListing() {
  const pins = new Map()
  const record = (listingId, path) => {
    if (!pins.has(listingId)) pins.set(listingId, [])
    pins.get(listingId).push(path)
  }
  for (const parent of ['orgs', 'hosts']) {
    const owners = await firestore.collection(parent).select().get()
    for (const owner of owners.docs) {
      const installs = await owner.ref.collection('installs').get()
      for (const pin of installs.docs) {
        record(String(pin.get('listingId') ?? pin.id), pin.ref.path)
      }
    }
  }
  return pins
}

const pinsByListing = await livePinsByListing()
const listings = await firestore.collection('marketplaceListings').get()

const rows = []
for (const listing of listings.docs) {
  const artifactType = String(listing.get('artifactType') ?? listing.get('type') ?? '')
  const isPlugin = artifactType === 'plugin'
  const versions = await listing.ref
    .collection(isPlugin ? 'pluginVersions' : 'versions')
    .get()
  const versionInstallCount = versions.docs.reduce(
    (total, doc) => total + Number(doc.get('installCount') ?? 0),
    0,
  )
  const versionActiveInstalls = versions.docs.reduce(
    (total, doc) => total + Number(doc.get('activeInstalls') ?? 0),
    0,
  )
  const listingInstallCount = Number(listing.get('installCount') ?? 0)
  const listingActiveInstalls = Number(listing.get('activeInstalls') ?? 0)
  const pins = pinsByListing.get(listing.id) ?? []

  const problems = []
  if (versionActiveInstalls !== listingActiveInstalls) {
    problems.push(
      `active: listing ${listingActiveInstalls} vs versions ${versionActiveInstalls}`,
    )
  }
  if (versionInstallCount !== listingInstallCount) {
    problems.push(
      `all-time: listing ${listingInstallCount} vs versions ${versionInstallCount}`,
    )
  }
  // Ground truth, and only for the type that has one.
  if (isPlugin && listingActiveInstalls !== pins.length) {
    problems.push(`active: listing ${listingActiveInstalls} vs ${pins.length} live pins`)
  }
  rows.push({
    listingId: listing.id,
    displayName: String(listing.get('displayName') ?? ''),
    artifactType,
    listingInstallCount,
    listingActiveInstalls,
    versionInstallCount,
    versionActiveInstalls,
    livePins: isPlugin ? pins.length : null,
    pinPaths: isPlugin ? pins : [],
    problems,
  })
}

if (asJson) {
  console.log(JSON.stringify({ scanned: rows.length, rows }, null, 2))
} else {
  for (const row of rows) {
    console.log(
      `${row.listingId} "${row.displayName}" [${row.artifactType}]\n` +
        `  listing   all-time ${row.listingInstallCount}  active ${row.listingActiveInstalls}\n` +
        `  versions  all-time ${row.versionInstallCount}  active ${row.versionActiveInstalls}\n` +
        `  live pins ${row.livePins ?? 'n/a (installs by copy, holds no pin)'}` +
        (row.pinPaths.length ? `\n    ${row.pinPaths.join('\n    ')}` : '') +
        (row.problems.length
          ? `\n  MISMATCH: ${row.problems.join(' ; ')}`
          : '\n  consistent'),
    )
  }
  const bad = rows.filter((row) => row.problems.length).length
  console.log(`\n${bad}/${rows.length} listings have counters that disagree.`)
}
