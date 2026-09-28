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
 * Stamp the fields the staff audit lists query onto the rows written before
 * them (AGL-3321): `actionGroup`, `kind`, `targetKind`, `targetHostId` and
 * `searchTokens`.
 *
 * The staff audit page and a staff account's audit tables filter and search
 * on their Firestore query, reading the fields every writer now stamps
 * (`withAdminAuditIndex` in `libs/aglyn/src/lib/app-utils/admin-audit-index.ts`).
 * A row written before that carries none of them, and a query cannot find a
 * document by a field it lacks, so the row would still list and never answer
 * the filter or the search.
 *
 * Every field is derived from what the row already says: its `action`, its
 * `target`, and the text fields a reviewer searches by.
 * `lib/admin-audit-index.mjs` states the derivation for scripts, held to the
 * library by shared worked examples, and reads the Action group and the kind
 * from the fixture's copy of the plugin registry.
 *
 * ## When to run it again
 *
 * Whenever `lib/admin-audit-index.fixtures.json` changes its `groups` or its
 * `accessActions`: a plugin declared a new code, prefix or read action, and
 * the rows written before it carry what the old mapping gave them.
 * `apps/console/specs/admin-audit-action-groups.spec.ts` is red until the
 * fixture follows the registry, which is when this has work to do.
 *
 * ## Idempotence and interruption
 *
 * A row whose stored fields already equal the derived ones is counted and not
 * written, so a second run writes nothing. Writes update those five fields
 * alone, in batches of 400; nothing else on an audit row changes and nothing
 * is deleted. An interrupted run is finished by the next.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-admin-audit-index.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-admin-audit-index.mjs --apply  # write
 *     node tools/scripts/backfill-admin-audit-index.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  ADMIN_AUDIT_INDEX_FIXTURES,
  adminAuditIndexFields,
} from './lib/admin-audit-index.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { sameSearchTokens } from './lib/name-search-tokens.mjs'

const args = parseDeployArgs({
  command: 'backfill-admin-audit-index',
  summary:
    'Stamp the fields the staff audit lists query onto the rows that ' +
    'predate them. Writes to the live project with --apply.',
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

/** The single-valued stamped fields, each counted by name when it is written. */
const SCALAR_FIELDS = ['actionGroup', 'kind', 'targetKind', 'targetHostId']

/**
 * What one row needs written, or why it needs nothing. Pure, for the
 * self-test. A reason is the field's name, `+` when the row lacked it and
 * `~` when it held a stale value.
 *
 * @param {Record<string, unknown>} data the stored row
 * @returns {{ skip: 'current' } | { update: Record<string, unknown>, reasons: string[] }}
 */
export function planAuditRow(data) {
  const derived = adminAuditIndexFields(data)
  const reasons = []
  for (const field of SCALAR_FIELDS) {
    if (data[field] !== derived[field]) {
      reasons.push(`${field in data ? '~' : '+'}${field}`)
    }
  }
  if (!sameSearchTokens(data.searchTokens, derived.searchTokens)) {
    reasons.push(`${Array.isArray(data.searchTokens) ? '~' : '+'}searchTokens`)
  }
  return reasons.length ? { update: derived, reasons } : { skip: 'current' }
}

function selfTest() {
  let failed = 0
  let ran = 0
  for (const { name, entry, expected } of ADMIN_AUDIT_INDEX_FIXTURES.cases) {
    ran += 1
    const got = adminAuditIndexFields(entry)
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failed += 1
      console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
    }
  }
  const [first] = ADMIN_AUDIT_INDEX_FIXTURES.cases
  const plans = [
    [first.entry, ['+actionGroup', '+kind', '+targetKind', '+targetHostId', '+searchTokens']],
    [{ ...first.entry, ...first.expected }, null],
    [{ ...first.entry, ...first.expected, actionGroup: 'stale' }, ['~actionGroup']],
    [{ ...first.entry, ...first.expected, kind: 'access' }, ['~kind']],
    [{ ...first.entry, ...first.expected, searchTokens: ['x'] }, ['~searchTokens']],
  ]
  for (const [data, reasons] of plans) {
    ran += 1
    const plan = planAuditRow(data)
    const got = 'skip' in plan ? null : plan.reasons
    if (JSON.stringify(got) !== JSON.stringify(reasons)) {
      failed += 1
      console.error(`FAIL plan: expected ${JSON.stringify(reasons)}, got ${JSON.stringify(got)}`)
    }
  }
  console.log(failed ? `self-test: ${failed} failed` : `self-test: ${ran}/${ran} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  console.log(`project: ${process.env.GOOGLE_CLOUD_PROJECT ?? '(from the credentials)'}`)
  const counts = { scanned: 0, current: 0, written: 0 }
  const reasons = new Map()
  const groups = new Map()
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collection('adminAudit').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planAuditRow(doc.data())
      if ('skip' in plan) {
        counts.current += 1
        continue
      }
      for (const reason of plan.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      groups.set(plan.update.actionGroup, (groups.get(plan.update.actionGroup) ?? 0) + 1)
      if (!args.apply) continue
      batch.update(doc.ref, plan.update)
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
      ? 'backfill-admin-audit-index: APPLIED'
      : 'backfill-admin-audit-index: DRY RUN (nothing written)',
  )
  console.log(`  scanned                     ${counts.scanned}`)
  console.log(`  already current             ${counts.current}`)
  console.log(`  would write                 ${counts.scanned - counts.current}`)
  for (const [reason, count] of [...reasons].sort()) {
    console.log(`    ${reason.startsWith('+') ? 'missing' : 'stale  '} ${reason.slice(1).padEnd(20)}${count}`)
  }
  for (const [group, count] of [...groups].sort()) {
    console.log(`    to group ${JSON.stringify(group)}: ${count}`)
  }
  if (args.apply) console.log(`  written                     ${counts.written}`)
}

await main()
