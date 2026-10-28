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
 * Per-member permission overrides (AGL-4047): the writes behind the member
 * Permissions section and the per-site collaborator toggles.
 *
 * Two places a member's own decisions live, and each write may set a key
 * (`true` / `false`) or CLEAR it (`null`, back to inherit):
 *
 * - `permissions[key]` on `orgs/{orgId}/members/{uid}` for an org catalog
 *   key, layered over the org role and the custom role by
 *   `resolveOrgPermissions`;
 * - `hostPermissions[hostId][key]` for a key a site collaborator holds per
 *   site, layered over their host role by `resolveCollaboratorHostPermissions`,
 *   and for a key a site narrows, for a workspace-wide member that site
 *   narrows (AGL-4047, `narrowPermissionsToSite`).
 *
 * Catalog keys are dotted (`billing.view`), so every write addresses the
 * field through a `FieldPath` — a dotted string would be read as nesting.
 * Both writes re-project before they answer: `resolvedPermissions` on the
 * member and `memberPermissions` on the hosts are what the rules read, and
 * a narrowing that answers 200 before it is stamped is a window in which
 * the rules still grant.
 */

import {
  hostPermissionKeys,
  narrowPermissionsToSite,
  ORG_PERMISSION_KEYS,
  resolveCollaboratorHostPermissions,
  siteNarrowedPermissionKeys,
  siteNarrowingFor,
  type AglynOrgMember,
} from '@aglyn/aglyn/server'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'
import { resolveMemberOrgPermissions, syncOrgAuthProjections } from './organizations'

const firestore = () => firebaseAdmin.app().firestore()

/** A key to `true` / `false`, or to `null` to clear it. */
export type PermissionOverrideWrite = Record<string, boolean | null>

/** A member's verdicts on either side of an override write. */
export interface PermissionOverridesResult {
  before: Record<string, boolean>
  after: Record<string, boolean>
  /** The member document as it stands after the write. */
  member: AglynOrgMember
}

function memberRef(orgId: string, uid: string) {
  return firestore().collection('orgs').doc(orgId).collection('members').doc(uid)
}

/**
 * Writes a map of keys under `parents` on one document: each set, or
 * deleted on null, in one update, addressed by `FieldPath` so a dotted key
 * stays one field.
 */
async function updateFields(
  ref: FirebaseFirestore.DocumentReference,
  parents: readonly string[],
  changes: PermissionOverrideWrite,
): Promise<void> {
  const [head, ...tail] = Object.entries(changes).map(
    ([key, value]) => [new FieldPath(...parents, key), value === null ? FieldValue.delete() : value] as const,
  )
  if (!head) return
  await ref.update(head[0], head[1], ...tail.flat())
}

/**
 * Sets or clears a member's org-level overrides. Keys outside the catalog
 * are refused before anything is written (the route validates first; this
 * is the floor). The member must exist.
 */
export async function setMemberPermissionOverrides(options: {
  orgId: string
  uid: string
  changes: PermissionOverrideWrite
}): Promise<PermissionOverridesResult> {
  const { orgId, uid, changes } = options
  const catalog = new Set<string>(ORG_PERMISSION_KEYS)
  for (const key of Object.keys(changes)) {
    if (!catalog.has(key)) throw new Error(`"${key}" is not a catalog permission`)
  }
  const ref = memberRef(orgId, uid)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new Error('member not found')
  const stored = { $id: uid, ...snapshot.data() } as AglynOrgMember
  const before = await resolveMemberOrgPermissions(orgId, stored)
  await updateFields(ref, ['permissions'], changes)
  await syncOrgAuthProjections(orgId)
  const member = { $id: uid, ...(await ref.get()).data() } as AglynOrgMember
  return { before, after: await resolveMemberOrgPermissions(orgId, member), member }
}

/**
 * Sets or clears a member's per-site toggles on one site. For a site
 * collaborator, only the keys a plugin declared per-site
 * (`hostPermissionKeys`) are stored. For a member who works across the
 * workspace, only on a site that narrows them and only the keys such a site
 * narrows (`siteNarrowedPermissionKeys`, AGL-4047): the site's way to give
 * back, or keep refused, what their narrower access there took. The member
 * must reach the site.
 */
export async function setHostPermissionOverrides(options: {
  orgId: string
  uid: string
  hostId: string
  changes: PermissionOverrideWrite
}): Promise<PermissionOverridesResult> {
  const { orgId, uid, hostId, changes } = options
  const ref = memberRef(orgId, uid)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new Error('member not found')
  const stored = { $id: uid, ...snapshot.data() } as AglynOrgMember
  const narrowed = siteNarrowingFor(stored, hostId) !== null
  const siteKeys = new Set(narrowed ? siteNarrowedPermissionKeys() : hostPermissionKeys())
  for (const key of Object.keys(changes)) {
    if (!siteKeys.has(key)) throw new Error(`"${key}" is not a per-site permission`)
  }
  // A narrowed member's verdict on this site, every per-site key and every
  // key the site narrows, from the same resolver the rules projection uses.
  const narrowedVerdicts = async (member: AglynOrgMember): Promise<Record<string, boolean>> => {
    const granted = narrowPermissionsToSite(
      await resolveMemberOrgPermissions(orgId, member),
      siteNarrowingFor(member, hostId),
    )
    return Object.fromEntries(
      [...hostPermissionKeys(), ...siteNarrowedPermissionKeys()].map((key) => [key, granted[key] === true]),
    )
  }
  const before = narrowed ? await narrowedVerdicts(stored) : resolveCollaboratorHostPermissions(stored, hostId)
  if (!before) throw new Error('member has no access to this site')
  await updateFields(ref, ['hostPermissions', hostId], changes)
  await syncOrgAuthProjections(orgId, hostId)
  const member = { $id: uid, ...(await ref.get()).data() } as AglynOrgMember
  return {
    before,
    after: narrowed
      ? await narrowedVerdicts(member)
      : (resolveCollaboratorHostPermissions(member, hostId) ??
        Object.fromEntries([...siteKeys].map((key) => [key, false]))),
    member,
  }
}
