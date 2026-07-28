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
 * Is this session still able to read from the server? (AGL-1063)
 *
 * A module-level store rather than context, because the thing that knows —
 * `firestore-one-shot-retry` — is a plain async helper called from effects,
 * not a component. Subscribers (the shell banner) get the derived verdict.
 *
 * ## The distinction this exists to draw
 *
 * `permission-denied` is treated as transient everywhere, and correctly so:
 * AGL-216/217 established a real race where `useUser()` reports a signed-in
 * user a beat before Firestore attaches the ID token. A denial that will
 * NEVER clear looks identical from the inside. AGL-1062 was that case — a
 * stale session denied every server read for hours while
 * `persistentLocalCache` kept listeners rendering, and nothing anywhere said
 * so.
 *
 * ## Why one denial is not enough
 *
 * Surviving all five retries already means "not the sign-in race". It does
 * NOT mean "session". A scoped collaborator reading something AGL-1041
 * deliberately hides gets exactly this shape, forever, by design — and
 * prompting them to re-authenticate mid-edit would be worse than the silent
 * degradation this replaces. What a scoped collaborator does NOT produce is
 * denials across unrelated collections: their `visibleTo` filter is per
 * collection, and the collections they may read keep working. A session that
 * is dead denies everything.
 *
 * So the verdict needs {@link SESSION_STALE_MIN_COLLECTIONS} DISTINCT
 * collections denied inside {@link SESSION_STALE_WINDOW_MS}. Unlabelled
 * reports all share one bucket, so a caller that forgets to name its
 * collection can only ever fail to trigger the prompt — never cause one.
 */

/**
 * Distinct collections that must exhaust their retries before the console
 * says the session is the problem. Two is the smallest number that cannot
 * be produced by a single deliberately-hidden collection (AGL-1041).
 */
export const SESSION_STALE_MIN_COLLECTIONS = 2

/**
 * How long a denial counts toward the verdict. Long enough to span a page
 * whose reads are staggered, short enough that two unrelated genuine
 * denials minutes apart never add up to a false prompt.
 */
export const SESSION_STALE_WINDOW_MS = 60_000

export interface SessionHealthState {
  /** True once the evidence says the SESSION, not the authorization. */
  staleSession: boolean
  /** Collection keys that exhausted their retries, most recent last. */
  deniedCollections: string[]
}

/** Collection key → when it last exhausted its retries. */
const denials = new Map<string, number>()
const listeners = new Set<(state: SessionHealthState) => void>()

/** Injectable clock so tests do not sleep. */
let now = () => Date.now()

function prune() {
  const cutoff = now() - SESSION_STALE_WINDOW_MS
  for (const [key, at] of denials) if (at < cutoff) denials.delete(key)
}

export function getSessionHealth(): SessionHealthState {
  prune()
  const deniedCollections = [...denials.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => key)
  return {
    staleSession: deniedCollections.length >= SESSION_STALE_MIN_COLLECTIONS,
    deniedCollections,
  }
}

function publish() {
  const state = getSessionHealth()
  for (const listener of listeners) listener(state)
}

/**
 * A one-shot read exhausted its retries on `permission-denied`.
 *
 * `collection` is the evidence, not a label: two reports of the same key are
 * one collection and never reach the threshold on their own.
 */
export function reportDeniedRead(collection = 'unknown'): void {
  denials.set(collection, now())
  publish()
}

/**
 * A one-shot read reached the SERVER and succeeded.
 *
 * That is proof the session is alive — stronger than any accumulated
 * denial, since one-shot reads bypass the persistent cache — so it clears
 * the evidence outright. Without this, two genuine denials early in a
 * session would leave the prompt armed for the rest of it.
 */
export function reportSuccessfulRead(): void {
  if (!denials.size) return
  denials.clear()
  publish()
}

export function subscribeSessionHealth(
  listener: (state: SessionHealthState) => void,
): () => void {
  listeners.add(listener)
  listener(getSessionHealth())
  return () => void listeners.delete(listener)
}

/** Test seam: reset the store and (optionally) pin the clock. */
export function __resetSessionHealth(clock?: () => number): void {
  denials.clear()
  now = clock ?? (() => Date.now())
}

export default getSessionHealth
