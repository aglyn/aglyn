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
 *    true — see the ordering note on `checkSeedFreshness`. It is also the one
 *    signal that a little patience answers, so `writeGuardedBySeed` waits for
 *    the confirmation before it refuses on this alone (AGL-4120).
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

import { whenListensConfirmed } from './listen-confirmation'

export type StaleSeedReason =
  | 'unreadable'
  | 'unconfirmed'
  | 'stale-session'
  /** The server's confirmation changed the values the form was built from. */
  | 'refreshed'

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

/**
 * Why we refused, in words that say what to DO about it.
 *
 * ## The subject is INTERPOLATED, so nothing here may agree with it (AGL-1446)
 *
 * Call sites pass "profile", "SEO settings", "theme overrides", "categories".
 * The copy used to read "Your SEO settings **has** not been confirmed", "so
 * **it** cannot be saved", "so **this** SEO settings may be out of date" —
 * fine for the singular subjects it was written against and wrong for half the
 * ~126 call sites. Every sentence below is number-neutral instead, and
 * `guarded-seed-write.spec.ts` pins all three verbatim against a plural
 * subject so it stays that way.
 *
 * ## What `unconfirmed` may claim (AGL-4120)
 *
 * It used to tell people a tab could be "permanently cache-only" and to open a
 * new one, "because reloading cannot restore a connection this tab never
 * opened". That theory was wrong twice over. AGL-2486 showed the Listen channel
 * open and answering all along, and AGL-4120 measured what was left: nothing
 * had disconnected, the console's own stall recovery had taken a healthy client
 * off the network. A fresh tab only looked like a cure because it had not been
 * knocked off yet.
 *
 * By the time this reads, the save has waited {@link SEED_CONFIRM_WAIT_MS} for
 * the confirmation. So it says the three things that are true, which are the
 * three a person acting on it needs: the save did not happen, what they typed
 * is still there, and trying again in a moment is the remedy.
 */
function refusalMessage(subject: string, reason: StaleSeedReason): string {
  switch (reason) {
    case 'unreadable':
      return (
        `Your ${subject} could not be loaded, so there is nothing safe to ` +
        'save — saving now would overwrite the stored copy with blanks. ' +
        'Reload and try again.'
      )
    case 'unconfirmed':
      return (
        `We could not confirm your ${subject} with the server yet, so nothing ` +
        'was saved. What you entered is still here. Check your connection and ' +
        'save again in a moment.'
      )
    case 'refreshed':
      return (
        `Your ${subject} just updated from the server, so nothing was saved ` +
        'yet. Check the latest values, then save again.'
      )
    case 'stale-session':
      return (
        `Your session went stale, so your ${subject} may be out of date — ` +
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
 *
 * A seed that is only UNCONFIRMED is waited for before it is refused
 * (AGL-4120): the save stays in its busy state while the server answers, which
 * is normally a moment. The other reasons are facts about the read or the
 * session that waiting does not change, and they refuse at once.
 */
export async function writeGuardedBySeed(
  options: GuardedSeedWriteOptions,
  write: () => Promise<void>,
): Promise<GuardedSeedWriteResult> {
  const verdict = checkSeedFreshness(options)
  if (verdict.ok) {
    await write()
    return verdict
  }
  if (verdict.reason !== 'unconfirmed') return verdict
  const settlement = await whenListensConfirmed()
  if (settlement === 'refreshed') {
    return {
      ok: false,
      reason: 'refreshed',
      message: refusalMessage(options.subject, 'refreshed'),
    }
  }
  if (settlement !== 'confirmed') return verdict
  // The wait took time, and the session may not have survived it.
  const confirmed = checkSeedFreshness({ ...options, fromCache: false })
  if (!confirmed.ok) return confirmed
  await write()
  return confirmed
}

export default writeGuardedBySeed
