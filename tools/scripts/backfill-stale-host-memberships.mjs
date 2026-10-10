/**
 * Lists, and with --write deletes, `users/{uid}/hostMemberships/{hostId}` rows
 * whose site no longer exists.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-stale-host-memberships.mjs \
 *     [--write] [--org=<orgId>]
 *
 * DRY RUN BY DEFAULT.
 *
 * ## Why rows go stale
 *
 * The projection row is the site switcher's source and the console's first
 * answer for "which site is this address". `eraseHost` clears it for the
 * org's members and the site's own members, but a row written back by a sync
 * that was in flight, or one belonging to someone neither list named, outlived
 * the site: the switcher listed a deleted site, and its address resolved to an
 * id whose document never arrives. `eraseHost` now sweeps after the delete;
 * this clears what it left behind before that.
 *
 * ## What it touches
 *
 * Only a row whose `hosts/{hostId}` document is ABSENT. A row for a site that
 * exists is never read further and never changed, whoever holds it. Idempotent:
 * a second run lists nothing.
 *
 * The scan is a collection-group query on `hostMemberships`, so it needs the
 * COLLECTION_GROUP index on `orgId` that `eraseOrgHostMemberships` already
 * relies on when --org is given. Without --org it reads every row (no filter
 * needs no index).
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const argv = process.argv.slice(2)
const write = argv.includes('--write')
const orgArg = argv.find((arg) => arg.startsWith('--org='))
const orgId = orgArg ? orgArg.slice('--org='.length) : ''
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    'usage: backfill-stale-host-memberships.mjs [--write] [--org=<orgId>]\n' +
      'Dry run unless --write. Deletes hostMemberships rows whose host doc is gone.',
  )
  process.exit(0)
}

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const BATCH = 400

/** Which of these host ids have no document. */
async function missingHostIds(hostIds) {
  const missing = new Set()
  for (let index = 0; index < hostIds.length; index += BATCH) {
    const refs = hostIds
      .slice(index, index + BATCH)
      .map((hostId) => db.collection('hosts').doc(hostId))
    const snapshots = await db.getAll(...refs)
    for (const snapshot of snapshots) {
      if (!snapshot.exists) missing.add(snapshot.id)
    }
  }
  return missing
}

let query = db.collectionGroup('hostMemberships')
if (orgId) query = query.where('orgId', '==', orgId)
const rows = (await query.get()).docs

const hostIds = [...new Set(rows.map((row) => row.id))]
const missing = await missingHostIds(hostIds)
const stale = rows.filter((row) => missing.has(row.id))

for (const row of stale) {
  console.log(
    `${write ? 'DELETE' : 'would delete'} ${row.ref.path}` +
      `  (${row.get('displayName') ?? ''} / ${row.get('subdomain') ?? ''})`,
  )
}
console.log(
  `${rows.length} row(s) over ${hostIds.length} site(s); ${stale.length} stale ` +
    `row(s) for ${missing.size} deleted site(s).`,
)

if (!write) {
  console.log('Dry run. Re-run with --write to delete them.')
} else {
  for (let index = 0; index < stale.length; index += BATCH) {
    const batch = db.batch()
    for (const row of stale.slice(index, index + BATCH)) batch.delete(row.ref)
    await batch.commit()
  }
  console.log(`Deleted ${stale.length} row(s).`)
}
