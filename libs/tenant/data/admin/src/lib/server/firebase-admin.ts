/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn/server'
// Initializes the firebase-admin default app (cert credential, RTDB URL,
// service account, AppCheck) on module load. `firestoreDatabaseId` is the
// FIRESTORE_DATABASE_ID override (AGL-1490): unset → `(default)` as before;
// set → every accessor targets the named database (disaster-recovery cutover,
// see docs/DISASTER_RECOVERY.md).
import { firestoreDatabaseId } from '@aglyn/shared-util-fbserver'
import { decode, encode } from '@msgpack/msgpack'
import { type App, getApp } from 'firebase-admin/app'
import {
  type BaseAuth,
  type DecodedIdToken,
  getAuth,
} from 'firebase-admin/auth'
import { assertIdTokenNotRevoked } from './token-revocation'
import { getDatabase } from 'firebase-admin/database'
import { getRemoteConfig } from 'firebase-admin/remote-config'
import {
  FieldPath,
  FieldValue,
  type FirestoreDataConverter,
  Timestamp,
  getFirestore,
} from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

function compress(value: any) {
  return Buffer.from(encode(value))
}
function decompress(value: any) {
  return decode(value)
}

export const hostConverter: FirestoreDataConverter<Aglyn.AglynHost> = {
  toFirestore(data) {
    if (data.$id) delete data.$id
    // data.updatedAt = Timestamp.now()
    return data
  },
  fromFirestore(snapshot) {
    if (!snapshot.exists) return undefined
    const data = snapshot.data()
    data.$id = snapshot.id
    return data as Aglyn.AglynScreen
  },
}

export const screenConverter: FirestoreDataConverter<Aglyn.AglynScreen> = {
  toFirestore(data) {
    if (data.$id) delete data.$id
    data.updatedAt = Timestamp.now()
    return data
  },
  fromFirestore(snapshot) {
    if (!snapshot.exists) return undefined
    const data = snapshot.data()
    data.$id = snapshot.id
    return data as Aglyn.AglynScreen
  },
}

export const screenVersionConverter: FirestoreDataConverter<Aglyn.AglynScreenVersion> =
  {
    toFirestore(data) {
      if (data.elements) {
        data.nodes = data.elements
        delete data.elements
      }
      if (data['bundleId']) {
        data.pluginId = data['bundleId']
        delete data['bundleId']
      }
      if (data.nodes) data.nodes = compress(data.nodes) as any
      if (data.$id) delete data.$id
      data.updatedAt = Timestamp.now()
      return data
    },
    fromFirestore(snapshot) {
      if (!snapshot.exists) return undefined
      const data = snapshot.data()
      if (data?.elements) {
        data.nodes = data.elements
        delete data.elements
      }
      if (data?.['bundleId']) {
        data.pluginId = data['bundleId']
        delete data['bundleId']
      }
      if (data?.nodes) {
        // Nodes saved while updateDoc bypassed the client converter are plain
        // maps rather than compressed bytes; decode only binary payloads.
        data.nodes = ArrayBuffer.isView(data.nodes)
          ? decompress(data.nodes)
          : data.nodes
      }
      data.$id = snapshot.id
      return data as Aglyn.AglynScreenVersion
    },
  }

export const layoutConverter: FirestoreDataConverter<Aglyn.AglynLayout> = {
  toFirestore(data) {
    if (data.$id) delete data.$id
    data.updatedAt = Timestamp.now()
    return data
  },
  fromFirestore(snapshot) {
    if (!snapshot.exists) return undefined
    const data = snapshot.data()
    data.$id = snapshot.id
    return data as Aglyn.AglynLayout
  },
}

// Layout versions persist nodes exactly like screen versions (compressed).
export const layoutVersionConverter =
  screenVersionConverter as unknown as FirestoreDataConverter<Aglyn.AglynLayoutVersion>

/**
 * Compatibility facade replacing firebase-admin v14's removed namespace API
 * (`import * as admin from 'firebase-admin'`) so existing call sites
 * (`firebaseAdmin.app().firestore()`, `firebaseAdmin.firestore.FieldValue`,
 * `firebaseAdmin.database()`) keep working unchanged, backed internally by
 * the modular SDK.
 */
/**
 * Auth wrapped so `verifyIdToken` also asks whether the account was revoked
 * (AGL-1881).
 *
 * WHY HERE, and not at the call sites: the audit found `checkRevoked` set on
 * 3 of 175 verifications, which is what a per-call-site opt-in converges to.
 * Every server door in this repo reaches auth through `firebaseAdmin.app()` —
 * all 117 console API routes, the marketplace/commerce/bookings plugin
 * servers, `authForPool`, `release-flags` — so this ONE function is where the
 * question can be asked once and be true everywhere, including on routes
 * written next year by someone who has never read AGL-1881.
 * `token-revocation.spec.ts` pins that the wrapping is real; the guard in
 * `token-revocation-coverage.spec.ts` pins that no future door bypasses it.
 *
 * A Proxy rather than a hand-written facade because `BaseAuth` has ~40
 * methods and a facade that listed 39 of them would silently drop the
 * fortieth. Only `verifyIdToken` and `tenantManager` are intercepted;
 * everything else is the SDK's own method, bound to the SDK's own instance.
 *
 * `tenantManager` is wrapped recursively because a GCIP tenant's
 * `TenantAwareAuth` is a DIFFERENT auth object with its own `verifyIdToken`,
 * and five console routes verify SSO tokens through it. Unwrapped, those five
 * would be exactly the holes this exists to close.
 *
 * An explicit `checkRevoked: true` is left alone: firebase-admin then runs the
 * same three checks itself, and doing both would buy one answer with two
 * round trips.
 */
function revocationCheckedAuth<T extends object>(target: T): T {
  return new Proxy(target, {
    get(auth, prop, receiver) {
      if (prop === 'verifyIdToken') {
        return async (...args: unknown[]) => {
          const verify = Reflect.get(auth, prop, auth) as (
            ...a: unknown[]
          ) => Promise<DecodedIdToken>
          // Spread, never `(token, checkRevoked)`: passing an explicit
          // `undefined` where the caller passed nothing changes what the SDK
          // sees, and a wrapper that alters the call it forwards is not a
          // wrapper.
          const decoded = await verify.apply(auth, args)
          if (args[1] === true) return decoded
          // `auth`, not `receiver`: the lookup must land on the pool that
          // verified the token (AGL-2005), and it must not re-enter this
          // proxy.
          await assertIdTokenNotRevoked(
            auth as unknown as Pick<BaseAuth, 'getUser'>,
            decoded,
          )
          return decoded
        }
      }
      if (prop === 'tenantManager') {
        return (...args: unknown[]) => {
          const manager = (
            Reflect.get(auth, prop, auth) as (...a: unknown[]) => object
          ).apply(auth, args)
          return new Proxy(manager, {
            get(mgr, key, mgrReceiver) {
              if (key === 'authForTenant') {
                return (...tenantArgs: unknown[]) =>
                  revocationCheckedAuth(
                    (
                      Reflect.get(mgr, key, mgr) as (...a: unknown[]) => object
                    ).apply(mgr, tenantArgs),
                  )
              }
              const value = Reflect.get(mgr, key, mgrReceiver)
              return typeof value === 'function' ? value.bind(mgr) : value
            },
          })
        }
      }
      const value = Reflect.get(auth, prop, receiver)
      // Bound to the SDK instance: firebase-admin's Auth keeps private state
      // on `this`, and an unbound method handed out through a Proxy loses it.
      return typeof value === 'function' ? value.bind(auth) : value
    },
  })
}

function wrapApp(app: App) {
  return {
    firestore: () => getFirestore(app, firestoreDatabaseId()),
    auth: () => revocationCheckedAuth(getAuth(app)),
    storage: () => getStorage(app),
    // Release-flag management (AGL-230): the staff admin flags API reads
    // and publishes the Remote Config template server-side.
    remoteConfig: () => getRemoteConfig(app),
  }
}

function firestoreNamespace() {
  return getFirestore(getApp(), firestoreDatabaseId())
}
firestoreNamespace.FieldValue = FieldValue
firestoreNamespace.Timestamp = Timestamp
firestoreNamespace.FieldPath = FieldPath

const firebaseAdmin = {
  app: (name?: string) => wrapApp(name ? getApp(name) : getApp()),
  firestore: firestoreNamespace,
  database: () => getDatabase(getApp()),
}

/**
 * Email-verification gate (AGL-479). Email/password accounts must verify
 * their address before any console access; OAuth accounts arrive with
 * `email_verified: true`, so they pass untouched. `verifyConsoleIdToken`
 * verifies the ID token exactly like `auth().verifyIdToken` and additionally
 * throws `EmailNotVerifiedError` when the address is unverified — verified
 * callers see identical behavior. Route handlers pair the raw verify with
 * `emailUnverifiedResponse()` (a 403) so the denial stays distinct from an
 * invalid-token 401. Fails closed: a token with no `email_verified` claim
 * (e.g. some custom-token sign-ins) is treated as unverified.
 *
 * Exception (AGL-480): staff impersonation sessions carry an `impersonatedBy`
 * claim (minted by /api/admin/impersonate). Staff have already authenticated
 * and the act is audited, so the impersonated account's own verification
 * state must not gate the support session — otherwise staff can't reach a
 * brand-new, still-unverified owner, the exact account most likely to need
 * help. `isImpersonationSession` gates that exemption.
 */
export class EmailNotVerifiedError extends Error {
  readonly code = 'auth/email-not-verified'
  constructor() {
    super('Email address not verified')
    this.name = 'EmailNotVerifiedError'
  }
}

export function isEmailVerified(decoded: DecodedIdToken): boolean {
  return decoded.email_verified === true
}

/** Staff impersonation session (AGL-357/AGL-480): token minted with an
 * `impersonatedBy` claim. Exempt from the email-verification gate. */
export function isImpersonationSession(decoded: DecodedIdToken): boolean {
  return typeof decoded['impersonatedBy'] === 'string'
}

export async function verifyConsoleIdToken(
  idToken: string,
  checkRevoked?: boolean,
): Promise<DecodedIdToken> {
  // `firebaseAdmin.app().auth()`, not a bare `getAuth` (AGL-1881): the raw
  // SDK handle skips the revocation check, and this helper's whole promise is
  // that it verifies "exactly like `auth().verifyIdToken`" plus the email
  // gate. A door that reads as the STRICTER one while being the looser one is
  // the worst shape available.
  const decoded = await firebaseAdmin
    .app()
    .auth()
    .verifyIdToken(idToken, checkRevoked)
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    throw new EmailNotVerifiedError()
  }
  return decoded
}

/** 403 sent to callers whose email address is not yet verified (AGL-479). */
export function emailUnverifiedResponse(): Response {
  return Response.json(
    { error: 'Verify your email to continue', reason: 'email-unverified' },
    { status: 403 },
  )
}

export { firebaseAdmin }
export default firebaseAdmin
