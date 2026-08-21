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

import type { MarketplaceArtifactType } from '../model/marketplace'

/**
 * Per-version install counters (AGL-1036).
 *
 * The listing already carries `installCount` (cumulative) and `activeInstalls`
 * (live pins), but neither answers the question a publisher asks before
 * changing anything: **who is still on the old version?** A listing-level
 * number cannot, and a re-pin does not even move it — the pin already existed,
 * so nothing increments while the install quietly changes version underneath.
 *
 * This module is the one writer of the per-version pair, deliberately: the
 * listing-level counters drifted apart precisely because five install routes
 * each incremented their own, and the per-version pair has twice the surface —
 * every version change is TWO writes, a decrement of what was left and an
 * increment of what was taken.
 */

/**
 * Where a version's counters live, which differs by artifact type.
 *
 * Plugins keep their versions in `pluginVersions` (publish internals, review
 * state, bundle pointers); everything else keeps content snapshots in
 * `versions`. Both are server-only, which is why the counters are read back
 * out through the listing-versions route rather than by the client.
 */
export function versionCollectionFor(
  artifactType: MarketplaceArtifactType | string | null | undefined,
): 'pluginVersions' | 'versions' {
  return artifactType === 'plugin' ? 'pluginVersions' : 'versions'
}

/** One version's pair of counters, as the version doc stores them. */
export interface VersionInstallTally {
  version: string
  installCount: number
  activeInstalls: number
}

/** The listing-level pair, which counts the same two things (AGL-1418). */
export interface ListingInstallTally {
  installCount?: number | null
  activeInstalls?: number | null
}

/**
 * The same quantity counted from the pins, which are ground truth (AGL-1419).
 *
 * Both stored levels are accumulators, and an accumulator cannot come back
 * down: nothing decrements when a tenant erase sweeps `installs` or the
 * console deletes a host pin client-side. The pins can, because they ARE the
 * installs — so when this is present it does not get reconciled against
 * anything, it simply wins.
 */
export interface LivePinTally {
  /** Live pins for the listing. A verified `0` is a count, not a gap. */
  activeInstalls: number
  /** Live pins per version id, when the split was derived too. */
  byVersion?: Map<string, number> | Record<string, number> | null
}

export interface ReconciledInstallTallies {
  /** Per-version counters, reconciled against the listing totals. */
  versions: VersionInstallTally[]
  /** The totals the page should print, and that the versions sum to. */
  installCount: number
  activeInstalls: number
  /**
   * Installs the totals include but no version claims. Non-zero means the
   * per-version split is INCOMPLETE, and a caller must say so rather than
   * print a breakdown that does not add up.
   */
  untrackedInstallCount: number
  untrackedActiveInstalls: number
}

const asCount = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/**
 * Reconciles one counter across the two levels that both claim to hold it.
 *
 * The listing total is not authoritative and neither is the per-version sum —
 * each has a failure mode the other does not (see `reconcileInstallTallies`).
 * So the total is the larger of the two, and the shortfall is either
 * attributed or NAMED, never silently absorbed.
 */
function reconcileCounter(
  tracked: number[],
  stored: number,
): { values: number[]; total: number; untracked: number } {
  const sum = tracked.reduce((running, value) => running + value, 0)
  const total = Math.max(sum, stored)
  const values = [...tracked]
  let untracked = total - sum
  // The ONE case where attribution is provable rather than guessed: with a
  // single version there is nowhere else an install could be. Every other
  // shape keeps the remainder as a remainder — a split that reads as fact and
  // is actually a guess is the defect this function exists to remove.
  if (untracked > 0 && values.length === 1) {
    values[0] += untracked
    untracked = 0
  }
  return { values, total, untracked }
}

/**
 * Makes the listing-level and per-version counters agree (AGL-1418).
 *
 * The marketplace keeps the same two quantities twice: once on the listing and
 * once per version. They are written by different code under different trigger
 * conditions, each swallowing its own failures, and nothing ever checked that
 * they agree — so the listing page printed `7 installs · 2 active` beside
 * `3 installs · 1 on this version` for a listing with ONE version and two live
 * pins. Three numbers, one quantity, and a publisher with no way to tell which
 * to believe.
 *
 * Neither level is trustworthy on its own:
 *
 * * The per-version pair only exists from AGL-1036 onwards and was never
 *   backfilled, so it under-counts every listing older than that.
 * * The listing-level pair is not incremented at all by the copied-artifact
 *   install routes, so it under-counts every component, theme, layout, email
 *   template and dataset schema.
 *
 * Both fail in the same direction — downwards — which is why the total is the
 * larger of the two rather than an average or a preference.
 *
 * `activeInstalls` is clamped to `installCount` at both levels. That is not a
 * guess: every writer increments the pair together, so "more live than ever
 * landed" is unrepresentable in a healthy database and printing it would
 * advertise the corruption rather than the count.
 *
 * Pure, and deliberately: it decides what to SAY, and the caller decides
 * whether to repair anything.
 *
 * ## When the pins are in hand (AGL-1419)
 *
 * Pass `pins` and the reasoning above stops applying to `activeInstalls`,
 * because it only existed to pick between two unreliable readings. The pin
 * count is the quantity itself, so it is taken exactly — including DOWNWARDS,
 * which no amount of reconciling between two accumulators could ever do, and
 * which is the whole reason `z6glT_UDAQ` advertised three active installs
 * against two live pins.
 *
 * The clamp flips direction with it. Without pins, `activeInstalls` is capped
 * at `installCount`, because "more live than ever landed" means one of the two
 * is corrupt and the all-time figure is the more believable. With pins it is
 * `installCount` that gets raised: a pin that exists now is an install that
 * landed, so an all-time counter below the live one is simply behind.
 */
export function reconcileInstallTallies(
  versions: VersionInstallTally[],
  listing: ListingInstallTally,
  pins?: LivePinTally | null,
): ReconciledInstallTallies {
  const trackedInstalls = versions.map((entry) => asCount(entry.installCount))
  const trackedActive = versions.map((entry) => asCount(entry.activeInstalls))

  const verified = pins ? asCount(pins.activeInstalls) : null
  const activeTotalRaw = verified ?? 0
  const active =
    verified == null
      ? reconcileCounter(trackedActive, asCount(listing?.activeInstalls))
      : splitVerifiedActive(versions, trackedActive, activeTotalRaw, pins?.byVersion)

  // All-time stays an accumulator even with pins in hand: an uninstall deletes
  // its pin and leaves nothing behind, so the pins cannot say how many
  // installs there have EVER been. They can only say the floor.
  const installs = reconcileCounter(
    trackedInstalls,
    Math.max(asCount(listing?.installCount), verified ?? 0),
  )

  let installValues = installs.values
  let installTotal = installs.total
  let activeValues = active.values
  let activeTotal = verified ?? active.total
  if (verified == null) {
    activeValues = active.values.map((value, index) =>
      Math.min(value, installs.values[index] ?? 0),
    )
    activeTotal = Math.min(active.total, installs.total)
  } else {
    installValues = installs.values.map((value, index) =>
      Math.max(value, activeValues[index] ?? 0),
    )
    installTotal = Math.max(
      installs.total,
      installValues.reduce((running, value) => running + value, 0),
    )
  }
  const activeSum = activeValues.reduce((running, value) => running + value, 0)
  const installSum = installValues.reduce((running, value) => running + value, 0)
  return {
    versions: versions.map((entry, index) => ({
      ...entry,
      installCount: installValues[index] ?? 0,
      activeInstalls: activeValues[index] ?? 0,
    })),
    installCount: installTotal,
    activeInstalls: activeTotal,
    untrackedInstallCount: Math.max(0, installTotal - installSum),
    untrackedActiveInstalls: Math.max(0, activeTotal - activeSum),
  }
}

/**
 * Splits a verified pin count across the versions (AGL-1419).
 *
 * Three cases, in descending order of how much is known:
 *
 * 1. A per-version pin count was taken too — use it, and let the remainder
 *    stand for pins on versions this history does not show (deleted, or past
 *    the 20 the route reads).
 * 2. One version — everything live is on it. Provable, not guessed.
 * 3. Neither — keep the stored per-version actives but let no prefix of them
 *    exceed the verified total, and name whatever is left. Trimming rather
 *    than scaling because a stored count that fits is still evidence, and a
 *    fabricated fraction of one is not.
 */
function splitVerifiedActive(
  versions: VersionInstallTally[],
  tracked: number[],
  total: number,
  byVersion: LivePinTally['byVersion'],
): { values: number[]; total: number; untracked: number } {
  const lookup =
    byVersion instanceof Map
      ? byVersion
      : byVersion
        ? new Map(Object.entries(byVersion).map(([k, v]) => [k, asCount(v)]))
        : null
  if (lookup) {
    const values = versions.map((entry) => asCount(lookup.get(entry.version)))
    const sum = values.reduce((running, value) => running + value, 0)
    return { values, total, untracked: Math.max(0, total - sum) }
  }
  if (versions.length === 1) return { values: [total], total, untracked: 0 }
  let remaining = total
  const values = tracked.map((value) => {
    const taken = Math.min(value, remaining)
    remaining -= taken
    return taken
  })
  return { values, total, untracked: remaining }
}

export interface VersionMoveInput {
  firestore: FirebaseFirestore.Firestore
  listingRef: FirebaseFirestore.DocumentReference
  artifactType: MarketplaceArtifactType | string | null | undefined
  /** The version this install was on, if any. Null for a first install. */
  from?: string | number | null
  /** The version it is on now. Null for an uninstall. */
  to?: string | number | null
}

const asId = (value: string | number | null | undefined): string | null =>
  value == null || value === '' ? null : String(value)

/**
 * Moves one install from one version's tally to another's.
 *
 * Rules, all of which exist because a wrong count is worse than no count:
 *
 * * `activeInstalls` is clamped at zero, so a repeat uninstall — which the
 *   plugin route already tolerates at listing level — cannot go negative.
 * * `installCount` only rises, and only on the version being taken: it records
 *   that an install once landed there, which stays true after they leave.
 * * A version whose document is gone is skipped rather than created. Writing
 *   `increment()` blind would resurrect a deleted version as a counters-only
 *   stub, and in `pluginVersions` that stub would surface through
 *   `newestApprovedVersion` as a version with no publish date and no review.
 * * `from === to` is a no-op. Re-installing the same version is not a new
 *   install of it, and counting it would inflate every re-install.
 * * **A move CONSERVES (AGL-1420).** When a `from` version is named, the
 *   arrival on `to` is recorded only if the departure from `from` actually
 *   landed. See below — this is the rule that stops a restored install
 *   minting a real one.
 *
 * Never on the critical path: a counter that cannot be written must not fail
 * an install the user asked for.
 *
 * ## Why a move has to conserve
 *
 * The two halves used to be independent writes, either of which could
 * silently no-op while the other landed — and both no-op paths are on the
 * `from` half, so the error was one-directional: **net +1, every time.**
 *
 * * `if (!snapshot.exists) return` skipped a `from` version whose document
 *   had been deleted, and the `to` increment still landed.
 * * `Math.max(0, active - 1)` swallowed a decrement against a version whose
 *   tally was already zero, and the `to` increment still landed.
 *
 * A `from` that cannot be decremented is not a bookkeeping inconvenience; it
 * is evidence that **this copy was never in the tracked population**. The
 * case that produces it in the wild is a site restore: `IMPORTABLE_FIELDS`
 * deliberately carries `marketplace` / `installedFrom` / `source` through
 * `POST /api/hosts/import` (site-export-round-trip.spec.ts asserts it, and it
 * is what keeps update-available detection working on a legitimate backup),
 * so a restored component or dataset arrives fully stamped with provenance
 * having never run an install route. No `installCount` increment, no pin,
 * nothing counted. The first time the publisher ships an update and someone
 * presses Update, `update-artifact` reads that stamp and calls this function
 * with a `from` nothing ever credited.
 *
 * That phantom then propagates rather than staying local: `reconcileCounter`
 * takes `max(versionSum, stored)` — because every accumulator in this system
 * fails DOWNWARD and the larger is therefore the better estimate — so an
 * inflated per-version tally raises the listing total the page prints to
 * buyers. Nothing can pull it back down again except a pin count, and
 * `verifiedLivePins` returns `null` for everything that is not a plugin,
 * which is exactly the set the import can restore. Over-counts are permanent;
 * under-counts are representable (`untracked`) and recoverable.
 *
 * So the bias goes the way the rest of the arithmetic already goes. The cost
 * is a real install whose `from` version document the publisher has since
 * deleted: its arrival is not credited to `to`. That install is still counted
 * at listing level, so `max(versionSum, stored)` keeps the total right and
 * the per-version breakdown reports it as `untracked` — the shape this module
 * already has for "we know it happened, we cannot say where".
 *
 * A first install (`from` null) is unaffected: there is nothing to conserve,
 * and `to` is credited exactly as before.
 */
export async function recordVersionMove(input: VersionMoveInput): Promise<void> {
  const from = asId(input.from)
  const to = asId(input.to)
  if (from === to) return
  const collection = input.listingRef.collection(
    versionCollectionFor(input.artifactType),
  )
  /** Resolves true only if the counter was actually moved. */
  const bump = async (
    versionId: string,
    activeDelta: 1 | -1,
  ): Promise<boolean> => {
    const ref = collection.doc(versionId)
    return await input.firestore
      .runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        // A version whose document is gone is skipped rather than created:
        // writing blind would resurrect it as a counters-only stub.
        if (!snapshot.exists) return false
        const active = Number(snapshot.get('activeInstalls') ?? 0)
        // Nothing to take off this version. Clamping and reporting success
        // is what let a phantom departure fund a real arrival.
        if (activeDelta < 0 && active <= 0) return false
        tx.update(ref, {
          activeInstalls: Math.max(0, active + activeDelta),
          ...(activeDelta > 0
            ? { installCount: Number(snapshot.get('installCount') ?? 0) + 1 }
            : {}),
        })
        return true
      })
      .catch(() => false)
  }
  if (from) {
    const departed = await bump(from, -1)
    // The move did not come from where it claims to have come from, so there
    // is no install here to move. Crediting `to` would invent one.
    if (!departed) return
  }
  if (to) await bump(to, 1)
}
