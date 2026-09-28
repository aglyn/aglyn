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
 * Stamp `searchTokens` onto every CSP violation counter written before the
 * field existed (AGL-3321).
 *
 * The staff Health page's CSP table searches its counters by
 * `array-contains` on `searchTokens`, under the window's range on `day`.
 * `recordCspViolations` now stamps the array on every write; a counter
 * written before that has none, and a query cannot find a document that
 * lacks the field — so without this, the counters already in the retention
 * window are invisible to the search while still listing normally. They age
 * out on their own (TTL, 60 days), so the gap closes by itself too; this
 * closes it now.
 *
 * The tokens are taken from what the counter already says — its `origin`,
 * `directive` and `app`, which are its key — through the same derivation as
 * `cspSearchTokens` in `libs/tenant/data/admin/.../csp-aggregate.ts`, built
 * on the one script-side copy of the word-prefix tokens
 * (`lib/name-search-tokens.mjs`). The library's spec and this script's
 * `--self-test` both assert `lib/csp-search-tokens.fixtures.json`, so the two
 * cannot drift apart unnoticed.
 *
 * ## Idempotence and interruption
 *
 * A counter whose tokens already match its key is never written, so a re-run
 * is a no-op and an interrupted run is finished by the next. Writes touch
 * only `searchTokens`, in batches of 400. Nothing is deleted.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-csp-search-tokens.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-csp-search-tokens.mjs --apply  # write
 *
 * A self-hosted install runs the same two commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  NAME_TOKEN_MAX_PREFIX,
  nameSearchTokens,
  sameSearchTokens,
} from './lib/name-search-tokens.mjs'

const args = parseDeployArgs({
  command: 'backfill-csp-search-tokens',
  summary:
    'Stamp `searchTokens` onto CSP violation counters that predate it. ' +
    'Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** `CSP_AGGREGATE_COLLECTION`. */
const COLLECTION = 'cspViolationDaily'
/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000

/**
 * `cspSearchTokens`: the word prefixes of the origin, the directive and the
 * app — each whole, and each run of letters and digits in it.
 *
 * @param {{ origin?: unknown, directive?: unknown, app?: unknown }} key
 * @returns {string[]}
 */
export function cspSearchTokens(key) {
  const words = [key.origin, key.directive, key.app]
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter(Boolean)
    .flatMap((value) => [value, ...value.split(/[^a-z0-9]+/)])
    .filter(Boolean)
  return nameSearchTokens(words.join(' '))
}

/**
 * What a counter should be stamped with, or a skip. Pure, for the self-test.
 *
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: { searchTokens: string[] } } | { skip: 'current' | 'no-key' }}
 */
export function planCounter(data) {
  const tokens = cspSearchTokens(data)
  if (!tokens.length) return { skip: 'no-key' }
  if (sameSearchTokens(data.searchTokens, tokens)) return { skip: 'current' }
  return { update: { searchTokens: tokens } }
}

function selfTest() {
  let failed = 0
  const check = (name, ok) => {
    if (!ok) {
      failed += 1
      console.error(`FAIL ${name}`)
    }
  }
  // The worked examples `csp-aggregate.spec.ts` asserts against the
  // library's `cspSearchTokens`.
  const fixtures = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'lib', 'csp-search-tokens.fixtures.json'),
      'utf8',
    ),
  )
  for (const { key, tokens: expected } of fixtures.tokens) {
    const tokens = cspSearchTokens(key)
    check(
      `${JSON.stringify(key)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(tokens)}`,
      sameSearchTokens(tokens, expected),
    )
    check(`${JSON.stringify(key)} tokens within the cap`, tokens.every((token) => token.length <= NAME_TOKEN_MAX_PREFIX))
  }

  const KEY = { origin: 'cdn.example.com', directive: 'img-src', app: 'tenant' }
  const TOKENS = cspSearchTokens(KEY)
  const planCases = [
    ['a legacy counter', { ...KEY, count: 3 }, { update: { searchTokens: TOKENS } }],
    ['a current counter', { ...KEY, searchTokens: TOKENS }, { skip: 'current' }],
    ['stale tokens', { ...KEY, searchTokens: ['x'] }, { update: { searchTokens: TOKENS } }],
    ['no key at all', { count: 1 }, { skip: 'no-key' }],
  ]
  for (const [name, data, expected] of planCases) {
    const got = planCounter(data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(expected))
  }
  // Idempotent: a counter the plan stamped plans nothing the second time.
  for (const [name, data] of planCases) {
    const once = planCounter(data)
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planCounter(stamped))
  }
  const total = fixtures.tokens.length * 2 + planCases.length * 2
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = { scanned: 0, current: 0, noKey: 0, tokens: 0, written: 0 }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collection(COLLECTION).orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planCounter(doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.noKey += 1
        continue
      }
      counts.tokens += 1
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
      ? 'backfill-csp-search-tokens: APPLIED'
      : 'backfill-csp-search-tokens: DRY RUN (nothing written)',
  )
  console.log(`  scanned              ${counts.scanned}`)
  console.log(`  already current      ${counts.current}`)
  console.log(`  no key to token      ${counts.noKey}`)
  console.log(`  stamp searchTokens   ${counts.tokens}`)
  if (args.apply) console.log(`  written              ${counts.written}`)
}

await main()
