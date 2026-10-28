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
 * STAMP EVERY SIGNED WAIVER WITH ITS RETENTION PERIOD (AGL-4042).
 *
 * Every signed waiver now follows its store's retention period: signing
 * stamps it with the day it is deleted (`retainUntilMs`) and the period that
 * was counted with (`retentionYears`), and records the site's period in
 * `orgs/{orgId}/waiverRetention/{hostId}`, which the `waivers-retention` job
 * compares with the store's setting. Signatures taken before that carry no
 * stamp (or, after an erasure request, a date without its period), and their
 * sites no state, so the job would never delete them. This stamps them.
 *
 * It writes only those two fields on a signature, and creates a missing
 * site state; nothing a signer, a store or the console shows changes, and an
 * erased signature's date stays as its period gives it. The period is the
 * site's as the store's settings resolve it (`resolvePluginConfig`, the
 * workspace's value under the site's), counted by the same rule signing uses
 * (`waiverRetentionStamp`). A signature whose period has already run out is
 * counted as due: the job's next tick deletes it, with its files.
 *
 * Dry-run by default: reads, prints counts, writes nothing. Each signature
 * is written with a precondition on the document it was judged from, so one
 * changed in between is skipped and picked up by a re-run.
 *
 *   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
 *   SWC_NODE_PROJECT=tsconfig.base.json \
 *     node --import @swc-node/register/esm-register \
 *     tools/scripts/backfill-waiver-retention.mts [--org <orgId>] [--commit]
 *
 * With FIRESTORE_EMULATOR_HOST set it needs only FIREBASE_PROJECT_ID.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore'

import { resolvePluginConfig } from '../../libs/aglyn/src/lib/plugin-manager/plugin-config'
import {
  WAIVERS_COLLECTIONS,
  WAIVERS_PLUGIN_ID,
} from '../../libs/plugins/waivers/src/lib/constants/bundle-common'
import {
  WAIVERS_CONFIG_SCHEMA,
  waiverRetentionStamp,
  waiverRetentionStampMoved,
  waiverRetentionYears,
} from '../../libs/plugins/waivers/src/lib/model/waiver-retention'

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const orgFlag = args.indexOf('--org')
const ONLY_ORG = orgFlag >= 0 ? args[orgFlag + 1] : undefined
const PAGE = 300

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
const nowMs = Date.now()

console.log(
  `\nStamp signed waivers with their retention period — project=${projectId} ` +
    `${ONLY_ORG ? `org=${ONLY_ORG} ` : ''}mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

/** A store's settings document for this plugin, at the workspace or the site. */
async function settings(scope: 'orgs' | 'hosts', id: string): Promise<Record<string, unknown> | undefined> {
  return (await firestore.collection(scope).doc(id).collection('pluginSettings').doc(WAIVERS_PLUGIN_ID).get()).data()
}

const periods = new Map<string, Promise<number>>()

/** A site's period, as the console's settings resolve it, read once per site. */
function siteYears(orgId: string, hostId: string): Promise<number> {
  const key = `${orgId}/${hostId}`
  if (!periods.has(key)) {
    periods.set(
      key,
      Promise.all([settings('orgs', orgId), settings('hosts', hostId)]).then(([org, host]) =>
        waiverRetentionYears(resolvePluginConfig(WAIVERS_CONFIG_SCHEMA, { org, host })),
      ),
    )
  }
  return periods.get(key) as Promise<number>
}

let seen = 0
let alreadyStamped = 0
let toStamp = 0
let dueNow = 0
let stamped = 0
let skipped = 0
const sites = new Map<string, { orgId: string; hostId: string; years: number }>()

const base = ONLY_ORG
  ? firestore.collection('orgs').doc(ONLY_ORG).collection(WAIVERS_COLLECTIONS.signatures)
  : firestore.collectionGroup(WAIVERS_COLLECTIONS.signatures)

let after: DocumentSnapshot | null = null
for (;;) {
  const page = await (after ? base.limit(PAGE).startAfter(after) : base.limit(PAGE)).get()
  for (const doc of page.docs) {
    seen += 1
    const signature = doc.data() as Parameters<typeof waiverRetentionStamp>[0] & {
      orgId?: string
      hostId?: string
      retainUntilMs?: number | null
      retentionYears?: number | null
    }
    const orgId = String(signature.orgId ?? '')
    const hostId = String(signature.hostId ?? '')
    if (!orgId || !hostId || typeof signature.validThroughDayKey !== 'string') {
      console.warn(`  skip  ${doc.ref.path} (no site or no covered day)`)
      skipped += 1
      continue
    }
    const years = await siteYears(orgId, hostId)
    sites.set(`${orgId}/${hostId}`, { orgId, hostId, years })
    const stamp = waiverRetentionStamp(signature, years)
    if (!waiverRetentionStampMoved(signature, stamp)) {
      alreadyStamped += 1
      continue
    }
    toStamp += 1
    if (stamp.retainUntilMs <= nowMs) dueNow += 1
    if (!COMMIT) continue
    try {
      await doc.ref.update({ ...stamp }, { lastUpdateTime: doc.updateTime })
      stamped += 1
    } catch (error) {
      console.warn(`  skip  ${doc.ref.path} (changed since it was read: ${String((error as Error).message).slice(0, 80)})`)
      skipped += 1
    }
  }
  if (page.size < PAGE) break
  after = page.docs[page.docs.length - 1]
}

let statesMissing = 0
let statesCreated = 0
for (const { orgId, hostId, years } of sites.values()) {
  const ref = firestore.collection('orgs').doc(orgId).collection(WAIVERS_COLLECTIONS.retention).doc(hostId)
  if ((await ref.get()).exists) continue
  statesMissing += 1
  if (!COMMIT) continue
  try {
    await ref.create({ orgId, hostId, years, checkedAtMs: nowMs, restamp: null })
    statesCreated += 1
  } catch {
    // Signed there since this read: signing created it.
  }
}

console.log(`signatures read:              ${seen}`)
console.log(`  already stamped:            ${alreadyStamped}`)
console.log(`  to stamp:                   ${toStamp}`)
console.log(`    of which already due:     ${dueNow} (the next job tick deletes them)`)
console.log(`  skipped:                    ${skipped}`)
console.log(`sites with signatures:        ${sites.size}`)
console.log(`  missing a retention state:  ${statesMissing}`)
if (COMMIT) {
  console.log(`\nstamped ${stamped} signature(s), created ${statesCreated} site state(s).`)
} else {
  console.log('\nDry run: nothing written. Re-run with --commit to stamp.')
}
process.exit(0)
