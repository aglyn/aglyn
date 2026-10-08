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
 * Stamp `emailTokens` and `reason` onto every SITE suppression written before
 * the list queried them (AGL-3321).
 *
 * A site's Suppressions list (`hosts/{hostId}/suppressions`) searches
 * addresses by `array-contains` on `emailTokens` and filters Reason by
 * EQUALITY on `reason`, both beneath its newest-first order. Every writer
 * now stamps the tokens, and every writer has written a reason since
 * AGL-2408. A row from before either has neither, and a query cannot find a
 * document that lacks a field — so without this, the backlog lists normally
 * while the search and the Reason filter quietly skip it.
 *
 * Both are taken from what the row already says: the tokens from `email`,
 * through `lib/email-search-tokens.mjs` — the script-side twin of
 * `emailSearchTokens` in `libs/tenant/data/admin/src/lib/server/email-suppression.ts`,
 * held to the same fixtures — and `reason`
 * as `unsubscribe`, which is what an absent reason has always meant (the
 * pre-AGL-2408 unsubscribe handler wrote `{ email, createdAt }` and nothing
 * else — see `describeSuppressionReason`). A row with no address (an erasure)
 * carries no tokens: a stale token array there is cleared.
 *
 * ## `email` on every row (AGL-3680)
 *
 * The list's Address header orders the QUERY by `email`, and `orderBy` drops
 * a document that lacks the field. Every writer stamps it — the address, or
 * `null` for an erasure — but a row from before addresses were stored holds
 * only its hash key. Such a row is stamped `email: null`: it has no address
 * to recover, and null keeps it in the sorted list (it reads "(address not
 * recorded)" either way).
 *
 * ## Idempotence and interruption
 *
 * A row whose tokens already match its address and which carries a reason
 * and an `email` (an address or null) is never written, so a re-run is a
 * no-op and an interrupted run is finished by the next. Writes touch only those three fields, in batches of 400. Nothing is
 * deleted. Only `hosts/{hostId}/suppressions/{id}` is touched; any other
 * collection named `suppressions` is counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-suppression-filters.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-suppression-filters.mjs --apply  # write
 *     node tools/scripts/backfill-host-suppression-filters.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
// The ONE script-side twin of `emailSearchTokens`, held to the library's
// fixtures by `lib/email-search-tokens.test.mjs`.
import { emailSearchTokens } from './lib/email-search-tokens.mjs'
import { sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const args = parseDeployArgs({
  command: 'backfill-host-suppression-filters',
  summary:
    'Stamp `emailTokens`, `reason` and `email` onto site suppressions that predate them. ' +
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
 * What one suppression row should be stamped with, or a skip. Pure, for the
 * self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-a-site-suppression' }}
 */
function planHostSuppression(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'suppressions') {
    return { skip: 'not-a-site-suppression' }
  }
  const update = {}
  const tokens = emailSearchTokens(data.email)
  if (tokens.length) {
    if (!sameSearchTokens(data.emailTokens, tokens)) update.emailTokens = tokens
  } else if (Array.isArray(data.emailTokens) && data.emailTokens.length) {
    // No address (an erasure): nothing to search it by, and nothing to keep.
    update.emailTokens = []
  }
  if (typeof data.reason !== 'string' || !data.reason) update.reason = 'unsubscribe'
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
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'email-search-tokens.fixtures.json'), 'utf8'),
  )
  for (const one of fixtures.emailTokens) {
    check(
      `emailSearchTokens(${JSON.stringify(one.email)})`,
      JSON.stringify(emailSearchTokens(one.email)) === JSON.stringify(one.tokens),
    )
  }
  const TOKENS = emailSearchTokens('dana@example.com')
  const P = 'hosts/h1/suppressions/k1'
  const cases = [
    ['a pre-AGL-2408 row', P, { email: 'dana@example.com' }, { update: { emailTokens: TOKENS, reason: 'unsubscribe' } }],
    ['a row with a reason and no tokens', P, { email: 'dana@example.com', reason: 'bounce' }, { update: { emailTokens: TOKENS } }],
    ['a current row', P, { email: 'dana@example.com', reason: 'manual', emailTokens: TOKENS }, { skip: 'current' }],
    ['stale tokens', P, { email: 'dana@example.com', reason: 'bounce', emailTokens: ['x'] }, { update: { emailTokens: TOKENS } }],
    ['an erasure with stale tokens', P, { email: null, reason: 'erasure', emailTokens: ['dana'] }, { update: { emailTokens: [] } }],
    ['an erasure', P, { email: null, reason: 'erasure' }, { skip: 'current' }],
    ['a hash-only row', P, { reason: 'bounce' }, { update: { email: null } }],
    ['a hash-only pre-AGL-2408 row', P, {}, { update: { reason: 'unsubscribe', email: null } }],
    ['not a site suppression', 'emailSuppressions/k1', { email: 'dana@example.com' }, { skip: 'not-a-site-suppression' }],
  ]
  for (const [name, path, data, expected] of cases) {
    const got = planHostSuppression(path, data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(expected))
    // Idempotent: a row the plan stamped plans nothing the second time.
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planHostSuppression(path, stamped))
  }
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = { scanned: 0, current: 0, tokens: 0, reason: 0, email: 0, other: 0, written: 0 }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('suppressions').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planHostSuppression(doc.ref.path, doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.other += 1
        continue
      }
      if ('emailTokens' in plan.update) counts.tokens += 1
      if ('reason' in plan.update) counts.reason += 1
      if ('email' in plan.update) counts.email += 1
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
      ? 'backfill-host-suppression-filters: APPLIED'
      : 'backfill-host-suppression-filters: DRY RUN (nothing written)',
  )
  console.log(`  scanned                 ${counts.scanned}`)
  console.log(`  already current         ${counts.current}`)
  console.log(`  stamp emailTokens       ${counts.tokens}`)
  console.log(`  stamp reason            ${counts.reason}`)
  console.log(`  stamp email: null       ${counts.email}`)
  console.log(`  not hosts/*/suppressions (left alone) ${counts.other}`)
  if (args.apply) console.log(`  written                 ${counts.written}`)
}

await main()
