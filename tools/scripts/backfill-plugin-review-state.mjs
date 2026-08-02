/**
 * Per-version review state back-fill (AGL-966).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-plugin-review-state.mjs [--apply]
 *
 * DRY RUN BY DEFAULT.
 *
 * Approval moved from the listing onto the version, and installs now
 * resolve the newest APPROVED version. Every version published before that
 * change has no `reviewState`, and absent is deliberately NOT approval — so
 * without this back-fill, every listed plugin would abruptly have nothing
 * installable. Existing installs keep working either way (they are pinned),
 * but new installs would break.
 *
 * Rules:
 *
 * - Versions of a `listed`/`verified` listing become `approved`, marked
 *   `grandfathered: true` so nobody mistakes a migration for a review. The
 *   detail page flags listings whose current bytes carry no recorded
 *   checklist, which is how staff work through this set deliberately.
 * - Versions of `submitted`/`in_review`/`rejected` listings become
 *   `pending`. Nothing was approved there, and pending is the honest state.
 * - Versions that already carry a `reviewState` are left alone, so this is
 *   safe to re-run.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore()

const listings = await firestore
  .collection('marketplaceListings')
  .where('type', '==', 'plugin')
  .get()

let approved = 0
let pending = 0
let untouched = 0

for (const listing of listings.docs) {
  const status = String(listing.get('reviewStatus') ?? '')
  const live = status === 'listed' || status === 'verified'
  const versions = await listing.ref.collection('pluginVersions').get()
  for (const version of versions.docs) {
    if (version.get('reviewState')) {
      untouched += 1
      continue
    }
    const state = live ? 'approved' : 'pending'
    if (state === 'approved') approved += 1
    else pending += 1
    console.log(
      `${apply ? 'set' : 'would set'} ${state.padEnd(8)} ${version.ref.path}` +
        `  (listing ${status || 'no status'})`,
    )
    if (apply) {
      await version.ref.set(
        {
          reviewState: state,
          ...(state === 'approved'
            ? {
                grandfathered: true,
                reviewedAt: new Date(),
                reviewNote:
                  'Approved by the AGL-966 migration, not by a reviewer.',
              }
            : {}),
        },
        { merge: true },
      )
    }
  }
}

console.log(
  `\n${listings.size} listing(s): ${approved} version(s) approved, ` +
    `${pending} pending, ${untouched} already stated.`,
)
if (!apply) console.log('Dry run — re-run with --apply to write.')
