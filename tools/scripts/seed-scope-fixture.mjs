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

// Emulator-only multi-org fixture for scoped sharing (AGL-1037…1048).
// Seeds the agency case the project exists for: one org with INTERNAL and
// CLIENT hosts, a site collaborator scoped to a single client host, and
// datasets/media that deliberately carry NO `visibleTo` — the pre-backfill
// shape AGL-1040 has to stamp.
//
//   FIRESTORE_EMULATOR_HOST=localhost:8082 \
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//     node tools/scripts/seed-scope-fixture.mjs
//
// Idempotent: deterministic `scope-…` ids, merge-set writes. Refuses to run
// without both emulator hosts so it can never touch production.
//
// What each fixture is FOR (so a later edit doesn't quietly defeat a test):
//
// - `scope-agency` org: 3 internal + 2 client hosts. The 12-client case in
//   the brief is the same shape; 2 keeps the fixture readable.
// - `collab` member: `allHosts: false`, `hostAccess: { scope-client-1 }`.
//   The one principal that must NOT see the internal library.
// - `legacy` member: neither `allHosts` nor `hostAccess` — the pre-flag
//   shape that must resolve org-wide (AGL-1038) rather than lock out.
// - `scope-ds-preset` / `scope-media-preset`: already carry a `visibleTo`,
//   so the backfill must SKIP them (idempotency proof).
// - `scope-ds-empty`: `visibleTo: []` — "visible to nobody". The backfill
//   must leave it alone; stamping it `['org']` would widen it.
// - `scope-legacy-host-ds`: a dataset under `hosts/{id}/datasets`, the
//   pre-AGL-237 path, so `legacyHostDatasets` reports a non-zero count.

import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error(
    'Refusing to run: FIRESTORE_EMULATOR_HOST and ' +
      'FIREBASE_AUTH_EMULATOR_HOST must both point at local emulators. ' +
      'This fixture is emulator-only by design.',
  )
  process.exit(1)
}

const projectId =
  process.argv.includes('--project')
    ? process.argv[process.argv.indexOf('--project') + 1]
    : 'aglyn-main'

if (!getApps().length) initializeApp({ projectId })
const db = getFirestore()
const auth = getAuth()

const ORG_ID = 'scope-agency'
const INTERNAL_HOSTS = ['scope-internal-1', 'scope-internal-2', 'scope-internal-3']
const CLIENT_HOSTS = ['scope-client-1', 'scope-client-2']
const ALL_HOSTS = [...INTERNAL_HOSTS, ...CLIENT_HOSTS]

const USERS = [
  { uid: 'scope-owner', email: 'scope-owner@aglyn.test', role: 'owner' },
  { uid: 'scope-collab', email: 'scope-collab@aglyn.test', role: 'viewer' },
  { uid: 'scope-legacy', email: 'scope-legacy@aglyn.test', role: 'editor' },
]

async function ensureUser({ uid, email }) {
  try {
    await auth.getUser(uid)
  } catch {
    await auth.createUser({
      uid,
      email,
      password: 'E2e-Password-1',
      emailVerified: true,
    })
  }
}

async function main() {
  for (const user of USERS) await ensureUser(user)

  const orgRef = db.collection('orgs').doc(ORG_ID)
  await orgRef.set(
    {
      name: 'Scope Agency',
      slug: ORG_ID,
      ownerUid: 'scope-owner',
      plan: 'business',
      hosts: Object.fromEntries(ALL_HOSTS.map((id) => [id, true])),
      subscription: { status: 'active' },
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  // Members. NONE carry `scopeTokens` — that is what the backfill writes.
  await orgRef.collection('members').doc('scope-owner').set(
    { role: 'owner', allHosts: true, email: 'scope-owner@aglyn.test' },
    { merge: true },
  )
  await orgRef.collection('members').doc('scope-collab').set(
    {
      role: 'viewer',
      allHosts: false,
      hostAccess: { 'scope-client-1': 'editor' },
      email: 'scope-collab@aglyn.test',
    },
    { merge: true },
  )
  // Legacy shape: neither flag nor map. Must resolve org-wide.
  await orgRef.collection('members').doc('scope-legacy').set(
    { role: 'editor', email: 'scope-legacy@aglyn.test' },
    { merge: true },
  )

  for (const hostId of ALL_HOSTS) {
    await db.collection('hostIndex').doc(hostId).set({ orgId: ORG_ID })
    await db.collection('hosts').doc(hostId).set(
      {
        orgId: ORG_ID,
        subdomain: hostId,
        memberRoles: {
          'scope-owner': 'admin',
          ...(hostId === 'scope-client-1' ? { 'scope-collab': 'editor' } : {}),
        },
      },
      { merge: true },
    )
  }

  // Org datasets with NO visibleTo — the pre-backfill shape.
  for (const [id, displayName] of [
    ['scope-ds-brand', 'Brand Assets'],
    ['scope-ds-internal', 'Internal Rates'],
    ['scope-ds-shared', 'Shared Products'],
  ]) {
    await orgRef.collection('datasets').doc(id).set(
      { displayName, fields: ['name'], createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  }
  // Already scoped — the backfill must SKIP these two.
  await orgRef.collection('datasets').doc('scope-ds-preset').set(
    {
      displayName: 'Preset Scoped',
      fields: ['name'],
      visibleTo: ['host:scope-internal-1'],
    },
    { merge: true },
  )
  // "Visible to nobody" — must NOT be widened to ['org'].
  await orgRef.collection('datasets').doc('scope-ds-empty').set(
    { displayName: 'Hidden', fields: ['name'], visibleTo: [] },
    { merge: true },
  )

  for (const id of ['scope-media-logo', 'scope-media-internal']) {
    await orgRef.collection('media').doc(id).set(
      {
        fileName: `${id}.png`,
        contentType: 'image/png',
        sizeBytes: 1024,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }
  await orgRef.collection('media').doc('scope-media-preset').set(
    { fileName: 'preset.png', contentType: 'image/png', visibleTo: ['org'] },
    { merge: true },
  )
  await orgRef.collection('mediaFolders').doc('scope-folder-internal').set(
    { name: 'Internal', parentId: null, order: 0 },
    { merge: true },
  )

  // Legacy host-scoped dataset (pre-AGL-237 path) so the route's
  // `legacyHostDatasets` count has something to find.
  await db
    .collection('hosts')
    .doc('scope-client-2')
    .collection('datasets')
    .doc('scope-legacy-host-ds')
    .set({ displayName: 'Legacy Host Data', fields: ['name'] }, { merge: true })

  console.log(
    `Seeded ${ORG_ID}: ${ALL_HOSTS.length} hosts, ${USERS.length} members, ` +
      '5 datasets (2 pre-scoped), 3 media, 1 folder, 1 legacy host dataset.',
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
