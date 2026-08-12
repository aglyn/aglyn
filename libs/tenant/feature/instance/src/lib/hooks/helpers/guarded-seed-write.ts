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
 * Refuse a whole-object write whose form was seeded from a read we cannot
 * trust (AGL-1356, AGL-1358, AGL-1066).
 *
 * ## The shape this exists for
 *
 * A form seeded from a Firestore LISTENER, saved with a payload that carries
 * every field rather than the one that changed. `merge: true` protects
 * nothing there — the untouched fields are all present in the payload — so
 * saving one edit rewrites the rest to whatever the seed held. If the seed
 * came from IndexedDB during a stale session, "whatever the seed held" can
 * be arbitrarily old, and the user's real values are destroyed by a save
 * they asked for and had every reason to expect to be safe.
 *
 * ## Why it WRAPS the write instead of preceding it
 *
 * The guards this replaces sat in front of their writes as early returns,
 * which is a shape you can have and still write — add a branch, reorder a
 * line, and the guard is decoration. Here the write is only reachable
 * THROUGH the verdict, so a call site cannot keep the guard and lose the
 * protection. It also makes the refusal testable as a refusal: assert the
 * inner function never ran.
 *
 * ## The three signals, in the order they are worth trusting
 *
 * 1. `fromCache` — the server never confirmed what is on screen (AGL-1066).
 *    This is the one that catches the dangerous case, because a cache-served
 *    read looks completely healthy: populated form, plausible values. It is
 *    per-listener ground truth from the SDK, so it needs no threshold and no
 *    window, and it clears itself the instant a server snapshot lands. It
 *    leads because it is also the more ACCURATE explanation whenever it is
 *    true — see the ordering note on `checkSeedFreshness`.
 * 2. `unreadable` — the read FAILED and there is nothing cached behind it
 *    (AGL-1143). Saving would write blanks over a populated document.
 * 3. `staleSession` — the console's own heuristic. Kept because it means
 *    something the other two do not (the SESSION is dead, not merely
 *    unconfirmed), but it must never be the ONLY guard: it needs two
 *    distinct labelled collections denied inside 60s, which is unreachable
 *    on a listener-only page. That was exactly how AGL-1356 stayed open.
 *
 * ## Why this lives in the library rather than the console (AGL-1358)
 *
 * Most of the ~forty sites wearing this shape are plugin cards in
 * `libs/plugins/**`, which cannot import from `apps/console`. The guard
 * itself is pure, and `fromCache` — the signal that actually fires —
 * originates here, on the listener hooks. What it cannot own is
 * `session-health`, which is console state.
 *
 * So the third signal is INJECTED, through the same seam
 * `firestore-denial-reporter` already uses for the reverse direction: the
 * console registers a check at startup and the guard pulls it. That keeps a
 * single guard for every call site with no new dependency edge and nothing
 * inverted — the library still knows nothing about the app. An unregistered
 * check simply reports "not stale", which is what the tenant runtime and the
 * unit tests want; the other two signals are unaffected, and they are the
 * ones the doc above says must carry the guard anyway.
 */

export type StaleSeedReason = 'unreadable' | 'unconfirmed' | 'stale-session'

/**
 * The console's `session-health` verdict, injected because it is app state.
 * Null until the app registers one — see {@link setStaleSessionCheck}.
 */
let staleSessionCheck: (() => boolean) | null = null

/**
 * Register the app's stale-session verdict. Called once, by the app that owns
 * `session-health`. Pass `null` to unregister (tests).
 *
 * Registered at module scope alongside `setFirestoreSessionReporters` rather
 * than in an effect, for the same reason: a save can be clicked before any
 * effect has run, and a guard that consults a check which does not exist yet
 * silently loses its third signal.
 */
export function setStaleSessionCheck(check: (() => boolean) | null): void {
  staleSessionCheck = check
}

/** The registered verdict, or `false` when nothing is registered. */
function isSessionStale(): boolean {
  return staleSessionCheck ? staleSessionCheck() : false
}

export interface GuardedSeedWriteOptions {
  /**
   * What is being saved, in the user's words — "profile", "settings".
   * Used to build the refusal message, so it reads naturally in a sentence
   * like "Your profile could not be loaded".
   */
  subject: string
  /** The seeding read FAILED (`status === 'error'`). */
  unreadable?: boolean
  /** The seeding snapshot came from cache (`metadata.fromCache`). */
  fromCache?: boolean
  /**
   * Also consult `session-health`. On by default; the only reason to turn it
   * off is a surface that deliberately writes during a known-degraded
   * session.
   */
  checkSession?: boolean
}

export interface GuardedSeedWriteResult {
  /** True when the write RAN. */
  ok: boolean
  /** Why it did not run. */
  reason?: StaleSeedReason
  /**
   * What to tell the user. Always populated when `ok` is false — a refused
   * save that says nothing is its own bug: the user retypes the form and
   * tries again, and the second attempt is refused just as silently.
   */
  message?: string
}

/** Why we refused, in words that say what to DO about it. */
function refusalMessage(subject: string, reason: StaleSeedReason): string {
  switch (reason) {
    case 'unreadable':
      return (
        `Your ${subject} could not be loaded, so it cannot be saved — that ` +
        'would overwrite it with blanks. Reload and try again.'
      )
    case 'unconfirmed':
      return (
        `Your ${subject} has not been confirmed with the server, so what is ` +
        'on screen may be out of date — saving now could overwrite newer ' +
        'values. Check your connection and reload before trying again.'
      )
    case 'stale-session':
      return (
        `Your session went stale, so this ${subject} may be out of date — ` +
        'saving now could overwrite newer values. Sign in again and reload.'
      )
  }
}

/** The verdict on its own, for a caller that needs it before the click. */
export function checkSeedFreshness(
  options: GuardedSeedWriteOptions,
): GuardedSeedWriteResult {
  const { subject, unreadable, fromCache, checkSession = true } = options
  /**
   * `fromCache` OUTRANKS `unreadable` (AGL-1066).
   *
   * It did not, and the ordering was harmless only while a refused listen
   * could never reach `status: 'error'`. Now that it can, the common case is
   * BOTH flags true at once — the cache is serving the document and the
   * server has stopped answering for it — and taking `unreadable` there
   * tells the user their settings "could not be loaded" and that saving
   * "would overwrite it with blanks", while a populated, plausible form sits
   * in front of them. The refusal is right; that explanation is not, and a
   * refusal whose reason is visibly false is one the user works around.
   *
   * What is left to `unreadable` is the read that failed with nothing to
   * show for it, which is the AGL-1143 case it was written for and where the
   * blanks are real. The heuristic still comes last.
   */
  const reason: StaleSeedReason | undefined = fromCache
    ? 'unconfirmed'
    : unreadable
      ? 'unreadable'
      : checkSession && isSessionStale()
        ? 'stale-session'
        : undefined
  if (!reason) return { ok: true }
  return { ok: false, reason, message: refusalMessage(subject, reason) }
}

/**
 * Run `write` only if the seed can be trusted.
 *
 * Never throws on refusal — the caller reports `message` and leaves the
 * user's typed values on screen, because the whole point is that we are not
 * confident enough to touch the stored document, not that the input was bad.
 */
export async function writeGuardedBySeed(
  options: GuardedSeedWriteOptions,
  write: () => Promise<void>,
): Promise<GuardedSeedWriteResult> {
  const verdict = checkSeedFreshness(options)
  if (!verdict.ok) return verdict
  await write()
  return verdict
}

export default writeGuardedBySeed
