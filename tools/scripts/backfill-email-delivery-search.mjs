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
 * Stamp `searchTokens` onto the delivery-log messages written before the
 * field existed (AGL-3321).
 *
 * The staff account page's Email delivery table searches a person's mail —
 * by recipient, subject word or sender tag — with `array-contains` on
 * `emailDeliveries/{key}/messages/*.searchTokens`, which every writer in
 * `libs/tenant/data/admin/.../email-delivery-log.ts` now stamps from the
 * message's merged state. A message written before that has no tokens, and a
 * query cannot find a document by a field it lacks, so without this the
 * backlog lists normally and never answers a search.
 *
 * The tokens come from what the message already says (`to`, `subject`,
 * `context`) through `emailDeliverySearchTokens`, stated for scripts in
 * `lib/email-search-tokens.mjs` and held to the library by
 * `lib/email-search-tokens.fixtures.json` from both sides.
 *
 * ## What it reads
 *
 * The `messages` collection group, keeping only documents whose parent is an
 * `emailDeliveries/{key}` record — other collections named `messages` (support
 * tickets, the inbox) are skipped and counted.
 *
 * ## Idempotence and interruption
 *
 * A message whose stored tokens already equal the derived ones is not
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next. Writes touch `searchTokens` alone. Nothing is deleted.
 *
 * ## Running it
 *
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-delivery-search.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-delivery-search.mjs --apply  # write
 *     node tools/scripts/backfill-email-delivery-search.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { emailDeliverySearchTokens } from './lib/email-search-tokens.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'
import { sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-email-delivery-search',
  summary:
    'Stamp `searchTokens` onto delivery-log messages that predate it. ' +
    'Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Whether a document path is a delivery-log message: `emailDeliveries/{key}/messages/{id}`. */
export function isDeliveryMessagePath(path) {
  const segments = String(path ?? '').split('/')
  return segments.length === 4 && segments[0] === 'emailDeliveries' && segments[2] === 'messages'
}

/**
 * What one message should be stamped with, or a skip. Pure, for the self-test.
 *
 * @param {Record<string, unknown>} data
 * @returns {{ update: { searchTokens: string[] } } | { skip: 'current' }}
 */
export function planMessage(data) {
  const tokens = emailDeliverySearchTokens(data)
  return sameSearchTokens(data.searchTokens, tokens)
    ? { skip: 'current' }
    : { update: { searchTokens: tokens } }
}

function selfTest() {
  const fixtures = JSON.parse(readFileSync(join(here, 'lib', 'email-search-tokens.fixtures.json'), 'utf8'))
  const failures = []
  for (const { name, message, tokens } of fixtures.deliveries) {
    if (!sameSearchTokens(emailDeliverySearchTokens(message), tokens)) failures.push(`tokens: ${name}`)
  }
  const [first] = fixtures.deliveries
  const cases = [
    ['a message with no tokens', first.message, { update: { searchTokens: first.tokens } }],
    ['a current message', { ...first.message, searchTokens: first.tokens }, { skip: 'current' }],
    ['stale tokens', { ...first.message, searchTokens: ['x'] }, { update: { searchTokens: first.tokens } }],
  ]
  for (const [name, data, expected] of cases) {
    if (JSON.stringify(planMessage(data)) !== JSON.stringify(expected)) failures.push(`plan: ${name}`)
  }
  const paths = [
    ['emailDeliveries/k1/messages/m1', true],
    ['supportTickets/t1/messages/m1', false],
    ['emailDeliveries/k1', false],
  ]
  for (const [path, expected] of paths) {
    if (isDeliveryMessagePath(path) !== expected) failures.push(`path: ${path}`)
  }
  const total = fixtures.deliveries.length + cases.length + paths.length
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(failures.length ? `self-test: ${failures.length} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const totals = { scanned: 0, current: 0, stamp: 0, missing: 0, other: 0 }
  const writes = []
  for await (const message of everyDocument(db.collectionGroup('messages'))) {
    if (!isDeliveryMessagePath(message.ref.path)) {
      totals.other += 1
      continue
    }
    totals.scanned += 1
    const data = message.data() ?? {}
    const plan = planMessage(data)
    if ('skip' in plan) {
      totals.current += 1
      continue
    }
    totals.stamp += 1
    if (!Array.isArray(data.searchTokens)) totals.missing += 1
    writes.push({ kind: 'update', ref: message.ref, value: plan.update })
  }
  console.log(`scanned ${totals.scanned} delivery messages (${totals.other} other "messages" documents skipped)`)
  console.log(`  already current  ${totals.current}`)
  console.log(`  to stamp         ${totals.stamp} (${totals.missing} with no tokens)`)
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()
