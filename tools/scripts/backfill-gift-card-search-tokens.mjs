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
 * Stamp `searchTokens` onto every gift card written before the field existed
 * (AGL-3321).
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-gift-card-search-tokens.mjs [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-gift-card-search-tokens.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials.
 * `GOOGLE_CLOUD_PROJECT` names the project; without it the credentials' own
 * project is used, and the run prints which one it is before it reads.
 *
 * ## What the field is
 *
 * The console's Gift cards card finds a card by its code or by the address it
 * was sent to, with an `array-contains` on its query, newest first. Both card
 * writers — the purchase path in `billing-webhook.ts` and the hand-issue
 * route in `gift-cards.ts` — now stamp `searchTokens` through
 * `giftCardSearchTokens` (`libs/plugins/commerce/src/lib/model/gift-card-search.ts`).
 * A card written before that has none, and without this it still lists but
 * no search finds it.
 *
 * The tokens are derived from the card's document id (its code) and its
 * `recipientEmail`, through the same rule as the library; the self-test runs
 * the fixtures that function's spec runs, so the two cannot drift apart
 * unnoticed. The name keys come from `lib/name-search-tokens.mjs` and the
 * address tokens from `lib/email-search-tokens.mjs`.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/giftCards/{code}`, and on each only `searchTokens`. A card
 * whose tokens already match is never written, so a re-run is a no-op and an
 * interrupted run is finished by the next. Nothing is deleted.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { emailSearchTokens } from './lib/email-search-tokens.mjs'
import { nameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Cards read, and at most written, per batch. Firestore allows 500. */
const BATCH = 400

/**
 * `giftCardSearchTokens`: word prefixes of the whole code and of each of its
 * `-`-separated parts, then the recipient address's tokens.
 *
 * @param {unknown} code the card's document id
 * @param {unknown} [recipientEmail]
 * @returns {string[]}
 */
export function giftCardSearchTokens(code, recipientEmail) {
  const whole = String(code ?? '').trim()
  const words = [whole, ...whole.split(/[-_]+/)].filter(Boolean)
  return [...new Set([...nameSearchTokens(words.join(' ')), ...emailSearchTokens(recipientEmail)])]
}

const sameTokens = (a, b) =>
  Array.isArray(a) && a.length === b.length && a.every((token, at) => token === b[at])

/**
 * One card's verdict, so the dry run and the apply run cannot disagree.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 */
export function planGiftCard(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'giftCards') {
    return { action: 'skip', reason: 'not a site gift card' }
  }
  const tokens = giftCardSearchTokens(segments[3], data?.recipientEmail)
  return sameTokens(data?.searchTokens, tokens)
    ? { action: 'current' }
    : { action: 'update', write: { searchTokens: tokens } }
}

async function run(args) {
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { FieldPath, getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}` +
      (args.host ? ` · site ${args.host}` : ''),
  )
  const base = args.host
    ? firestore.collection('hosts').doc(args.host).collection('giftCards')
    : firestore.collectionGroup('giftCards')
  const totals = { scanned: 0, current: 0, updated: 0, skipped: 0 }
  const skipReasons = new Map()
  let cursor = null
  for (;;) {
    // Paged by document name: every card has one, so the walk is total.
    let page = base.orderBy(FieldPath.documentId()).limit(BATCH)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    const batch = firestore.batch()
    let writes = 0
    for (const doc of snapshot.docs) {
      totals.scanned += 1
      const verdict = planGiftCard(doc.ref.path, doc.data())
      if (verdict.action === 'current') {
        totals.current += 1
      } else if (verdict.action === 'skip') {
        totals.skipped += 1
        skipReasons.set(verdict.reason, (skipReasons.get(verdict.reason) ?? 0) + 1)
      } else {
        totals.updated += 1
        batch.update(doc.ref, verdict.write)
        writes += 1
      }
    }
    if (args.apply && writes) await batch.commit()
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < BATCH) break
  }
  console.log(
    `\n${totals.scanned} gift card(s) scanned: ${totals.current} already current, ` +
      `${totals.updated} ${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped`,
  )
  for (const [reason, count] of skipReasons) console.log(`  skipped ${count}: ${reason}`)
  if (!args.apply) console.log('\nDRY RUN — re-run with --apply to write.')
}

/** The verdicts that decide whether this is safe to run. No Firestore. */
function runSelfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    cases.push({ name, ok, actual, expected })
  }
  // The copy answers the worked examples the library's spec asserts.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'gift-card-search-tokens.fixtures.json'), 'utf8'),
  )
  for (const one of fixtures.cases) {
    check(`fixture ${one.name}`, giftCardSearchTokens(one.code, one.recipientEmail), one.expected)
  }
  const path = 'hosts/h1/giftCards/GC-00FF'
  const tokens = giftCardSearchTokens('GC-00FF', 'jane@example.com')
  check('stamps a legacy card', planGiftCard(path, { recipientEmail: 'jane@example.com' }), {
    action: 'update',
    write: { searchTokens: tokens },
  })
  check(
    'is idempotent: a stamped card is current',
    planGiftCard(path, { recipientEmail: 'jane@example.com', searchTokens: tokens }),
    { action: 'current' },
  )
  check('reads the code from the document id', planGiftCard(path, {}).write?.searchTokens.includes('gc-00ff'), true)
  check('leaves another collection named giftCards alone', planGiftCard('orgs/o1/giftCards/x', {}), {
    action: 'skip',
    reason: 'not a site gift card',
  })
  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` + (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  if (failed) process.exitCode = 1
}

/*
 * Run only when invoked, never when imported: the demo seeder imports
 * `giftCardSearchTokens`, and ARGUMENTS FAIL CLOSED (AGL-1489).
 */
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const args = parseDeployArgs({
    command: 'backfill-gift-card-search-tokens',
    summary:
      'Stamp `searchTokens` (code and recipient address prefixes) onto gift cards that ' +
      'predate them, so the console search finds them. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
      { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site (host document id).' },
    ],
  })
  if (args.selfTest) runSelfTest()
  else await run(args)
}
