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
 * Per-user host membership projection (AGL-844): a reverse index at
 * `users/{uid}/hostMemberships/{hostId}` mirroring `hosts/{hostId}.memberRoles`
 * — the hosts a user can reach in an org, denormalized with the name so the
 * site switcher and subdomain→id routing can query + order + name-prefix-search
 * a user's own sites without loading the whole `hosts` collection (which the
 * rules can only serve unordered under a per-user `memberRoles.{uid}` filter).
 *
 * Because it lives under the user's own doc it is owner-readable and already
 * membership-filtered, so `where(orgId==…) orderBy(nameLower|updatedAt)` is a
 * plain composite index (no dynamic map path). Admin-SDK-written only.
 *
 * It is a best-effort convenience index, NOT an authorization source: real
 * access stays gated by `hosts/{hostId}.memberRoles` in the rules, so a stale
 * row at worst shows a site that then 404s on read — never grants access.
 *
 * Writers are scoped, mirroring the `users/{uid}/orgs` reverse index: a member
 * change re-syncs THAT member across the org's hosts; a host change re-syncs
 * THAT host across members. Kept in sync at the same points as `memberRoles`
 * (see `syncHostMemberRoles` callers) plus the erase/displayName gaps (AGL-855).
 */

import {
  hostRoleFor,
  isOrgWideMember,
  nameSearchKey,
  type AglynOrganization,
  type AglynOrgMember,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

const firestore = () => firebaseAdmin.app().firestore()

/** Firestore caps a batch at 500 writes; commit in chunks below that. */
const CHUNK = 400

interface HostMeta {
  displayName?: string
  subdomain?: string
  favicon?: string
}

const orgHostIds = async (
  db: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<string[]> => {
  const org = (await db.collection('orgs').doc(orgId).get()).data() as
    | AglynOrganization
    | undefined
  return Object.keys(org?.hosts ?? {})
}

const readHostMeta = async (
  db: FirebaseFirestore.Firestore,
  hostIds: string[],
): Promise<Map<string, HostMeta>> => {
  if (hostIds.length === 0) return new Map()
  const snaps = await db.getAll(
    ...hostIds.map((id) => db.collection('hosts').doc(id)),
  )
  return new Map(
    snaps.map((snap) => [
      snap.id,
      {
        displayName: snap.get('displayName'),
        subdomain: snap.get('subdomain'),
        // The switcher renders from the projection, not the host doc, so the
        // favicon has to travel with it (AGL-1071).
        favicon: snap.get('seo')?.favicon,
      },
    ]),
  )
}

const listMembers = async (
  db: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<AglynOrgMember[]> => {
  const snap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .get()
  return snap.docs.map((d) => ({ $id: d.id, ...d.data() }) as AglynOrgMember)
}

const membershipRef = (
  db: FirebaseFirestore.Firestore,
  uid: string,
  hostId: string,
) => db.collection('users').doc(uid).collection('hostMemberships').doc(hostId)

/**
 * Shape one projection row. Exported for tests: the favicon rule below is a
 * delete-vs-omit decision that is invisible in review and silent in
 * production when wrong (AGL-1071).
 */
export const membershipRow = (
  orgId: string,
  meta: HostMeta | undefined,
  role: string,
) => {
  const displayName = meta?.displayName ?? ''
  return {
    orgId,
    ...(meta?.subdomain ? { subdomain: meta.subdomain } : {}),
    displayName,
    nameLower: nameSearchKey(displayName),
    // DELETE rather than omit when the site has no favicon (AGL-1071). These
    // rows are written with `{ merge: true }`, so omitting the key leaves
    // whatever was there — clearing a favicon would keep showing the old one
    // in the switcher until something unrelated rewrote the row. The clear
    // path writes `seo.favicon: ''`, so test truthiness, not nullishness.
    favicon: meta?.favicon ? meta.favicon : FieldValue.delete(),
    role,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

/** Runs a set of write operations in ≤CHUNK-sized batches. */
const commitChunked = async (
  db: FirebaseFirestore.Firestore,
  ops: Array<(batch: FirebaseFirestore.WriteBatch) => void>,
): Promise<void> => {
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + CHUNK)) op(batch)
    await batch.commit()
  }
}

/**
 * Mirror the member's org-wide reach onto their `users/{uid}/orgs/{orgId}`
 * row (AGL-1032), so the console can tell a site collaborator from an
 * org-wide viewer without a second read on every org route.
 *
 * Rides the projection pass rather than being a call the membership APIs
 * each have to remember: every path that changes a member's reach — add,
 * role change, grant, revoke, ownership transfer — already re-syncs their
 * host rows, so one funnel keeps the mirror true and self-heals a row an
 * earlier failure left stale.
 *
 * Only ever UPDATES an existing row. The reverse index is created with the
 * membership and deleted with it; a `set`/merge here on a removed member
 * would resurrect a half-row with no `orgName` or `slug`, and the console
 * renders that as a nameless workspace nobody can open.
 */
async function syncMemberOrgReach(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
  member: AglynOrgMember | null,
): Promise<void> {
  if (!member) return
  const ref = db.collection('users').doc(uid).collection('orgs').doc(orgId)
  const snap = await ref.get()
  if (!snap.exists) return
  const orgWide = isOrgWideMember(member)
  if (snap.get('orgWide') === orgWide) return
  await ref.set({ orgWide }, { merge: true })
}

/**
 * Re-sync ONE member's projection rows across all the org's hosts: set a row
 * for every host the member can reach, delete the row for every host they
 * cannot (a role downgrade silently drops hosts). Call after any change to a
 * single member (add / role change / grant / revoke / ownership step).
 */
export async function syncMemberHostProjections(
  orgId: string,
  uid: string,
): Promise<void> {
  const db = firestore()
  const [memberSnap, hostIds] = await Promise.all([
    db.collection('orgs').doc(orgId).collection('members').doc(uid).get(),
    orgHostIds(db, orgId),
  ])
  const member = memberSnap.exists
    ? ({ $id: uid, ...memberSnap.data() } as AglynOrgMember)
    : null
  await syncMemberOrgReach(db, orgId, uid, member)
  const meta = await readHostMeta(db, hostIds)
  const ops = hostIds.map((hostId) => (batch: FirebaseFirestore.WriteBatch) => {
    const role = hostRoleFor(member, hostId)
    const ref = membershipRef(db, uid, hostId)
    if (role) batch.set(ref, membershipRow(orgId, meta.get(hostId), role), { merge: true })
    else batch.delete(ref)
  })
  await commitChunked(db, ops)
}

/**
 * Re-sync ONE host's projection rows across all org members: set a row for
 * every member who can reach it, delete for those who cannot. Call after a
 * host is created, renamed, or its displayName changes.
 */
export async function syncHostProjectionForMembers(
  orgId: string,
  hostId: string,
): Promise<void> {
  const db = firestore()
  const [members, meta] = await Promise.all([
    listMembers(db, orgId),
    readHostMeta(db, [hostId]),
  ])
  const hostMeta = meta.get(hostId)
  const ops = members.map((member) => (batch: FirebaseFirestore.WriteBatch) => {
    const role = hostRoleFor(member, hostId)
    const ref = membershipRef(db, member.$id, hostId)
    if (role) batch.set(ref, membershipRow(orgId, hostMeta, role), { merge: true })
    else batch.delete(ref)
  })
  await commitChunked(db, ops)
}

/** Delete every projection row for a member across the org's hosts (member removed). */
export async function deleteMemberHostProjections(
  orgId: string,
  uid: string,
): Promise<void> {
  const db = firestore()
  const hostIds = await orgHostIds(db, orgId)
  await commitChunked(
    db,
    hostIds.map((hostId) => (batch: FirebaseFirestore.WriteBatch) => {
      batch.delete(membershipRef(db, uid, hostId))
    }),
  )
}

/** Delete every member's projection row for one host (host erased). */
export async function deleteHostProjectionForAllMembers(
  orgId: string,
  hostId: string,
): Promise<void> {
  const db = firestore()
  const members = await listMembers(db, orgId)
  await commitChunked(
    db,
    members.map((member) => (batch: FirebaseFirestore.WriteBatch) => {
      batch.delete(membershipRef(db, member.$id, hostId))
    }),
  )
}
