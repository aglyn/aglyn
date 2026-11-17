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
 * Stamp `usageLevel: 'unreviewed'` on every workspace (`orgs`) and site
 * (`hosts`) written before the staff usage level existed (AGL-4228) — and,
 * run without `--write`, report how many carry it.
 *
 * The staff Organizations and Sites lists filter the usage level by equality,
 * and a Firestore query cannot find a document by a field it lacks, so
 * "Not reviewed" would miss every older workspace and site. New ones get the
 * field at creation (`createOrganization`, `provisionHost`).
 *
 * Only a MISSING field is written; a level staff already set is never
 * touched, so a second run writes nothing and an interrupted run is finished
 * by the next. Accounts (`users`) are not stamped: the staff Users list joins
 * the level by uid, and an account without one reads as not reviewed.
 *
 * ## Running it
 *
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-usage-level.mjs          # report (dry run)
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-usage-level.mjs --write  # write
 *     node tools/scripts/backfill-usage-level.mjs --self-test
 *
 * Re-run it (it converges to 0) after the promotion that carries the stamp,
 * since a workspace or site created by the old code in between lacks it.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-usage-level',
  summary:
    "Report, and with --write stamp, usageLevel: 'unreviewed' on workspaces and sites that lack it.",
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--write', key: 'write', describe: 'Write. Without it, a read-only report.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** `USAGE_LEVEL_FIELD` in `libs/aglyn/src/lib/app-utils/usage-level.ts`. */
export const FIELD = 'usageLevel'
/** `DEFAULT_USAGE_LEVEL` there. */
export const DEFAULT_LEVEL = 'unreviewed'
/** The collections whose staff lists filter by it. */
export const COLLECTIONS = ['orgs', 'hosts']

/** Whether one document needs the stamp: only when the field is missing. */
export function needsStamp(data) {
  return !data || data[FIELD] == null
}

function selfTest() {
  const cases = [
    ['missing: stamp', needsStamp({ name: 'Acme' }), true],
    ['null: stamp', needsStamp({ [FIELD]: null }), true],
    ['no data: stamp', needsStamp(undefined), true],
    ['unreviewed: leave', needsStamp({ [FIELD]: 'unreviewed' }), false],
    ['set by staff: leave', needsStamp({ [FIELD]: 'live' }), false],
  ]
  const failures = cases.filter(([, got, expected]) => got !== expected)
  for (const [name, got, expected] of failures) {
    console.error(`FAIL ${name}: expected ${expected}, got ${got}`)
  }
  console.log(
    failures.length
      ? `self-test: ${failures.length} of ${cases.length} failed`
      : `self-test: ${cases.length}/${cases.length} passed`,
  )
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const write = Boolean(args.write)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply: write })
  const writes = []
  for (const collection of COLLECTIONS) {
    let scanned = 0
    let carry = 0
    for await (const snapshot of everyDocument(db.collection(collection))) {
      scanned += 1
      if (!needsStamp(snapshot.data())) {
        carry += 1
        continue
      }
      writes.push({ kind: 'update', ref: snapshot.ref, value: { [FIELD]: DEFAULT_LEVEL } })
    }
    console.log(`${collection}: scanned ${scanned}, carry ${FIELD} ${carry}, to stamp ${scanned - carry}`)
  }
  if (!write) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`WRITTEN — ${writes.length} documents stamped.`)
}

await main()
