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
 * Stamp the Inbox's list fields onto the form submissions written before them.
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-form-submission-filters.mjs [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-form-submission-filters.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials: the
 * `gcloud` login above, or `GOOGLE_APPLICATION_CREDENTIALS` naming a service
 * account key with Firestore write access. `GOOGLE_CLOUD_PROJECT` names the
 * project; without it the credentials' own project is used, and the run
 * prints which one it is before it reads anything.
 *
 * ## What the fields are
 *
 * The Inbox's Submissions list puts every filter and its search on its
 * Firestore query (AGL-3321), so each needs a field the query can ask:
 *
 *   senderTokens  the sender's name and address as word prefixes — the From
 *                 filter's `array-contains`.
 *   searchTokens  those, then the words of the message — the search box's.
 *   read          a boolean on every row, so Read and Unread are equalities.
 *
 * The submit route stamps all three on every new submission
 * (`messageSearchFields` in `libs/aglyn/src/lib/app-utils/message-search.ts`,
 * and `read: false`). A row written before carries no tokens, so no search
 * or From filter finds it until this script reaches it. A row with no `read`
 * has always read as unread, and is stamped `false`, which is what it meant.
 *
 * The tokens come from `lib/message-search.mjs`, the script-side copy of the
 * library's builder, held to it by `lib/message-search.fixtures.json` — which
 * the library's spec asserts and `--self-test` asserts here.
 *
 * ## What it touches
 *
 * Every `hosts/{hostId}/formSubmissions/{id}` — or one site's, with `--host`.
 * It reads `fields`, `read` and the two token arrays, and UPDATES only the
 * fields whose stored value differs from the computed one. Nothing else on a
 * submission changes, and nothing is deleted.
 *
 * ## Idempotence and interruption
 *
 * A row whose stored fields equal the computed ones is counted as current and
 * not written, so a second run writes nothing. Writes are batched per site in
 * pages of {@link BATCH_SIZE}; an interruption leaves some rows stamped, which
 * is exactly what a re-run finishes.
 *
 * `--apply` is refused on a checkout whose submit route does not stamp the
 * fields itself: backfilling the past while the present keeps writing rows
 * without them would leave a gap that grows back.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { messageSearchFields, messageSender } from './lib/message-search.mjs'
import { sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')
const SUBMIT_ROUTE = join(REPO_ROOT, 'apps', 'tenant', 'app', 'api', 'forms', 'submit', 'route.ts')

/*
 * ARGUMENTS FAIL CLOSED (AGL-1489): `--aply` would otherwise leave a run the
 * operator believes is writing as a dry run, and `--hosts=abc` would widen a
 * run scoped to one site to every one on the project.
 */
const args = parseDeployArgs({
  command: 'backfill-form-submission-filters',
  summary:
    'Stamp the Inbox list fields (senderTokens, searchTokens, read) onto form ' +
    'submissions written before them, so the Submissions list can filter and ' +
    'search them. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site.' },
  ],
})

/** Rows read, and at most written, per batch. Firestore allows 500. */
const BATCH_SIZE = 400

/**
 * One submission's verdict, so the dry run and the apply run cannot
 * disagree. `write` holds only the fields that differ.
 */
export function planRow(data) {
  const fields = data?.fields
  if (fields != null && (typeof fields !== 'object' || Array.isArray(fields))) {
    return { action: 'skip', reason: '`fields` is not a map' }
  }
  const computed = messageSearchFields(fields ?? {})
  const write = {}
  if (!sameSearchTokens(data?.senderTokens, computed.senderTokens)) {
    write.senderTokens = computed.senderTokens
  }
  if (!sameSearchTokens(data?.searchTokens, computed.searchTokens)) {
    write.searchTokens = computed.searchTokens
  }
  // Absent has always read as unread; any non-boolean is a row the Read
  // filter cannot ask, and unread is what the Inbox drew it as.
  if (typeof data?.read !== 'boolean') write.read = false
  return Object.keys(write).length ? { action: 'update', write } : { action: 'current' }
}

/** The apply guard: the writer stamps the fields itself. */
function writerStamps(source) {
  const code = source ?? readFileSync(SUBMIT_ROUTE, 'utf8')
  const ok = code.includes('messageSearchFields(') && /\bread: false\b/.test(code)
  return {
    ok,
    why: ok
      ? 'the submit route stamps messageSearchFields and read'
      : 'the submit route in this checkout does not stamp messageSearchFields and read: false',
  }
}

async function run() {
  const guard = writerStamps()
  if (args.apply && !guard.ok) {
    console.error(`REFUSED — ${guard.why}`)
    process.exitCode = 2
    return
  }
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { FieldPath, getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}` +
      (args.host ? ` · site ${args.host}` : ''),
  )

  const hostIds = args.host
    ? [args.host]
    : (await firestore.collection('hosts').select().get()).docs.map((entry) => entry.id)

  const totals = { sites: 0, scanned: 0, current: 0, updated: 0, skipped: 0 }
  const fieldsWritten = { senderTokens: 0, searchTokens: 0, read: 0 }
  const skipReasons = new Map()

  for (const hostId of hostIds) {
    const submissions = firestore.collection('hosts').doc(hostId).collection('formSubmissions')
    const counts = { scanned: 0, current: 0, updated: 0, skipped: 0 }
    let cursor = null
    for (;;) {
      // Paged by document name: every row has one, so the walk is total.
      let page = submissions
        .orderBy(FieldPath.documentId())
        .select('fields', 'read', 'senderTokens', 'searchTokens')
        .limit(BATCH_SIZE)
      if (cursor) page = page.startAfter(cursor)
      const snapshot = await page.get()
      if (snapshot.empty) break
      const batch = firestore.batch()
      let writes = 0
      for (const row of snapshot.docs) {
        counts.scanned += 1
        const verdict = planRow(row.data())
        if (verdict.action === 'current') counts.current += 1
        else if (verdict.action === 'skip') {
          counts.skipped += 1
          skipReasons.set(verdict.reason, (skipReasons.get(verdict.reason) ?? 0) + 1)
        } else {
          counts.updated += 1
          writes += 1
          for (const key of Object.keys(verdict.write)) fieldsWritten[key] += 1
          batch.update(row.ref, verdict.write)
        }
      }
      if (args.apply && writes) await batch.commit()
      cursor = snapshot.docs[snapshot.docs.length - 1]
      if (snapshot.size < BATCH_SIZE) break
    }
    if (counts.scanned) totals.sites += 1
    totals.scanned += counts.scanned
    totals.current += counts.current
    totals.updated += counts.updated
    totals.skipped += counts.skipped
    if (counts.updated || counts.skipped) {
      console.log(
        `hosts/${hostId}: ${counts.scanned} scanned, ${counts.current} current, ` +
          `${counts.updated} ${args.apply ? 'updated' : 'to update'}, ${counts.skipped} skipped`,
      )
    }
  }

  console.log(
    `\n${totals.sites} site(s) with submissions: ${totals.scanned} scanned, ` +
      `${totals.current} already current, ${totals.updated} ` +
      `${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped`,
  )
  console.log(
    `  fields: senderTokens ${fieldsWritten.senderTokens}, searchTokens ` +
      `${fieldsWritten.searchTokens}, read ${fieldsWritten.read}`,
  )
  for (const [reason, count] of skipReasons) console.log(`  skipped ${count}: ${reason}`)
  if (!guard.ok) console.log(`\n⚠️  ${guard.why} — --apply is refused on this checkout.`)
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
  const fixtures = JSON.parse(readFileSync(join(here, 'lib', 'message-search.fixtures.json'), 'utf8'))
  fixtures.fields.forEach((one, at) =>
    check(`fixture fields #${at}`, messageSearchFields(one.fields), one.expected),
  )
  fixtures.sender.forEach((one, at) =>
    check(`fixture sender #${at}`, messageSender(one.fields), one.expected),
  )

  const message = { name: 'Dana Reed', email: 'dana@acme.com', message: 'Hello there' }
  const stamped = messageSearchFields(message)
  check(
    'stamps a row that carries none of the fields',
    planRow({ fields: message }),
    { action: 'update', write: { ...stamped, read: false } },
  )
  check(
    'is idempotent: a stamped row is current',
    planRow({ fields: message, ...stamped, read: true }),
    { action: 'current' },
  )
  check(
    'writes only what differs',
    planRow({ fields: message, ...stamped, senderTokens: ['x'], read: false }),
    { action: 'update', write: { senderTokens: stamped.senderTokens } },
  )
  check(
    'keeps a read row read',
    planRow({ fields: message, ...stamped, read: true }).action,
    'current',
  )
  check(
    'stamps a row with no fields map as empty tokens',
    planRow({ read: false }),
    { action: 'update', write: { senderTokens: [], searchTokens: [] } },
  )
  check(
    'skips a row whose fields are not a map',
    planRow({ fields: 'oops' }),
    { action: 'skip', reason: '`fields` is not a map' },
  )
  check(
    'the apply guard reads a stamping writer',
    writerStamps("add({ ...Aglyn.messageSearchFields(x), read: false })").ok,
    true,
  )
  check('the apply guard refuses a writer that stamps nothing', writerStamps('add({ read: false })').ok, false)

  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` + (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  const live = writerStamps()
  console.log(`\nthis tree: ${live.ok ? 'may be applied against' : 'REFUSED'} — ${live.why}`)
  if (failed || !live.ok) process.exitCode = 1
}

if (args.selfTest) runSelfTest()
else await run()
