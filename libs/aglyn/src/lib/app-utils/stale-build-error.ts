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
 * THE TAB THAT WAS OPEN ACROSS A DEPLOY (AGL-3279).
 *
 * Every build names its chunks by content hash and the previous build's are
 * not kept, so a tab loaded before a release asks for a file the origin no
 * longer serves the moment it navigates or opens a lazy route. The browser
 * rejects the import, the boundary above catches it, and the visitor is
 * shown a crash page with a **Try again** button that cannot possibly work:
 * `reset()` re-renders the same tree, which requests the same missing chunk.
 * It reported once in the 48h to 2026-09-23, on `aglyn.com`.
 *
 * A reload fixes it completely, because the fresh document names the chunks
 * the deploy actually shipped. What matters is that it may never LOOP: a
 * genuinely broken deploy would otherwise reload every visitor forever, and
 * an error reporter's first rule — never become the outage — applies twice
 * over to something that reloads pages.
 *
 * So the recovery is RATE-BOUND, held in session storage: at most one
 * reload per tab per {@link RECOVERY_INTERVAL_MS}, and a browser that
 * refuses storage gets none at all rather than an unbounded one. A second
 * failure inside that window renders the crash page and stays there, which
 * is the honest outcome — at that point the build really is broken and
 * reloading is not the answer.
 *
 * An interval rather than a once-ever mark, because a console tab lives for
 * days and this repo ships several times a day: a once-ever mark would
 * spend the tab's only recovery on the first deploy it survived and leave
 * it stranded on the third. Long enough that no plausible loop is
 * comfortable; short enough that the next release is covered.
 *
 * A module of its own, not a function in `error-beacon.ts`, for the reason
 * `redispatch-caught-error.ts` gives: an error boundary's chunk is
 * downloaded by every visitor, and importing one name off the beacon would
 * drag its whole installer in with it.
 */

import { redispatchCaughtError } from './redispatch-caught-error'

const RELOADED_KEY = 'aglyn.staleBuildReloaded'

/** How long one recovery suppresses the next, in this tab. */
export const RECOVERY_INTERVAL_MS = 30 * 60 * 1_000

/**
 * Messages the browsers spell differently for one event — the module the
 * document names is not there.
 *
 * Matched on the MESSAGE as well as the name because only webpack's own
 * failure carries `name === 'ChunkLoadError'`; a native dynamic import that
 * 404s rejects with a plain `TypeError` whose wording is the browser's.
 */
const STALE_BUILD_MESSAGE =
  /Loading chunk .* failed|Failed to load chunk|Loading CSS chunk .* failed|error loading dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported module/i

/** Was this thrown because the document names a chunk the origin dropped? */
export function isStaleBuildError(error: unknown): boolean {
  if (!error) return false
  const thrown = error as { name?: unknown; message?: unknown }
  if (String(thrown.name ?? '') === 'ChunkLoadError') return true
  return STALE_BUILD_MESSAGE.test(String(thrown.message ?? ''))
}

/**
 * Should this tab reload itself for a stale build — and, if so, SPEND the
 * recovery, so asking twice cannot answer yes twice.
 *
 * The decision and the reload are separated on purpose. The decision is
 * the part with the rate limit in it, and the part that must be provable;
 * the reload is one line at the call site, which the boundary writes where
 * a reader can see it happen.
 *
 * Every storage path is guarded: an accessor may throw in a private window
 * or with site data blocked, and a failure to RECOVER from an error must
 * never be a second error.
 */
export function shouldReloadForStaleBuild(error: unknown): boolean {
  if (typeof window === 'undefined') return false
  if (!isStaleBuildError(error)) return false
  const now = Date.now()
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? '')
    // An unreadable mark is not a recent one: a stored value we cannot
    // parse must not suppress the recovery forever.
    if (Number.isFinite(last) && last > 0 && now - last < RECOVERY_INTERVAL_MS) {
      return false
    }
    window.sessionStorage.setItem(RELOADED_KEY, String(now))
  } catch {
    // No storage is no rate limit, and an unbounded reload is worse than a
    // crash page: take the crash page.
    return false
  }
  return true
}

/**
 * Withdraws the reload {@link recoverStaleBuildRejection} scheduled; true
 * when there was one.
 */
let cancelPending: (() => void) | null = null

function cancelPendingReload(): boolean {
  if (!cancelPending) return false
  cancelPending()
  return true
}

/** Re-load the document; a refused reload leaves the tab where it was. */
function reloadDocument(): void {
  try {
    window.location.reload()
  } catch {
    // Nothing to do: the crash page is already on screen.
  }
}

/**
 * What EVERY error boundary does with what it caught: reload once for a stale
 * build, and otherwise hand the error to the beacon. `global-error.tsx`
 * included: it catches what the root layout threw, and a stale tab's root
 * layout asks for its chunks like any other segment.
 *
 * One function so that no boundary can run half of it. The ones that matter
 * most are not the root boundaries but the two below them on a published
 * site — `PageBodyBoundary` around the page body and
 * `[host]/[scheme]/error.tsx` around the page — because a site plugin's chunk
 * is loaded by the page body, so those are what a stale tab reaches. A
 * boundary there that only re-dispatched would leave an empty body, or a
 * **Try again** that cannot work, and report a `ChunkLoadError` for it.
 *
 * A reloaded error is NOT reported; the fresh document is the fix, and the
 * tab it happened in is gone. What still reaches the beacon is the failure a
 * reload did not cure — a second one inside the recovery window, or a
 * browser that refuses storage — which the beacon labels `chunk-load`.
 *
 * `reload` is a parameter only so a spec can observe it: jsdom refuses to let
 * one redefine `location.reload`.
 *
 * @returns whether the tab is reloading.
 */
export function recoverStaleBuildOrReport(
  error: unknown,
  reload: () => void = reloadDocument,
): boolean {
  // A rejection already spent this tab's recovery on a reload that waits for
  // the tab to be hidden. The page has crashed now, so there is nothing left
  // on screen to protect: take that reload immediately.
  if (isStaleBuildError(error) && cancelPendingReload()) {
    reload()
    return true
  }
  if (shouldReloadForStaleBuild(error)) {
    reload()
    return true
  }
  redispatchCaughtError(error)
  return false
}

/**
 * THE SAME TAB, WHEN NO BOUNDARY SAW IT (AGL-3423).
 *
 * An `import()` that nothing awaits inside a render, a click handler's lazy
 * module or an effect's, rejects past every boundary and reaches `window` as
 * an `unhandledrejection`. The beacon labels it `chunk-load`, and until now
 * that was all: the tab stayed on the old build with one feature silently
 * dead.
 *
 * The recovery differs from a boundary's in WHEN it reloads. A boundary
 * reloads a page that has already crashed. Here the page is still up and
 * may hold work the visitor has not saved: a Besigner edit, a half-typed
 * form. So the reload waits until the tab is hidden, the moment AGL-3280's
 * cross-pool recovery also uses, and runs at once only when the tab is
 * already hidden. The visitor comes back to the build that is deployed.
 *
 * It spends the same rate-bound mark as a boundary, so it can never loop,
 * and it absorbs every later stale-build rejection in the tab while the
 * reload is pending: they are the same stale document, not new failures.
 * A boundary that catches one meanwhile takes the pending reload at once.
 *
 * @returns whether the rejection was recovered, and so should not be
 *   reported. False for any other rejection, and for a stale build whose
 *   recovery is spent, which the beacon still reports as `chunk-load`.
 */
export function recoverStaleBuildRejection(
  reason: unknown,
  reload: () => void = reloadDocument,
): boolean {
  if (typeof document === 'undefined' || !isStaleBuildError(reason)) return false
  if (cancelPending) return true
  if (!shouldReloadForStaleBuild(reason)) return false
  if (document.visibilityState === 'hidden') {
    reload()
    return true
  }
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') return
    cancelPendingReload()
    reload()
  }
  cancelPending = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    cancelPending = null
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return true
}
