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

import { type FirebaseApp } from 'firebase/app'
import {
  type Auth,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
} from 'firebase/auth'

/**
 * How much of a session an origin is allowed to keep (AGL-1379).
 *
 * - `durable` — the SDK default hierarchy (IndexedDB → localStorage →
 *   sessionStorage). A **refresh token lands on disk in plaintext**, which is
 *   correct on `*.aglyn.com`: we own the DNS forever, and a 14-day session is
 *   the product.
 * - `ephemeral` — `initializeAuth(app, { persistence: inMemoryPersistence })`
 *   with **no `popupRedirectResolver`**, per AGL-1099a D6. For a **custom
 *   console domain**, whose DNS the customer can re-point at their own server
 *   after a detach: a refresh token left in that origin's IndexedDB is a
 *   durable account-takeover primitive that no cookie TTL and no server-side
 *   revocation short of `revokeRefreshTokens` can reach.
 *
 * The class is a property of the **instance**, not of any call site, which is
 * why it is declared here and nowhere else — see `createAuthInstance`.
 */
export type AuthPersistenceClass = 'durable' | 'ephemeral'

/** `code` on {@link SealedAuthPersistenceError}, shaped like a Firebase error code. */
export const AUTH_PERSISTENCE_SEALED_CODE = 'aglyn-auth/persistence-sealed'

/**
 * Thrown when something tries to re-persist an `ephemeral` auth instance.
 *
 * Thrown **synchronously**, deliberately, even though `setPersistence` is
 * typed `Promise<void>`. That matches how the SDK already refuses the
 * federated family on a resolver-less instance (`signInWithPopup` and friends
 * throw `auth/argument-error` before any network request, measured in
 * `docs/design/agl-1099a-poc-findings.md` §3), and it means a fire-and-forget
 * `void setPersistence(...)` fails loudly instead of becoming an unhandled
 * rejection nobody reads.
 */
export class SealedAuthPersistenceError extends Error {
  readonly code = AUTH_PERSISTENCE_SEALED_CODE
  constructor() {
    super(
      'setPersistence is sealed on this Auth instance: it was created with ' +
        "persistence class 'ephemeral' (AGL-1099a D6), so persisting a " +
        'refresh token to this origin is not permitted. If this origin may ' +
        "keep a session, create its Auth instance as 'durable' — do not " +
        'change persistence after the fact (AGL-1379).',
    )
    this.name = 'SealedAuthPersistenceError'
  }
}

/**
 * Is `setPersistence` sealed on this instance? A diagnostic, not a boundary —
 * the boundary is the property descriptor itself.
 */
export function isAuthPersistenceSealed(auth: Auth): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(auth, 'setPersistence')
  return (
    !!descriptor && descriptor.writable === false && descriptor.configurable === false
  )
}

/**
 * Make `setPersistence` unrepresentable on this instance.
 *
 * The modular `setPersistence(auth, persistence)` is a one-line delegation —
 * `getModularInstance(auth).setPersistence(persistence)` (verified in
 * `@firebase/auth` 1.13.3) — so an own, non-writable, non-configurable
 * property shadowing the prototype method closes **every** route that goes
 * through the object: the free function, the method, a wrapper, an aliased
 * import, and any call site nobody has written yet. That is the point. The
 * six existing `setPersistence` call sites did not have to be touched, and
 * the seventh nobody has typed yet is covered too.
 *
 * Deliberate limit, stated rather than overclaimed: a caller who reaches
 * around the instance — pulling the method off `Object.getPrototypeOf(auth)`
 * and `call`-ing it — is not stopped. Overriding the prototype would seal
 * every `Auth` in the process, including the `durable` ones this file exists
 * to leave alone.
 */
function sealPersistence(auth: Auth): Auth {
  // Idempotent: `initializeAuth` returns the existing instance when called
  // twice with deep-equal options, and `usePresence` re-enters its effect on
  // every room change. Re-defining a non-configurable property is a
  // TypeError, so the second pass must be a no-op rather than a crash.
  if (isAuthPersistenceSealed(auth)) return auth
  Object.defineProperty(auth, 'setPersistence', {
    value: (): Promise<void> => {
      throw new SealedAuthPersistenceError()
    },
    writable: false,
    configurable: false,
    enumerable: false,
  })
  return auth
}

/**
 * The only way an Aglyn `Auth` instance is born, and the persistence class is
 * a **required positional argument** (AGL-1379).
 *
 * ## Why this shape
 *
 * The thing that has to be guarded is a `setPersistence` call passing
 * `browserLocalPersistence`, which the PoC measured flipping a refresh token
 * from absent to present in IndexedDB on an in-memory instance — accepted at
 * runtime, no error, no warning.
 *
 * - **A lint rule cannot classify it.** Whether a given `setPersistence` call
 *   is safe depends on which host the browser is on, and the same source file
 *   serves both. `apps/console/utils/passkeys.ts:133` is *correct* on
 *   `app.aglyn.com` and *fatal* on `console.acme-agency.com`. A rule banning
 *   the call would be false half the time, and AGL-1357's lesson — derive the
 *   classification from what the code declares — has nothing to derive from
 *   at these call sites, because nothing there declares the instance's class.
 * - **A wrapper the six sites go through is bypassable** by the next person
 *   who imports `setPersistence` from `firebase/auth` directly, which is what
 *   all six already do.
 * - **A required argument works only where the class is knowable**, and that
 *   is here, at creation — the AGL-1366 shape (`setNode`'s required `parent`)
 *   applied at the one place it is honest. Every creation site must now say
 *   which kind of origin it is on, and the guard rides the instance from
 *   there.
 *
 * `durable` is the SDK default, reached by the exact `getAuth(app)` the
 * console has always called — this factory changes nothing about how
 * `*.aglyn.com` persists.
 */
export function createAuthInstance(
  app: FirebaseApp,
  persistenceClass: AuthPersistenceClass,
): Auth {
  if (persistenceClass === 'ephemeral') {
    // No `popupRedirectResolver`: D6's second half. The auth helper iframe is
    // never loaded, so the custom domain needs no `frame-ancestors` entry and
    // can never need a Firebase authorized-domain entry for OAuth.
    return sealPersistence(initializeAuth(app, { persistence: inMemoryPersistence }))
  }
  return getAuth(app)
}
