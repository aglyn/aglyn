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
 * Stamp `searchTokens` onto every activity entry written before the field
 * existed (AGL-3321).
 *
 * The activity logs — a site's, an organization's, and the person-centred
 * feeds read across both — search with `array-contains` on `searchTokens`,
 * the word-prefix tokens of the actor's address, the API key's name and the
 * name of what changed (`activitySearchTokens` in
 * `libs/aglyn/src/lib/app-utils/activity-search.ts`). Every writer stamps it
 * now; an entry written before that has none, and a query cannot find a
 * document by a field it lacks, so without this the backlog LISTS normally
 * and no search can find it.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/activity/{id}` and `orgs/{orgId}/activity/{id}`, read as
 * the `activity` collection group. Any other collection that happens to be
 * named `activity` is counted as skipped and left alone. Only `searchTokens`
 * is written; nothing is deleted.
 *
 * ## Idempotence and interruption
 *
 * An entry whose stored `searchTokens` already equals the computed array is
 * never written — nor is one with nothing to search and no field — so a
 * re-run is a no-op and an interrupted run is finished by the next. Writes
 * are one field, in batches of 400.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-activity-search-tokens.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-activity-search-tokens.mjs --apply  # write
 *     node tools/scripts/backfill-activity-search-tokens.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 * The tokens come from `lib/activity-search-tokens.mjs`, the script-side twin
 * of the library's builder, which `backfill-reconstructed-activity.mjs` stamps
 * the rows it writes through too, so the two can run in either order.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activitySearchTokens } from './lib/activity-search-tokens.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000

/**
 * One entry's verdict, so the dry run and the apply run cannot disagree.
 * Pure, for the self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ searchTokens: string[] } | { skip: 'current' | 'not-an-activity-log' }}
 */
export function planActivityEntry(path, data) {
  const segments = path.split('/')
  if (
    segments.length !== 4 ||
    (segments[0] !== 'hosts' && segments[0] !== 'orgs') ||
    segments[2] !== 'activity'
  ) {
    return { skip: 'not-an-activity-log' }
  }
  const computed = activitySearchTokens(data)
  const stored = data?.searchTokens
  if (sameSearchTokens(stored, computed)) return { skip: 'current' }
  if (stored === undefined && computed.length === 0) return { skip: 'current' }
  return { searchTokens: computed }
}

function selfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    cases.push({
      name,
      ok: JSON.stringify(actual) === JSON.stringify(expected),
      actual,
    })
  }
  // The copy answers the worked examples the library's spec asserts.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'activity-search-tokens.fixtures.json'), 'utf8'),
  )
  fixtures.tokens.forEach((one) =>
    check(`fixture: ${one.name}`, activitySearchTokens(one.entry), one.expected),
  )
  const entry = {
    actorEmail: 'ada@example.com',
    target: { type: 'screen', name: 'Home' },
  }
  const tokens = activitySearchTokens(entry)
  check('stamps a site entry that carries no tokens', planActivityEntry('hosts/h1/activity/a1', entry), {
    searchTokens: tokens,
  })
  check('stamps an organization entry too', planActivityEntry('orgs/o1/activity/a1', entry), {
    searchTokens: tokens,
  })
  check(
    'is idempotent: a stamped entry is current',
    planActivityEntry('hosts/h1/activity/a1', { ...entry, searchTokens: tokens }),
    { skip: 'current' },
  )
  check(
    're-stamps an entry whose tokens are stale',
    planActivityEntry('hosts/h1/activity/a1', { ...entry, searchTokens: ['x'] }),
    { searchTokens: tokens },
  )
  check(
    'leaves an entry with nothing to search and no field alone',
    planActivityEntry('hosts/h1/activity/run', { actorEmail: null, target: { type: 'workflow' } }),
    { skip: 'current' },
  )
  check(
    'leaves any other collection named activity alone',
    planActivityEntry('users/u1/activity/a1', entry),
    { skip: 'not-an-activity-log' },
  )
  check(
    'leaves a nested activity collection alone',
    planActivityEntry('hosts/h1/things/t1/activity/a1', entry),
    { skip: 'not-an-activity-log' },
  )

  for (const one of cases) {
    console.log(
      `${one.ok ? 'ok  ' : 'FAIL'} ${one.name}` +
        (one.ok ? '' : ` — got ${JSON.stringify(one.actual)}`),
    )
  }
  const failed = cases.filter((one) => !one.ok).length
  console.log(`\nself-test: ${cases.length - failed}/${cases.length} passed`)
  process.exit(failed ? 1 : 0)
}

async function run(args) {
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}`,
  )
  const counts = { scanned: 0, current: 0, stamped: 0, otherCollections: 0, written: 0 }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    // Paged by document name: every entry has one, so the walk is total.
    let page = firestore
      .collectionGroup('activity')
      .orderBy('__name__')
      .select('actorEmail', 'apiKeyName', 'target', 'searchTokens')
      .limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planActivityEntry(doc.ref.path, doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.otherCollections += 1
        continue
      }
      counts.stamped += 1
      if (!args.apply) continue
      batch.update(doc.ref, { searchTokens: plan.searchTokens })
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
      ? 'backfill-activity-search-tokens: APPLIED'
      : 'backfill-activity-search-tokens: DRY RUN (nothing written)',
  )
  console.log(`  scanned                 ${counts.scanned}`)
  console.log(`  already current         ${counts.current}`)
  console.log(`  ${args.apply ? 'stamped' : 'to stamp'}                ${counts.stamped}`)
  console.log(`  not hosts/* or orgs/* activity (left alone) ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                 ${counts.written}`)
}

/*
 * The arguments are read, and the project touched, only when this file is
 * the script being run, so a spec or a script may import `planActivityEntry`.
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseDeployArgs({
    command: 'backfill-activity-search-tokens',
    summary:
      'Stamp `searchTokens` onto activity entries that predate it, so the ' +
      'activity logs can search them. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      {
        flag: '--self-test',
        key: 'selfTest',
        describe: 'Run the fixtures, touching no project.',
      },
    ],
  })
  if (args.selfTest) selfTest()
  else await run(args)
}
