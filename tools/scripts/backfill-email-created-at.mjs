/**
 * `createdAtMs` on every email that predates the stamp.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-email-created-at.mjs \
 *     [--apply] [--host=<hostId>] [--max-records=<n>]
 *
 * DRY RUN BY DEFAULT.
 *
 * ⚠️ **THIS SCRIPT HAS NOT BEEN RUN IN PRODUCTION.** Nothing below assumes it
 * has, which is the point of the fallback in `emailListTimeMs`: a message with
 * no stamp orders by its send time exactly as it did before, so the console is
 * correct whether this has run or not. What is still waiting on it is server
 * ORDERING — `orderBy('createdAtMs')` drops every document missing the field,
 * so the emails list goes on reading a ceilinged window in document-id order
 * until every record carries one.
 *
 * ## What it writes, and where the number comes from
 *
 * `hosts/{hostId}/campaigns/{sendId}` is one email. Every writer stamps
 * `createdAtMs` when it MINTS the document — see `campaign-send.ts` — but
 * records written before that carry no creation date of any kind, and the ids
 * are nanoid, so there is nothing in the id to recover one from.
 *
 * What those records do carry is dates of things that happened AFTER they were
 * created: `draftedAt`, `scheduledAt`, `sentAt` and `sendAtMs`. Creation
 * precedes all of them, so the EARLIEST one present is the tightest honest
 * upper bound on when the record was made, and that is what is written.
 *
 * It is an estimate, and it is recorded as one. Every write also stamps
 * {@link ESTIMATED_FIELD} naming the field the number came from, so a later
 * reader can tell a creation date the writer stamped from one this script
 * inferred — the same distinction the consent backfill draws for the same
 * reason. A number nobody can tell is a guess stops being a guess.
 *
 * ## The records it deliberately does NOT date
 *
 * A message with none of those four fields is left alone and REPORTED. It is
 * an email that was never drafted, never scheduled and never sent, and there
 * is nothing to derive a date from — writing the run's own clock would date
 * every one of them to the day this script happened to be executed, bunched at
 * the top of a list ordered by creation, which is a worse answer than the
 * absence they have now.
 *
 * ## Idempotence
 *
 * A record that already carries `createdAtMs` is skipped, whether the writer
 * stamped it or a previous run of this script did. Each write is its own
 * transaction against a fresh read, so interruption leaves finished work and
 * nothing half-done, and re-running finishes the rest.
 *
 * ## Why it may not simply write what it read
 *
 * The read and the write are separated by the length of a full sweep, and an
 * email is a live document — the send path stamps `sentAt` on it, the delivery
 * webhook increments its counters. So the decision is taken again inside the
 * transaction, against a fresh read: a record that acquired a real
 * `createdAtMs` in the meantime is left exactly as it is.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { parseDeployArgs } from './lib/deploy-args.mjs'

/** The field every writer of a message now stamps. */
const CREATED_FIELD = 'createdAtMs'

/**
 * Records that this script inferred the date rather than reading it.
 *
 * Names the FIELD it was derived from, not merely that it was derived: "the
 * earliest thing we know happened to this email" is a different claim
 * depending on whether that thing was a draft save or a delivery, and a reader
 * asking why an email's creation date is a Tuesday deserves the answer.
 */
const ESTIMATED_FIELD = 'createdAtEstimatedFrom'

/**
 * The fields creation can be bounded by, and how to read each one.
 *
 * All four describe something that happened to an email AFTER it existed, so
 * every one of them is an upper bound and the earliest wins.
 */
const SOURCES = [
  { field: 'draftedAt', read: (value) => timestampMs(value) },
  { field: 'scheduledAt', read: (value) => timestampMs(value) },
  { field: 'sentAt', read: (value) => timestampMs(value) },
  { field: 'sendAtMs', read: (value) => numberMs(value) },
]

/*
 * ARGUMENTS FAIL CLOSED (AGL-1489).
 *
 * A scan for known flags that ignores the rest makes a TYPO SILENT:
 * `--hots=site1` would be discarded, and the run an operator believes is
 * scoped to one site would sweep every site in the project. Here that is a
 * write to every email record a customer has, so an unrecognized argument
 * exits 2 having written nothing, and `--help` prints usage instead of
 * sweeping a live project.
 */
const args = parseDeployArgs({
  command: 'backfill-email-created-at',
  summary:
    'Stamp createdAtMs on email records that predate it, derived from the ' +
    'earliest date each one carries. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    {
      flag: '--host',
      key: 'host',
      value: 'string',
      describe: 'Limit to one site.',
    },
    {
      flag: '--max-records',
      key: 'maxRecords',
      value: 'string',
      describe: 'Stop after this many writes.',
    },
  ],
})

/** Epoch ms from an admin `Timestamp`, or null for anything else. */
function timestampMs(value) {
  if (value && typeof value.toMillis === 'function') {
    const ms = value.toMillis()
    return Number.isFinite(ms) && ms > 0 ? ms : null
  }
  if (value && typeof value._seconds === 'number') {
    return value._seconds * 1000
  }
  return null
}

/** Epoch ms from a stored number, or null. */
function numberMs(value) {
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

/**
 * What this record's creation date should be, and what it was derived from.
 *
 * Exported shape rather than a bare number so the dry run can report the
 * derivation: a plan that says only "2026-03-04" is a plan nobody can check.
 *
 * @returns `{ ms, from }`, or null where nothing can be derived.
 */
export function plannedCreatedAt(data) {
  if (numberMs(data?.[CREATED_FIELD])) return null
  let best = null
  for (const source of SOURCES) {
    const ms = source.read(data?.[source.field])
    if (ms === null) continue
    if (best === null || ms < best.ms) best = { ms, from: source.field }
  }
  return best
}

async function main() {
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const ceiling = args.maxRecords ? Number(args.maxRecords) : Infinity
  if (!Number.isFinite(ceiling) && args.maxRecords) {
    console.error('--max-records must be a number — NOTHING WAS WRITTEN.')
    return process.exit(2)
  }

  /*
   * One site, or every site through the collection group.
   *
   * `collectionGroup('campaigns')` is the same walk the scheduled-campaign
   * processor makes, so it reaches exactly the documents the product treats as
   * emails and no others.
   */
  const walk = args.host
    ? firestore.collection(`hosts/${args.host}/campaigns`)
    : firestore.collectionGroup('campaigns')

  const report = { scanned: 0, stamped: 0, already: 0, undatable: [] }
  const snapshot = await walk.get()
  for (const doc of snapshot.docs) {
    report.scanned += 1
    const data = doc.data()
    if (numberMs(data?.[CREATED_FIELD])) {
      report.already += 1
      continue
    }
    const planned = plannedCreatedAt(data)
    if (!planned) {
      report.undatable.push(doc.ref.path)
      continue
    }
    if (report.stamped >= ceiling) break
    if (!args.apply) {
      report.stamped += 1
      console.log(
        `  would stamp ${doc.ref.path} = ` +
          `${new Date(planned.ms).toISOString()} (from ${planned.from})`,
      )
      continue
    }
    /*
     * Decided AGAIN inside the transaction, against a fresh read. A sweep is
     * not instantaneous and an email is a live document: one that acquired a
     * real `createdAtMs` while this ran must keep it rather than be replaced
     * by an estimate.
     */
    const wrote = await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(doc.ref)
      if (!fresh.exists) return false
      if (numberMs(fresh.get(CREATED_FIELD))) return false
      transaction.update(doc.ref, {
        [CREATED_FIELD]: planned.ms,
        [ESTIMATED_FIELD]: planned.from,
      })
      return true
    })
    if (wrote) report.stamped += 1
    else report.already += 1
  }

  console.log(
    `\nscanned ${report.scanned}  ` +
      `${args.apply ? 'stamped' : 'would stamp'} ${report.stamped}  ` +
      `already dated ${report.already}  ` +
      `undatable ${report.undatable.length}`,
  )
  if (report.undatable.length) {
    console.log(
      '\nNo date of any kind — left alone rather than dated from the clock ' +
        'this script ran on:',
    )
    for (const path of report.undatable.slice(0, 50)) console.log(`  ${path}`)
    if (report.undatable.length > 50) {
      console.log(`  … and ${report.undatable.length - 50} more`)
    }
  }
  if (!args.apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
