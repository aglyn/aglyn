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
 * How much of a bulk move one request may attempt (AGL-1469).
 *
 * ## The ceiling was never a count
 *
 * Nineteen files were selected, MOVE TO FOLDER… was clicked, and the console
 * showed a red "Move failed" while **seven had already moved**. Batches of
 * seven or fewer had been succeeding. That reads like a batch-size limit, and
 * it is not one:
 *
 * - **Not the Firestore batch limit.** `move-assets` opens no batch at all —
 *   it writes each document with its own `set(…, { merge: true })`.
 * - **Not a declared cap.** `MAX_ASSETS_PER_OP` is 500 and the request cap was
 *   100. Nineteen reaches neither.
 *
 * What is left is **wall clock**. The loop is serial and every iteration is a
 * round trip to Cloud Storage: exists, copy, getMetadata, sometimes
 * setMetadata, delete — plus a copy AND a delete for every CDN variant. The
 * handler declared no `maxDuration`, so it ran at the platform default and was
 * cut off mid-loop by the platform rather than stopping itself. That is also
 * why the snackbar read exactly `Move failed`: the client's own fallback
 * string, which only renders when the response body will not parse as JSON —
 * a gateway timeout, not an answer from this handler.
 *
 * ## Which is why the number cannot be inherited
 *
 * The seven was measured on 2026-08-13, on a library where **no asset had a
 * single variant** (AGL-1468 — 0 of 174). The back-fill has since given 109
 * assets their variants back, up to three each, so a move now performs up to
 * six more object operations per asset than when that seven was observed. Any
 * fixed number would already be wrong, and would go wrong again the next time
 * variant widths, object sizes or region latency change.
 *
 * So the bound is a **time budget** and the request is **resumable**: it moves
 * assets until the budget is spent, then hands back everything it did not
 * touch and lets the client ask again. This is the shape `selectCronChunk`
 * uses for the sweep crons, for the same reason stated there — raising
 * `maxDuration` buys headroom, it does not make an unbounded loop finishable.
 */

/**
 * Wall-clock a single request will spend moving before it yields.
 *
 * Well inside the route's `maxDuration` on purpose: the budget is checked
 * BETWEEN assets, so the request still has to finish whichever asset it has
 * started, and a large object with three variants is not instant. The gap
 * between the two is that headroom.
 */
export const MOVE_BUDGET_MS = 20_000

/**
 * Ceiling on assets per request regardless of the clock, so one call cannot
 * hold a connection open indefinitely against a library of small metadata-only
 * documents that each cost nothing.
 */
export const MOVE_MAX_ASSETS_PER_REQUEST = 100

export interface MoveAssetsOptions {
  /** Everything the caller still wants moved, in the order it wants them. */
  mediaIds: readonly string[]
  /** Moves one asset. Rejecting marks that asset failed; it does not stop. */
  moveOne: (mediaId: string) => Promise<void>
  /** Injected for tests; `Date.now` in the route. */
  now?: () => number
  budgetMs?: number
  maxAssets?: number
  /** Called with the id and reason, for the server log. */
  onFailure?: (mediaId: string, error: unknown) => void
}

export interface MoveAssetsResult {
  /** Relocated by THIS request. */
  movedIds: string[]
  /** Attempted and refused. A retry may or may not help; the caller says so. */
  failedIds: string[]
  /** Never attempted — the budget ran out first. Ask again with these. */
  remainingIds: string[]
  /** Nothing is left to attempt. */
  done: boolean
}

/**
 * Move as many assets as the budget allows, and account for every id.
 *
 * Three properties, each of which was missing and each of which cost
 * something:
 *
 * 1. **A failed asset does not end the request.** The old loop had no
 *    try/catch, so one rejected copy threw out of the handler and discarded
 *    the count of everything already moved — the delete path's shape before
 *    AGL-1461, one verb along.
 * 2. **Every id comes back in exactly one bucket.** `moved + failed +
 *    remaining === mediaIds`. That is what lets the snackbar say "7 of 19"
 *    and mean it, and what lets the client leave the other twelve selected so
 *    a retry is correct by construction rather than by the author
 *    reconstructing the boundary from folder counts afterwards.
 * 3. **At least one asset is always attempted.** A request that yields having
 *    done nothing turns the client's resume loop into an infinite one, so the
 *    budget is only consulted from the second asset onward.
 */
export async function moveAssetsWithinBudget(
  options: MoveAssetsOptions,
): Promise<MoveAssetsResult> {
  const {
    mediaIds,
    moveOne,
    now = Date.now,
    budgetMs = MOVE_BUDGET_MS,
    maxAssets = MOVE_MAX_ASSETS_PER_REQUEST,
    onFailure,
  } = options
  const startedAt = now()
  const movedIds: string[] = []
  const failedIds: string[] = []
  let index = 0
  for (; index < mediaIds.length; index += 1) {
    const attempted = movedIds.length + failedIds.length
    // Never on the first asset — see property 3.
    if (attempted > 0 && (attempted >= maxAssets || now() - startedAt >= budgetMs)) {
      break
    }
    const mediaId = mediaIds[index]
    try {
      await moveOne(mediaId)
      movedIds.push(mediaId)
    } catch (error) {
      onFailure?.(mediaId, error)
      failedIds.push(mediaId)
    }
  }
  const remainingIds = [...mediaIds.slice(index)]
  return {
    movedIds,
    failedIds,
    remainingIds,
    // `done` describes what is left to ATTEMPT, not what succeeded: a failed
    // asset has had its turn, and the caller decides whether to offer a retry.
    done: remainingIds.length === 0,
  }
}
