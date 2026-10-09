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
 * The server half of the account-identity resolver (AGL-3721): reading the
 * profile documents the pure resolver needs, and filling a blank SSO Auth
 * record from what the IdP sent at sign-in.
 *
 * See `@aglyn/shared-util-tools/account-identity` for the precedence and why
 * it exists.
 */

import {
  authIdentityFillFromIdp,
  resolveAccountIdentity,
  type AccountIdentityIdpSource,
  type AccountIdentityProfileSource,
  type ResolvedAccountIdentity,
} from '@aglyn/shared-util-tools/account-identity'
import type { UserRecord } from 'firebase-admin/auth'
import { authForPool } from './auth-pools'
import firebaseAdmin from './firebase-admin'

/** The `users/{uid}` fields the resolver reads, plus the removal marker. */
export interface AccountProfileIdentity extends AccountIdentityProfileSource {
  photoUrlErasedAt?: unknown
}

const PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'displayName',
  'photoUrl',
  'photoUrlErasedAt',
] as const

/** `getAll` takes any number of refs; chunked so one call stays modest. */
const GET_ALL_CHUNK = 100

function pickProfile(data: Record<string, unknown> | undefined): AccountProfileIdentity {
  const out: Record<string, unknown> = {}
  for (const field of PROFILE_FIELDS) {
    if (data && data[field] !== undefined) out[field] = data[field]
  }
  return out as AccountProfileIdentity
}

/**
 * The identity fields of each account's `users/{uid}` document, keyed by
 * uid. A uid with no document is absent from the map. Read with `getAll`, so
 * N accounts cost N document reads in ⌈N/100⌉ round trips — callers pass
 * only the accounts whose Auth record left something blank.
 */
export async function readAccountProfiles(
  uids: readonly string[],
  options: { firestore?: any } = {},
): Promise<Map<string, AccountProfileIdentity>> {
  const db = options.firestore ?? firebaseAdmin.app().firestore()
  const unique = [...new Set(uids.filter(Boolean))]
  const out = new Map<string, AccountProfileIdentity>()
  for (let i = 0; i < unique.length; i += GET_ALL_CHUNK) {
    const refs = unique
      .slice(i, i + GET_ALL_CHUNK)
      .map((uid) => db.collection('users').doc(uid))
    if (!refs.length) continue
    const snapshots = await db.getAll(...refs)
    for (const snapshot of snapshots) {
      if (snapshot.exists) out.set(snapshot.id, pickProfile(snapshot.data()))
    }
  }
  return out
}

/** The Auth-record fields the resolver reads. */
type IdentityRecord = Pick<UserRecord, 'displayName' | 'photoURL' | 'providerData'>

/** Resolve one Auth record (plus its profile, when read) to a name and photo. */
export function resolveUserRecordIdentity(
  record: IdentityRecord & { email?: string | null },
  profile?: AccountIdentityProfileSource | null,
  idp?: AccountIdentityIdpSource | null,
): ResolvedAccountIdentity {
  return resolveAccountIdentity({
    auth: {
      displayName: record.displayName,
      photoURL: record.photoURL,
      providerData: record.providerData,
    },
    profile: profile ?? null,
    idp: idp ?? null,
    email: record.email ?? null,
  })
}

/**
 * Whether the Auth record alone leaves the name or the photo blank — the
 * only rows worth a profile read. Providers count: Google's avatar on
 * `providerData` is an answer.
 */
export function userRecordIdentityIncomplete(record: IdentityRecord): boolean {
  const resolved = resolveUserRecordIdentity(record)
  return !resolved.displayName || !resolved.photoUrl
}

/**
 * Resolve a batch of rows that carry an Auth record, reading `users/{uid}`
 * only for the rows the record leaves incomplete.
 */
export async function resolveUserRecordIdentities<
  Row extends { record: IdentityRecord & { uid: string; email?: string | null } },
>(
  rows: readonly Row[],
  options: { firestore?: any } = {},
): Promise<Map<string, ResolvedAccountIdentity>> {
  const incomplete = rows
    .filter((row) => userRecordIdentityIncomplete(row.record))
    .map((row) => row.record.uid)
  let profiles = new Map<string, AccountProfileIdentity>()
  if (incomplete.length) {
    try {
      profiles = await readAccountProfiles(incomplete, options)
    } catch (error) {
      // A cosmetic enrichment must not fail the listing: the rows fall back
      // to what the Auth record says, which is what they showed before.
      console.error('[account-identity] profile read failed', error)
    }
  }
  const out = new Map<string, ResolvedAccountIdentity>()
  for (const row of rows) {
    out.set(
      row.record.uid,
      resolveUserRecordIdentity(row.record, profiles.get(row.record.uid) ?? null),
    )
  }
  return out
}

export interface SyncAuthIdentityInput {
  uid: string
  /** GCIP tenant id, or null for the project pool. */
  tenantId: string | null
  /** The Auth record when the caller already holds it; read otherwise. */
  record?: Pick<UserRecord, 'displayName' | 'photoURL'> | null
  /** What the IdP sent: `resolveIdpDisplayName` / `resolveIdpPhotoUrl`. */
  idp: { displayName?: string | null; photoUrl?: string | null }
  /** Injectable for tests. */
  firestore?: any
  auth?: { getUser(uid: string): Promise<Pick<UserRecord, 'displayName' | 'photoURL'>>; updateUser(uid: string, fields: Record<string, unknown>): Promise<unknown> }
}

/**
 * Fill an Auth record's blank `displayName` / `photoURL` from the IdP's copy
 * at sign-in (AGL-3721).
 *
 * The Auth record is what every Admin-SDK surface reads — the staff Users
 * list, the staff user page, the members route mirroring identity onto a
 * roster — and a SAML sign-in leaves both fields empty, because GCIP keeps the
 * assertion's attributes on the token rather than on the record. The profile
 * seed already stores them in `users/{uid}`; this puts them where the rest of
 * the platform looks too.
 *
 * NEVER OVERWRITES. Only a blank field is written, so a name or photo the
 * person or staff set always wins over the directory's. The photo also honours
 * the profile's `photoUrlErasedAt`: someone who removed their avatar has asked
 * not to have the directory's put back, and the Auth record is no exception.
 */
export async function syncAuthIdentityFromIdp(
  input: SyncAuthIdentityInput,
): Promise<{ fields: string[] }> {
  const wantsName = Boolean(String(input.idp.displayName ?? '').trim())
  const wantsPhoto = Boolean(String(input.idp.photoUrl ?? '').trim())
  if (!wantsName && !wantsPhoto) return { fields: [] }
  const pool = input.auth ?? authForPool(input.tenantId)
  const record = input.record ?? (await pool.getUser(input.uid))
  // Nothing blank that the IdP could fill — the common case after the first
  // sign-in, and it costs no profile read.
  let fill = authIdentityFillFromIdp({ auth: record, idp: input.idp })
  if (!Object.keys(fill).length) return { fields: [] }
  if (fill.photoURL) {
    const db = input.firestore ?? firebaseAdmin.app().firestore()
    const profile = await db.collection('users').doc(input.uid).get()
    fill = authIdentityFillFromIdp({
      auth: record,
      idp: input.idp,
      photoErased: Boolean(profile.exists && profile.get('photoUrlErasedAt')),
    })
    if (!Object.keys(fill).length) return { fields: [] }
  }
  await pool.updateUser(input.uid, fill)
  return { fields: Object.keys(fill) }
}
