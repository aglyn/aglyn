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

/**
 * Mark every event deleted before the delete wrote `status` as
 * `status: 'deleted'` (AGL-3354).
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-events-deleted-status.mjs [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-events-deleted-status.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials.
 *
 * ## Why
 *
 * The public Event List asks its query for `status == 'published'`, so the
 * fifty events it returns are fifty a visitor may see. The console's delete
 * now writes `status: 'deleted'` beside `deletedAt`; an event deleted before
 * that still reads `published`, so the query returns it and the listing drops
 * it after the read, which lets it take one of the fifty places.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/events/{id}` carrying a `deletedAt`, and on each only
 * `status`. An event already marked is never written, so a re-run is a no-op.
 * Nothing is deleted.
 */
import { pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'

/** Events read, and at most written, per batch. Firestore allows 500. */
const BATCH = 400

/**
 * One event's verdict, so the dry run and the apply run cannot disagree.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 */
export function planEvent(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'events') {
    return { action: 'skip', reason: 'not a site event' }
  }
  if (!data?.deletedAt) return { action: 'current' }
  if (data.status === 'deleted') return { action: 'current' }
  return { action: 'update', write: { status: 'deleted' } }
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
    ? firestore.collection('hosts').doc(args.host).collection('events')
    : firestore.collectionGroup('events')
  const totals = { scanned: 0, current: 0, updated: 0, skipped: 0 }
  let cursor = null
  for (;;) {
    // Paged by document name: every event has one, so the walk is total.
    let page = base.orderBy(FieldPath.documentId()).limit(BATCH)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    const batch = firestore.batch()
    let writes = 0
    for (const doc of snapshot.docs) {
      totals.scanned += 1
      const verdict = planEvent(doc.ref.path, doc.data())
      if (verdict.action === 'current') totals.current += 1
      else if (verdict.action === 'skip') totals.skipped += 1
      else {
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
    `\n${totals.scanned} event(s) scanned: ${totals.current} already current, ` +
      `${totals.updated} ${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped`,
  )
  if (!args.apply) console.log('\nDRY RUN — re-run with --apply to write.')
}

/** The verdicts that decide whether this is safe to run. No Firestore. */
function runSelfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    cases.push({ name, ok, actual })
  }
  const path = 'hosts/h1/events/e1'
  const deletedAt = { toMillis: () => 1_750_000_000_000 }
  check('marks an event deleted before the delete wrote status', planEvent(path, { status: 'published', deletedAt }), {
    action: 'update',
    write: { status: 'deleted' },
  })
  check('marks a deleted draft too', planEvent(path, { status: 'draft', deletedAt }), {
    action: 'update',
    write: { status: 'deleted' },
  })
  check('is idempotent: a marked event is current', planEvent(path, { status: 'deleted', deletedAt }), {
    action: 'current',
  })
  check('leaves a live event alone', planEvent(path, { status: 'published' }), { action: 'current' })
  check('leaves another collection named events alone', planEvent('orgs/o1/events/x', { deletedAt }), {
    action: 'skip',
    reason: 'not a site event',
  })
  for (const entry of cases) {
    console.log(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` + (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`))
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  if (failed) process.exitCode = 1
}

// Run only when invoked, never when imported; arguments fail closed (AGL-1489).
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const args = parseDeployArgs({
    command: 'backfill-events-deleted-status',
    summary:
      "Set `status: 'deleted'` on events deleted before the delete wrote it, so the public " +
      'Event List query never returns them. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the verdicts, touching no project.' },
      { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site (host document id).' },
    ],
  })
  if (args.selfTest) runSelfTest()
  else await run(args)
}
