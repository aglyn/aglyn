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

import {
  getSessionHealth,
  reportDeniedRead,
  reportSuccessfulRead,
  SESSION_STALE_WINDOW_MS,
} from './session-health'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

/**
 * Retries a one-shot Firestore read (`getDocs`/`getCountFromServer`/`getDoc`)
 * on `permission-denied`, the same transient race `useFirestoreCollection`/
 * `useFirestoreDoc` recover from (AGL-216/218-222/223): `useUser()` can
 * report a signed-in user a beat before Firestore's own credential provider
 * has attached that user's ID token, so the very first read right after
 * sign-in can be denied even though the user is genuinely authorized.
 * Unlike `onSnapshot`, one-shot reads don't get a second try for free —
 * this wraps them with the same short backoff.
 *
 * `collection` names what was being read. It is not decoration: it is the
 * evidence `session-health` uses to tell a dead session (every collection
 * denied) from a legitimate AGL-1041 denial (one collection, by design).
 * Omitting it can only fail to raise the re-auth prompt, never raise it
 * falsely.
 */
export async function firestoreOneShotRetry<T>(
  run: () => Promise<T>,
  collection?: string,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      const result = await run()
      // Reaching the server at all clears the accumulated evidence — a
      // one-shot read cannot be answered by the persistent cache.
      reportSuccessfulRead()
      return result
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (code !== 'permission-denied') throw error
      if (attempt >= MAX_RETRIES) {
        /**
         * Surviving every retry means this is NOT the post-sign-in race
         * above — that one resolves in well under two seconds.
         *
         * Report FIRST, then read the verdict, so this denial is part of the
         * evidence the message describes rather than missing from its own
         * summary.
         *
         * Published so the shell can say it where the user will see it
         * (AGL-1063) — a console.error helps nobody without devtools open.
         */
        reportDeniedRead(collection)
        const { staleSession, deniedCollections } = getSessionHealth()
        const windowSeconds = Math.round(SESSION_STALE_WINDOW_MS / 1000)
        const seen =
          `${deniedCollections.length} distinct collection` +
          `${deniedCollections.length === 1 ? '' : 's'} denied in the last ` +
          `${windowSeconds}s (${deniedCollections.join(', ') || 'unknown'})`

        if (staleSession) {
          /**
           * The evidence now supports the session theory, on the same
           * threshold the user-facing prompt uses — a dead session denies
           * EVERYTHING, so denials spanning unrelated collections are the
           * signature.
           *
           * This is AGL-1062: a stale session denied every server read,
           * `persistentLocalCache` kept serving listeners from IndexedDB so
           * most pages looked fine, and only the one-shot reads rendered
           * empty states. Hours went into rules, indexes and transport
           * theories before "sign out and back in" turned out to be it.
           * Whoever sees this next gets that for free — but only when the
           * evidence actually points there.
           */
          console.error(
            `Firestore denied "${collection ?? 'unknown'}" after ` +
              `${MAX_RETRIES} retries, and ${seen}. A dead session denies ` +
              'every collection, so the session itself is the likeliest ' +
              'cause: signing out and back in is the first thing to try. ' +
              'Cached pages can keep rendering normally while this is ' +
              'happening.',
            error,
          )
        } else {
          /**
           * One collection is NOT evidence of a bad session, and saying so
           * was actively misleading (AGL-1179). `session-health` refuses to
           * conclude "stale" from this much, and this log used to conclude it
           * anyway — sending two different people to sign out over a URL that
           * simply did not exist (AGL-1149).
           *
           * So: describe what was observed, list the causes, and let the
           * reader pick. The third one is the one that keeps catching people,
           * because `permission-denied` is genuinely surprising as the answer
           * to "does this document exist".
           */
          console.error(
            `Firestore denied "${collection ?? 'unknown'}" after ` +
              `${MAX_RETRIES} retries — not the post-sign-in race. Only ` +
              `${seen}, which is NOT the signature of a bad session (that ` +
              'denies every collection), so signing out probably will not ' +
              'help. Likelier: this account genuinely lacks access, or the ' +
              'document does not exist — a missing document cannot satisfy a ' +
              'membership rule, so Firestore answers permission-denied rather ' +
              'than not-found. For an org-shaped path, orgSlugs/{slug} is ' +
              'public-read and settles existence without membership.',
            error,
          )
        }
        throw error
      }
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

export default firestoreOneShotRetry
