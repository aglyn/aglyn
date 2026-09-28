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
 * Stamp `recoveryState` onto every open checkout written before the field
 * existed (AGL-3321).
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-checkout-recovery-state.mjs [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-checkout-recovery-state.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials.
 * `GOOGLE_CLOUD_PROJECT` names the project; without it the credentials' own
 * project is used, and the run prints which one it is before it reads.
 *
 * ## What the field is
 *
 * The console's Recovery & alerts card counts abandoned checkouts with
 * Firestore count queries — due a reminder, still within the first hour,
 * reminded — and lists the newest open ones. "Carries an email" and "not
 * reminded yet" are ABSENCES on a checkout, and a query cannot ask for a
 * field a document lacks, so every writer now stamps `recoveryState`:
 * `cart-checkout.ts` on create (`pending` with an email, `none` without) and
 * `process-abandoned.ts` beside `remindedAtMs` (`reminded`). An open
 * checkout written before that has none, and without this it is missing from
 * every figure on the card while the reminder job still acts on it.
 *
 * The state is derived from what the checkout already says, through the same
 * rule as `checkoutRecoveryState` in
 * `libs/plugins/commerce/src/lib/model/checkout-recovery.ts`; the self-test
 * runs the fixtures that function's spec runs, so the two cannot drift apart
 * unnoticed.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/checkouts/{id}` whose `status` is `open`, and on each only
 * `recoveryState`. A completed or expired checkout is counted and left alone:
 * the card never counts one. A checkout whose state already matches is never
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next. Nothing is deleted.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Checkouts read, and at most written, per batch. Firestore allows 500. */
const BATCH = 400

/**
 * `checkoutRecoveryState`: no email, nobody to remind; a truthy
 * `remindedAtMs` retires it — the tests `scanAbandonedCheckouts` applies.
 *
 * @param {{ email?: unknown, remindedAtMs?: unknown }} checkout
 * @returns {'pending' | 'reminded' | 'none'}
 */
export function checkoutRecoveryState(checkout) {
  if (!checkout?.email) return 'none'
  return checkout.remindedAtMs ? 'reminded' : 'pending'
}

/**
 * One checkout's verdict, so the dry run and the apply run cannot disagree.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 */
export function planCheckout(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'checkouts') {
    return { action: 'skip', reason: 'not a site checkout' }
  }
  if (data?.status !== 'open') {
    return { action: 'skip', reason: 'not open — the card never counts it' }
  }
  const state = checkoutRecoveryState(data)
  return data.recoveryState === state
    ? { action: 'current' }
    : { action: 'update', write: { recoveryState: state } }
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
    ? firestore.collection('hosts').doc(args.host).collection('checkouts')
    : firestore.collectionGroup('checkouts')
  const totals = { scanned: 0, current: 0, updated: 0, skipped: 0 }
  const states = new Map()
  const skipReasons = new Map()
  let cursor = null
  for (;;) {
    // Paged by document name: every checkout has one, so the walk is total.
    let page = base.orderBy(FieldPath.documentId()).limit(BATCH)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    const batch = firestore.batch()
    let writes = 0
    for (const doc of snapshot.docs) {
      totals.scanned += 1
      const verdict = planCheckout(doc.ref.path, doc.data())
      if (verdict.action === 'current') {
        totals.current += 1
      } else if (verdict.action === 'skip') {
        totals.skipped += 1
        skipReasons.set(verdict.reason, (skipReasons.get(verdict.reason) ?? 0) + 1)
      } else {
        totals.updated += 1
        const state = verdict.write.recoveryState
        states.set(state, (states.get(state) ?? 0) + 1)
        batch.update(doc.ref, verdict.write)
        writes += 1
      }
    }
    if (args.apply && writes) await batch.commit()
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < BATCH) break
  }
  console.log(
    `\n${totals.scanned} checkout(s) scanned: ${totals.current} already current, ` +
      `${totals.updated} ${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped`,
  )
  for (const [state, count] of states) console.log(`  recoveryState ${state}: ${count}`)
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
    readFileSync(join(here, 'lib', 'checkout-recovery-state.fixtures.json'), 'utf8'),
  )
  for (const one of fixtures.cases) {
    check(`fixture ${one.name}`, checkoutRecoveryState(one.checkout), one.expected)
  }
  const path = 'hosts/h1/checkouts/cs_1'
  const legacy = { status: 'open', email: 'jane@example.com', createdAtMs: 1 }
  check('stamps a legacy open checkout', planCheckout(path, legacy), {
    action: 'update',
    write: { recoveryState: 'pending' },
  })
  check('is idempotent: a stamped checkout is current', planCheckout(path, { ...legacy, recoveryState: 'pending' }), {
    action: 'current',
  })
  check('corrects a state that lags a reminder', planCheckout(path, { ...legacy, recoveryState: 'pending', remindedAtMs: 5 }), {
    action: 'update',
    write: { recoveryState: 'reminded' },
  })
  check('stamps none on a checkout with no email', planCheckout(path, { status: 'open', createdAtMs: 1 }), {
    action: 'update',
    write: { recoveryState: 'none' },
  })
  check('leaves a completed checkout alone', planCheckout(path, { ...legacy, status: 'completed' }), {
    action: 'skip',
    reason: 'not open — the card never counts it',
  })
  check('leaves another collection named checkouts alone', planCheckout('orgs/o1/checkouts/c1', legacy), {
    action: 'skip',
    reason: 'not a site checkout',
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

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const args = parseDeployArgs({
    command: 'backfill-checkout-recovery-state',
    summary:
      'Stamp `recoveryState` onto open checkouts that predate it, so the recovery ' +
      'queue counts them. Writes to the live project with --apply.',
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
