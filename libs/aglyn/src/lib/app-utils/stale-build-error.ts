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
