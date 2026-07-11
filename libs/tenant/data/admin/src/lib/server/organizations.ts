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
 * Server-side organization operations (AGL-233/234). Everything here is
 * Admin-SDK-only by design: org creation, slug reservation, membership
 * and the projections the security rules authorize against are never
 * client-writable (docs/MULTI_TENANT_FIRESTORE.md §8).
 */

import {
  createResourceUid,
  generateOrgSlug,
  hasOrgPermission,
  isValidOrgSlug,
  projectHostMemberRoles,
  type AglynOrganization,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type OrgPermission,
  type OrgRole,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

const firestore = () => firebaseAdmin.app().firestore()

export class OrgSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Org slug already reserved: ${slug}`)
    this.name = 'OrgSlugTakenError'
  }
}

export interface CreateOrganizationOptions {
  name: string
  slug: string
  ownerUid: string
  ownerEmail?: string | null
  ownerDisplayName?: string | null
}

/**
 * Creates an org in one transaction: slug reservation (uniqueness), org
 * doc, owner membership, and the owner's reverse-index entry. Throws
 * `OrgSlugTakenError` when the slug is reserved; slug validity is the
 * caller's job (API routes return 400 with policy copy).
 */
export async function createOrganization(
  options: CreateOrganizationOptions,
): Promise<string> {
  const { name, slug, ownerUid, ownerEmail, ownerDisplayName } = options
  const db = firestore()
  const orgId = createResourceUid()
  await db.runTransaction(async (tx) => {
    const reservation = await tx.get(db.collection('orgSlugs').doc(slug))
    if (reservation.exists) throw new OrgSlugTakenError(slug)
    tx.set(db.collection('orgSlugs').doc(slug), { orgId })
    tx.set(db.collection('orgs').doc(orgId), {
      name,
      slug,
      ownerUid,
      hosts: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.set(
      db.collection('orgs').doc(orgId).collection('members').doc(ownerUid),
      {
        role: 'owner',
        allHosts: true,
        email: ownerEmail ?? null,
        displayName: ownerDisplayName ?? null,
        joinedAt: FieldValue.serverTimestamp(),
      },
    )
    tx.set(
      db.collection('users').doc(ownerUid).collection('orgs').doc(orgId),
      { role: 'owner', orgName: name, slug },
    )
  })
  return orgId
}

export interface OrgMembershipResolution {
  orgId: string
  member: AglynOrgMember
}

/**
 * The signed-in user's membership in one org, or null. When `orgId` is
 * omitted, resolves the user's first org from the reverse index (the
 * single-org case every pre-org account lands in after backfill).
 */
export async function resolveOrgMembership(
  uid: string,
  orgId?: string | null,
): Promise<OrgMembershipResolution | null> {
  const db = firestore()
  let resolved = orgId ?? null
  if (!resolved) {
    const mine = await db
      .collection('users')
      .doc(uid)
      .collection('orgs')
      .limit(1)
      .get()
    resolved = mine.empty ? null : mine.docs[0].id
  }
  if (!resolved) return null
  const memberSnapshot = await db
    .collection('orgs')
    .doc(resolved)
    .collection('members')
    .doc(uid)
    .get()
  if (!memberSnapshot.exists) return null
  return {
    orgId: resolved,
    member: { $id: uid, ...memberSnapshot.data() } as AglynOrgMember,
  }
}

/**
 * The user's org, creating a personal one on first need (signup flows and
 * pre-backfill accounts): name from the display name or email local part,
 * slug generated with numeric-suffix retries on collision.
 */
export async function ensureOrgForUser(
  uid: string,
  profile: { email?: string | null; displayName?: string | null } = {},
): Promise<OrgMembershipResolution> {
  const existing = await resolveOrgMembership(uid)
  if (existing) return existing

  const base =
    profile.displayName?.trim() ||
    profile.email?.split('@')[0]?.trim() ||
    'workspace'
  const name = base.slice(0, 80)
  let slug = generateOrgSlug(name) || `org-${createResourceUid().slice(0, 8)}`
  for (let attempt = 0; ; attempt += 1) {
    try {
      const orgId = await createOrganization({
        name,
        slug,
        ownerUid: uid,
        ownerEmail: profile.email ?? null,
        ownerDisplayName: profile.displayName ?? null,
      })
      const created = await resolveOrgMembership(uid, orgId)
      if (!created) throw new Error('Org membership missing after create')
      return created
    } catch (error) {
      if (!(error instanceof OrgSlugTakenError) || attempt >= 4) throw error
      slug = `${slug.slice(0, 26)}-${attempt + 2}`
      if (!isValidOrgSlug(slug)) {
        slug = `org-${createResourceUid().slice(0, 8)}`
      }
    }
  }
}

/**
 * Changes an org's workspace slug (AGL-236): reserves the new slug and
 * updates the org doc in one transaction, leaving the old reservation as
 * a tombstone (`movedTo`) so existing workspace URLs keep resolving —
 * the middleware redirects them. Reverse-index slugs fan out after.
 * Throws `OrgSlugTakenError` when another org holds the new slug; slug
 * validity/authorization are the API route's job.
 */
export async function changeOrgSlug(
  orgId: string,
  newSlug: string,
): Promise<{ previousSlug: string | null }> {
  const db = firestore()
  let previousSlug: string | null = null
  await db.runTransaction(async (tx) => {
    const orgRef = db.collection('orgs').doc(orgId)
    const orgSnapshot = await tx.get(orgRef)
    if (!orgSnapshot.exists) throw new Error(`Unknown org: ${orgId}`)
    previousSlug = (orgSnapshot.get('slug') as string | undefined) ?? null
    if (previousSlug === newSlug) return
    const reservation = await tx.get(db.collection('orgSlugs').doc(newSlug))
    // A tombstone pointing back at this org may be re-claimed.
    if (reservation.exists && reservation.get('orgId') !== orgId) {
      throw new OrgSlugTakenError(newSlug)
    }
    tx.set(db.collection('orgSlugs').doc(newSlug), { orgId })
    tx.set(
      orgRef,
      { slug: newSlug, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    if (previousSlug) {
      tx.set(db.collection('orgSlugs').doc(previousSlug), {
        orgId,
        movedTo: newSlug,
        renamedAt: FieldValue.serverTimestamp(),
      })
    }
  })
  // Reverse index carries the slug for the switcher display.
  const members = await listOrgMembers(orgId)
  const batch = db.batch()
  for (const member of members) {
    batch.set(
      db.collection('users').doc(member.$id).collection('orgs').doc(orgId),
      { slug: newSlug },
      { merge: true },
    )
  }
  await batch.commit()
  return { previousSlug }
}

/** Host → org resolution via the server-written `hostIndex` mirror. */
export async function resolveOrgIdForHost(
  hostId: string,
): Promise<string | null> {
  const snapshot = await firestore().collection('hostIndex').doc(hostId).get()
  const orgId = snapshot.data()?.['orgId']
  return typeof orgId === 'string' ? orgId : null
}

/**
 * The org doc itself — billing, plan, entitlements and suspension (the
 * shape the legacy tenants/{uid} doc carried; orgs are the only billing
 * source since AGL-238). Null when the doc is missing.
 */
export async function getOrgDoc(
  orgId: string,
): Promise<Partial<AglynOrganization> | null> {
  const snapshot = await firestore().collection('orgs').doc(orgId).get()
  return snapshot.exists
    ? ({ $id: snapshot.id, ...snapshot.data() } as Partial<AglynOrganization>)
    : null
}

/**
 * Billing/entitlement source for a host (AGL-238): the owning org's doc
 * via the hostIndex mirror. Null for unindexed hosts — callers treat that
 * as the pre-billing fail-open (every feature on), the same contract the
 * legacy tenants/{uid} read had.
 */
export async function getOrgForHost(hostId: string): Promise<{
  orgId: string
  org: Partial<AglynOrganization>
} | null> {
  const orgId = await resolveOrgIdForHost(hostId)
  if (!orgId) return null
  const org = await getOrgDoc(orgId)
  return org ? { orgId, org } : null
}

/**
 * Billing/entitlement source for a user without host context (account-
 * level APIs): the explicit workspace org when given, else the first org
 * from the reverse index. Null for accounts with no org yet.
 */
export async function getOrgForUser(
  uid: string,
  orgId?: string | null,
): Promise<{
  orgId: string
  org: Partial<AglynOrganization>
  member: AglynOrgMember
} | null> {
  const membership = await resolveOrgMembership(uid, orgId)
  if (!membership) return null
  const org = await getOrgDoc(membership.orgId)
  return org
    ? { orgId: membership.orgId, org, member: membership.member }
    : null
}

/**
 * Org-scoped data collection for a host (AGL-237): datasets, contacts and
 * contactSegments live on the org so every host shares them. Falls back
 * to the host's own subcollection for hosts not yet org-wired (pre-
 * migration safety) — callers use the returned ref for reads AND writes
 * so both sides stay consistent either way.
 */
export async function orgDataCollectionForHost(
  hostId: string,
  name: 'datasets' | 'contacts' | 'contactSegments',
): Promise<FirebaseFirestore.CollectionReference> {
  const orgId = await resolveOrgIdForHost(hostId)
  return orgId
    ? firestore().collection('orgs').doc(orgId).collection(name)
    : firestore().collection('hosts').doc(hostId).collection(name)
}

/**
 * Server-side permission check (AGL-243): the member's org-role defaults
 * refined by their custom role doc (one read, only when assigned). API
 * routes call this before privileged mutations.
 */
export async function memberHasOrgPermission(
  orgId: string,
  member: Partial<AglynOrgMember> | null | undefined,
  permission: OrgPermission,
): Promise<boolean> {
  if (!member) return false
  let customRole: AglynOrgCustomRole | null = null
  if (member.roleId) {
    const snapshot = await firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('roles')
      .doc(member.roleId)
      .get()
    customRole = snapshot.exists
      ? (snapshot.data() as AglynOrgCustomRole)
      : null
  }
  return hasOrgPermission(member, permission, customRole)
}

export async function listOrgMembers(
  orgId: string,
): Promise<AglynOrgMember[]> {
  const snapshot = await firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .get()
  return snapshot.docs.map(
    (doc) => ({ $id: doc.id, ...doc.data() }) as AglynOrgMember,
  )
}

/**
 * Recomputes the `memberRoles` authorization projection on every host the
 * org owns (or one host when given). Called after any membership change
 * and after host creation — the rules read host docs, so this is what
 * makes membership effective (docs/MULTI_TENANT_FIRESTORE.md §5).
 */
export async function syncHostMemberRoles(
  orgId: string,
  hostId?: string,
): Promise<void> {
  const db = firestore()
  const members = await listOrgMembers(orgId)
  const hostIds = hostId
    ? [hostId]
    : Object.keys(
        ((await db.collection('orgs').doc(orgId).get()).data() as
          | AglynOrganization
          | undefined)?.hosts ?? {},
      )
  const batch = db.batch()
  for (const id of hostIds) {
    batch.set(
      db.collection('hosts').doc(id),
      {
        orgId,
        memberRoles: projectHostMemberRoles(members, id),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }
  await batch.commit()
}

/** What an org activity entry points at; `id` lets detail views filter. */
export interface OrgActivityTarget {
  type: 'org' | 'member' | 'invite'
  id?: string
  name?: string
}

/**
 * Org-level counterpart to the host activity log (AGL-118): fire-and-
 * forget append to `orgs/{orgId}/activity` from the org API routes. Never
 * throws — an audit miss must not break the mutation that triggered it.
 * Admin-SDK-only, like the rest of this file; the rules deny client writes.
 */
export async function logOrgActivity(
  orgId: string,
  actor: { uid: string; email?: string | null },
  action: string,
  target: OrgActivityTarget,
): Promise<void> {
  await firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('activity')
    .add({
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      action,
      target: {
        type: target.type,
        ...(target.id ? { id: target.id } : {}),
        ...(target.name ? { name: target.name } : {}),
      },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
}

export interface UpsertOrgMemberOptions {
  orgId: string
  uid: string
  role: OrgRole
  allHosts?: boolean
  hostAccess?: Record<string, 'admin' | 'editor' | 'viewer'>
  /** Custom role reference (AGL-243); null clears it. */
  roleId?: string | null
  email?: string | null
  displayName?: string | null
  /** Job title shown on the roster/member page (AGL-364). */
  title?: string | null
  invitedBy?: string | null
}

/**
 * Creates or updates a member transactionally with its reverse-index
 * entry, then re-syncs host projections. Owner-role guards live in the
 * API routes (self-demotion, owner removal) — this is the mechanism.
 */
export async function upsertOrgMember(
  options: UpsertOrgMemberOptions,
): Promise<void> {
  const {
    orgId,
    uid,
    role,
    allHosts,
    hostAccess,
    roleId,
    email,
    displayName,
    title,
    invitedBy,
  } = options
  const db = firestore()
  await db.runTransaction(async (tx) => {
    const orgSnapshot = await tx.get(db.collection('orgs').doc(orgId))
    if (!orgSnapshot.exists) throw new Error(`Unknown org: ${orgId}`)
    const org = orgSnapshot.data() as AglynOrganization
    const memberRef = db
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(uid)
    const existing = await tx.get(memberRef)
    tx.set(
      memberRef,
      {
        role,
        allHosts: allHosts ?? false,
        hostAccess: hostAccess ?? {},
        ...(roleId !== undefined ? { roleId } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(invitedBy ? { invitedBy } : {}),
        ...(existing.exists
          ? {}
          : { joinedAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    )
    tx.set(
      db.collection('users').doc(uid).collection('orgs').doc(orgId),
      { role, orgName: org.name ?? null, slug: org.slug ?? null },
    )
  })
  await syncHostMemberRoles(orgId)
}

/**
 * Transfers org ownership (AGL-232): the target must already be on the
 * roster; the previous owner steps down to admin. One transaction across
 * the org doc, both member docs and both reverse-index entries, then the
 * host projections re-sync.
 */
export async function transferOrgOwnership(
  orgId: string,
  fromUid: string,
  toUid: string,
): Promise<void> {
  if (fromUid === toUid) throw new Error('Target already owns this org')
  const db = firestore()
  await db.runTransaction(async (tx) => {
    const orgRef = db.collection('orgs').doc(orgId)
    const orgSnapshot = await tx.get(orgRef)
    if (!orgSnapshot.exists) throw new Error(`Unknown org: ${orgId}`)
    const org = orgSnapshot.data() as AglynOrganization
    if (org.ownerUid !== fromUid) {
      throw new Error('Only the current owner can transfer ownership')
    }
    const targetRef = orgRef.collection('members').doc(toUid)
    const target = await tx.get(targetRef)
    if (!target.exists) {
      throw new Error('The new owner must already be an org member')
    }
    tx.set(
      orgRef,
      { ownerUid: toUid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    tx.set(targetRef, { role: 'owner', allHosts: true }, { merge: true })
    tx.set(
      orgRef.collection('members').doc(fromUid),
      { role: 'admin' },
      { merge: true },
    )
    tx.set(
      db.collection('users').doc(toUid).collection('orgs').doc(orgId),
      { role: 'owner' },
      { merge: true },
    )
    tx.set(
      db.collection('users').doc(fromUid).collection('orgs').doc(orgId),
      { role: 'admin' },
      { merge: true },
    )
  })
  await syncHostMemberRoles(orgId)
}

/**
 * Grants (or updates) per-host access for a uid without disturbing an
 * existing membership's org role or allHosts flag (AGL-238: the host user
 * manager rides org membership). Creates a viewer membership scoped to
 * just this host when the uid is not on the roster yet.
 */
export async function grantHostAccess(options: {
  orgId: string
  uid: string
  hostId: string
  role: 'viewer' | 'editor' | 'admin'
  email?: string | null
  displayName?: string | null
  invitedBy?: string
}): Promise<void> {
  const { orgId, uid, hostId, role, email, displayName, invitedBy } = options
  const db = firestore()
  await db.runTransaction(async (tx) => {
    const orgRef = db.collection('orgs').doc(orgId)
    const orgSnapshot = await tx.get(orgRef)
    if (!orgSnapshot.exists) throw new Error(`Unknown org: ${orgId}`)
    const org = orgSnapshot.data() as AglynOrganization
    const memberRef = orgRef.collection('members').doc(uid)
    const existing = await tx.get(memberRef)
    tx.set(
      memberRef,
      {
        ...(existing.exists
          ? {}
          : {
              role: 'viewer' as OrgRole,
              allHosts: false,
              joinedAt: FieldValue.serverTimestamp(),
            }),
        hostAccess: { [hostId]: role },
        ...(email !== undefined ? { email } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(invitedBy ? { invitedBy } : {}),
      },
      // merge deep-merges the hostAccess map, so other host grants and
      // the existing role/allHosts stay untouched.
      { merge: true },
    )
    if (!existing.exists) {
      tx.set(db.collection('users').doc(uid).collection('orgs').doc(orgId), {
        role: 'viewer',
        orgName: org.name ?? null,
        slug: org.slug ?? null,
      })
    }
  })
  await syncHostMemberRoles(orgId)
}

/** Drops one host from a member's hostAccess map, then re-projects. */
export async function revokeHostAccess(
  orgId: string,
  uid: string,
  hostId: string,
): Promise<void> {
  await firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .doc(uid)
    .set(
      { hostAccess: { [hostId]: FieldValue.delete() } },
      { merge: true },
    )
  await syncHostMemberRoles(orgId)
}

/** Removes a member + reverse index entry, then re-syncs projections. */
export async function removeOrgMember(
  orgId: string,
  uid: string,
): Promise<void> {
  const db = firestore()
  const batch = db.batch()
  batch.delete(
    db.collection('orgs').doc(orgId).collection('members').doc(uid),
  )
  batch.delete(db.collection('users').doc(uid).collection('orgs').doc(orgId))
  await batch.commit()
  await syncHostMemberRoles(orgId)
}

/**
 * Registers a host under its org: org directory entry, hostIndex mirror,
 * and the initial memberRoles projection on the host doc.
 */
export async function registerOrgHost(
  orgId: string,
  hostId: string,
  subdomain?: string,
): Promise<void> {
  const db = firestore()
  await db
    .collection('orgs')
    .doc(orgId)
    .set(
      {
        hosts: { [hostId]: true },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  await db
    .collection('hostIndex')
    .doc(hostId)
    .set({ orgId, ...(subdomain ? { subdomain } : {}) })
  await syncHostMemberRoles(orgId, hostId)
}
