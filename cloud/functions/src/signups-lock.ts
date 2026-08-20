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
 * The signups lock's account-CREATION decision (AGL-1531).
 *
 * DO NOT EDIT THIS BLOCK HERE. It is a verbatim copy of the region of the
 * same name in `libs/aglyn/src/lib/app-utils/lockdown.ts`, which is where it
 * is documented and where its tests live. `cloud/functions` is a plain npm
 * package outside the nx workspace and can resolve only firebase-admin and
 * firebase-functions, so it cannot import the library — hence a copy, and
 * hence `apps/console/specs/signups-creation-lock-wiring.spec.ts`, which
 * fails if the two blocks differ by a single character.
 *
 * Change the library, then copy the region across; the guard tells you if
 * you forgot.
 */

// #region signups-creation-lock

/**
 * FAIL CLOSED. If the lock state cannot be read, account creation is
 * REFUSED.
 *
 * This repo's posture is deliberately not uniform — rate limiting fails
 * soft, CSRF fails closed, and `getFeatureLockdown` fails OPEN ("an
 * unreachable Firestore is an outage, not a feature lockdown"). That
 * fail-open is right where it sits: it guards requests from people who are
 * already signed in, and denying them service over a Firestore blip would
 * turn a read outage into a product outage.
 *
 * Here the trade is the other way round, for three reasons:
 *
 * 1. An account created while Firestore is unreadable cannot finish signing
 *    up anyway. `users/{uid}`, the legal-acceptance record and the org all
 *    live in Firestore. Fail-open does not buy a working signup — it buys an
 *    orphan Auth record with no profile, no acceptance and no workspace,
 *    which is the exact artefact this issue exists to stop accumulating. So
 *    the "cost" of failing closed here is close to zero real signups.
 * 2. A brake that releases itself under load is not a brake. The incident
 *    this lever answers is a bot wave; a wave is precisely the condition
 *    that makes reads fail. Fail-open would open the valve at the moment it
 *    is being leaned on.
 * 3. GCIP already fails closed one level up and that is not configurable: if
 *    the blocking function errors or times out, Identity Platform refuses
 *    the operation. A fail-open read inside a fail-closed container would
 *    give one control two opposite postures depending on WHERE it broke.
 *
 * The escape hatch is not a code change and needs no deploy: unregister the
 * `beforeCreate` trigger in the Identity Platform console. That is the same
 * console an operator is already in during an incident, and the staff
 * lockdown page reports whether the trigger is registered.
 */
export type SignupsCreationVerdict =
  | { refused: false }
  /** `locked` = staff pulled the lever. `unreadable` = fail-closed. */
  | { refused: true; cause: 'locked' | 'unreadable' }

/**
 * How long the blocking function waits on the lock read before refusing.
 *
 * Blocking functions sit on the account-creation critical path and Identity
 * Platform gives them a bounded window, so an unbounded `get()` would turn
 * a slow read into the platform's own timeout — which refuses anyway, but
 * after burning the whole budget and with no log saying why.
 */
export const SIGNUPS_CREATION_LOCK_READ_TIMEOUT_MS = 2_500

/**
 * Refuse this account creation?
 *
 * `readLock` returns the `lockdowns/feature--signups` document, or null when
 * it does not exist. It is injected rather than imported so this decision —
 * including its fail-closed and timeout behaviour — is testable without a
 * Firestore, and so the same characters run in the function and in the test.
 *
 * NOT parameterised by provider, by email, or by tenant. Email/password,
 * Google and SSO all reach Firebase Auth account creation, and a lock that
 * discriminated between them would be a lock on one gate of three. The
 * caller passes no identity at all, so no future edit can quietly add a
 * carve-out here.
 */
export async function signupsCreationVerdict(
  readLock: () => Promise<{ untilMs?: number } | null | undefined>,
  nowMs: number,
  timeoutMs: number = SIGNUPS_CREATION_LOCK_READ_TIMEOUT_MS,
): Promise<SignupsCreationVerdict> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: { untilMs?: number } | null | undefined
  try {
    state = await Promise.race([
      readLock(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('signups lock read timed out')),
          timeoutMs,
        )
      }),
    ])
  } catch {
    return { refused: true, cause: 'unreadable' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  // Absent document = not locked. This is the ONLY path that admits an
  // account, and it requires a completed read that found nothing.
  if (state === null || state === undefined) return { refused: false }
  // An expiry that has passed deactivates with no write, matching
  // `isLockdownActive` exactly (the sibling test pins that equivalence).
  if (typeof state.untilMs === 'number' && state.untilMs <= nowMs) {
    return { refused: false }
  }
  // Deliberately stricter than `normalizeLockdownDoc`, which refuses to
  // interpret a malformed doc and so reports NOT LOCKED. Here the document's
  // existence is the lever: the only writer is the audited staff route, so a
  // doc that exists at all means someone pulled it, and a field this build
  // cannot parse must never un-pull it.
  return { refused: true, cause: 'locked' }
}

// #endregion signups-creation-lock
