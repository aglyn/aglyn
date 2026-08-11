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
import type { LivePinTally } from './version-stats'

/**
 * Install counts derived from the pins, which are the only ground truth
 * (AGL-1419).
 *
 * AGL-1418 made the page internally consistent and said so honestly: the
 * stored numbers were still wrong, because both stored levels are
 * accumulators and an accumulator can only fail downwards from a missed
 * increment — or upwards forever from a pin that disappeared without one. Six
 * of eight production listings disagreed with their real pin counts;
 * `z6glT_UDAQ` advertised `3 active` against two live pins, and nothing in the
 * product could ever have noticed.
 *
 * Nothing decrements when a pin dies out of band, and there are three ways for
 * that to happen: `recursiveDelete` on a tenant erase (`erase.ts` never names
 * `installs`, it just sweeps the subtree), the console's client-side host-pin
 * delete in the promote-to-org flow, and any cascade. So the derived count is
 * not a nicety — it is the only thing that can bring a count back DOWN.
 *
 * ## Why a collection group here, when three other places refuse one
 *
 * `reviews.ts` and `listing-content.component.tsx` both avoid
 * `collectionGroup('installs')`, and both are right to: they ask "which of MY
 * org's sites has this pinned", and a cross-tenant scan to answer a
 * single-org question is unbounded work plus pins the caller must never see.
 *
 * This asks the opposite question — "how many pins exist anywhere" — which is
 * cross-tenant by definition, and answers it with `count()`, which returns an
 * integer and never a document. No pin, no path, no tenant identity leaves
 * this function. It runs in the Admin SDK on a server route, so it is not a
 * rules question either.
 *
 * ## Cost
 *
 * Firestore bills an aggregation at roughly one document read per 1000 index
 * entries scanned, not one per document, so a listing with 500 installs costs
 * ~1 read rather than 500. That is the single biggest lever here, and it is
 * why counting pins on a buyer-facing page is affordable at all.
 *
 * On top of it, `verifiedLivePins` only issues the aggregation when the stored
 * copy is stale, and writes the answer back — so the ordinary request pays
 * ZERO extra reads and serves a number that was derived from the pins.
 */

/** How long a derived count stays good without re-deriving it. */
export const PIN_VERIFY_TTL_MS = 15 * 60 * 1000

/**
 * How long one process stops re-issuing an aggregation that failed.
 *
 * In-process on purpose. It exists to stop an error storm when the index is
 * missing, not to remember anything — a cold instance SHOULD try again and log
 * again, because the message names the index and is how anyone finds out.
 */
export const PIN_COUNT_BACKOFF_MS = 5 * 60 * 1000

/** The listing fields this module maintains, on top of the two counters. */
export interface PinVerificationFields {
  /**
   * The last count derived from the pins. Kept beside `activeInstalls` rather
   * than instead of it so an accumulator write by an install or uninstall
   * route makes the pair disagree, which is what marks the cache stale — the
   * write paths invalidate this without knowing it exists.
   */
  pinnedActiveInstalls?: number | null
  /** The derived per-version split, so a cache hit serves the same breakdown. */
  pinnedVersionInstalls?: Record<string, number> | null
  pinsVerifiedAtMs?: number | null
}

interface CountableFirestore {
  collectionGroup: (id: string) => {
    where: (
      field: string,
      op: '==',
      value: unknown,
    ) => {
      where: (
        field: string,
        op: '==',
        value: unknown,
      ) => { count: () => { get: () => Promise<{ data: () => { count?: unknown } }> } }
      count: () => { get: () => Promise<{ data: () => { count?: unknown } }> }
    }
  }
}

/** Retried aggregations are pointless while the index is still missing. */
const failedUntilMs = new Map<string, number>()
/** One aggregation per listing per process, however many requests arrive. */
const inFlight = new Map<string, Promise<LivePinTally | null>>()

/** Exported for tests: a module-level cache outlives a `jest` test otherwise. */
export function resetPinCountBackoff(): void {
  failedUntilMs.clear()
  inFlight.clear()
}

const isMissingIndex = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code
  const message = String((error as { message?: unknown })?.message ?? '')
  return (
    code === 9 ||
    code === 'failed-precondition' ||
    /FAILED_PRECONDITION|requires an index|requires a COLLECTION_GROUP/i.test(
      message,
    )
  )
}

/**
 * Turns a failed aggregation into `null`, LOUDLY — and never into `0`.
 *
 * This is the whole safety property of the module. A missing composite index
 * surfaces as `FAILED_PRECONDITION`, which every other counter path in this
 * codebase swallows with `.catch(() => undefined)`; swallowed to a zero here
 * it would write "no installs" over every listing on the platform in a single
 * TTL window, and the write-back would make it durable. So the failure value
 * is a distinct one that means "not counted" and that no caller can mistake
 * for a count.
 */
function reportUncountable(listingId: string, what: string, error: unknown): null {
  if (isMissingIndex(error)) {
    console.error(
      `[marketplace] install pin ${what} for ${listingId} could not run: ` +
        'the Firestore index is MISSING. Install counts are falling back to ' +
        'the stored accumulators, which drift. Deploy the `installs` entries ' +
        'in cloud/firebase-firestore.indexes.json ' +
        '(firebase deploy --only firestore:indexes --config cloud/firebase.json). ' +
        String((error as { message?: unknown })?.message ?? error),
    )
  } else {
    console.error(
      `[marketplace] install pin ${what} for ${listingId} failed`,
      error,
    )
  }
  return null
}

/**
 * Live pins for one listing, or `null` when the count could not be taken.
 *
 * Needs a `COLLECTION_GROUP_ASC` single-field index on `installs.listingId`
 * (a `fieldOverrides` entry — Firestore auto-creates single-field indexes at
 * COLLECTION scope only, never at COLLECTION_GROUP scope).
 */
export async function countLivePins(
  firestore: CountableFirestore,
  listingId: string,
): Promise<number | null> {
  try {
    const snapshot = await firestore
      .collectionGroup('installs')
      .where('listingId', '==', listingId)
      .count()
      .get()
    const count = Number(snapshot.data()?.count ?? Number.NaN)
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null
  } catch (error) {
    return reportUncountable(listingId, 'count', error)
  }
}

/**
 * Live pins per version, or `null` when the split could not be taken.
 *
 * One aggregation per version, which is bounded by the caller's `limit(20)` on
 * the version history — and paid once per TTL window, not once per request.
 * A composite `listingId ASC, version ASC` collection-group index covers it.
 *
 * `null` and "every version zero" are different answers and the caller treats
 * them differently, so a single failing member fails the whole split rather
 * than reporting a hole as a zero.
 */
export async function countLivePinsByVersion(
  firestore: CountableFirestore,
  listingId: string,
  versionIds: string[],
): Promise<Map<string, number> | null> {
  const wanted = [...new Set(versionIds.filter(Boolean))]
  if (!wanted.length) return new Map()
  try {
    const counts = await Promise.all(
      wanted.map(async (version) => {
        const snapshot = await firestore
          .collectionGroup('installs')
          .where('listingId', '==', listingId)
          .where('version', '==', version)
          .count()
          .get()
        const count = Number(snapshot.data()?.count ?? Number.NaN)
        if (!Number.isFinite(count) || count < 0) throw new Error('bad count')
        return [version, Math.floor(count)] as const
      }),
    )
    return new Map(counts)
  } catch (error) {
    return reportUncountable(listingId, 'per-version count', error)
  }
}

export interface VerifyLivePinsInput {
  firestore: CountableFirestore
  listingRef: {
    update: (
      data: Record<string, unknown>,
      precondition?: { lastUpdateTime?: unknown },
    ) => Promise<unknown>
  }
  listingId: string
  /** The listing document as already read by the route. Never re-read here. */
  listing: Record<string, unknown> | undefined | null
  artifactType: MarketplaceArtifactType | string | null | undefined
  /** Version ids in the history, for the per-version split. */
  versionIds?: string[]
  /**
   * `snapshot.updateTime`, so the write-back cannot clobber an install that
   * landed between the read and the write. Omit to write unconditionally.
   */
  updateTime?: unknown
  nowMs?: number
}

/**
 * The count the page should print, derived from pins and cached in the listing.
 *
 * Returns `null` when there is no verified answer — a copied artifact, a stale
 * cache the aggregation could not refresh, or a listing whose index is not
 * deployed yet. `null` means "fall back to the stored accumulators", which is
 * exactly AGL-1418's behaviour, so a missing index degrades to the previous
 * release rather than to zeros.
 *
 * Read cost per request:
 *
 * * **Copied artifact** — 0. They install by copying and hold no pin, so a
 *   derived count would be a derived zero over a real number.
 * * **Cache hit** — 0. The listing document was already read by the route.
 * * **Cache miss** — 1 aggregation (~1 read per 1000 pins), plus one more per
 *   version only when the listing has more than one version, plus 1 write.
 *
 * The cache goes stale two ways. The TTL covers silent drift — a pin swept by
 * a tenant erase, which decrements nothing. The `pinnedActiveInstalls`
 * comparison covers real installs: every install and uninstall route moves
 * `activeInstalls`, which breaks the pair immediately, so a genuine install
 * shows on the next request instead of up to `PIN_VERIFY_TTL_MS` later. No
 * install route had to learn about any of this.
 */
export async function verifiedLivePins(
  input: VerifyLivePinsInput,
): Promise<LivePinTally | null> {
  // Only plugins hold a pin. Every other artifact type installs by copying
  // itself into the site, so `collectionGroup('installs')` finds nothing for
  // it — and a derived 0 written back over a real `activeInstalls` would be
  // this fix causing the exact class of damage it exists to repair.
  if (input.artifactType !== 'plugin') return null
  const listingId = String(input.listingId ?? '')
  if (!listingId) return null

  const nowMs = input.nowMs ?? Date.now()
  const listing = input.listing ?? {}
  const storedActive = Number(listing['activeInstalls'] ?? 0)
  const pinnedActive = listing['pinnedActiveInstalls']
  const verifiedAtMs = Number(listing['pinsVerifiedAtMs'] ?? 0)
  const fresh =
    typeof pinnedActive === 'number' &&
    Number.isFinite(pinnedActive) &&
    pinnedActive === storedActive &&
    nowMs - verifiedAtMs < PIN_VERIFY_TTL_MS &&
    nowMs >= verifiedAtMs
  if (fresh) {
    const split = listing['pinnedVersionInstalls']
    return {
      activeInstalls: pinnedActive,
      byVersion:
        split && typeof split === 'object'
          ? new Map(
              Object.entries(split as Record<string, unknown>).map(
                ([version, value]) => [version, Number(value ?? 0)],
              ),
            )
          : null,
    }
  }

  const blockedUntil = failedUntilMs.get(listingId) ?? 0
  if (nowMs < blockedUntil) return null

  const pending = inFlight.get(listingId)
  if (pending) return pending
  const work = (async (): Promise<LivePinTally | null> => {
    const total = await countLivePins(input.firestore, listingId)
    if (total == null) {
      failedUntilMs.set(listingId, nowMs + PIN_COUNT_BACKOFF_MS)
      return null
    }
    failedUntilMs.delete(listingId)
    // One version needs no split: everything live is on it, which
    // `reconcileInstallTallies` already proves rather than guesses. Skipping
    // the query is the difference between 1 aggregation and 2 for the shape
    // most listings actually have.
    const versionIds = input.versionIds ?? []
    const byVersion =
      versionIds.length > 1
        ? await countLivePinsByVersion(input.firestore, listingId, versionIds)
        : null

    // Write the derived value back over the accumulator, which is what turns
    // the stored counter into a self-healing cache instead of an independent
    // number that only ever drifts further. Never on the critical path: a
    // count that cannot be written must not fail the page.
    //
    // `lastUpdateTime` is the guard against the one race that matters — an
    // install landing between the aggregation and this write, whose
    // `increment()` an absolute value would erase. The precondition fails the
    // write instead, and the next request re-derives.
    const patch: Record<string, unknown> = {
      activeInstalls: total,
      pinnedActiveInstalls: total,
      pinsVerifiedAtMs: nowMs,
    }
    // All-time can never be below live: a pin that exists now is an install
    // that landed. It stays an accumulator otherwise — an uninstall leaves no
    // trace, so the pins cannot tell us how many there have ever been.
    if (Number(listing['installCount'] ?? 0) < total) patch['installCount'] = total
    if (byVersion) {
      patch['pinnedVersionInstalls'] = Object.fromEntries(byVersion)
    }
    await input.listingRef
      .update(
        patch,
        input.updateTime ? { lastUpdateTime: input.updateTime } : undefined,
      )
      .catch(() => undefined)
    return { activeInstalls: total, byVersion }
  })()
  inFlight.set(listingId, work)
  try {
    return await work
  } finally {
    inFlight.delete(listingId)
  }
}
