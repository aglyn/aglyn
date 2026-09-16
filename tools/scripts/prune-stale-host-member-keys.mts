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

/**
 * PRUNE THE SITE GRANTS A MERGED PROJECTION LEFT BEHIND (AGL-2985).
 *
 * `syncOrgAuthProjections` wrote `hosts/{hostId}.memberRoles` and
 * `.memberPermissions` with `{ merge: true }`, which keeps every map key the
 * recomputed projection omits. Every collaborator whose site access was
 * revoked, and every member removed from an organization, before that writer
 * switched to `mergeFields` still holds a key — and the Firestore rules read
 * that key, and nothing else, to let a person edit and publish the site.
 *
 * The fixed writer heals an organization the next time anything re-projects
 * it. This does it now, for every site: a key is stale exactly when
 * `hostRoleFor` — the function the projection itself is built from — gives
 * its uid no role on that site under the organization's current roster.
 * Only stale keys are deleted; a role that is merely out of date is left for
 * the projection, which is the writer that knows what it should be.
 *
 * Each site is written with a precondition on the document it was judged
 * from, so a grant that lands between the read and the write refuses the
 * delete rather than being undone by it; re-running picks the site up again.
 *
 * Dry-run by default: reads, prints every stale key, writes nothing.
 *
 *   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
 *   SWC_NODE_PROJECT=tools/marketing/tsconfig.tables.json \
 *     node --import @swc-node/register/esm-register \
 *     tools/scripts/prune-stale-host-member-keys.mts [--org <orgId>] [--commit]
 *
 * With FIRESTORE_EMULATOR_HOST set it needs only FIREBASE_PROJECT_ID.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import type { AglynOrgMember } from '../../libs/aglyn/src/lib/foundation'
import { hostRoleFor } from '../../libs/aglyn/src/lib/app-utils/organizations'

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const orgFlag = args.indexOf('--org')
const ONLY_ORG = orgFlag >= 0 ? args[orgFlag + 1] : undefined

/** The two host maps the projection keys by member uid. */
const PROJECTED_MAPS = ['memberRoles', 'memberPermissions'] as const

/**
 * A uid the dotted update path can name. Firebase Auth uids are
 * alphanumeric; anything else is reported and left for the projection.
 */
const PLAIN_UID = /^[A-Za-z0-9_-]+$/

const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) {
  console.error('Missing FIREBASE_PROJECT_ID env var')
  process.exit(1)
}
if (!getApps().length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId })
  } else {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    if (!clientEmail || !privateKey) {
      console.error('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
      process.exit(1)
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }
}
const firestore = getFirestore()

console.log(
  `\nPrune stale site grants — project=${projectId} ` +
    `${ONLY_ORG ? `org=${ONLY_ORG} ` : ''}mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

const rosters = new Map<string, Map<string, AglynOrgMember>>()

/** The organization's current members by uid, read once per organization. */
async function rosterOf(orgId: string): Promise<Map<string, AglynOrgMember>> {
  const cached = rosters.get(orgId)
  if (cached) return cached
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .get()
  const roster = new Map(
    snapshot.docs.map((doc) => [
      doc.id,
      { $id: doc.id, ...doc.data() } as AglynOrgMember,
    ]),
  )
  rosters.set(orgId, roster)
  return roster
}

const hosts = ONLY_ORG
  ? await firestore.collection('hosts').where('orgId', '==', ONLY_ORG).get()
  : await firestore.collection('hosts').get()

let sitesScanned = 0
let sitesWithStaleKeys = 0
let staleKeys = 0
let pruned = 0
let refused = 0

for (const host of hosts.docs) {
  sitesScanned += 1
  const data = host.data()
  const orgId = typeof data['orgId'] === 'string' ? data['orgId'] : ''
  // No organization to judge the keys against: not this script's call.
  if (!orgId) continue
  const roster = await rosterOf(orgId)
  const deletes: Record<string, FirebaseFirestore.FieldValue> = {}
  for (const field of PROJECTED_MAPS) {
    const map = data[field]
    if (!map || typeof map !== 'object') continue
    for (const uid of Object.keys(map)) {
      if (hostRoleFor(roster.get(uid) ?? null, host.id)) continue
      if (!PLAIN_UID.test(uid)) {
        console.warn(`  skip  ${host.id}  ${field}[${JSON.stringify(uid)}] (uid not addressable)`)
        continue
      }
      console.log(`  stale ${host.id}  ${field}.${uid}  (org ${orgId})`)
      deletes[`${field}.${uid}`] = FieldValue.delete()
    }
  }
  const count = Object.keys(deletes).length
  if (!count) continue
  sitesWithStaleKeys += 1
  staleKeys += count
  if (!COMMIT) continue
  try {
    await host.ref.update(deletes, { lastUpdateTime: host.updateTime })
    pruned += count
  } catch (error) {
    // The site changed after it was judged. Nothing was written; a re-run
    // judges it again against what is there now.
    refused += 1
    console.warn(`  retry ${host.id}: changed since it was read (${String(error)})`)
  }
}

console.log(
  `\nsites scanned=${sitesScanned}  sites with stale keys=${sitesWithStaleKeys}  ` +
    `stale keys=${staleKeys}`,
)
console.log(
  COMMIT
    ? `Pruned ${pruned} key(s); ${refused} site(s) changed mid-run — re-run to finish them.\n`
    : `Dry-run — nothing written. Re-run with --commit to prune.\n`,
)
process.exit(COMMIT && refused > 0 ? 2 : 0)
