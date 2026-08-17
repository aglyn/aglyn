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
 * `updateExisting(ref, data)` — write to a document that must ALREADY exist,
 * and say plainly whether it did (AGL-1763).
 *
 * `set(ref, data, { merge: true })` reads as "update if present" and means
 * "create if absent". When the document id came from a caller, a webhook, or a
 * cached list, that gap mints a phantom: a real document holding only the
 * fields of this one patch, which then satisfies every query that filters on
 * them and nothing else. AGL-1755 (a stub booking), AGL-1760 (a stub
 * reservation) and AGL-1763's `orgs/{orgId}` finding are all the same shape.
 *
 * The codebase already carried the correct idiom and even documented the
 * hazard — `apps/tenant/app/api/analytics/collect/route.ts:101`:
 *
 *   "update(), not set(): beacons from stale cached pages must not resurrect a
 *   deleted overlay as a stats-only stray doc."
 *
 * `update()` IS the existence check: atomic, no second read, and it rejects on
 * a missing document. AGL-1763 measured a lint rule for this and rejected it
 * (14% precision, 57% recall — "this document must already exist" is a
 * property of the caller's intent, not of the syntax). A named call is the
 * remedy instead: it makes the intent explicit and greppable at the site.
 *
 * WHAT THIS ADDS OVER A BARE `.update()`. The tempting shorthand,
 * `ref.update(data).catch(() => false)`, is wrong in a way that is invisible
 * until it matters: it reports "the document was absent" for a permission
 * denial, an App Check rejection, a transport failure, and — the trap that
 * actually bites here — an `INVALID_ARGUMENT` from a delete sentinel below the
 * top level, which `set({ merge: true })` accepts at any depth but `update()`
 * accepts only at the root (`@google-cloud/firestore` serializer,
 * `allowDeletes: 'root'`). Only gRPC `NOT_FOUND` means absent. Everything else
 * rethrows, so a caller that maps `false` onto a 404 cannot turn an outage
 * into a confident lie about the data.
 *
 * WHAT IT DOES NOT DECIDE. Refusing is not automatically right — AGL-1760's
 * lesson is that a refusal must not discard money or work that already
 * happened. The caller still chooses between refusing, refusing-and-recording,
 * and creating deliberately with every required field. This only makes the
 * question unavoidable by handing back the answer.
 */

/** gRPC `Status.NOT_FOUND`. Firestore's "no entity to update" surfaces here. */
const GRPC_NOT_FOUND = 5

/**
 * The slice of `DocumentReference` this needs. Typed structurally so a caller
 * holding a `DocumentReference<T>` from any of the SDK's generic positions
 * passes without a cast, and so specs can drive it with an in-memory double.
 */
export interface UpdatableDocumentRef {
  update(data: Record<string, unknown>): Promise<unknown>
  readonly path?: string
}

/**
 * Applies `data` to `ref` only if the document exists.
 *
 * @returns `true` when the update landed, `false` when the document was
 *   absent. Any other failure rethrows.
 */
export async function updateExisting(
  ref: UpdatableDocumentRef,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    await ref.update(data)
    return true
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === GRPC_NOT_FOUND) {
      return false
    }
    throw error
  }
}
