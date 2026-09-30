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
 * Stamp the stored `suspended` flag onto every organization and every site
 * whose flag is missing or no longer matches its suspension (AGL-3416).
 *
 * The staff Organizations and Sites lists filter Suspended by EQUALITY on
 * `orgs/{orgId}.suspended` and `hosts/{hostId}.suspended`
 * (`apps/console/utils/server/suspended-flag.ts`). `createOrganization` and
 * `claimHostForOrg` now write `false`, and the lockdown core writes the flag
 * beside the `suspended*` family it mirrors. A document written before that
 * carries no flag, and a query cannot find a document by a field it lacks: it
 * still LISTS, but neither `Suspended` nor `Not suspended` finds it.
 *
 * The flag is whether the suspension is IN FORCE now: `suspendedAt` set, and
 * no numeric `suspendedUntilMs` at or before this moment — the definition the
 * rules' `suspensionActive` and the console's `suspensionInForce` share.
 *
 * ## What it touches
 *
 * `orgs/{orgId}` and `hosts/{hostId}`, and on each only `suspended`. Nothing
 * is deleted, and `updatedAt` is not moved: nothing about the document
 * changed. The `suspended*` family is read, never written.
 *
 * ## Idempotence and interruption
 *
 * A document whose flag already equals what its family gives is never
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next. A timed suspension that lapses between runs is corrected by the next
 * run, and by the lists themselves before any query that asks.
 *
 * The write lands after the read, so a lock placed or lifted on the same
 * document in between would be overwritten with the answer read before it.
 * Run it when no one is using the lockdown page, and run the dry run again
 * afterwards: it must plan nothing.
 *
 * ## Running it
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-suspended-flag.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-suspended-flag.mjs --apply  # write
 *
 *     node tools/scripts/backfill-suspended-flag.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-suspended-flag',
  summary:
    'Stamp the stored `suspended` flag onto organizations and sites whose flag is ' +
    'missing or stale, so the staff lists can filter Suspended. Writes to the ' +
    'named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** The two collections the staff lists read, each carrying the flag. */
const COLLECTIONS = ['orgs', 'hosts']

/**
 * Whether a `suspended*` family is an active lock at `nowMs`: the twin of
 * `suspensionInForce` in `apps/console/utils/server/suspended-flag.ts`.
 *
 * @param {Record<string, unknown>} data the document
 * @param {number} nowMs
 * @returns {boolean}
 */
export function inForce(data, nowMs) {
  const at = data.suspendedAt
  if (at === undefined || at === null || at === false) return false
  const until = data.suspendedUntilMs
  return !(typeof until === 'number' && until <= nowMs)
}

/**
 * What a document should be stamped with, or that it is current. Pure, for
 * the self-test, so the dry run and the apply run cannot disagree.
 *
 * @param {Record<string, unknown>} data the document
 * @param {number} nowMs
 * @returns {{ update: { suspended: boolean }, reason: 'missing' | 'stale' } | { skip: 'current' }}
 */
export function planDocument(data, nowMs) {
  const suspended = inForce(data, nowMs)
  if (data.suspended === suspended) return { skip: 'current' }
  return {
    update: { suspended },
    reason: typeof data.suspended === 'boolean' ? 'stale' : 'missing',
  }
}

function selfTest() {
  const NOW = 1_800_000_000_000
  const failures = []
  const cases = [
    ['never suspended, no flag', {}, { update: { suspended: false }, reason: 'missing' }],
    ['never suspended, flag current', { suspended: false }, { skip: 'current' }],
    [
      'suspended open-ended, no flag',
      { suspendedAt: { seconds: 1 } },
      { update: { suspended: true }, reason: 'missing' },
    ],
    ['suspended open-ended, flag current', { suspendedAt: NOW - 1, suspended: true }, { skip: 'current' }],
    [
      'timed and still running',
      { suspendedAt: NOW - 10, suspendedUntilMs: NOW + 10 },
      { update: { suspended: true }, reason: 'missing' },
    ],
    [
      'timed and lapsed, flag left true',
      { suspendedAt: NOW - 10, suspendedUntilMs: NOW, suspended: true },
      { update: { suspended: false }, reason: 'stale' },
    ],
    [
      'a malformed expiry keeps the lock',
      { suspendedAt: NOW - 10, suspendedUntilMs: 'soon' },
      { update: { suspended: true }, reason: 'missing' },
    ],
    [
      'a non-boolean flag is replaced',
      { suspended: 'true' },
      { update: { suspended: false }, reason: 'missing' },
    ],
  ]
  for (const [name, data, expected] of cases) {
    const got = planDocument(data, NOW)
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
    }
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    if (!('skip' in planDocument(stamped, NOW))) failures.push(`${name}: re-run is not a no-op`)
  }
  const total = cases.length * 2
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(
    failures.length
      ? `self-test: ${failures.length} of ${total} failed`
      : `self-test: ${total}/${total} passed`,
  )
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const nowMs = Date.now()
  const writes = []
  for (const name of COLLECTIONS) {
    const totals = { scanned: 0, current: 0, missing: 0, stale: 0, suspended: 0 }
    for await (const snapshot of everyDocument(db.collection(name))) {
      totals.scanned += 1
      const plan = planDocument(snapshot.data() ?? {}, nowMs)
      if ('skip' in plan) {
        totals.current += 1
        continue
      }
      totals[plan.reason] += 1
      if (plan.update.suspended) totals.suspended += 1
      writes.push({ kind: 'update', ref: snapshot.ref, value: plan.update })
    }
    console.log(`${name}: scanned ${totals.scanned}`)
    console.log(`  already current        ${totals.current}`)
    console.log(`  to stamp (no flag)     ${totals.missing}`)
    console.log(`  to correct (stale)     ${totals.stale}`)
    console.log(`  of those, in force     ${totals.suspended}`)
  }
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()
