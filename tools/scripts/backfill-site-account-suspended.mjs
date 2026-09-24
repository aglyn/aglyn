#!/usr/bin/env node
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
 * Stamp `suspended: false` onto every site member written before the field
 * was stored for active members (AGL-3321).
 *
 * The console's Site users list filters Status by EQUALITY on `suspended`
 * (`hosts/{hostId}/siteMembers`), and sign-up now writes `suspended: false`
 * while the member drawer's Suspend and Reactivate write `true` and `false`.
 * A member created before that carries no `suspended` at all unless someone
 * suspended them, and a query cannot find a document that lacks a field — so
 * without this, `Status is Active` misses every older active member.
 *
 * `false` is what the document already means: every reader (sign-in, the
 * session gate, the console's Status column) treats anything but `true` as
 * not suspended, so nothing a member or a site owner sees changes. A value
 * that is present but not a boolean is counted on its own line and stamped
 * `false` too, for the same reason.
 *
 * ## Idempotence and interruption
 *
 * A document that already carries a boolean `suspended` is never written, so
 * a re-run is a no-op and an interrupted run is finished by the next. Writes
 * are one field, in batches of 400. Nothing is deleted.
 *
 * Only `hosts/{hostId}/siteMembers/{id}` is touched: the scan is a
 * collection group, and any other collection that happens to be named
 * `siteMembers` is counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-site-account-suspended.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-site-account-suspended.mjs --apply  # write
 *     node tools/scripts/backfill-site-account-suspended.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const args = parseDeployArgs({
  command: 'backfill-site-account-suspended',
  summary:
    'Stamp `suspended: false` onto site members that carry no boolean `suspended`. ' +
    'Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000

/**
 * What a site member document needs, or why it is left alone. Pure, for the
 * self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ stamp: 'missing' | 'not-boolean' } | { skip: 'current' | 'not-a-site-member' }}
 */
export function planSiteMember(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'siteMembers') {
    return { skip: 'not-a-site-member' }
  }
  if (typeof data.suspended === 'boolean') return { skip: 'current' }
  return { stamp: data.suspended === undefined ? 'missing' : 'not-boolean' }
}

function selfTest() {
  const cases = [
    ['hosts/h1/siteMembers/m1', { email: 'a@example.test' }, { stamp: 'missing' }],
    ['hosts/h1/siteMembers/m2', { suspended: false }, { skip: 'current' }],
    ['hosts/h1/siteMembers/m3', { suspended: true }, { skip: 'current' }],
    ['hosts/h1/siteMembers/m4', { suspended: null }, { stamp: 'not-boolean' }],
    ['hosts/h1/siteMembers/m5', { suspended: 'true' }, { stamp: 'not-boolean' }],
    ['orgs/o1/siteMembers/m6', {}, { skip: 'not-a-site-member' }],
    ['hosts/h1/siteMembers/m7/notes/n1', {}, { skip: 'not-a-site-member' }],
  ]
  let failed = 0
  for (const [path, data, expected] of cases) {
    const got = planSiteMember(path, data)
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failed += 1
      console.error(`FAIL ${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
    }
  }
  console.log(failed ? `self-test: ${failed} failed` : `self-test: ${cases.length}/${cases.length} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = {
    scanned: 0,
    current: 0,
    missing: 0,
    notBoolean: 0,
    otherCollections: 0,
    written: 0,
  }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('siteMembers').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planSiteMember(doc.ref.path, doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.otherCollections += 1
        continue
      }
      if (plan.stamp === 'missing') counts.missing += 1
      else counts.notBoolean += 1
      if (!args.apply) continue
      batch.update(doc.ref, { suspended: false })
      pending += 1
      if (pending >= BATCH) {
        await batch.commit()
        counts.written += pending
        batch = firestore.batch()
        pending = 0
      }
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  if (args.apply && pending) {
    await batch.commit()
    counts.written += pending
  }
  console.log(
    args.apply
      ? 'backfill-site-account-suspended: APPLIED'
      : 'backfill-site-account-suspended: DRY RUN (nothing written)',
  )
  console.log(`  scanned                       ${counts.scanned}`)
  console.log(`  already carry a boolean       ${counts.current}`)
  console.log(`  stamp false (field missing)   ${counts.missing}`)
  console.log(`  stamp false (not a boolean)   ${counts.notBoolean}`)
  console.log(`  not hosts/*/siteMembers (left alone) ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                       ${counts.written}`)
}

await main()
