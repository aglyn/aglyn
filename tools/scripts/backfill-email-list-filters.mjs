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
 * Stamp the keys the Emails lists and list-membership tables query onto every
 * list and enrollment written before them (AGL-3321).
 *
 * Both tables put every filter and search word on their Firestore query, and
 * a query cannot find a document that lacks the field it asks about. So a
 * list or an enrollment written before its writer stamped these still LISTS,
 * while every search and filter quietly skips it.
 *
 *   `orgs/{orgId}/lists/{listId}` — `nameLower`, `nameTokens` and
 *     `nameReversed` from `name` (what `nameSearchFields` stamps on the create
 *     and the rename), and `kind: 'manual'` where no kind is stored, which is
 *     what an absent kind has always meant (the column draws it so).
 *   `orgs/{orgId}/lists/{listId}/members/{id}` — `searchTokens` from the
 *     address and the name (what `enrollListMember` stamps through
 *     `listMemberSearchTokens`), and `via: 'manual'` where none is stored,
 *     which is what an absent `via` has always meant (the materializer never
 *     removes such a row, and the column draws it as Added).
 *
 * The keys come from the ONE script-side twin of each builder —
 * `lib/name-search-tokens.mjs` and `lib/email-search-tokens.mjs` — held to the
 * library's fixtures by their own tests, so a row stamped here is found
 * exactly as a row the writers stamp.
 *
 * ## Idempotence and interruption
 *
 * A row whose keys already equal what its name and address make, and which
 * carries a kind (or `via`), is never written, so a re-run is a no-op and an
 * interrupted run is finished by the next. Writes touch only those fields, in
 * batches of 400. Nothing is deleted. Only the two paths above are touched:
 * the scans are collection groups, and any other collection named `lists` or
 * `members` (an organization's team roster is one) is counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-list-filters.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-list-filters.mjs --apply  # write
 *     node tools/scripts/backfill-email-list-filters.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { listMemberSearchTokens } from './lib/email-search-tokens.mjs'
import { displayNameSearchFields, sameSearchTokens } from './lib/name-search-tokens.mjs'

const args = parseDeployArgs({
  command: 'backfill-email-list-filters',
  summary:
    'Stamp the search and filter keys onto email lists and list enrollments that ' +
    'predate them. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the cases, touching no project.' },
  ],
})

/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of a scan. */
const PAGE = 1000

/** `orgs/{orgId}/lists/{listId}`. */
const isList = (segments) =>
  segments.length === 4 && segments[0] === 'orgs' && segments[2] === 'lists'

/** `orgs/{orgId}/lists/{listId}/members/{id}`. */
const isEnrollment = (segments) =>
  segments.length === 6 &&
  segments[0] === 'orgs' &&
  segments[2] === 'lists' &&
  segments[4] === 'members'

/**
 * What one list should be stamped with, or a skip. Pure, for the self-test.
 *
 * @param {string} path
 * @param {Record<string, unknown>} data
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-a-list' }}
 */
export function planList(path, data) {
  if (!isList(path.split('/'))) return { skip: 'not-a-list' }
  const update = {}
  const keys = displayNameSearchFields(data.name)
  if (data.nameLower !== keys.nameLower) update.nameLower = keys.nameLower
  if (!sameSearchTokens(data.nameTokens, keys.nameTokens)) update.nameTokens = keys.nameTokens
  if (data.nameReversed !== keys.nameReversed) update.nameReversed = keys.nameReversed
  if (typeof data.kind !== 'string' || !data.kind) update.kind = 'manual'
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

/**
 * What one enrollment should be stamped with, or a skip. Pure, for the
 * self-test.
 *
 * @param {string} path
 * @param {Record<string, unknown>} data
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-an-enrollment' }}
 */
export function planEnrollment(path, data) {
  if (!isEnrollment(path.split('/'))) return { skip: 'not-an-enrollment' }
  const update = {}
  const tokens = listMemberSearchTokens(data.email, data.name)
  if (!sameSearchTokens(data.searchTokens, tokens)) update.searchTokens = tokens
  if (typeof data.via !== 'string' || !data.via) update.via = 'manual'
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

  const L = 'orgs/o1/lists/l1'
  const KEYS = displayNameSearchFields('Spring Newsletter')
  const listCases = [
    ['a list from before the keys', L, { name: 'Spring Newsletter', kind: 'manual' }, { update: { ...KEYS } }],
    ['a list from before kind', L, { name: 'Spring Newsletter', ...KEYS }, { update: { kind: 'manual' } }],
    ['a current list', L, { name: 'Spring Newsletter', ...KEYS, kind: 'dynamic' }, { skip: 'current' }],
    ['a renamed list with stale keys', L, { name: 'Spring Newsletter', ...displayNameSearchFields('Old'), kind: 'manual' }, { update: { ...KEYS } }],
    ['not a list', 'hosts/h1/lists/l1', { name: 'x' }, { skip: 'not-a-list' }],
  ]
  for (const [name, path, data, expected] of listCases) {
    const got = planList(path, data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, same(got, expected))
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planList(path, stamped))
  }

  const M = 'orgs/o1/lists/l1/members/k1'
  const TOKENS = listMemberSearchTokens('dana@example.com', 'Dana Scully')
  const memberCases = [
    ['an enrollment from before the keys', M, { email: 'dana@example.com', name: 'Dana Scully' }, { update: { searchTokens: TOKENS, via: 'manual' } }],
    ['a rule enrollment without tokens', M, { email: 'dana@example.com', name: 'Dana Scully', via: 'rule' }, { update: { searchTokens: TOKENS } }],
    ['a current enrollment', M, { email: 'dana@example.com', name: 'Dana Scully', via: 'manual', searchTokens: TOKENS }, { skip: 'current' }],
    ['an organization team member', 'orgs/o1/members/uid-1', { email: 'dana@example.com' }, { skip: 'not-an-enrollment' }],
  ]
  for (const [name, path, data, expected] of memberCases) {
    const got = planEnrollment(path, data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, same(got, expected))
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planEnrollment(path, stamped))
  }
  check('an enrollment is found by its name', TOKENS.includes('scully'))
  check('an enrollment is found by its domain', TOKENS.includes('example'))
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

/**
 * Walk one collection group, planning each document and writing the stamps
 * in batches when applying.
 */
async function sweep(firestore, group, plan, counts) {
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup(group).orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      const planned = plan(doc.ref.path, doc.data())
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
      for (const field of Object.keys(planned.update)) {
        counts.fields[field] = (counts.fields[field] ?? 0) + 1
      }
      counts.stamp += 1
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
}

const emptyCounts = () => ({ scanned: 0, current: 0, stamp: 0, other: 0, written: 0, fields: {} })

function report(label, counts, otherLabel) {
  console.log(`  ${label}`)
  console.log(`    scanned              ${counts.scanned}`)
  console.log(`    already current      ${counts.current}`)
  console.log(`    to stamp             ${counts.stamp}`)
  for (const [field, count] of Object.entries(counts.fields)) {
    console.log(`      ${field.padEnd(18)} ${count}`)
  }
  console.log(`    ${otherLabel.padEnd(20)} ${counts.other}`)
  if (args.apply) console.log(`    written              ${counts.written}`)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const lists = emptyCounts()
  const members = emptyCounts()
  await sweep(firestore, 'lists', planList, lists)
  await sweep(firestore, 'members', planEnrollment, members)
  console.log(
    args.apply
      ? 'backfill-email-list-filters: APPLIED'
      : 'backfill-email-list-filters: DRY RUN (nothing written)',
  )
  report('lists (orgs/*/lists)', lists, 'other `lists` (left)')
  report('enrollments (orgs/*/lists/*/members)', members, 'other `members` (left)')
}

await main()
