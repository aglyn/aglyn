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
 *
 * The channel runs both ways: see {@link reportFirestoreSessionHeal} at the
 * bottom of this file for the return leg, which is how a refused listener
 * learns the session came back. It lives here rather than in a module of its
 * own because a heal is defined entirely in terms of the denial it reverses —
 * split them and someone broadcasts one without the other's rules.
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
 * The same seam in the other direction: the app telling refused listeners
 * that the session came back (AGL-1066).
 *
 * ## Why this has to exist
 *
 * A refused listen recovers today only because the retry loop never stops —
 * every reopen is another chance for the token to have attached. That is also
 * the single reason the AGL-664 in-place re-auth works at all: nothing else
 * re-subscribes. The hooks' effects depend on the query's identity
 * (`[ref.firestore, ref.path]` and each caller's `deps`), and a `stale`-reason
 * re-auth signs the same uid back in, so no dependency changes and no effect
 * re-runs. `AuthenticatedLayout` deliberately holds the tree MOUNTED while a
 * re-auth prompt is pending (AGL-664), which is what makes "resume exactly
 * where you were" true — and it is exactly why a remount cannot be relied on
 * to reopen anything.
 *
 * So any change that lets a refusal streak go terminal — the AGL-1066 item-3
 * flip — needs this channel first, or a user who re-authenticates
 * successfully sits in front of an errored console until they reload.
 *
 * ## What may broadcast, and what must not
 *
 * A heal is a RECOVERY FROM DENIAL, not any token event. Firebase refreshes
 * the ID token roughly hourly; broadcasting on that would reopen every
 * listener in the console on a timer for no reason. The console broadcasts
 * from one place — a session fault that has been resolved — see
 * `apps/console/utils/session-heal.ts`.
 *
 * Subscribers gate themselves as well: a listener the server is NOT refusing
 * ignores the broadcast entirely, so even a spurious heal costs nothing.
 * Nothing here clears `serverDenied` or `deniedStreak` — only a snapshot the
 * server answered is evidence, and that invariant does not bend for a
 * hopeful signal from the auth layer.
 */
const healListeners = new Set<() => void>()

/**
 * Listen for "the session may have recovered". Returns the unsubscribe.
 *
 * The callback runs synchronously inside {@link reportFirestoreSessionHeal},
 * so it must be cheap and must tolerate being called when there is nothing
 * to do.
 */
export function subscribeFirestoreSessionHeal(
  listener: () => void,
): () => void {
  healListeners.add(listener)
  return () => void healListeners.delete(listener)
}

/**
 * Tell every listener the session may have recovered.
 *
 * Iterates a COPY: a subscriber reopening its listen can unsubscribe (an
 * unmount racing the broadcast) and mutating the set mid-iteration would skip
 * the next one.
 */
export function reportFirestoreSessionHeal(): void {
  for (const listener of [...healListeners]) listener()
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
