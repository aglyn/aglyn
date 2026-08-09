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
 * Bulk uid → person resolution for staff surfaces (AGL-938).
 *
 * A staff page must never show a raw uid where a name or email will do
 * (AGL-810), but "resolve the uid" is a three-store question:
 *
 * 1. **Firebase Auth pools** — the project pool plus every GCIP tenant, via
 *    `findUserByUidAcrossPools` (AGL-1122). A project-level lookup alone
 *    would silently miss every SSO account.
 * 2. **The org member roster**, `orgs/{orgId}/members/{uid}` — the identity
 *    source for members whose auth record cannot be reached (a deleted
 *    account whose membership lingers, or a tenant-listing outage while the
 *    pools fail soft). The roster carries `email`/`displayName` precisely so
 *    other people stay nameable without an auth read (AGL-1127).
 * 3. **Nobody** — `system:cron` actors, erased accounts. The uid comes back
 *    marked unresolved so the caller can render it as itself, with a hint,
 *    rather than crash or spin.
 *
 * Fail-soft by contract: an outage in any store degrades a name back to a
 * uid. It must never take down the page that asked.
 */

import type { PooledUserRecord } from './auth-pools'
import { findUserByUidAcrossPools } from './auth-pools'
import firebaseAdmin from './firebase-admin'

/** Where a uid resolved: an auth pool, the org roster, or nowhere. */
export type PersonSource = 'auth' | 'roster'

export interface ResolvedPerson {
  uid: string
  email: string | null
  displayName: string | null
  /** Null when no store answered — render the uid itself, flagged unknown. */
  source: PersonSource | null
}

export interface ResolveUidsOptions {
  /**
   * Org whose member roster backs up the auth pools. Without it, uids that
   * miss every pool simply come back unresolved.
   */
  orgId?: string
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
  /** Injectable for tests; defaults to `findUserByUidAcrossPools`. */
  findUser?: (uid: string) => Promise<PooledUserRecord | null>
}

/**
 * Resolve a batch of uids to people, deduplicated, keyed by uid. Every
 * requested uid is present in the result — unresolvable ones as
 * `{ email: null, displayName: null, source: null }` — so callers can index
 * without existence checks.
 */
export async function resolveUidsToPeople(
  uids: ReadonlyArray<string | null | undefined>,
  options: ResolveUidsOptions = {},
): Promise<Record<string, ResolvedPerson>> {
  const find = options.findUser ?? findUserByUidAcrossPools
  const unique = [
    ...new Set(
      uids.filter((uid): uid is string => typeof uid === 'string' && !!uid),
    ),
  ]
  const people: Record<string, ResolvedPerson> = {}
  const missed: string[] = []

  await Promise.all(
    unique.map(async (uid) => {
      try {
        const found = await find(uid)
        if (found) {
          people[uid] = {
            uid,
            email: found.record.email ?? null,
            displayName: found.record.displayName ?? null,
            source: 'auth',
          }
          return
        }
      } catch {
        // An auth outage is a miss, not a failure — the roster below may
        // still name this person.
      }
      missed.push(uid)
    }),
  )

  if (missed.length && options.orgId) {
    try {
      const db = options.firestore ?? firebaseAdmin.app().firestore()
      const members = db
        .collection('orgs')
        .doc(options.orgId)
        .collection('members')
      const snapshots = await db.getAll(
        ...missed.map((uid: string) => members.doc(uid)),
      )
      snapshots.forEach((snapshot: any, index: number) => {
        if (!snapshot.exists) return
        const email = snapshot.get('email')
        const displayName = snapshot.get('displayName')
        // A roster doc with neither field names nobody — that uid stays
        // unresolved rather than resolving to an empty person.
        if (typeof email !== 'string' && typeof displayName !== 'string') {
          return
        }
        people[missed[index]] = {
          uid: missed[index],
          email: typeof email === 'string' && email ? email : null,
          displayName:
            typeof displayName === 'string' && displayName
              ? displayName
              : null,
          source: 'roster',
        }
      })
    } catch (error) {
      // Roster unreachable: those uids render as themselves. Logged, not
      // thrown — a labelling nicety must not 500 the page that asked.
      console.error('roster fallback failed while resolving uids', error)
    }
  }

  for (const uid of unique) {
    if (!people[uid]) {
      people[uid] = { uid, email: null, displayName: null, source: null }
    }
  }
  return people
}

export default resolveUidsToPeople
