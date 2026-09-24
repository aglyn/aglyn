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
 * Stamp `released` and `emailTokens` onto every platform suppression written
 * before the fields existed (AGL-3321).
 *
 * The staff suppression list filters Active and Released by EQUALITY on
 * `released`, and searches addresses by `array-contains` on `emailTokens`,
 * both beneath its newest-first cursor. `suppressEmail` now writes both, and
 * every release writes `released: true` beside `releasedAt`. A record written
 * before that has neither, and a query cannot find a document that lacks a
 * field — so without this, the backlog is invisible to the Status filter and
 * to the search, while still listing normally.
 *
 * Both are taken from what the record already says: `released` from
 * `releasedAt`, and the tokens from `email`, through the same derivation as
 * `emailSearchTokens` in `libs/tenant/data/admin/.../email-suppression.ts`.
 * The self-test runs the fixtures that function's spec runs, so the two
 * cannot drift apart unnoticed.
 *
 * ## Idempotence and interruption
 *
 * A record whose `released` already matches `releasedAt`, and whose tokens
 * already match its address, is never written, so a re-run is a no-op and an
 * interrupted run is finished by the next. Writes touch only those two
 * fields, in batches of 400. Nothing is deleted. A record with no address
 * gets `released` and no tokens: there is nothing to search it by.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-suppression-filters.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-suppression-filters.mjs --apply  # write
 *
 * A self-hosted install runs the same two commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const args = parseDeployArgs({
  command: 'backfill-email-suppression-filters',
  summary:
    'Stamp `released` and `emailTokens` onto platform email suppressions that ' +
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
/** `NAME_TOKEN_MAX_PREFIX` and `NAME_TOKEN_LIMIT` in `app-utils/name-search`. */
const TOKEN_MAX_PREFIX = 12
const TOKEN_LIMIT = 120

/** `nameSearchTokens`: every prefix, to the cap, of every space-separated word. */
function wordPrefixTokens(text) {
  const key = String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!key) return []
  const tokens = new Set()
  for (const word of key.split(' ')) {
    if (!word) continue
    const capped = word.slice(0, TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

/**
 * `emailSearchTokens`: the prefixes of the whole address, the domain, the
 * domain behind an `@`, and each piece of the local part and of the domain.
 *
 * @param {unknown} email
 * @returns {string[]}
 */
export function emailSearchTokens(email) {
  const address = String(email ?? '').trim().toLowerCase()
  if (!address) return []
  const at = address.lastIndexOf('@')
  const local = at === -1 ? address : address.slice(0, at)
  const domain = at === -1 ? '' : address.slice(at + 1)
  const words = [
    address,
    ...(domain ? [domain, `@${domain}`] : []),
    ...local.split(/[._+-]+/),
    ...domain.split('.'),
  ]
  return wordPrefixTokens(words.filter(Boolean).join(' '))
}

const sameTokens = (a, b) =>
  Array.isArray(a) && a.length === b.length && a.every((token, at) => token === b[at])

/**
 * What a suppression record should be stamped with, or a skip. Pure, for the
 * self-test.
 *
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' }}
 */
export function planSuppression(data) {
  const update = {}
  const released = Boolean(data.releasedAt)
  if (data.released !== released) update.released = released
  const tokens = emailSearchTokens(data.email)
  if (tokens.length && !sameTokens(data.emailTokens, tokens)) update.emailTokens = tokens
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  let failed = 0
  const check = (name, ok) => {
    if (!ok) {
      failed += 1
      console.error(`FAIL ${name}`)
    }
  }
  // The fixtures `email-suppression.spec.ts` runs against `emailSearchTokens`.
  const tokenCases = [
    ['jane.doe@mail.example.com', ['jane', 'doe', 'jane.doe@mai', 'mail.example', '@mail.exampl', 'example', 'com', 'm']],
    ['Dana@Example.com', ['dana', 'dana@example', 'example.com', '@example.com', 'example', 'com']],
  ]
  for (const [address, expected] of tokenCases) {
    const tokens = emailSearchTokens(address)
    for (const token of expected) check(`${address} has ${token}`, tokens.includes(token))
    check(`${address} tokens within the cap`, tokens.every((token) => token.length <= TOKEN_MAX_PREFIX))
    check(`${address} tokens unique`, new Set(tokens).size === tokens.length)
  }
  check('no address, no tokens', emailSearchTokens('').length === 0 && emailSearchTokens(null).length === 0)

  const TOKENS = emailSearchTokens('dana@example.com')
  const planCases = [
    ['a legacy active record', { email: 'dana@example.com', releasedAt: null }, { update: { released: false, emailTokens: TOKENS } }],
    ['a legacy released record', { email: 'dana@example.com', releasedAt: { seconds: 1 } }, { update: { released: true, emailTokens: TOKENS } }],
    ['a current record', { email: 'dana@example.com', releasedAt: null, released: false, emailTokens: TOKENS }, { skip: 'current' }],
    ['a released record whose flag lags', { email: 'dana@example.com', releasedAt: { seconds: 1 }, released: false, emailTokens: TOKENS }, { update: { released: true } }],
    ['stale tokens', { email: 'dana@example.com', releasedAt: null, released: false, emailTokens: ['x'] }, { update: { emailTokens: TOKENS } }],
    ['no address', { releasedAt: null }, { update: { released: false } }],
  ]
  for (const [name, data, expected] of planCases) {
    const got = planSuppression(data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(expected))
  }
  // Idempotent: a record the plan stamped plans nothing the second time.
  for (const [name, data] of planCases) {
    const once = planSuppression(data)
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planSuppression(stamped))
  }
  const total = tokenCases.reduce((sum, [, expected]) => sum + expected.length + 2, 0) + 1 + planCases.length * 2
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = { scanned: 0, current: 0, released: 0, tokens: 0, written: 0 }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collection('emailSuppressions').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planSuppression(doc.data())
      if ('skip' in plan) {
        counts.current += 1
        continue
      }
      if ('released' in plan.update) counts.released += 1
      if ('emailTokens' in plan.update) counts.tokens += 1
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
      ? 'backfill-email-suppression-filters: APPLIED'
      : 'backfill-email-suppression-filters: DRY RUN (nothing written)',
  )
  console.log(`  scanned              ${counts.scanned}`)
  console.log(`  already current      ${counts.current}`)
  console.log(`  stamp released       ${counts.released}`)
  console.log(`  stamp emailTokens    ${counts.tokens}`)
  if (args.apply) console.log(`  written              ${counts.written}`)
}

await main()
