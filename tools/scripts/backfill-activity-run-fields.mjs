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
 * Complete every automation RUN in `hosts/{hostId}/activity` for the run
 * history's query (AGL-3321).
 *
 * The Runs dialog is one Firestore query: this automation's entries with a
 * `result`, newest first, with Trigger, Result and a search word over the
 * summary's `summaryTokens` as further predicates. Every run writer now
 * stamps all four fields. An entry written before that is missing some:
 *
 *   - a run recorded before the structured fields carries only the prose
 *     `Action ran on <event>` (with ` with errors: <what failed>` when it
 *     failed) — no `result`, so the query cannot see it at all, and no
 *     `trigger` or `summary`;
 *   - every run written before the search carries no `summaryTokens`, so a
 *     search cannot find it.
 *
 * This reads each back the way the history has always shown it — the
 * verdict and event from the prose, the summary from `with errors:` or
 * `Ran` — and writes only the fields it lacks. An entry that is neither a
 * stored verdict nor that prose (a publish, a media save, a member change)
 * is not a run and is never touched.
 *
 * ## Idempotence and interruption
 *
 * An entry that already carries all four, with tokens equal to the ones its
 * summary gives, is counted as current and not written, so a re-run writes
 * nothing. Writes are `update`s of the missing fields alone, in batches of
 * 400; an interrupted run is finished by the next. Nothing is deleted.
 *
 * Only `hosts/{hostId}/activity/{id}` is touched: the scan is a collection
 * group, and the organization log (`orgs/{orgId}/activity`) is counted as
 * skipped and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-activity-run-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-activity-run-fields.mjs --apply  # write
 *     node tools/scripts/backfill-activity-run-fields.mjs --self-test                            # no project
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { nameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const args = parseDeployArgs({
  command: 'backfill-activity-run-fields',
  summary:
    'Complete automation runs in hosts/*/activity with result, trigger, ' +
    'summary and summaryTokens, so the run history query finds them. Writes ' +
    'to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents per batch; Firestore allows 500, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000

/*
 * THE COMPLETION, restated — `runEntryCompletion` in
 * `libs/plugins/workflows/src/lib/model/run-history.ts`, which a plain Node
 * script cannot import. The name keys are NOT restated here: they come from
 * `lib/name-search-tokens.mjs`, the one script-side twin of the library's.
 * The completion is held to the worked examples in
 * `lib/activity-run-fields.fixtures.json`: the workflows spec asserts them
 * against the library and the self-test below against this copy, so the
 * backfill cannot stamp a spelling the writers and the query do not use.
 */
const RUN_RESULTS = ['succeeded', 'failed', 'skipped']

/**
 * The fields a stored entry lacks, or `null` when it is not a run or is
 * complete. Pure, for the self-test.
 *
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown> | null}
 */
export function runEntryCompletion(entry) {
  const stored = String(entry.result ?? '').trim()
  const action = String(entry.action ?? '').trim()
  const legacy = action.startsWith('Action ran on')
  if (!RUN_RESULTS.includes(stored) && !legacy) return null
  /** @type {Record<string, unknown>} */
  const patch = {}
  if (!RUN_RESULTS.includes(stored)) {
    patch.result = action.includes('with errors:') ? 'failed' : 'succeeded'
  }
  if (typeof entry.trigger !== 'string' || !entry.trigger) {
    const event = legacy ? /^Action ran on (\S+)/.exec(action)?.[1] : undefined
    if (event) patch.trigger = event
  }
  let summary = typeof entry.summary === 'string' ? entry.summary.trim() : ''
  if (!summary) {
    const errors = /with errors:\s*(.+)$/.exec(action)
    summary = errors ? errors[1] : legacy ? 'Ran' : action
    patch.summary = summary
  }
  const tokens = nameSearchTokens(summary)
  const held = Array.isArray(entry.summaryTokens) ? entry.summaryTokens : null
  if (!held || held.length !== tokens.length || held.some((token, at) => token !== tokens[at])) {
    patch.summaryTokens = tokens
  }
  return Object.keys(patch).length ? patch : null
}

/** Whether a document path is a site's activity entry, `hosts/{id}/activity/{id}`. */
const isHostActivity = (path) => {
  const segments = path.split('/')
  return segments.length === 4 && segments[0] === 'hosts' && segments[2] === 'activity'
}

function selfTest() {
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'activity-run-fields.fixtures.json'), 'utf8'),
  )
  const cases = fixtures.cases.map((one) => ({
    name: one.name,
    got: runEntryCompletion(one.entry),
    expected: one.expected,
  }))
  cases.push(
    {
      name: 'a completed entry is current on the second pass',
      got: runEntryCompletion({
        action: 'Action ran on formSubmission',
        ...runEntryCompletion({ action: 'Action ran on formSubmission' }),
      }),
      expected: null,
    },
    { name: 'a site activity path is in scope', got: isHostActivity('hosts/h1/activity/a1'), expected: true },
    { name: 'the org log is not', got: isHostActivity('orgs/o1/activity/a1'), expected: false },
  )
  let failed = 0
  for (const one of cases) {
    const ok = JSON.stringify(one.got) === JSON.stringify(one.expected)
    if (!ok) failed += 1
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${one.name}${ok ? '' : ` — got ${JSON.stringify(one.got)}`}`)
  }
  console.log(`\nself-test: ${cases.length - failed}/${cases.length} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = {
    scanned: 0,
    notRuns: 0,
    current: 0,
    verdicts: 0,
    triggers: 0,
    summaries: 0,
    tokens: 0,
    otherCollections: 0,
    written: 0,
  }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('activity').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      if (!isHostActivity(doc.ref.path)) {
        counts.otherCollections += 1
        continue
      }
      const data = doc.data()
      const stored = String(data.result ?? '').trim()
      const patch = runEntryCompletion(data)
      if (!patch) {
        if (RUN_RESULTS.includes(stored) || String(data.action ?? '').startsWith('Action ran on')) {
          counts.current += 1
        } else {
          counts.notRuns += 1
        }
        continue
      }
      if ('result' in patch) counts.verdicts += 1
      if ('trigger' in patch) counts.triggers += 1
      if ('summary' in patch) counts.summaries += 1
      if ('summaryTokens' in patch) counts.tokens += 1
      if (!args.apply) continue
      batch.update(doc.ref, patch)
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
      ? 'backfill-activity-run-fields: APPLIED'
      : 'backfill-activity-run-fields: DRY RUN (nothing written)',
  )
  console.log(`  scanned                        ${counts.scanned}`)
  console.log(`  not runs (left alone)          ${counts.notRuns}`)
  console.log(`  runs already complete          ${counts.current}`)
  console.log(`  stamp result (legacy prose)    ${counts.verdicts}`)
  console.log(`  stamp trigger                  ${counts.triggers}`)
  console.log(`  stamp summary                  ${counts.summaries}`)
  console.log(`  stamp summaryTokens            ${counts.tokens}`)
  console.log(`  not hosts/*/activity (left alone) ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                        ${counts.written}`)
}

await main()
