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
 * FAIL OPEN WHEN THE LOCK CANNOT BE READ; KEEP HOLDING ONE ALREADY SEEN.
 *
 * This repo's postures are deliberately not uniform — rate limiting fails
 * soft, CSRF fails closed, and `getFeatureLockdown` fails OPEN because an
 * unreachable Firestore is an outage rather than a feature lockdown. This
 * gate sits with the last of those, and the split below is what makes that
 * safe rather than merely convenient.
 *
 * ## Not knowing is answered by admitting
 *
 * An unreadable lock means the platform does not KNOW whether staff pulled
 * the lever. Refusing on "do not know" is not a cautious answer here, it is
 * a total one: this is the only thing standing in front of Firebase Auth
 * account creation, so one refusal turns away every stranger at once, with a
 * generic error they cannot act on and no reason to come back. And the
 * condition that produces it is ordinary rather than exceptional — where
 * signup traffic is light the instance is cold for nearly every attempt, so
 * "the first Firestore read costs more than the budget" is the common case,
 * not the rare one.
 *
 * The error in the other direction is bounded. An account created while
 * Firestore is unreadable cannot finish signing up anyway — the profile, the
 * legal-acceptance record and the workspace all live in Firestore — so
 * admitting costs some orphan Auth records for the length of the read
 * outage, and those are enumerable and removable afterwards. One side's
 * mistake is a handful of empty records; the other side's is the whole
 * funnel, silently, for as long as reads are slow.
 *
 * ## A lever actually seen is a fact, and it survives
 *
 * Every read that COMPLETES is recorded below, and a read that then fails is
 * answered from that record instead of from nothing. So the objection
 * fail-open usually earns — a bot wave makes reads fail and thereby releases
 * the brake aimed at the wave — needs the wave to land on an instance that
 * has never once read the lock; every instance that has keeps refusing for
 * the whole outage. Lifting the lever is itself a Firestore write, so
 * nothing can lift it during that outage either, and a lock's own `untilMs`
 * is still honored against the clock, so a dead-man expiry cannot become
 * un-liftable by being remembered.
 *
 * This is STRICTER than the tenant takedown ledger (AGL-1621), which
 * remembers only locks classified `takedown` and lets a `standard` one
 * release during an outage. That trade is right where it sits, because
 * holding a remembered lock there keeps every visitor off a customer's whole
 * site. Holding one here refuses new signups, which is the cheap direction,
 * so no `enforcement` field is consulted at all and any active lock is
 * remembered.
 *
 * ## What it does not do, stated rather than implied
 *
 * An instance that has never completed a read has nothing to remember, so a
 * lever pulled DURING a total Firestore outage does not reach a cold one.
 * Closing that gap needs a carrier more available than Firestore, which is a
 * different and much larger change; pretending otherwise here would be worse
 * than naming it. The escape hatch that needs no deploy is unchanged:
 * unregister the `beforeCreate` trigger in Identity Platform, which the
 * staff lockdown page reports the state of.
 */
export type SignupsCreationVerdict =
  /**
   * `unreadable` marks an admission made BLIND: the read did not complete
   * and nothing this instance remembers said the lever was pulled. Carried
   * so the caller can log it — the two admissions are the same outcome for
   * the person signing up and a very different one for an operator.
   */
  | { refused: false; unreadable?: true }
  /**
   * `locked` = a read completed and found the lever pulled. `held` = a read
   * failed and an earlier one had found it pulled.
   */
  | { refused: true; cause: 'locked' | 'held' }

/**
 * How long the blocking function waits on the lock read before deciding
 * without it.
 *
 * Blocking functions sit on the account-creation critical path and Identity
 * Platform gives them a bounded window, so an unbounded `get()` would hand
 * the decision to the platform's own timeout — which refuses, after burning
 * the whole budget and with no log saying why. Bounding it keeps the verdict
 * here, where it can be reasoned about and recorded.
 */
export const SIGNUPS_CREATION_LOCK_READ_TIMEOUT_MS = 2_500

/**
 * What the last COMPLETED read saw, for the life of this instance.
 * `undefined` means no read has completed here yet — the state a cold
 * instance starts in, and the only one that cannot hold a lock.
 *
 * Not a cache: it is never consulted in place of a read, only in place of
 * one that failed, so it can never make this gate slower to notice a lift
 * than the lift's own write.
 */
let lastReadSignupsLock: { untilMs?: number } | null | undefined

/**
 * Forget it. Not part of any panic path — this exists for process
 * boundaries and for tests, where one case's lock would otherwise become the
 * next case's refusal.
 */
export function resetSignupsLockMemory(): void {
  lastReadSignupsLock = undefined
}

/**
 * Is this state an engaged lock at `nowMs`?
 *
 * Deliberately stricter than `normalizeLockdownDoc`, which refuses to
 * interpret a malformed doc and so reports NOT LOCKED. Here the document's
 * existence is the lever: the only writer is the audited staff route, so a
 * doc that exists at all means someone pulled it, and a field this build
 * cannot parse must never un-pull it. An expiry that has passed deactivates
 * with no write, matching `isLockdownActive` exactly (the sibling test pins
 * that equivalence).
 */
function signupsLockEngaged(
  state: { untilMs?: number } | null | undefined,
  nowMs: number,
): boolean {
  if (state === null || state === undefined) return false
  return !(typeof state.untilMs === 'number' && state.untilMs <= nowMs)
}

/**
 * Refuse this account creation?
 *
 * `readLock` returns the `lockdowns/feature--signups` document, or null when
 * it does not exist. It is injected rather than imported so this decision —
 * including its fail-open and timeout behavior — is testable without a
 * Firestore, and so the same characters run in the function and in the test.
 *
 * NOT parameterized by provider, by email, or by tenant. Email/password,
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
    // Nothing was learned, so the only thing that can refuse now is what an
    // earlier read established. A remembered lock whose window has closed is
    // dropped here rather than re-examined on every later failure.
    if (signupsLockEngaged(lastReadSignupsLock, nowMs)) {
      return { refused: true, cause: 'held' }
    }
    lastReadSignupsLock = undefined
    return { refused: false, unreadable: true }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  // A completed read is the whole truth, "no document" included: it decides
  // this account AND replaces whatever was remembered, which is how a lift
  // takes effect.
  lastReadSignupsLock = state ?? null
  return signupsLockEngaged(state, nowMs)
    ? { refused: true, cause: 'locked' }
    : { refused: false }
}

// #endregion signups-creation-lock
