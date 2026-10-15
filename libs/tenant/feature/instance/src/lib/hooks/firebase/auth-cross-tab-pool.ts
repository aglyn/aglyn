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
'use client'

import { type Auth } from 'firebase/auth'

/**
 * The SDK internals this module touches, verified in `@firebase/auth` 1.13.6.
 *
 * - `PersistenceUserManager` binds `auth._onStorageEvent` ONCE, when the
 *   instance initializes, as the persistence's cross-tab listener. A later
 *   own-property `_onStorageEvent` would never be called, so the seam cannot
 *   be there.
 * - `_onStorageEvent` reads the shared record and, for a user whose uid
 *   differs from this tab's, calls `this._updateCurrentUser(user, true)`.
 *   That call is looked up on `this` at call time, so an own property on the
 *   instance is reached.
 * - `true` (`skipBeforeStateCallbacks`) with a NON-null user is passed by that
 *   one call site and nowhere else. `signOut` passes `true` with `null`; every
 *   sign-in, link, reauth and `updateCurrentUser` passes the default `false`.
 *
 * `auth-cross-tab-pool.spec.ts` drives the real SDK through a real `storage`
 * event, so an SDK upgrade that moves any of this reds that spec.
 */
interface CrossTabSyncInternals {
  tenantId: string | null
  _updateCurrentUser(
    user: { tenantId?: string | null } | null,
    skipBeforeStateCallbacks?: boolean,
  ): Promise<void>
}

const INSTALLED = Symbol.for('aglyn.auth.followPeerTabPool')

/**
 * Let a cross-tab sign-in move this instance to the signed-in user's pool
 * (AGL-3803).
 *
 * ## The bug
 *
 * A durable instance keeps ONE signed-in user per browser profile, under
 * `firebase:authUser:<apiKey>:<appName>` — a key that does not name the
 * Identity Platform pool. When another tab signs in, the SDK hands the record
 * it wrote to every other tab through `_onStorageEvent`, which replaces the
 * tab's user via `_updateCurrentUser`. That method asserts
 * `auth.tenantId === user.tenantId`. A tab whose instance is in an SSO
 * tenant (`adoptRestoredPool`, AGL-2486) and a peer tab that signs in to the
 * project pool — or the reverse, or staff impersonation into another pool —
 * fail it: `auth/tenant-id-mismatch` is thrown inside a listener nobody
 * awaits, which is the unhandled rejection in the client-errors log.
 *
 * The tab is then wrong without saying so. It keeps the old user in memory
 * and fires no auth-state change, while the profile's record, and the shared
 * session cookie the peer minted, belong to the new user. The next token
 * refresh writes the old user back over the record, so the peer tab gets the
 * same error the other way round, and whichever tab reloads next restores
 * whichever account wrote last.
 *
 * ## The fix
 *
 * On that one path, put the instance in the incoming user's pool first, so
 * the SDK's own assertion holds and the switch completes exactly as it
 * already does between two users of the same pool. The pool comes from the
 * user, never from a caller, so this can only ever agree with the record
 * every tab of this origin already treats as the truth.
 *
 * Why not a pool-specific persistence key (a Firebase app per pool)? Firestore,
 * Storage and App Check hang off the one app, the pool is not known until
 * the restore has run, and the shared session cookie is one per profile
 * anyway. A profile has one signed-in account; this makes every tab agree on
 * it instead of letting the pool decide which tabs may hear about it.
 *
 * ## What it does not change
 *
 * - The assertion still guards every in-tab sign-in, link and reauth: those
 *   pass `skipBeforeStateCallbacks = false` and go straight to the SDK.
 * - Sign-out elsewhere (`user === null`) is untouched, and so is the pool
 *   of a signed-out tab.
 * - A same-pool switch is untouched: the pools already agree.
 *
 * A tab that is mid sign-in when a peer signs in races it, exactly as the SDK
 * already makes two same-pool sign-ins race over the one record: the last
 * write wins in every tab.
 *
 * Idempotent: `getAuth(app)` hands back the same instance on every call, and
 * the guard is installed on the first.
 */
export function followPeerTabPool<T extends Auth>(auth: T): T {
  const internals = auth as unknown as CrossTabSyncInternals & {
    [INSTALLED]?: true
  }
  // Not an SDK instance (a stub in a spec): nothing syncs, nothing to follow.
  if (!internals || typeof internals._updateCurrentUser !== 'function') return auth
  if (internals[INSTALLED]) return auth
  const updateCurrentUser = internals._updateCurrentUser

  Object.defineProperty(internals, '_updateCurrentUser', {
    configurable: true,
    writable: true,
    value: function followPeerTabUser(
      this: CrossTabSyncInternals,
      user: { tenantId?: string | null } | null,
      skipBeforeStateCallbacks?: boolean,
    ): Promise<void> {
      if (skipBeforeStateCallbacks === true && user) {
        const pool = user.tenantId ?? null
        if (this.tenantId !== pool) this.tenantId = pool
      }
      return updateCurrentUser.call(this, user, skipBeforeStateCallbacks)
    },
  })
  Object.defineProperty(internals, INSTALLED, { value: true })
  return auth
}
