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
 * Stamp `read` onto every in-app notification written before the field
 * existed (AGL-3321).
 *
 * The notifications feed filters New and Read by EQUALITY on `read`, under
 * its newest-first cursor, and every emitter now writes `read: false` on
 * create and `read: true` beside `readAt` when the owner reads one (see
 * `AglynNotification.read`). A document written before that has no `read`
 * at all, and a query cannot find a document that lacks a field — so
 * without this, the backlog is invisible to both filters and to the
 * app-bar's unread count.
 *
 * `read` is taken from what the document already says: `true` when `readAt`
 * is set, `false` otherwise. That is the meaning the console has always
 * given the two states, so nothing a reader sees changes.
 *
 * ## Idempotence and interruption
 *
 * A document that already carries a boolean `read` is never written, so a
 * re-run is a no-op and an interrupted run is finished by the next. Writes
 * are one field, in batches of 400. Nothing is deleted.
 *
 * Only `users/{uid}/notifications/{id}` is touched: the scan is a collection
 * group, and any other collection that happens to be named `notifications`
 * is counted as skipped and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-notification-read.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-notification-read.mjs --apply  # write
 *
 * A self-hosted install runs the same two commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const args = parseDeployArgs({
  command: 'backfill-notification-read',
  summary:
    'Stamp `read` onto in-app notifications that predate it, from `readAt`. ' +
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
 * What `read` a notification should carry, or `null` when it already has
 * one (or is not a user's notification at all). Pure, for the self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ read: boolean } | { skip: 'current' | 'not-a-user-notification' }}
 */
export function planNotification(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'users' || segments[2] !== 'notifications') {
    return { skip: 'not-a-user-notification' }
  }
  if (typeof data.read === 'boolean') return { skip: 'current' }
  return { read: Boolean(data.readAt) }
}

function selfTest() {
  const cases = [
    ['users/u1/notifications/n1', {}, { read: false }],
    ['users/u1/notifications/n2', { readAt: { seconds: 1 } }, { read: true }],
    ['users/u1/notifications/n3', { readAt: null }, { read: false }],
    ['users/u1/notifications/n4', { read: false }, { skip: 'current' }],
    ['users/u1/notifications/n5', { read: true, readAt: { seconds: 1 } }, { skip: 'current' }],
    ['orgs/o1/notifications/n6', {}, { skip: 'not-a-user-notification' }],
  ]
  let failed = 0
  for (const [path, data, expected] of cases) {
    const got = planNotification(path, data)
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
    toUnread: 0,
    toRead: 0,
    otherCollections: 0,
    written: 0,
  }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('notifications').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planNotification(doc.ref.path, doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.otherCollections += 1
        continue
      }
      if (plan.read) counts.toRead += 1
      else counts.toUnread += 1
      if (!args.apply) continue
      batch.update(doc.ref, { read: plan.read })
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
  console.log(args.apply ? 'backfill-notification-read: APPLIED' : 'backfill-notification-read: DRY RUN (nothing written)')
  console.log(`  scanned            ${counts.scanned}`)
  console.log(`  already carry read ${counts.current}`)
  console.log(`  stamp read: false  ${counts.toUnread}`)
  console.log(`  stamp read: true   ${counts.toRead}`)
  console.log(`  not users/*/notifications (left alone) ${counts.otherCollections}`)
  if (args.apply) console.log(`  written            ${counts.written}`)
}

await main()
