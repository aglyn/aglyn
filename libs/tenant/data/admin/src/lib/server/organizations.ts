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
  isOrgWideMember,
  isValidOrgSlug,
  projectHostMemberRoles,
  projectMemberScopeTokens,
  scopeTokensForHost,
  type AglynOrganization,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type OrgPermission,
  type OrgRole,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import { cache } from 'react'
import { findUserByUidAcrossPools } from './auth-pools'
import firebaseAdmin from './firebase-admin'
import {
  deleteMemberHostProjections,
  syncHostProjectionForMembers,
  syncMemberHostProjections,
} from './host-memberships'
import { updateExisting } from './update-existing'
import { attachWorkspaceDomain } from './workspace-domains'

const firestore = () => firebaseAdmin.app().firestore()

/** Firestore's hard cap on writes in one batched commit. */
const FIRESTORE_BATCH_LIMIT = 500

export class OrgSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Org slug already reserved: ${slug}`)
    this.name = 'OrgSlugTakenError'
  }
}

/**
 * Whether an `orgSlugs/{slug}` reservation may be (re)claimed (AGL-585):
 * free when the doc is missing, when the claimant already owns it, or when
 * it is a tombstone (`movedTo` set) — a renamed-away slug keeps redirecting
 * old URLs only until someone wants it, it is never reserved forever.
 * Claiming writes a full-replace `{ orgId }`, which ends the redirect —
 * links to a reclaimed slug resolve to the new owner from then on.
 */
export function isSlugReservationClaimable(
  reservation: { orgId?: unknown; movedTo?: unknown } | undefined,
  claimingOrgId: string | null,
): boolean {
  if (!reservation) return true
  if (claimingOrgId !== null && reservation.orgId === claimingOrgId) return true
  return Boolean(reservation.movedTo)
}

/**
 * How long after account creation the signup flow may still provision the
 * org it collected, without a verified email (AGL-1523). Generous relative
 * to the seconds the real flow needs, tight relative to abuse: outside this
 * window the AGL-479 verified-email gate stands in full.
 */
export const SIGNUP_PROVISIONING_GRACE_MS = 15 * 60 * 1000

/**
 * The pure decision for the signup-provisioning grace (AGL-1523).
 *
 * The signup form collects an organization name and posts it to
 * `/api/orgs/create` seconds after `createUserWithEmailAndPassword` — a
 * moment at which a password account is ALWAYS unverified, so the AGL-479
 * email gate refused every signup-time provisioning ever attempted on the
 * password door. The gate's purpose is to keep unverified accounts out of
 * the console, and it still does: creating the user's own first workspace
 * grants no console access (the session mint and the app layout both still
 * require verification). What the gate must stop refusing is the one
 * request that is part of account creation itself.
 *
 * Grace is granted only when BOTH hold:
 *  - the account is brand new (creation within the window — an unverified
 *    account cannot come back later and start minting workspaces), and
 *  - the account owns no org yet (grace provisions exactly ONE workspace;
 *    it is not a window of unlimited slug reservation).
 *
 * A malformed/missing creation time fails CLOSED.
 */
export function isWithinSignupProvisioningGrace(options: {
  creationTime: string | undefined
  ownsAnyOrg: boolean
  now?: number
}): boolean {
  const { creationTime, ownsAnyOrg, now = Date.now() } = options
  if (ownsAnyOrg) return false
  const createdAt = Date.parse(creationTime ?? '')
  if (!Number.isFinite(createdAt)) return false
  // A slightly-future creation time is clock skew on a definitionally
  // brand-new account — within grace. Only age beyond the window denies.
  return now - createdAt <= SIGNUP_PROVISIONING_GRACE_MS
}

/**
 * Whether `uid` — an UNVERIFIED caller — may still create the org the signup
 * flow collected (AGL-1523). Reads the auth record's creation time and the
 * caller's owned-org count, then applies
 * {@link isWithinSignupProvisioningGrace}. Any lookup failure fails CLOSED:
 * the AGL-479 gate stands.
 */
export async function signupProvisioningGraceAllows(
  uid: string,
): Promise<boolean> {
  try {
    // Across pools (AGL-1122), not `auth().getUser` — a project-level lookup
    // silently misses tenanted SSO accounts, and this helper failing closed
    // would then wrongly 403 them.
    const found = await findUserByUidAcrossPools(uid)
    if (!found) return false
    const owned = await firestore()
      .collection('orgs')
      .where('ownerUid', '==', uid)
      .limit(1)
      .get()
    return isWithinSignupProvisioningGrace({
      creationTime: found.record.metadata?.creationTime,
      ownsAnyOrg: !owned.empty,
    })
  } catch (error) {
    console.error('[orgs] signup provisioning grace check failed', error)
    return false
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
    // Tombstones (renamed-away slugs) are claimable by new orgs (AGL-585).
    if (
      !isSlugReservationClaimable(
        reservation.exists
          ? (reservation.data() as { orgId?: unknown; movedTo?: unknown })
          : undefined,
        null,
      )
    ) {
      throw new OrgSlugTakenError(slug)
    }
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
      // The owner reaches every site by definition (AGL-1032).
      { role: 'owner', orgName: name, slug, orgWide: true },
    )
  })
  // Make `{slug}.aglyn.com` resolve (AGL-1136). AGL-1135 removed the
  // `*.aglyn.com` wildcard — it served a real sign-in page on every hostname
  // under the domain — so a workspace subdomain now only works if the domain
  // is attached to the project.
  //
  // AFTER the transaction, and AWAITED. It was `void`, on the reasoning that
  // no workspace should fail to be created because a DNS API was slow — right
  // requirement, wrong mechanism (AGL-1136). On a serverless runtime `void`
  // does not mean "in the background", it means "may never run": the instance
  // can be frozen the moment the response is flushed. Confirmed twice on this
  // codebase already, on the Stripe org sync and the profile seed.
  //
  // Awaiting cannot fail org creation, and that property comes from the
  // helper, not from the `void` — `attachWorkspaceDomain` swallows every
  // error and returns an outcome rather than throwing. The cost is one HTTP
  // round trip on an operation that already runs a Firestore transaction; the
  // alternative was advertising a workspace URL that 404s.
  //
  // `erase.ts` already awaits the matching detach, which is what made the
  // asymmetry worth looking at.
  await attachWorkspaceDomain(slug)
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
 * Throws `OrgSlugTakenError` only when another org ACTIVELY holds the new
 * slug — tombstones are claimable (AGL-585). Slug validity/authorization
 * are the API route's job.
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
    // Claimable when free, own (moving back), or a tombstone another org
    // renamed away from (AGL-585) — abandoned slugs are never reserved
    // forever. Only another org's ACTIVE slug blocks the change.
    if (
      !isSlugReservationClaimable(
        reservation.exists
          ? (reservation.data() as { orgId?: unknown; movedTo?: unknown })
          : undefined,
        orgId,
      )
    ) {
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
  // Attach the new subdomain, and deliberately KEEP the old one (AGL-1136).
  // The previous slug's tombstone 308s to the new one, and a redirect can
  // only run on a hostname that still resolves — detaching it here would
  // break the very redirect the tombstone exists to serve.
  // Awaited for the same reason as the create path above (AGL-1136): a
  // `void` here is not a background task, it is a coin flip.
  await attachWorkspaceDomain(newSlug)
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

/**
 * Host → org resolution via the server-written `hostIndex` mirror.
 *
 * `React.cache`-deduped PER REQUEST (AGL-1302): one tenant render resolved
 * this hop up to five times — org billing, datasets, plugin installs, realm
 * installs and the publish-schedule executor each re-read the same
 * `hostIndex/{hostId}` doc. Per-request memoization is zero-staleness by
 * construction; outside a React render (route handlers, jest) `cache` is a
 * pass-through, so nothing changes for the console's authz paths.
 */
export const resolveOrgIdForHost = cache(
  async (hostId: string): Promise<string | null> => {
    const snapshot = await firestore().collection('hostIndex').doc(hostId).get()
    const orgId = snapshot.data()?.['orgId']
    return typeof orgId === 'string' ? orgId : null
  },
)

/**
 * The org doc itself — billing, plan, entitlements and suspension (the
 * shape the legacy tenants/{uid} doc carried; orgs are the only billing
 * source since AGL-238). Null when the doc is missing.
 */
/**
 * `React.cache`-deduped per request like {@link resolveOrgIdForHost}
 * (AGL-1302). NOTE: within one render every caller receives the SAME object
 * — treat it as read-only, as every current caller already does.
 */
export const getOrgDoc = cache(
  async (orgId: string): Promise<Partial<AglynOrganization> | null> => {
    const snapshot = await firestore().collection('orgs').doc(orgId).get()
    return snapshot.exists
      ? ({ $id: snapshot.id, ...snapshot.data() } as Partial<AglynOrganization>)
      : null
  },
)

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
 * The raw host doc, `React.cache`-deduped per request like
 * {@link resolveOrgIdForHost}. Null when missing. Added for AGL-1506 so a
 * dispatcher that already pays this read for the plugin deny-list can also
 * feed the host's `suspendedAt` family to the lockdown verdict without a
 * second get. Same read-only contract as {@link getOrgDoc}.
 */
export const getHostDocAdmin = cache(
  async (hostId: string): Promise<Record<string, unknown> | null> => {
    const snapshot = await firestore().collection('hosts').doc(hostId).get()
    return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
  },
)

/**
 * The host's per-site plugin deny-list (AGL-1014), for API dispatch and any
 * other server consumer of `resolveHostEnabledPlugins`. Rides
 * {@link getHostDocAdmin}'s request-cached read. Fail-open to [] — an absent
 * host doc or field means "nothing disabled here", never a lockout.
 */
export const getHostDisabledPlugins = cache(
  async (hostId: string): Promise<string[]> => {
    const disabled = (await getHostDocAdmin(hostId))?.['disabledPlugins']
    return Array.isArray(disabled) ? disabled.map(String) : []
  },
)

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
 * contactSegments live on the org so every host shares them.
 *
 * The pre-migration fallback to `hosts/{hostId}/{name}` is GONE (AGL-1050).
 * The AGL-1040 backfill counted the docs still on it in production and
 * found zero, so it was dead code rather than a migration — and a second
 * storage path that can still be WRITTEN is a second boundary to enforce
 * forever, which undoes the premise of scoped sharing: one home per
 * resource plus an explicit scope.
 *
 * A host with no org is now an error rather than a silent write into a
 * collection nothing reads. Every host has an org; `hostIndex` is written
 * by `registerOrgHost` at creation.
 */
/**
 * The org-owned collections a host reads in its own context. Every one of
 * these carries `visibleTo` (AGL-1037) and so must go through
 * `scopedToHost` on any Admin-SDK path — `media` and `mediaFolders` were
 * added for the export route (AGL-1046), which had been reading the
 * legacy host path and exporting nothing at all.
 */
export type OrgDataCollection =
  | 'datasets'
  | 'contacts'
  | 'contactSegments'
  | 'media'
  | 'mediaFolders'

export async function orgDataCollectionForHost(
  hostId: string,
  name: OrgDataCollection,
): Promise<FirebaseFirestore.CollectionReference> {
  const orgId = await resolveOrgIdForHost(hostId)
  if (!orgId) {
    throw new Error(`Host ${hostId} has no org — cannot resolve ${name}`)
  }
  return firestore().collection('orgs').doc(orgId).collection(name)
}

/**
 * Narrows an org-scoped collection to what ONE host may see (AGL-1039).
 *
 * The Admin SDK does not evaluate Firestore rules, so AGL-1041's
 * `visibleTo.hasAny(...)` protects the console and nothing else — every
 * server read has to filter for itself or a client site can render another
 * client's data. Use this instead of the bare collection ref anywhere a
 * request is being served in the context of a single host.
 *
 * Only the ORG path is filtered — but no longer because of the legacy
 * `hosts/{hostId}/…` fallback, which AGL-1050 removed on both the server
 * (above) and the client. What survives it is the reason stated at the
 * check itself: callers may hand this helper a ref they built themselves,
 * and a host-library ref must never be filtered, since its docs carry no
 * `visibleTo` and the filter would match nothing and blank the site.
 */
export function scopedToHost(
  ref: FirebaseFirestore.CollectionReference,
  hostId: string,
): FirebaseFirestore.Query {
  // The org-path check is retained even though AGL-1050 removed the host
  // fallback: this helper is also handed refs by callers that build their
  // own paths, and a host-library ref must never be filtered — its docs
  // carry no `visibleTo`, so the filter would match nothing.
  const orgScoped = ref.parent?.parent?.id === 'orgs'
  if (!orgScoped) return ref
  return ref.where(
    'visibleTo',
    'array-contains-any',
    scopeTokensForHost(hostId),
  )
}

/**
 * `orgDataCollectionForHost` + `scopedToHost` in one call — the form every
 * host-context read should use. Returns the collection ref too, for the
 * writes and `doc()` lookups a Query cannot express.
 */
export async function orgDataQueryForHost(
  hostId: string,
  name: OrgDataCollection,
): Promise<{
  ref: FirebaseFirestore.CollectionReference
  query: FirebaseFirestore.Query
}> {
  const ref = await orgDataCollectionForHost(hostId, name)
  return { ref, query: scopedToHost(ref, hostId) }
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
 * Recomputes both denormalized authorization projections after a
 * membership change: `memberRoles` on every host the org owns (or one host
 * when given), and `scopeTokens` on every member doc.
 *
 * The rules resolve a request from these two reads — the host doc for host
 * content (docs/MULTI_TENANT_FIRESTORE.md §5), the member doc for scoped
 * org resources (AGL-1038) — so this is what makes a membership effective.
 * Both live here, in one writer called by every mutation below, because a
 * grant path that updates one projection and forgets the other silently
 * over- or under-grants.
 *
 * `scopeTokens` is recomputed for the whole roster rather than the changed
 * member: the roster is already loaded for `memberRoles`, and a full pass
 * self-heals rows that an earlier partial failure left stale.
 */
export async function syncOrgAuthProjections(
  orgId: string,
  hostId?: string,
): Promise<void> {
  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const members = await listOrgMembers(orgId)
  const hostIds = hostId
    ? [hostId]
    : Object.keys(
        ((await orgRef.get()).data() as AglynOrganization | undefined)
          ?.hosts ?? {},
      )
  const writes: Array<[FirebaseFirestore.DocumentReference, object]> = [
    ...hostIds.map(
      (id) =>
        [
          db.collection('hosts').doc(id),
          {
            orgId,
            memberRoles: projectHostMemberRoles(members, id),
            updatedAt: FieldValue.serverTimestamp(),
          },
        ] as [FirebaseFirestore.DocumentReference, object],
    ),
    ...members.map(
      (member) =>
        [
          orgRef.collection('members').doc(member.$id),
          { scopeTokens: projectMemberScopeTokens(member) },
        ] as [FirebaseFirestore.DocumentReference, object],
    ),
  ]
  // Hosts alone rarely approached the 500-write batch cap; hosts plus the
  // whole roster can, so commit in chunks rather than throwing on big orgs.
  for (let i = 0; i < writes.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = db.batch()
    for (const [ref, data] of writes.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
      batch.set(ref, data, { merge: true })
    }
    await batch.commit()
  }
}

/**
 * @deprecated Renamed to `syncOrgAuthProjections` (AGL-1038) now that it
 * also writes member `scopeTokens`. Kept as an alias for out-of-tree
 * callers; delete once none remain.
 */
export const syncHostMemberRoles = syncOrgAuthProjections

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
  /**
   * The member's provider photo, mirrored onto the roster (AGL-1126).
   *
   * Every member surface reads the roster; none of them can read Firebase
   * Auth for an SSO member, whose record lives in a per-org tenant pool
   * (AGL-1122). Without this the console falls back to drawn initials for
   * everyone — fine, but it means a member who HAS a picture still never
   * shows it. This is the ONLY source of a real face now that the Gravatar
   * fallback is gone (AGL-1683), so keeping it populated matters more than
   * it did. Display data only: never an identity or authorization source.
   */
  photoURL?: string | null
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
    photoURL,
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
        // Absent leaves the stored photo alone; an explicit null clears it.
        // A provider that stops sending a picture must not silently wipe one
        // the member is still using.
        ...(photoURL !== undefined ? { photoURL } : {}),
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
      {
        role,
        orgName: org.name ?? null,
        slug: org.slug ?? null,
        // Mirrored from the member doc written just above (AGL-1032) — this
        // `set` has no merge, so the flag has to be part of it or the
        // console loses the collaborator/viewer distinction until the
        // projection pass below rewrites it.
        orgWide: isOrgWideMember({
          role,
          allHosts: allHosts ?? false,
          hostAccess: hostAccess ?? {},
        }),
      },
    )
  })
  await syncOrgAuthProjections(orgId)
  // Reverse-index this member's now-current host access (AGL-844).
  await syncMemberHostProjections(orgId, uid)
}

/**
 * Fill in a roster row's display identity from an identity provider, writing
 * ONLY the fields that are currently blank (AGL-1131).
 *
 * Separate from `upsertOrgMember` because the caller is the SSO sign-in path
 * on its already-a-member branch, where the member's role, host access and
 * invite state are settled and must not be touched. `upsertOrgMember`
 * requires a `role` and re-asserts it, so reusing it here would let an SSO
 * sign-in quietly reset an admin to the org's `sso.defaultRole`.
 *
 * Absent-only, so it is safe on every sign-in: it backfills the rows that
 * predate the IdP mapping and then never writes again, and it can never
 * overwrite a name or photo a person chose.
 *
 * @returns the field names it wrote, for logging and tests.
 */
export async function backfillMemberIdentity(
  orgId: string,
  uid: string,
  identity: { displayName?: string | null; photoURL?: string | null },
  db = firestore(),
): Promise<string[]> {
  const ref = db.collection('orgs').doc(orgId).collection('members').doc(uid)
  const snapshot = await ref.get()
  // A missing row is NOT this function's job to create — creating one here
  // would mint a membership with no role, which every permission check reads
  // as a member of some kind.
  if (!snapshot.exists) return []

  const blank = (value: unknown) => typeof value !== 'string' || !value.trim()
  const patch: Record<string, string> = {}
  const displayName = identity.displayName?.trim()
  const photoURL = identity.photoURL?.trim()
  if (displayName && blank(snapshot.get('displayName'))) {
    patch['displayName'] = displayName
  }
  if (photoURL && blank(snapshot.get('photoURL'))) {
    patch['photoURL'] = photoURL
  }
  if (!Object.keys(patch).length) return []

  await ref.set(patch, { merge: true })
  return Object.keys(patch)
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
      // Both principals end up owner/admin, which is org-wide reach whatever
      // they were before — a promoted site collaborator must lose the scoped
      // console along with the scoped membership (AGL-1032).
      { role: 'owner', orgWide: true },
      { merge: true },
    )
    tx.set(
      db.collection('users').doc(fromUid).collection('orgs').doc(orgId),
      { role: 'admin', orgWide: true },
      { merge: true },
    )
  })
  await syncOrgAuthProjections(orgId)
  // Both principals' host access changed (owner spans every host) — AGL-844.
  await Promise.all([
    syncMemberHostProjections(orgId, toUid),
    syncMemberHostProjections(orgId, fromUid),
  ])
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
        // A brand-new site collaborator: on the org roster, but their console
        // is one site (AGL-1032). `role: 'viewer'` here is indistinguishable
        // from a genuine org-wide viewer's, which is the whole reason for
        // this flag. An EXISTING member keeps whatever reach they had — a
        // host grant never widens or narrows it.
        orgWide: false,
      })
    }
  })
  await syncOrgAuthProjections(orgId)
  await syncMemberHostProjections(orgId, uid)
}

/**
 * Drops one host from a member's hostAccess map, then re-projects.
 *
 * `updateExisting`, not a merge-set (AGL-1766). A merge-set whose entire
 * payload is a delete sentinel still CREATES the document when it is absent,
 * and the row it minted here is not merely untidy — it is a MEMBERSHIP, and
 * one that reads as org-wide. `isOrgWideMember` treats "no `role`, no
 * `allHosts`, empty `hostAccess`" as the pre-`allHosts` LEGACY shape and
 * answers true (deliberately: reading it as "scoped, with access to nothing"
 * would lock real members out). A genuine site collaborator never looks like
 * that — `grantHostAccess` always writes `allHosts: false` — but a document
 * conjured from this patch alone does, exactly.
 *
 * So the consequences land away from here, which is what made it hard to see:
 * `resolveOrgMembership` finds the doc and returns a membership for someone
 * who was removed from the org; `syncOrgAuthProjections` on the next line
 * stamps it `scopeTokens: ['org']`, the read set the rules and every
 * Admin-SDK `memberCanSee` resolve from; and `countManagerSeats` bills it as
 * a manager seat. (It does NOT reach `hosts/*.memberRoles`, as AGL-1763
 * supposed — `hostRoleFor` requires an `isOrgRole(role)` and the phantom has
 * none.)
 *
 * Reachable without any race: `removeOrgMember` deletes the org member doc
 * but leaves the `hosts/{hostId}/members` roster row, which is what this is
 * called from. Deleting that leftover row re-created the membership it was
 * meant to finish removing. (AGL-1766's "stale double-submit" is NOT a route:
 * the caller 404s on the missing roster row before reaching here.)
 *
 * DOTTED FIELD PATH, not the nested map: `update()` accepts a delete sentinel
 * only at the top level of its patch (`@google-cloud/firestore` serializer,
 * `allowDeletes: 'root'`), so the nested form would throw INVALID_ARGUMENT.
 * The dotted path is top-level and clears the one key while leaving the rest
 * of `hostAccess` alone — the same field-by-field semantics the merge had.
 * Safe as a string path because host ids are `createResourceUid()` nanoids
 * (`A-Za-z0-9_-`), so none can contain the `.` the SDK splits on.
 *
 * REFUSE, and ignore the answer: revoking a grant that is not there is a
 * no-op and discards nothing (AGL-1760). The projections still run — they are
 * recomputed from the roster, so a pass that finds no member doc is exactly
 * the self-heal a stale row needs.
 */
export async function revokeHostAccess(
  orgId: string,
  uid: string,
  hostId: string,
): Promise<void> {
  await updateExisting(
    firestore().collection('orgs').doc(orgId).collection('members').doc(uid),
    { [`hostAccess.${hostId}`]: FieldValue.delete() },
  )
  await syncOrgAuthProjections(orgId)
  await syncMemberHostProjections(orgId, uid)
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
  await syncOrgAuthProjections(orgId)
  // The member is off the roster, so the sync above can't reach their rows —
  // drop the reverse index explicitly (AGL-844), like the orgs entry above.
  await deleteMemberHostProjections(orgId, uid)
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
  await syncOrgAuthProjections(orgId, hostId)
  // Seed the per-user projection for everyone who can reach the new host.
  await syncHostProjectionForMembers(orgId, hostId)
}
