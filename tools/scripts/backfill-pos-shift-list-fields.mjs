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
 * Stamp the fields the POS shift history sorts by onto every shift written
 * before them (AGL-3680).
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-pos-shift-list-fields.mjs [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-pos-shift-list-fields.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials: the
 * `gcloud` login above, or `GOOGLE_APPLICATION_CREDENTIALS` naming a service
 * account key with Firestore write access. `GOOGLE_CLOUD_PROJECT` names the
 * project; without it the credentials' own project is used, and the run
 * prints which one it is before it reads anything.
 *
 * ## What the fields are
 *
 * The shift history (`PosShiftHistoryCard`) sorts by every column header, and
 * each header order is an `orderBy` on the shifts query — which DROPS every
 * shift that lacks the field. So the shift writer
 * (`libs/plugins/commerce/src/lib/server/pos-shift.ts`) now opens a shift with
 * `closedAtMs`, `countedCashCents`, `expectedCashCents`, `varianceCents` and
 * `netSalesCents` all `null`, and the close fills them, `netSalesCents`
 * flattened from the Z report (`report.netSalesCents`) since a query cannot
 * order by a field inside `report`. A shift written before carries none of
 * the five while open, and no `netSalesCents` once closed.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/registers/{registerId}/shifts/{shiftId}` only (any other
 * collection named `shifts` is counted and left alone), and on each only
 * those five fields, and only where the field is ABSENT: a present value —
 * a closed shift's figures, or an open one's `null` — is never rewritten.
 * `netSalesCents` is the shift's frozen report's figure, or `null` without
 * one; the other four are `null` where absent (a closed shift has always
 * carried them).
 *
 * ## Idempotence and interruption
 *
 * A shift with nothing absent is counted as current, so a second run writes
 * nothing and an interrupted run is finished by the next. Writes are
 * `update()`s in batches of {@link BATCH}. Nothing is deleted.
 */
import { pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'

/** Shifts read, and at most written, per batch. Firestore allows 500. */
const BATCH = 400

/** `POS_SHIFT_SORTED_FIELDS` in `constants/pos-shift-list-query.ts`. */
export const SHIFT_SORTED_FIELDS = [
  'closedAtMs',
  'netSalesCents',
  'expectedCashCents',
  'countedCashCents',
  'varianceCents',
]

/** The value a shift should carry for one sorted field, from what it already says. */
function wanted(data, field) {
  if (field === 'netSalesCents') {
    const net = data?.report?.netSalesCents
    return typeof net === 'number' && Number.isFinite(net) ? net : null
  }
  return null
}

/**
 * One shift's verdict, so the dry run and the apply run cannot disagree: the
 * fields to write, or why nothing is.
 *
 * @param {string} path the document path
 * @param {Record<string, any>} data the document
 */
export function planShift(path, data) {
  const segments = path.split('/')
  if (
    segments.length !== 6 ||
    segments[0] !== 'hosts' ||
    segments[2] !== 'registers' ||
    segments[4] !== 'shifts'
  ) {
    return { action: 'skip', reason: 'not a register shift' }
  }
  const write = {}
  for (const field of SHIFT_SORTED_FIELDS) {
    if (!(field in (data ?? {}))) write[field] = wanted(data, field)
  }
  return Object.keys(write).length ? { action: 'update', write } : { action: 'current' }
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

  const totals = { scanned: 0, current: 0, updated: 0, skipped: 0 }
  const fieldCounts = new Map()
  const skipReasons = new Map()
  const walk = async (base) => {
    let cursor = null
    for (;;) {
      // Paged by document name: every shift has one, so the walk is total.
      let page = base.orderBy(FieldPath.documentId()).limit(BATCH)
      if (cursor) page = page.startAfter(cursor)
      const snapshot = await page.get()
      if (snapshot.empty) break
      const batch = firestore.batch()
      let writes = 0
      for (const doc of snapshot.docs) {
        totals.scanned += 1
        const verdict = planShift(doc.ref.path, doc.data())
        if (verdict.action === 'current') {
          totals.current += 1
        } else if (verdict.action === 'skip') {
          totals.skipped += 1
          skipReasons.set(verdict.reason, (skipReasons.get(verdict.reason) ?? 0) + 1)
        } else {
          totals.updated += 1
          for (const key of Object.keys(verdict.write)) {
            fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1)
          }
          batch.update(doc.ref, verdict.write)
          writes += 1
        }
      }
      if (args.apply && writes) await batch.commit()
      cursor = snapshot.docs[snapshot.docs.length - 1]
      if (snapshot.size < BATCH) break
    }
  }

  if (args.host) {
    // One site: each of its registers' shifts.
    const registers = await firestore.collection('hosts').doc(args.host).collection('registers').get()
    for (const register of registers.docs) await walk(register.ref.collection('shifts'))
  } else {
    await walk(firestore.collectionGroup('shifts'))
  }

  console.log(
    `\n${totals.scanned} shift(s) scanned: ${totals.current} already current, ` +
      `${totals.updated} ${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped`,
  )
  for (const [key, count] of fieldCounts) console.log(`  ${key}: ${count}`)
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
  const path = 'hosts/h1/registers/r1/shifts/s1'
  const open = { status: 'open', openedAtMs: 1, openingFloatCents: 0, cashEvents: [] }
  const closed = {
    ...open,
    status: 'closed',
    closedAtMs: 2,
    countedCashCents: 500,
    expectedCashCents: 400,
    varianceCents: 100,
    report: { netSalesCents: 1234 },
  }

  check('stamps an open shift from before with five nulls', planShift(path, open), {
    action: 'update',
    write: {
      closedAtMs: null,
      netSalesCents: null,
      expectedCashCents: null,
      countedCashCents: null,
      varianceCents: null,
    },
  })
  check('flattens a closed shift’s report net sales, and nothing else', planShift(path, closed), {
    action: 'update',
    write: { netSalesCents: 1234 },
  })
  check('is idempotent: a stamped shift is current', planShift(path, { ...closed, netSalesCents: 1234 }), {
    action: 'current',
  })
  check(
    'never rewrites a present value, null included',
    planShift(path, {
      ...open,
      closedAtMs: null,
      netSalesCents: null,
      expectedCashCents: null,
      countedCashCents: null,
      varianceCents: null,
    }),
    { action: 'current' },
  )
  check('a closed shift with no report states null net sales', planShift(path, { ...closed, report: undefined }), {
    action: 'update',
    write: { netSalesCents: null },
  })
  check('leaves another collection named shifts alone', planShift('orgs/o1/shifts/s1', open), {
    action: 'skip',
    reason: 'not a register shift',
  })

  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` +
        (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  if (failed) process.exitCode = 1
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const args = parseDeployArgs({
    command: 'backfill-pos-shift-list-fields',
    summary:
      'Stamp the fields the POS shift history sorts by (closedAtMs, netSalesCents, ' +
      'expectedCashCents, countedCashCents, varianceCents) onto shifts that predate ' +
      'them. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the cases, touching no project.' },
      { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site (host document id).' },
    ],
  })
  if (args.selfTest) runSelfTest()
  else await run(args)
}
