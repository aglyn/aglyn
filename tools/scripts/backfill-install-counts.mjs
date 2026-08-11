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

// Backfill the marketplace install counters from the pins (AGL-1419).
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-install-counts.mjs [--apply] [--json]
//
// DRY RUN BY DEFAULT. Without `--apply` it writes nothing and prints the exact
// field-level diff it would make. Verify with tools/scripts/audit-install-counters.mjs
// before and after.
//
// Why a script as well as the request path: `install-pin-counts.ts` heals a
// listing when somebody opens it, which is the right trade for a buyer-facing
// page but leaves an unvisited listing wrong indefinitely — and leaves the
// browse grid, which reads `marketplaceListings` directly, printing the old
// number until then. This walks every listing once.
//
// It deliberately does NOT use `collectionGroup('installs')`: it walks `orgs`
// and `hosts` directly, exactly like the audit script, so it runs whether or
// not the COLLECTION_GROUP index has been deployed yet. That matters — this is
// the thing you want to run BEFORE the index, to establish the floor.
//
// Ground truth exists for PLUGINS only. Every other artifact type installs by
// copying itself into the site and holds no pin, so for those this can only
// apply the same reconciliation the page applies (AGL-1418: take the larger of
// the two levels, since both only ever fail downwards) and says so per row.
//
// What it does NOT do, deliberately: invent an `activeInstalls` for the copied
// artifact routes that never increment one. Nothing decrements it either, and
// a number that only rises is worse than an absent one.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')
const asJson = process.argv.includes('--json')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

const firestore = getFirestore()
const count = (value) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/** Every live pin, by listing and by version. One pin is one install. */
async function livePins() {
  const byListing = new Map()
  for (const parent of ['orgs', 'hosts']) {
    const owners = await firestore.collection(parent).select().get()
    for (const owner of owners.docs) {
      const installs = await owner.ref.collection('installs').get()
      for (const pin of installs.docs) {
        const listingId = String(pin.get('listingId') ?? pin.id)
        const version = String(pin.get('version') ?? '')
        if (!byListing.has(listingId)) {
          byListing.set(listingId, { paths: [], byVersion: new Map() })
        }
        const entry = byListing.get(listingId)
        entry.paths.push(pin.ref.path)
        if (version) {
          entry.byVersion.set(version, (entry.byVersion.get(version) ?? 0) + 1)
        }
      }
    }
  }
  return byListing
}

const pinsByListing = await livePins()
const listings = await firestore.collection('marketplaceListings').get()

const rows = []
for (const listing of listings.docs) {
  const artifactType = String(
    listing.get('artifactType') ?? listing.get('type') ?? '',
  )
  const isPlugin = artifactType === 'plugin'
  const versionsSnapshot = await listing.ref
    .collection(isPlugin ? 'pluginVersions' : 'versions')
    .get()
  const versions = versionsSnapshot.docs.map((doc) => ({
    ref: doc.ref,
    id: String(doc.get('version') ?? doc.id),
    installCount: count(doc.get('installCount')),
    activeInstalls: count(doc.get('activeInstalls')),
  }))
  const pins = pinsByListing.get(listing.id) ?? { paths: [], byVersion: new Map() }
  const storedInstallCount = count(listing.get('installCount'))
  const storedActiveInstalls = count(listing.get('activeInstalls'))
  const versionActiveSum = versions.reduce((t, v) => t + v.activeInstalls, 0)
  const versionInstallSum = versions.reduce((t, v) => t + v.installCount, 0)

  // ── active ────────────────────────────────────────────────────────────
  // With pins, this is the quantity itself and is taken exactly — including
  // downwards, which is the only repair no accumulator could ever make.
  // Without them, AGL-1418's rule: the larger of two counters that both only
  // fail downwards.
  const nextActive = isPlugin
    ? pins.paths.length
    : Math.max(storedActiveInstalls, versionActiveSum)

  // ── all-time ──────────────────────────────────────────────────────────
  // Stays an accumulator: an uninstall deletes its pin and leaves nothing
  // behind, so the pins establish only the floor.
  const nextInstallCount = Math.max(
    storedInstallCount,
    versionInstallSum,
    nextActive,
  )

  // ── the per-version split ─────────────────────────────────────────────
  const versionPatches = []
  for (const version of versions) {
    const patch = {}
    if (isPlugin) {
      const live = pins.byVersion.get(version.id) ?? 0
      if (live !== version.activeInstalls) patch.activeInstalls = live
      // A pin that exists now proves an install landed on this version.
      if (live > version.installCount) patch.installCount = live
    } else if (versions.length === 1) {
      // The one provable attribution: with a single version there is nowhere
      // else an install can be (AGL-1418 `reconcileCounter`).
      if (nextActive !== version.activeInstalls) patch.activeInstalls = nextActive
      if (nextInstallCount > version.installCount) {
        patch.installCount = nextInstallCount
      }
    }
    if (Object.keys(patch).length) {
      versionPatches.push({ ref: version.ref, id: version.id, patch })
    }
  }

  const listingPatch = {}
  if (nextActive !== storedActiveInstalls) listingPatch.activeInstalls = nextActive
  if (nextInstallCount !== storedInstallCount) {
    listingPatch.installCount = nextInstallCount
  }
  if (isPlugin) {
    // Seed the request path's cache from a verified count, so the first buyer
    // to open the listing pays nothing and the browse grid is already right.
    listingPatch.pinnedActiveInstalls = nextActive
    listingPatch.pinnedVersionInstalls = Object.fromEntries(pins.byVersion)
    listingPatch.pinsVerifiedAtMs = Date.now()
  }

  // What the split still cannot account for after the repair. Reported rather
  // than absorbed: the all-time remainder is every install that landed before
  // per-version tracking existed (AGL-1036) and there is no way to know which
  // version took it, so spreading it would be invention. The page prints this
  // as `untrackedInstallCount` for exactly the same reason.
  const repairedVersionActive = versions.reduce(
    (total, version) =>
      total +
      (versionPatches.find((entry) => entry.id === version.id)?.patch
        .activeInstalls ?? version.activeInstalls),
    0,
  )
  const repairedVersionInstall = versions.reduce(
    (total, version) =>
      total +
      (versionPatches.find((entry) => entry.id === version.id)?.patch
        .installCount ?? version.installCount),
    0,
  )

  rows.push({
    listingId: listing.id,
    displayName: String(listing.get('displayName') ?? ''),
    artifactType,
    groundTruth: isPlugin ? 'pins' : 'reconciled (this type holds no pin)',
    untrackedAfter: {
      activeInstalls: Math.max(0, nextActive - repairedVersionActive),
      installCount: Math.max(0, nextInstallCount - repairedVersionInstall),
    },
    before: {
      activeInstalls: storedActiveInstalls,
      installCount: storedInstallCount,
      versionActiveSum,
      versionInstallSum,
    },
    livePins: isPlugin ? pins.paths.length : null,
    after: { activeInstalls: nextActive, installCount: nextInstallCount },
    listingPatch,
    versionPatches: versionPatches.map((entry) => ({
      version: entry.id,
      patch: entry.patch,
    })),
    _writes: { listingRef: listing.ref, listingPatch, versionPatches },
  })
}

const changing = rows.filter(
  (row) =>
    row.before.activeInstalls !== row.after.activeInstalls ||
    row.before.installCount !== row.after.installCount ||
    row.versionPatches.length,
)

if (apply) {
  for (const row of rows) {
    const batch = firestore.batch()
    if (Object.keys(row._writes.listingPatch).length) {
      batch.set(row._writes.listingRef, row._writes.listingPatch, { merge: true })
    }
    for (const entry of row._writes.versionPatches) {
      batch.set(entry.ref, entry.patch, { merge: true })
    }
    await batch.commit()
  }
}

const report = rows.map(({ _writes, ...row }) => row)
if (asJson) {
  console.log(
    JSON.stringify(
      { applied: apply, scanned: report.length, changing: changing.length, rows: report },
      null,
      2,
    ),
  )
} else {
  for (const row of report) {
    const moved =
      row.before.activeInstalls !== row.after.activeInstalls ||
      row.before.installCount !== row.after.installCount
    console.log(
      `${row.listingId} "${row.displayName}" [${row.artifactType}] — ${row.groundTruth}\n` +
        `  live pins ${row.livePins ?? 'n/a'}\n` +
        `  listing   active ${row.before.activeInstalls} -> ${row.after.activeInstalls}` +
        `   all-time ${row.before.installCount} -> ${row.after.installCount}` +
        (moved ? '   CHANGED' : '   (unchanged)') +
        (row.versionPatches.length
          ? '\n' +
            row.versionPatches
              .map(
                (entry) =>
                  `  version ${entry.version}  ${JSON.stringify(entry.patch)}`,
              )
              .join('\n')
          : '') +
        (row.untrackedAfter.activeInstalls || row.untrackedAfter.installCount
          ? `\n  STILL UNATTRIBUTED after repair: active ` +
            `${row.untrackedAfter.activeInstalls}, all-time ` +
            `${row.untrackedAfter.installCount} — no version can be proven to ` +
            `own these, so the page names the remainder instead of splitting it`
          : ''),
    )
  }
  console.log(
    `\n${changing.length}/${report.length} listings would change. ` +
      (apply ? 'APPLIED.' : 'Dry run — nothing was written. Re-run with --apply.'),
  )
}
