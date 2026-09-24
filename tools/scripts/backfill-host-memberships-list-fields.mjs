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
 * Stamp `searchTokens` and `createdAt` onto every site membership row
 * written before the fields existed (AGL-3321).
 *
 * The organization's Sites list is a query over `users/{uid}/hostMemberships`
 * — `where(orgId ==)`, the reader's filters, ordered by `nameLower` or
 * `createdAt` — and its quick search is an `array-contains` on
 * `searchTokens`. `membershipRow` (libs/tenant/data/admin/.../
 * host-memberships.ts) now writes both on every re-sync. A row written before
 * that has neither, and a query cannot find a document that lacks a field: the
 * search would never find it, and the list sorted by Created would not show it
 * at all, while the list sorted by name still did.
 *
 * Both are taken from the HOST document, as the writer takes them: the tokens
 * from its `displayName`, `subdomain` and `cname`, and `createdAt` as the
 * host's own (null when it has none, so the row still sorts). A row whose host
 * no longer exists is counted and left alone — the list drops it at the join,
 * and deleting it is not this script's to do.
 *
 * ## Idempotence and interruption
 *
 * A row whose tokens and date already match its host is never written, so a
 * re-run is a no-op and an interrupted run is finished by the next. Writes
 * UPDATE those two fields alone, in batches of 400. Nothing is deleted. Only
 * `users/{uid}/hostMemberships/{hostId}` is touched: the scan is a collection
 * group, and anything else of that name is counted and skipped.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-memberships-list-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-memberships-list-fields.mjs --apply  # write
 *     node tools/scripts/backfill-host-memberships-list-fields.mjs --self-test
 *
 * `--org=<orgId>` limits the run to one organization's rows. A self-hosted
 * install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/*
 * ARGUMENTS FAIL CLOSED (AGL-1489): `--aply` would otherwise leave a run the
 * operator believes is writing as a dry run, and `--orgs=abc` would widen a
 * run scoped to one organization to every one on the project.
 */
const args = parseDeployArgs({
  command: 'backfill-host-memberships-list-fields',
  summary:
    'Stamp `searchTokens` and `createdAt` onto site membership rows that ' +
    'predate them, so the Sites list can search and sort them. Writes to the ' +
    'live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one organization.' },
  ],
})

/** Rows per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Rows read per page of the scan. */
const PAGE = 500

/*
 * THE TOKEN BUILDER, restated — KEEP IN SYNC with `hostMembershipSearchTokens`
 * in `libs/tenant/data/admin/src/lib/server/host-memberships.ts`, and with
 * `nameSearchKey` / `nameSearchTokens` in
 * `libs/aglyn/src/lib/app-utils/name-search.ts` beneath it, which a plain Node
 * script cannot import. Both are held to the same worked examples,
 * `lib/host-membership-search-tokens.fixtures.json`: the library's spec asserts
 * them and so does the self-test below, so this script cannot stamp a token the
 * writer and the list's query do not use.
 */

/** `NAME_TOKEN_MAX_PREFIX` and `NAME_TOKEN_LIMIT` in `name-search`. */
const TOKEN_MAX_PREFIX = 12
const TOKEN_LIMIT = 120

/** `nameSearchKey`: trimmed, whitespace collapsed, lower-cased. */
const nameKey = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

/** `nameSearchTokens`: every prefix, to the cap, of every space-separated word. */
function wordPrefixTokens(text) {
  const key = nameKey(text)
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

/** A tail of a word begins after any character that is not a letter or a digit. */
const WORD_SEPARATOR = /[^\p{L}\p{N}]/u

/** A word, and every tail of it that begins after a separator, by codepoint. */
function wordTails(word) {
  const chars = [...word]
  const tails = [word]
  for (let at = 1; at < chars.length; at += 1) {
    if (WORD_SEPARATOR.test(chars[at - 1]) && !WORD_SEPARATOR.test(chars[at])) {
      tails.push(chars.slice(at).join(''))
    }
  }
  return tails
}

/**
 * `hostMembershipSearchTokens`: the name, the subdomain and the custom domain,
 * each word with its tails, as word-prefix tokens.
 *
 * @param {{ displayName?: unknown, subdomain?: unknown, cname?: unknown } | undefined} meta
 * @returns {string[]}
 */
export function hostMembershipSearchTokens(meta) {
  const words = [meta?.displayName, meta?.subdomain, meta?.cname]
    .map((value) => nameKey(typeof value === 'string' ? value : ''))
    .flatMap((key) => (key ? key.split(' ') : []))
    .flatMap(wordTails)
  return wordPrefixTokens(words.join(' '))
}

/** A Firestore timestamp, as opposed to a legacy number or string. */
const isTimestamp = (value) => typeof value?.toMillis === 'function'

const sameTokens = (stored, computed) =>
  Array.isArray(stored) &&
  stored.length === computed.length &&
  stored.every((token, at) => token === computed[at])

/** Two stored dates are the same instant, or both are null. */
const sameInstant = (stored, computed) => {
  if (computed === null) return stored === null
  return (
    isTimestamp(stored) &&
    stored.seconds === computed.seconds &&
    stored.nanoseconds === computed.nanoseconds
  )
}

/**
 * What one row should be stamped with, or why it is left alone. Pure, for the
 * self-test, so the dry run and the apply run cannot disagree.
 *
 * @param {string} path the row's document path
 * @param {Record<string, unknown>} row the row
 * @param {Record<string, unknown> | null} host its host document, or null when it no longer exists
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'no-host' | 'not-a-membership-row' }}
 */
export function planRow(path, row, host) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'users' || segments[2] !== 'hostMemberships') {
    return { skip: 'not-a-membership-row' }
  }
  if (!host) return { skip: 'no-host' }
  const update = {}
  const tokens = hostMembershipSearchTokens(host)
  if (!sameTokens(row.searchTokens, tokens)) update.searchTokens = tokens
  const createdAt = isTimestamp(host.createdAt) ? host.createdAt : null
  if (!sameInstant(row.createdAt, createdAt)) update.createdAt = createdAt
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual })
  }

  // The copy answers the worked examples the library's spec asserts.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'host-membership-search-tokens.fixtures.json'), 'utf8'),
  )
  check('the fixtures are there to answer', fixtures.tokens.length > 3, true)
  fixtures.tokens.forEach((one, at) =>
    check(`fixture tokens #${at}`, hostMembershipSearchTokens(one.meta), one.expected),
  )

  const at = (seconds) => ({ seconds, nanoseconds: 0, toMillis: () => seconds * 1000 })
  const HOST = { displayName: 'Harbor Bakery', subdomain: 'harbor-bakery', createdAt: at(100) }
  const TOKENS = hostMembershipSearchTokens(HOST)
  const ROW = 'users/u1/hostMemberships/h1'
  const planCases = [
    ['a legacy row', ROW, { orgId: 'o1', displayName: 'Harbor Bakery' }, HOST, { update: { searchTokens: TOKENS, createdAt: HOST.createdAt } }],
    ['a current row', ROW, { searchTokens: TOKENS, createdAt: at(100) }, HOST, { skip: 'current' }],
    ['a row whose host was renamed', ROW, { searchTokens: ['old'], createdAt: at(100) }, HOST, { update: { searchTokens: TOKENS } }],
    ['a seeded row dated by the seed, not the site', ROW, { searchTokens: TOKENS, createdAt: at(7) }, HOST, { update: { createdAt: HOST.createdAt } }],
    ['a site that never recorded a date', ROW, { searchTokens: TOKENS }, { ...HOST, createdAt: undefined }, { update: { createdAt: null } }],
    ['a legacy numeric date on the site', ROW, { searchTokens: TOKENS, createdAt: null }, { ...HOST, createdAt: 1_700_000_000_000 }, { skip: 'current' }],
    ['a row whose site is gone', ROW, {}, null, { skip: 'no-host' }],
    ['another collection of the same name', 'orgs/o1/hostMemberships/h1', {}, HOST, { skip: 'not-a-membership-row' }],
  ]
  for (const [name, path, row, host, expected] of planCases) {
    check(name, planRow(path, row, host), expected)
  }
  // Idempotent: a row the plan stamped plans nothing the second time.
  for (const [name, path, row, host] of planCases) {
    const once = planRow(path, row, host)
    const stamped = 'update' in once ? { ...row, ...once.update } : row
    const again = planRow(path, stamped, host)
    check(`${name}: a re-run writes nothing`, 'skip' in again, true)
  }

  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` +
        (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\nself-test: ${cases.length - failed}/${cases.length} passed`)
  process.exitCode = failed ? 1 : 0
}

async function run() {
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}` +
      (args.org ? ` · org ${args.org}` : ''),
  )

  const counts = {
    scanned: 0,
    current: 0,
    tokens: 0,
    createdAt: 0,
    noHost: 0,
    otherCollections: 0,
    written: 0,
  }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('hostMemberships')
    if (args.org) page = page.where('orgId', '==', args.org)
    page = page.orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break

    const hostIds = [...new Set(snapshot.docs.map((row) => row.id))]
    const hosts = new Map(
      (await firestore.getAll(...hostIds.map((id) => firestore.collection('hosts').doc(id)))).map(
        (host) => [host.id, host.exists ? host.data() : null],
      ),
    )
    for (const row of snapshot.docs) {
      counts.scanned += 1
      const plan = planRow(row.ref.path, row.data(), hosts.get(row.id) ?? null)
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else if (plan.skip === 'no-host') counts.noHost += 1
        else counts.otherCollections += 1
        continue
      }
      if ('searchTokens' in plan.update) counts.tokens += 1
      if ('createdAt' in plan.update) counts.createdAt += 1
      if (!args.apply) continue
      batch.update(row.ref, plan.update)
      pending += 1
      if (pending >= BATCH) {
        // Swap in the fresh batch BEFORE awaiting the full one, so `batch`
        // never points at an in-flight commit (AGL-1815).
        const full = batch
        batch = firestore.batch()
        pending = 0
        await full.commit()
        counts.written += BATCH
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
      ? 'backfill-host-memberships-list-fields: APPLIED'
      : 'backfill-host-memberships-list-fields: DRY RUN (nothing written)',
  )
  console.log(`  scanned                         ${counts.scanned}`)
  console.log(`  already current                 ${counts.current}`)
  console.log(`  stamp searchTokens              ${counts.tokens}`)
  console.log(`  stamp createdAt                 ${counts.createdAt}`)
  console.log(`  site gone (left alone)          ${counts.noHost}`)
  console.log(`  not users/*/hostMemberships     ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                         ${counts.written}`)
}

if (args.selfTest) selfTest()
else await run()
