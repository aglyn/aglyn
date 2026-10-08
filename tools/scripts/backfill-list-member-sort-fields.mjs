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

/**
 * Stamp `name`, `addedAt` and `email` onto every email-list enrollment
 * written before its writer stamped them (AGL-3680).
 *
 * A list's members table orders its QUERY by Address, Name and Joined, and
 * `orderBy` drops a document that lacks the field — so an enrollment missing
 * one would vanish from its own list the moment a reader clicked that header.
 * `enrollListMember`, the collection's only writer, now stamps all three on
 * every row it writes. This finishes the rows written before:
 *
 *   `name: null` where no name is stored — what an absent name has always
 *     meant (the column draws it as a dash).
 *   `addedAt` from the document's CREATE TIME where it is absent — the rows
 *     adopted under the legacy ids predate the field, and the instant the
 *     document came to exist is the date the person joined the list. The
 *     writer does the same for such a row on its next enrollment.
 *   `email: null` where no address is stored, so the Address order keeps it.
 *
 * ## Idempotence and interruption
 *
 * A row carrying all three (null counts) is never written, so a re-run
 * reports 0 to stamp and an interrupted run is finished by the next. Writes
 * touch only those fields, in batches of 400. Nothing is deleted. Only
 * `orgs/{orgId}/lists/{listId}/members/{id}` is touched; the scan is a
 * collection group, and any other collection named `members` (an
 * organization's team roster is one) is counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-list-member-sort-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-list-member-sort-fields.mjs --apply  # write
 *     node tools/scripts/backfill-list-member-sort-fields.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const args = parseDeployArgs({
  command: 'backfill-list-member-sort-fields',
  summary:
    'Stamp `name`, `addedAt` and `email` onto email-list enrollments that predate ' +
    'them. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the cases, touching no project.' },
  ],
})

/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000

/** `orgs/{orgId}/lists/{listId}/members/{id}`. */
const isEnrollment = (segments) =>
  segments.length === 6 &&
  segments[0] === 'orgs' &&
  segments[2] === 'lists' &&
  segments[4] === 'members'

/**
 * What one enrollment should be stamped with, or a skip. Pure, for the
 * self-test.
 *
 * @param {string} path
 * @param {Record<string, unknown>} data
 * @param {unknown} createTime the document's create time
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-an-enrollment' }}
 */
export function planEnrollmentSortFields(path, data, createTime) {
  if (!isEnrollment(path.split('/'))) return { skip: 'not-an-enrollment' }
  const update = {}
  if (data.name === undefined) update.name = null
  if (data.addedAt === undefined && createTime) update.addedAt = createTime
  if (data.email === undefined) update.email = null
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  let failed = 0
  let total = 0
  const check = (name, ok) => {
    total += 1
    if (!ok) {
      failed += 1
      console.error(`FAIL ${name}`)
    }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const M = 'orgs/o1/lists/l1/members/k1'
  const CREATED = { seconds: 1700000000, nanoseconds: 0 }
  const JOINED = { seconds: 1600000000, nanoseconds: 0 }
  const cases = [
    ['a legacy row', M, { email: 'dana@example.com' }, { update: { name: null, addedAt: CREATED } }],
    ['a row with a name and no date', M, { email: 'dana@example.com', name: 'Dana' }, { update: { addedAt: CREATED } }],
    ['a row without a name', M, { email: 'dana@example.com', addedAt: JOINED }, { update: { name: null } }],
    ['a row without an address', M, { name: null, addedAt: JOINED }, { update: { email: null } }],
    ['a current row', M, { email: 'dana@example.com', name: 'Dana', addedAt: JOINED }, { skip: 'current' }],
    ['a current nameless row', M, { email: 'dana@example.com', name: null, addedAt: JOINED }, { skip: 'current' }],
    ['an organization team member', 'orgs/o1/members/uid-1', { email: 'dana@example.com' }, { skip: 'not-an-enrollment' }],
  ]
  for (const [name, path, data, expected] of cases) {
    const got = planEnrollmentSortFields(path, data, CREATED)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, same(got, expected))
    // Idempotent: a row the plan stamped plans nothing the second time.
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planEnrollmentSortFields(path, stamped, CREATED))
  }
  check(
    'a stored date is never moved',
    !('addedAt' in (planEnrollmentSortFields(M, { email: 'a@b.co', addedAt: JOINED }, CREATED).update ?? {})),
  )
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = { scanned: 0, current: 0, stamp: 0, other: 0, written: 0, fields: {} }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('members').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      const planned = planEnrollmentSortFields(doc.ref.path, doc.data(), doc.createTime)
      if ('skip' in planned) {
        if (planned.skip === 'current') {
          counts.scanned += 1
          counts.current += 1
        } else {
          counts.other += 1
        }
        continue
      }
      counts.scanned += 1
      counts.stamp += 1
      for (const field of Object.keys(planned.update)) {
        counts.fields[field] = (counts.fields[field] ?? 0) + 1
      }
      if (!args.apply) continue
      batch.update(doc.ref, planned.update)
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
      ? 'backfill-list-member-sort-fields: APPLIED'
      : 'backfill-list-member-sort-fields: DRY RUN (nothing written)',
  )
  console.log(`  scanned                    ${counts.scanned}`)
  console.log(`  already current            ${counts.current}`)
  console.log(`  to stamp                   ${counts.stamp}`)
  for (const [field, count] of Object.entries(counts.fields)) {
    console.log(`    ${field.padEnd(24)} ${count}`)
  }
  console.log(`  other \`members\` (left)     ${counts.other}`)
  if (args.apply) console.log(`  written                    ${counts.written}`)
}

await main()
