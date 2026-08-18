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
 * Propagate the avatar a person chose for themselves onto every org roster
 * row that names them (AGL-1976).
 *
 * `orgs/{orgId}/members/{uid}.photoURL` is the ONLY avatar any member surface
 * reads — the Team list, the member detail page, activity entries and presence
 * all feed `MemberAvatar` from the roster row, because none of them can read
 * another person's auth record: an SSO member's lives in a per-org GCIP pool
 * that project-level auth cannot see at all (AGL-1122). Manage Account →
 * Profile image wrote `users/{uid}.photoUrl` and the auth record and stopped
 * there, so a person who set an avatar saw it in their own app bar and their
 * colleagues went on seeing a grey initial (AGL-1126, reopened by AGL-1961
 * fixing only the app bar half).
 *
 * ## Why this is a server function and not a client write
 *
 * `orgs/{orgId}/members/{memberUid}` is `allow write: if false` in
 * `cloud/firebase-firestore.rules`, and that is the right rule: the roster row
 * is a PERMISSIONS document. It carries `role`, `allHosts`, `hostAccess` and
 * `roleId` alongside the display identity, and a field-scoped self-write
 * exception on a permissions document — to render an avatar — is the wrong
 * shape of risk to take. It also has to fan out: a person can belong to
 * several workspaces and all their rows should agree.
 *
 * ## THE DISTINCTION THIS FILE EXISTS TO GET RIGHT
 *
 * `backfillMemberIdentity` (AGL-1131) is **absent-only** and must stay that
 * way: it runs on the SSO sign-in path on EVERY sign-in, so an overwriting
 * version would replace a photo somebody uploaded with their IdP directory
 * thumbnail, silently, on their next sign-in — and it would do it forever.
 *
 * This function is the opposite case and must **overwrite**. A person opening
 * Manage Account, typing a URL and pressing Save has stated a preference; a
 * write that declined to replace the IdP thumbnail already sitting on the row
 * would leave them looking at the old picture with no way to change it, which
 * is the same defect as the one being fixed, only harder to explain.
 *
 * The two rules are not in tension because their inputs differ in kind: one is
 * an assertion made ABOUT a person by a directory, the other is a choice made
 * BY the person. `member-photo.spec.ts` pins both directions in one file, so a
 * future edit that collapses them into a single helper fails a test.
 *
 * ## The value is not trusted because a member typed it
 *
 * It ends up as an `<img src>` in front of every colleague in the workspace,
 * so it is re-validated here rather than at the client that offered it —
 * `https://` only, the same rule `resolveIdpPhotoUrl` enforces on an IdP
 * assertion (AGL-1131), which exists to refuse `javascript:` and `data:` URLs.
 * The client's check is a courtesy to the person typing; this one is the
 * boundary.
 */

import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

const firestore = () => firebaseAdmin.app().firestore()

/**
 * Matches the cap the staff identity editor already imposes on the same field
 * (`/api/admin/users/manage`, `updateProfile`), so the two surfaces cannot
 * accept different values for one column.
 */
export const MEMBER_PHOTO_MAX_LENGTH = 500

export type MemberPhotoRejection = 'not-https' | 'too-long'

/**
 * Flat rather than a discriminated union on `ok`, because `strictNullChecks`
 * is OFF repo-wide and TypeScript will not narrow a boolean-literal
 * discriminant without it — `if (!value.ok)` left `reason` unreachable in
 * every caller. The shape is still exact: a refusal carries `reason` and no
 * `photoURL`, an acceptance the reverse, and the spec asserts both with
 * `toEqual`.
 */
export interface MemberPhotoValue {
  ok: boolean
  /** The storable value, on an acceptance. `''` when clearing. */
  photoURL?: string
  /** Whether this acceptance removes the avatar rather than setting one. */
  clearing?: boolean
  /** Why it was refused, on a refusal. */
  reason?: MemberPhotoRejection
}

/**
 * Normalize what a caller offered into either a storable URL or a refusal.
 *
 * An empty string is a legitimate value and means CLEAR — "worth doing at the
 * same time" per AGL-1976, because otherwise a removed avatar lingers on the
 * roster after it is gone everywhere else, which is the same bug pointing the
 * other way.
 *
 * Pure, so the policy can be tested without Firestore.
 */
export function normalizeMemberPhotoUrl(raw: unknown): MemberPhotoValue {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ok: true, photoURL: '', clearing: true }
  if (value.length > MEMBER_PHOTO_MAX_LENGTH) return { ok: false, reason: 'too-long' }
  // `https://` and nothing else. Not a general URL parse: the point is to
  // refuse the schemes that turn an avatar into script execution, and an
  // allowlist of one is the only form of that check that cannot be widened by
  // a clever input.
  if (!/^https:\/\//i.test(value)) return { ok: false, reason: 'not-https' }
  return { ok: true, photoURL: value, clearing: false }
}

export interface PropagateMemberPhotoResult {
  /** Orgs whose roster row was updated. */
  orgIds: string[]
  /** Memberships listed but with no roster row to write — see below. */
  missingRows: string[]
  /** Whether the photo was removed rather than set. */
  cleared: boolean
}

/**
 * Write `photoURL` — and nothing else — onto every roster row for `uid`.
 *
 * Memberships are enumerated from `users/{uid}/orgs`, the same reverse index
 * `eraseUser` walks to find the rosters a person appears on. Using it rather
 * than a collection-group query over `members` is deliberate: a collection
 * group would read every workspace's roster in the estate to find one person's
 * rows, and this runs on an interactive save.
 *
 * A membership whose roster row does NOT exist is reported and skipped, never
 * created. Minting a row here would produce a membership document with no
 * `role`, which every permission check that asks only whether the doc exists
 * reads as a member of some kind — the AGL-1122 bug class, and the same reason
 * `backfillMemberIdentity` refuses it.
 *
 * Each write is a `merge` carrying exactly one key, so `role`, `allHosts`,
 * `hostAccess` and `roleId` are untouched by construction rather than by
 * remembering to leave them alone.
 *
 * @param input - the uid to write for and the value: an `https://` URL to
 *        set, or `''`/`null` to clear.
 */
export async function propagateMemberPhoto(input: {
  uid: string
  photoURL: string | null
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
}): Promise<PropagateMemberPhotoResult> {
  const db = input.firestore ?? firestore()
  const normalized = normalizeMemberPhotoUrl(input.photoURL)
  if (!normalized.ok) {
    // Callers validate first; reaching here means a route forgot to. Throwing
    // is better than storing an unvalidated value on ten colleagues' screens.
    throw new Error(`propagateMemberPhoto: refused photo (${normalized.reason})`)
  }
  if (!input.uid) return { orgIds: [], missingRows: [], cleared: normalized.clearing }

  const memberships = await db
    .collection('users')
    .doc(input.uid)
    .collection('orgs')
    .get()

  const orgIds: string[] = []
  const missingRows: string[] = []
  for (const row of memberships.docs) {
    const ref = db
      .collection('orgs')
      .doc(row.id)
      .collection('members')
      .doc(input.uid)
    const snapshot = await ref.get()
    if (!snapshot.exists) {
      missingRows.push(row.id)
      continue
    }
    // `FieldValue.delete()` rather than `''` on a clear. A blank string is a
    // value, and `backfillMemberIdentity`'s `blank()` treats it as absent —
    // so storing `''` would invite the IdP to refill the row on the next
    // sign-in with exactly the photo the person just removed.
    await ref.set(
      {
        photoURL: normalized.clearing
          ? FieldValue.delete()
          : normalized.photoURL,
      },
      { merge: true },
    )
    orgIds.push(row.id)
  }

  return { orgIds, missingRows, cleared: normalized.clearing }
}

export default propagateMemberPhoto
