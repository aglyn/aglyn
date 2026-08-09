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
 * Let a LISTENER tell the app its reads are being refused (AGL-1066).
 *
 * `session-health` was built around one-shot reads, because that is where
 * AGL-1062 was first noticed. The console is listener-first, so the detector
 * was watching the read style the console barely uses: only four one-shot
 * call sites pass a collection label, one of them fires once per mount and
 * so can never recur inside the 60s window, and none of the pages carrying a
 * stale-write guard issues a labelled read at all. The verdict was
 * unreachable on the surfaces that needed it.
 *
 * Listeners are on every page, and they already know which collection they
 * are reading, so labelling is free rather than something a caller must
 * remember. This is the seam that lets them report without the library
 * importing the app: the console registers `reportDeniedRead` at startup and
 * the hooks call it through here. An unregistered reporter is a no-op, which
 * is what the tenant runtime wants — it has no client Firestore at all.
 *
 * ## Why this cannot fire offline
 *
 * Only `permission-denied` is ever reported. A client that has simply lost
 * the network gets no error callback at all — the listen sits there and the
 * cache keeps answering — and any one-shot it does make fails `unavailable`.
 * That is what keeps the whole mechanism from mistaking a tunnel for a dead
 * session, and it is why callers must NOT relax the code check.
 */

export interface FirestoreSessionReporters {
  /** A listen was refused past the budget; names the collection. */
  onDenied: (collection?: string) => void
  /**
   * A listen was answered BY THE SERVER.
   *
   * Reported as well as the denials, and it is what keeps this safe to turn
   * on. A scoped collaborator (AGL-1041) has collections they may not read
   * by design, and with listeners reporting they could otherwise accumulate
   * two denied collections and be told their session is dead. But their
   * other listens keep succeeding against the server, and one server answer
   * clears the evidence outright — a genuinely dead session has no such
   * answer to offer, so it is the discriminator the denial count alone
   * cannot be.
   *
   * A CACHED snapshot must never be passed here; it proves nothing.
   */
  onServerRead: () => void
}

let reporters: FirestoreSessionReporters | null = null

/**
 * Register the app's reporters. Called once, by the app that owns
 * `session-health`. Pass `null` to unregister (tests).
 */
export function setFirestoreSessionReporters(
  next: FirestoreSessionReporters | null,
): void {
  reporters = next
}

/** Report a refused listen. No-op when nothing is registered. */
export function reportFirestoreDenial(collection?: string): void {
  reporters?.onDenied(collection)
}

/** Report a listen the SERVER answered. No-op when nothing is registered. */
export function reportFirestoreServerRead(): void {
  reporters?.onServerRead()
}

/**
 * Consecutive refusals before a listener says anything.
 *
 * Matched to `firestore-one-shot-retry`'s budget so both read styles apply
 * the same bar: surviving this many means it is not the AGL-216/217
 * post-sign-in race, which resolves in well under two seconds.
 *
 * The streak this counts is NOT the hook's retry `attempt`. That one is
 * reset by any snapshot, including one served from cache, so under
 * `persistentLocalCache` it never reaches any threshold at all — see
 * `use-firestore-collection-cached-retry.spec.ts`. This one is reset only by
 * a snapshot the SERVER answered, which is the only evidence that actually
 * bears on whether the session can read.
 */
export const DENIAL_STREAK_TO_REPORT = 5

/**
 * The collection a listen was against, when it can be known from public API.
 *
 * `DocumentReference` exposes `parent`, and a `CollectionReference` exposes
 * `path`. A filtered `Query` exposes neither, and reaching into `_query` to
 * get one would be reading SDK internals — so those report `undefined` and
 * land in the shared `unknown` bucket. That can only ever fail to reach the
 * two-collection threshold, never trip it falsely, which is the right way
 * for this to degrade.
 */
export function denialLabelForQuery(target: unknown): string | undefined {
  const candidate = target as
    | { type?: string; path?: string; parent?: { path?: string } }
    | null
    | undefined
  if (!candidate) return undefined
  // A document listen: name the collection that holds it, not the document,
  // so two docs in one collection stay ONE piece of evidence.
  if (candidate.parent?.path) return candidate.parent.path
  if (candidate.type === 'collection' && candidate.path) return candidate.path
  return undefined
}
