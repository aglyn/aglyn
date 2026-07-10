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
  type AglynOrganization,
  type AglynOrgMember,
  createResourceUid,
  generateOrgSlug,
  isValidOrgSlug,
  type OrgRole,
  projectHostMemberRoles,
} from '@aglyn/aglyn'
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

/** Host → org resolution via the server-written `hostIndex` mirror. */
export async function resolveOrgIdForHost(
  hostId: string,
): Promise<string | null> {
  const snapshot = await firestore().collection('hostIndex').doc(hostId).get()
  const orgId = snapshot.data()?.['orgId']
  return typeof orgId === 'string' ? orgId : null
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

export interface UpsertOrgMemberOptions {
  orgId: string
  uid: string
  role: OrgRole
  allHosts?: boolean
  hostAccess?: Record<string, 'admin' | 'editor' | 'viewer'>
  email?: string | null
  displayName?: string | null
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
  const { orgId, uid, role, allHosts, hostAccess, email, displayName, invitedBy } =
    options
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
        ...(email !== undefined ? { email } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
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
