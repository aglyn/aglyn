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
  consentGroupForHost,
  type ConsentGroup,
  checkHostCollaboratorQuota,
  checkSeatQuota,
  countCollaboratorSeats,
  countManagerSeatsExcluding,
  createResourceUid,
  generateOrgSlug,
  resolveOrgPermissions,
  isOrgWideMember,
  isValidOrgSlug,
  projectHostMemberRoles,
  projectMemberScopeTokens,
  scopeTokensForHost,
  type AglynOrganization,
  type AglynOrgBilling,
  type AglynOrgCustomRole,
  type AglynOrgMember,
  type CollaboratorSeatEntry,
  type HostAccessRole,
  type OrgPermission,
  type OrgRole,
} from '@aglyn/aglyn/server'
import {
  nameSearchKey,
  nameSearchReversed,
  nameSearchTokens,
} from '@aglyn/aglyn/app-utils/name-search'
// LEAF MODULE, NOT THE BARREL (AGL-1289). This file is itself reachable
// through `@aglyn/aglyn/server`, and the verdict route proved this week that a
// constant pulled from that barrel inside the cycle typechecks and then
// resolves `undefined` at runtime.
import {
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
} from '@aglyn/aglyn/app-utils/org-billing-doc'
import { FieldValue } from 'firebase-admin/firestore'
import { cache } from 'react'
import { findUserByUidAcrossPools } from './auth-pools'
import firebaseAdmin from './firebase-admin'
import {
  enforceFreeWorkspaceCapInTransaction,
  readFreeWorkspaceCapConfig,
  type FreeWorkspaceCapConfig,
} from './free-workspace-cap'
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
 * How long a workspace address created by an UNVERIFIED owner is held for
 * that owner before anybody else may take it (AGL-2585).
 *
 * The org's name becomes its address — `acme-inc.aglyn.com` — and until this
 * existed the address was GRANTED at the moment of signup, before anything
 * proved the email belonged to the person typing it. A throwaway inbox, or no
 * working inbox at all, therefore claimed a name permanently: nothing in the
 * platform released one.
 *
 * Twenty-one days rather than the seven the reaper waits, and the gap is the
 * point. The ordinary path is that `reap-unverified-orgs` finds the workspace
 * at day seven and erases it, which releases the address through
 * `eraseOrgSlugs` — this window is what still ends the squat when that sweep
 * has stopped running, and its width is the sweep's own outage budget.
 */
export const SLUG_RESERVATION_MS = 21 * 24 * 60 * 60 * 1000

/**
 * Has a PENDING address reservation run out? (AGL-2585)
 *
 * `reservedUntil` is written only by {@link createOrganization}, and only
 * when the owner was unverified at the moment the workspace was made. A
 * reservation without it is a GRANT and never lapses, which is what keeps
 * every workspace made by a verified owner — and every one that predates this
 * field — untouchable by this rule.
 *
 * A `reservedUntil` that is not a finite number never lapses either: a
 * corrupt or half-written expiry is a reason to leave an address alone, not a
 * reason to hand it to the next caller.
 */
export function isSlugReservationLapsed(
  // The whole `orgSlugs/{slug}` document, not just the field being read: every
  // caller has one in hand, and a parameter narrowed to `reservedUntil` alone
  // makes the ordinary case — a grant, which carries `orgId` and no expiry —
  // an excess-property error at the call site.
  reservation:
    | { orgId?: unknown; movedTo?: unknown; reservedUntil?: unknown }
    | undefined,
  now: number = Date.now(),
): boolean {
  const until = reservation?.reservedUntil
  if (typeof until !== 'number' || !Number.isFinite(until)) return false
  return until <= now
}

/**
 * Whether an `orgSlugs/{slug}` reservation may be (re)claimed (AGL-585):
 * free when the doc is missing, when the claimant already owns it, or when
 * it is a tombstone (`movedTo` set) — a renamed-away slug keeps redirecting
 * old URLs only until someone wants it, it is never reserved forever.
 * Claiming writes a full-replace `{ orgId }`, which ends the redirect —
 * links to a reclaimed slug resolve to the new owner from then on.
 *
 * A LAPSED PENDING RESERVATION is claimable too (AGL-2585). The reservation
 * an unverified signup takes is a hold, not a grant, and a hold that never
 * expires is the squat this rule exists to end.
 *
 * ⚠️ Claimable here is NOT the whole answer for a lapsed reservation — see
 * {@link lapsedReservationIsStillHeld}, which both call sites consult before
 * they act on a `true` that came from the lapse branch. This function is pure
 * and cannot ask whether the owner has verified since; treating its answer as
 * final would let a customer who verified on day one lose their address on
 * day twenty-one because a sweep was down.
 */
export function isSlugReservationClaimable(
  reservation:
    | { orgId?: unknown; movedTo?: unknown; reservedUntil?: unknown }
    | undefined,
  claimingOrgId: string | null,
  now: number = Date.now(),
): boolean {
  if (!reservation) return true
  if (claimingOrgId !== null && reservation.orgId === claimingOrgId) return true
  if (reservation.movedTo) return true
  return isSlugReservationLapsed(reservation, now)
}

/**
 * Is a LAPSED reservation nonetheless still its holder's? (AGL-2585)
 *
 * The lapse rule above is pure, and the fact it cannot see is the only one
 * that matters here: whether the owner verified their address after the
 * workspace was made. `reap-unverified-orgs` clears `reservedUntil` on its
 * next pass when they have, but "on its next pass" is a promise about a
 * scheduled job, and a scheduled job can stop. Between a verification and the
 * promotion that records it, the pure rule would say this address is free.
 *
 * So the two paths that take a slug ask this before they take a lapsed one,
 * and it answers from the auth record — the only source of truth for whether
 * an address was ever confirmed.
 *
 * FAILS CLOSED, in every direction. A missing org, a missing owner, an auth
 * lookup that throws: all of them return `true`, meaning the reservation
 * stands and the claim is refused. Refusing to hand over an address costs the
 * claimant one attempt at a name; granting one wrongly costs its holder the
 * URL their customers use.
 */
async function lapsedReservationIsStillHeld(
  reservation: { orgId?: unknown } | undefined,
): Promise<boolean> {
  const holderOrgId =
    typeof reservation?.orgId === 'string' ? reservation.orgId : null
  if (!holderOrgId) return true
  try {
    const holder = await firestore().collection('orgs').doc(holderOrgId).get()
    if (!holder.exists) {
      // The workspace is gone and only the reservation outlived it. Nothing
      // is being taken from anyone.
      return false
    }
    const ownerUid = holder.get('ownerUid')
    if (typeof ownerUid !== 'string' || !ownerUid) return true
    const found = await findUserByUidAcrossPools(ownerUid)
    if (!found) return true
    return found.record.emailVerified === true
  } catch (error) {
    console.error('[orgs] lapsed reservation check failed', error)
    return true
  }
}

/**
 * The `orgSlugs/{slug}` body a new workspace writes (AGL-2585).
 *
 * A verified owner gets `{ orgId }` — the grant this collection has always
 * held. An unverified one gets the same document with an expiry on it, and
 * nothing else: no uid, no email. `orgSlugs` is world-readable, because the
 * console resolves a workspace subdomain client-side from it, so everything
 * written here is published.
 */
export function slugReservationDocument(
  orgId: string,
  reservedUntil: number | null,
): { orgId: string; reservedUntil?: number } {
  return reservedUntil === null ? { orgId } : { orgId, reservedUntil }
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
  /**
   * Skip the AGL-2265 free-workspace ceiling.
   *
   * For staff provisioning on a customer's behalf and for the migration and
   * backfill scripts — a ceiling that stops support from fixing a workspace
   * is a ceiling that produces the ticket it was meant to prevent. Never set
   * from a self-serve path; `/api/orgs/create` passes the staff claim and
   * nothing else.
   */
  bypassFreeWorkspaceCap?: boolean
  /**
   * Hold the workspace address instead of granting it (AGL-2585).
   *
   * Set by `/api/orgs/create` when the caller's email was NOT verified — the
   * AGL-1523 signup grace, which is every password signup, because a password
   * account is always unverified at the moment the signup form posts. The
   * reservation then carries an expiry, and an expiry is the difference
   * between a name someone proved they can receive mail at and a name someone
   * typed.
   *
   * Left unset everywhere else, which keeps `ensureOrgForUser`, the staff
   * provisioning paths and the migration scripts writing the same grant they
   * always have.
   */
  reserveSlugUntilMs?: number | null
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
  const reserveSlugUntilMs = options.reserveSlugUntilMs ?? null
  const db = firestore()
  const orgId = createResourceUid()
  // The free-workspace ceiling (AGL-2265). Read OUTSIDE the transaction —
  // it is a platform setting on a 15s cache, not a document this creation
  // races with, and putting it in the read set would make every workspace
  // creation on the platform contend on one document. `ready` rides along so
  // the verdict knows the difference between "staff set no limit" and "we
  // could not read it", and never treats the second as the first.
  const capConfig: FreeWorkspaceCapConfig | null = options.bypassFreeWorkspaceCap
    ? null
    : await readFreeWorkspaceCapConfig()
  await db.runTransaction(async (tx) => {
    const reservation = await tx.get(db.collection('orgSlugs').doc(slug))
    const held = reservation.exists
      ? (reservation.data() as {
          orgId?: unknown
          movedTo?: unknown
          reservedUntil?: unknown
        })
      : undefined
    // Tombstones (renamed-away slugs) are claimable by new orgs (AGL-585),
    // and so is a signup reservation that ran out unverified (AGL-2585) —
    // but only once the auth record agrees it was never confirmed.
    if (
      !isSlugReservationClaimable(held, null) ||
      (isSlugReservationLapsed(held) && (await lapsedReservationIsStillHeld(held)))
    ) {
      throw new OrgSlugTakenError(slug)
    }
    // Last read, first write: the ceiling counts inside this transaction, so
    // a retry recounts, and it writes the per-owner marker that makes two
    // concurrent creates by one account contend. Throws
    // `FreeWorkspaceCapError`, which the API routes turn into a 403 with the
    // numbers in it.
    if (capConfig) {
      await enforceFreeWorkspaceCapInTransaction({
        tx,
        firestore: db,
        uid: ownerUid,
        config: capConfig,
      })
    }
    tx.set(
      db.collection('orgSlugs').doc(slug),
      slugReservationDocument(orgId, reserveSlugUntilMs),
    )
    /*
     * THE BILLING DOCUMENT EXISTS FROM BIRTH (AGL-1152).
     *
     * `readOrgBilling` reads `orgs/{id}/billing/stripe` and falls back to the
     * org doc when it is absent — and Firestore BILLS a read for a document
     * that does not exist. An org created without one therefore pays a
     * NOT_FOUND plus the fallback lookup on every read, forever, on the
     * tenant's hot path behind a deliberately short TTL.
     *
     * Measured before this: 14,498 NOT_FOUND reads/day on production, 15% of
     * all Firestore reads, from four orgs that had never had a document. The
     * `--seed-empty` pass in `backfill-org-billing.mjs` repaired those; this is
     * what stops the next org recreating the problem.
     *
     * EMPTY IS THE HONEST VALUE, not a placeholder: a new org has no Stripe
     * relationship, and `readOrgBilling`'s fallback returned `{}` for exactly
     * this case anyway. `writeOrgBilling` merge-sets, so the first real
     * subscription composes with this rather than racing it.
     */
    tx.set(
      db
        .collection('orgs')
        .doc(orgId)
        .collection(ORG_BILLING_SUBCOLLECTION)
        .doc(ORG_BILLING_DOC_ID),
      {},
    )
    tx.set(db.collection('orgs').doc(orgId), {
      name,
      /*
       * The searchable form of `name`, written beside it (AGL-2501).
       *
       * Firestore cannot search a string it has not been given in search
       * form: a prefix range needs the normalized key to ORDER by, and
       * `name` carries case and stray whitespace. Without this the staff
       * organization list can only filter the rows already on screen — ten
       * of them — which stops being a search the moment there are more
       * organizations than a page.
       *
       * Denormalized rather than computed at query time because there is no
       * query-time in Firestore. Every writer of `name` owes this field; the
       * rename in `/api/orgs/settings` is the other one.
       */
      nameLower: nameSearchKey(name),
      // Word-prefix tokens, so the staff search can answer "contains a word
      // starting with X" rather than only "starts with X" (AGL-2501).
      nameTokens: nameSearchTokens(name),
      // Reversed, so the list's "ends with" filter is a prefix range like
      // every other string operator Firestore can answer.
      nameReversed: nameSearchReversed(name),
      slug,
      ownerUid,
      // Stamped once and never mutated — `transferOrgOwnership` moves
      // `ownerUid` and deliberately leaves this alone (AGL-2265). It is what
      // stops "hand the workspace to an alt account, create another, take it
      // back" from being a way past the free-workspace ceiling.
      createdByUid: ownerUid,
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
        /*
         * The rules projection, stamped AT CREATION (AGL-1038).
         *
         * Every other membership write reaches `syncOrgAuthProjections`,
         * which recomputes this for the whole roster. This one does not —
         * it is inside the creating transaction, and nothing runs after it
         * — so a brand-new org's owner had no `scopeTokens` at all and the
         * weekly scope-drift detector reported the org from the day it was
         * made until some later membership change happened to heal it.
         *
         * Computed rather than written as a literal, so it cannot disagree
         * with the projection every other path uses.
         */
        scopeTokens: projectMemberScopeTokens({ role: 'owner', allHosts: true }),
        /*
         * The permission projection, stamped here for the same reason and
         * with the same consequence if it is missed.
         *
         * No custom role can exist in an org being created, so the resolver
         * is handed an explicit null and returns the owner's role defaults —
         * which is also what the rules fall back to for a member carrying no
         * map, so a failure to stamp this is invisible rather than a lockout.
         * It is written anyway: an unstamped owner is a row the drift check
         * has to keep explaining.
         */
        resolvedPermissions: resolveOrgPermissions(
          { role: 'owner', allHosts: true },
          null,
        ),
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
  // The first entry in the workspace's log (AGL-118). Creation is the one
  // category the activity log never covered — it was assembled by adding
  // calls at mutation points in the console UI, and the acts that bring a
  // top-level object into existence happen out here, in provisioning code no
  // UI mutation point ever reaches. The visible symptom was a customer whose
  // page read as though they had never used the product, because their whole
  // session had been creation.
  await logOrgActivity(
    orgId,
    { uid: ownerUid, email: ownerEmail ?? null },
    'Created the workspace',
    { type: 'org', id: orgId, name },
  )
  return orgId
}

export interface OrgMembershipResolution {
  orgId: string
  member: AglynOrgMember
  /**
   * True only when THIS call provisioned the org, so a caller can report the
   * activation (AGL-2587). `ensureOrgForUser` is the third org-creation door
   * and the only server-side one, and it looked identical from outside to a
   * resolution of an org that already existed — which is why `org_created`
   * counted none of the workspaces it makes. Absent on `resolveOrgMembership`,
   * which never creates anything.
   */
  created?: boolean
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
      // Marked so the caller can count the activation (AGL-2587).
      return { ...created, created: true }
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
    const held = reservation.exists
      ? (reservation.data() as {
          orgId?: unknown
          movedTo?: unknown
          reservedUntil?: unknown
        })
      : undefined
    // Claimable when free, own (moving back), a tombstone another org renamed
    // away from (AGL-585), or an unverified signup's reservation that ran out
    // (AGL-2585) — abandoned slugs are never reserved forever. Only another
    // org's ACTIVE slug blocks the change, and a lapsed reservation whose
    // holder has since verified is still active, which the auth record decides.
    if (
      !isSlugReservationClaimable(held, orgId) ||
      (held?.orgId !== orgId &&
        isSlugReservationLapsed(held) &&
        (await lapsedReservationIsStillHeld(held)))
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
  | 'lists'
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
/**
 * The member's FULL granular permission set, custom role and per-member
 * overrides applied (AGL-2350).
 *
 * `memberHasOrgPermission` below is the single-permission form and now
 * delegates here, so the two cannot answer differently. Split out because
 * `resolveOrgPermissions` in `libs/tenant/runtime` needs the whole set to
 * project onto the legacy flag map that the marketplace install and publish
 * gates read — it previously derived those flags from the built-in role tier
 * alone, which silently ignored both refinements.
 *
 * One conditional read, only when a custom role is actually assigned. A
 * dangling `roleId` resolves to `null` and falls back to the role defaults
 * rather than denying, matching what the console hook does with the same
 * dangling id — a deleted role must not lock a member out of surfaces their
 * base role allows.
 */
export async function resolveMemberOrgPermissions(
  orgId: string,
  member: Partial<AglynOrgMember> | null | undefined,
): Promise<Record<OrgPermission, boolean>> {
  let customRole: AglynOrgCustomRole | null = null
  if (member?.roleId) {
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
  return resolveOrgPermissions(member, customRole)
}

export async function memberHasOrgPermission(
  orgId: string,
  member: Partial<AglynOrgMember> | null | undefined,
  permission: OrgPermission,
): Promise<boolean> {
  if (!member) return false
  return (await resolveMemberOrgPermissions(orgId, member))[permission]
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
 * The custom role documents this roster actually references, read once each.
 *
 * A roster of hundreds shares a handful of roles, so this is bounded by the
 * number of DISTINCT `roleId`s and not by the member count.
 *
 * A role id that resolves to nothing is left ABSENT rather than recorded as
 * an empty role. The two happen to reach the same verdict today —
 * `resolveOrgPermissions` skips a key whose value is not a boolean, so an
 * empty map changes nothing — but they are different claims, and only one of
 * them is true: a dangling id means the lookup MISSED, not that a role
 * granting nothing was found. Recording the miss honestly is what keeps the
 * fallback correct if that resolver ever treats an empty map as a revocation,
 * which is what its own type comment already says it does.
 */
async function loadOrgCustomRoles(
  orgId: string,
  members: readonly AglynOrgMember[],
): Promise<Map<string, AglynOrgCustomRole>> {
  const roleIds = [
    ...new Set(
      members
        .map((member) => member.roleId)
        .filter((roleId): roleId is string => typeof roleId === 'string' && !!roleId),
    ),
  ]
  const rolesRef = firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('roles')
  const found = new Map<string, AglynOrgCustomRole>()
  await Promise.all(
    roleIds.map(async (roleId) => {
      const snapshot = await rolesRef.doc(roleId).get()
      if (snapshot.exists) {
        found.set(roleId, snapshot.data() as AglynOrgCustomRole)
      }
    }),
  )
  return found
}

/**
 * Recomputes the denormalized authorization projections after a membership
 * change: `memberRoles` on every host the org owns (or one host when given),
 * and `scopeTokens` + `resolvedPermissions` on every member doc.
 *
 * The rules resolve a request from these reads — the host doc for host
 * content (docs/MULTI_TENANT_FIRESTORE.md §5), the member doc for scoped
 * org resources (AGL-1038) — so this is what makes a membership effective.
 * They live here, in one writer called by every mutation below, because a
 * grant path that updates one projection and forgets another silently over-
 * or under-grants.
 *
 * Everything is recomputed for the whole roster rather than the changed
 * member: the roster is already loaded for `memberRoles`, and a full pass
 * self-heals rows that an earlier partial failure left stale.
 *
 * ## `resolvedPermissions`, and why the rules need it denormalized
 *
 * Security rules cannot resolve a custom role. `member.roleId` points at
 * `orgs/{orgId}/roles/{roleId}`, and reproducing the three-layer precedence
 * (per-member beats custom role beats role default) in CEL takes a second
 * cross-document get() plus a correct handling of a dangling id — where a
 * naive version over-denies and locks out paying customers. So the rules read
 * the ANSWER instead of the inputs, which is the same trade `scopeTokens`
 * already makes for a reason the rules language shares: it has no `.map()`
 * either.
 *
 * The map is `resolveOrgPermissions`' own output, so the rules and every
 * server route are reading one resolver's verdict rather than two
 * implementations of it.
 *
 * ONE READ PER DISTINCT ROLE, not per member: an org assigns a handful of
 * custom roles across a roster that can run to hundreds, and resolving each
 * member independently would re-read the same few documents once each.
 */
export async function syncOrgAuthProjections(
  orgId: string,
  hostId?: string,
): Promise<void> {
  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const members = await listOrgMembers(orgId)
  const customRoles = await loadOrgCustomRoles(orgId, members)
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
          {
            scopeTokens: projectMemberScopeTokens(member),
            resolvedPermissions: resolveOrgPermissions(
              member,
              // `?? null`, never `?? undefined`: a member whose `roleId`
              // points at a DELETED role must resolve to their role
              // defaults, which is what the resolver does with an explicit
              // null and what every server route already does with the same
              // dangling id. Leaving it undefined would be the same value,
              // but the null says the lookup happened and missed.
              member.roleId ? (customRoles.get(member.roleId) ?? null) : null,
            ),
          },
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
  /**
   * `host` and `subscription` are the two facts about a workspace that no
   * host feed can hold (AGL-118).
   *
   * A site's own log lives at `hosts/{hostId}/activity` and is destroyed with
   * the site — `eraseHost` recursive-deletes the whole tree — so "this site
   * was deleted" written there is an entry with no reader by construction.
   * A subscription belongs to no single site at all. Both are org-level
   * events, and this is the only feed that outlives them.
   */
  type: 'org' | 'member' | 'invite' | 'host' | 'subscription'
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
  /**
   * `uid` is nullable because some org events HAVE no actor (AGL-118). Stripe
   * cancels a subscription after a month of failed retries with nobody
   * present, and the honest record of that says so. Naming the last person
   * who touched billing instead would put a real name on an act nobody
   * performed — and `actorId` is a filterable field, so the invented
   * attribution would then show up under that person when somebody asks what
   * they have done.
   */
  actor: { uid: string | null; email?: string | null },
  action: string,
  target: OrgActivityTarget,
): Promise<void> {
  await firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('activity')
    .add({
      actorId: actor.uid ?? null,
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

/** What a host activity entry points at. Mirrors `HostActivityTarget`. */
export interface HostActivityTarget {
  type:
    | 'host' | 'screen' | 'layout' | 'theme' | 'media' | 'content' | 'variable'
    | 'function' | 'workflow' | 'member' | 'component' | 'template'
  id?: string
  name?: string
  versionId?: string
}

/**
 * Append to `hosts/{hostId}/activity` with the ADMIN SDK (AGL-118).
 *
 * The host log's twin of {@link logOrgActivity}, and the beginning of the
 * migration off the browser. Every entry in this collection has been written
 * by the client since the log existed, which makes it an audit trail its
 * subject can decline to write: three template surfaces created screens,
 * layouts and components while calling no logger at all, and nothing noticed
 * for months because a log that is missing an entry looks exactly like a
 * person who did nothing.
 *
 * A route that already authenticated the caller has the two things the client
 * cannot be trusted for — a VERIFIED uid, and the certainty that the write it
 * is recording actually happened, because it performed it. So an entry from
 * here is worth more than the one it replaces, not merely more reliable.
 *
 * Never throws, for the reason the client logger never throws: an audit miss
 * must not turn a successful create into a failed request. It is `await`ed
 * rather than floated because a serverless response ending cancels in-flight
 * work, which would make the drop the common case rather than the rare one.
 */
export async function logHostActivity(
  hostId: string,
  actor: { uid: string; email?: string | null },
  action: string,
  target: HostActivityTarget,
): Promise<void> {
  await firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('activity')
    .add({
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      action,
      target: {
        type: target.type,
        ...(target.id ? { id: target.id } : {}),
        ...(target.name ? { name: target.name } : {}),
        ...(target.versionId ? { versionId: target.versionId } : {}),
      },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
}

/**
 * A collaborator seat refusal, raised from INSIDE the grant transaction
 * (AGL-2068).
 *
 * An exception rather than a return value because it has to travel out of
 * `upsertOrgMember` / `grantHostAccess`, whose contract is "make it so" and
 * which four routes already call as a bare `await`. Returning a verdict would
 * have let every existing call site ignore it silently, which is the shape of
 * the bug being fixed.
 */
export class CollaboratorSeatLimitError extends Error {
  readonly hostId: string
  readonly limit: number
  readonly upgradeRequired: boolean
  readonly addonPriceUsd: number | null
  /**
   * Seats this site holds ABOVE `limit` (AGL-2439). Non-zero means the site
   * is GRANDFATHERED: those collaborators keep their access, and the refusal
   * is only of the NEXT one. Carried on the error so the refusal copy can say
   * that rather than letting the admin read a 403 as "somebody was removed".
   */
  readonly retainedOverCap: number
  constructor(
    hostId: string,
    quota: {
      limit: number
      upgradeRequired: boolean
      addonPriceUsd: number | null
      retainedOverCap?: number
    },
  ) {
    super(collaboratorSeatMessage(quota))
    this.name = 'CollaboratorSeatLimitError'
    this.hostId = hostId
    this.limit = quota.limit
    this.upgradeRequired = quota.upgradeRequired
    this.addonPriceUsd = quota.addonPriceUsd
    this.retainedOverCap = Math.max(0, quota.retainedOverCap ?? 0)
  }
}

/**
 * The two refusal strings, verbatim from `/api/hosts/members` where they have
 * always lived. Kept byte-identical on purpose: this is now the ONE place
 * they are produced, and any client or spec matching "Collaborator limit
 * reached" must keep matching.
 */
function collaboratorSeatMessage(quota: {
  limit: number
  upgradeRequired: boolean
  addonPriceUsd: number | null
}): string {
  return quota.upgradeRequired
    ? `Collaborator limit reached (${quota.limit}) — upgrade ` +
        'your plan to add more collaborators'
    : `Collaborator seats full (${quota.limit}) — add seats for ` +
        `$${quota.addonPriceUsd}/mo each from Billing`
}

/**
 * Everyone who could be holding a collaborator seat in this org: the whole
 * roster plus every un-accepted invite (AGL-2068).
 *
 * Both collections in full, rather than a `where('hostAccess.X','!=',null)`:
 * the predicate that decides a seat is `isOrgWideMember`, which reads three
 * fields and treats an ABSENT `allHosts` as org-wide. Firestore cannot
 * express "field absent" in a filter, so a query-side count gets the legacy
 * rows wrong in the direction that over-charges. These collections are
 * bounded by the very caps being enforced, so reading them whole is cheap and
 * — inside a transaction — is exactly the lock that serialises concurrent
 * grants.
 */
async function readSeatEntries(
  orgRef: FirebaseFirestore.DocumentReference,
  read: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>,
): Promise<CollaboratorSeatEntry[]> {
  const [members, invites] = await Promise.all([
    read(orgRef.collection('members')),
    read(orgRef.collection('invites').where('acceptedAt', '==', null)),
  ])
  return [
    // The uid is the DOCUMENT ID on the roster and is not a field, so it has
    // to be put back or every legacy row without a mirrored email identifies
    // nobody and silently stops consuming its seat.
    ...members.docs.map(
      (doc) => ({ uid: doc.id, ...doc.data() }) as CollaboratorSeatEntry,
    ),
    ...invites.docs.map((doc) => doc.data() as CollaboratorSeatEntry),
  ]
}

/**
 * The hard cap itself, evaluated against the POST-state and inside the same
 * transaction that performs the grant (AGL-2068).
 *
 * A create-time quota that reads, decides, and then writes is not a cap —
 * this repo has now relearned that three times in one day (AGL-1390 laundering
 * a count, AGL-2057 the assist cap, AGL-2063 the site limit): N concurrent
 * requests all read the same pre-count, all pass, and all land. Doing the
 * read through the transaction is what fixes it. Firestore tracks the read
 * SET, so a second grant that read the same roster cannot commit — it retries,
 * re-reads a roster that now holds the first grant, and refuses.
 *
 * Only NEWLY granted hosts are charged. Changing an existing collaborator's
 * role on a site they already reach re-writes the same seat, and refusing that
 * would strand an over-limit org unable to even demote its way back.
 *
 * THE CAP IS PER SITE AND SO IS THE QUESTION (AGL-2439). This calls
 * `checkHostCollaboratorQuota(org, hostId, used)` and not
 * `checkSeatQuota(org, 'members', used)`: since AGL-2439 the purchased
 * quantity is an org-level POOL and the latter deliberately answers the
 * PLAN's cap with no pool in it. Passing the plan cap here would refuse a
 * site the seats the org bought and assigned to it.
 *
 * THE GRANDFATHER LIVES HERE, in what this function does NOT do. It runs on
 * the GRANT path only — `newlyScopedHosts` is empty for an existing seat — so
 * a site already above its corrected cap keeps every collaborator it has and
 * is merely refused the next one. There is no sweep, no reconciliation and no
 * revocation anywhere in this file, and none may be added: the cap binds
 * ALLOCATION, never ACCESS. `quota.retainedOverCap` is how many seats a site
 * is over by, carried on the refusal so the console can say it out loud
 * rather than leaving the customer to infer it from a rejected click.
 */
async function assertCollaboratorSeats(options: {
  orgRef: FirebaseFirestore.DocumentReference
  org: Partial<AglynOrgBilling>
  hostIds: string[]
  self: {
    uid?: string | null
    email?: string | null
    emails?: readonly (string | null | undefined)[] | null
  }
  read: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>
}): Promise<void> {
  const { orgRef, org, hostIds, self, read } = options
  if (!hostIds.length) return
  const entries = await readSeatEntries(orgRef, read)
  for (const hostId of hostIds) {
    const used = countCollaboratorSeats(entries, hostId, self)
    const quota = checkHostCollaboratorQuota(org, hostId, used)
    if (!quota.allowed) throw new CollaboratorSeatLimitError(hostId, quota)
  }
}

/**
 * Which hosts a membership is about to reach for the FIRST time as a scoped
 * collaborator — the set the seat cap is charged for.
 *
 * Empty when the resulting membership is org-wide: a manager already reaches
 * every host and pays for it with a manager seat.
 */
function newlyScopedHosts(options: {
  role: OrgRole | undefined
  allHosts: boolean
  hostAccess: Record<string, unknown>
  existing: Partial<AglynOrgMember> | undefined
}): string[] {
  const { role, allHosts, hostAccess, existing } = options
  if (isOrgWideMember({ role, allHosts, hostAccess } as Partial<AglynOrgMember>)) {
    return []
  }
  const prior = (existing?.hostAccess ?? {}) as Record<string, unknown>
  return Object.keys(hostAccess).filter((hostId) => !prior[hostId])
}

/**
 * Turn a seat refusal into the 403 the four admitting routes return, or null
 * when the error is something else and must keep propagating to the 500.
 *
 * Lives here beside `emailUnverifiedResponse` and `lockdownRefusal` so a
 * route's catch block is one line and cannot accidentally mask a real fault.
 */
export function collaboratorSeatRefusalResponse(
  error: unknown,
): Response | null {
  if (!(error instanceof CollaboratorSeatLimitError)) return null
  return Response.json(
    {
      error: error.message,
      code: 'collaborator_seat_limit',
      limit: error.limit,
      upgradeRequired: error.upgradeRequired,
      // AGL-2439: how many seats this site is over by. NOBODY was removed —
      // the client renders this as retention, not as a loss.
      retainedOverCap: error.retainedOverCap,
    },
    { status: 403 },
  )
}

/**
 * The same cap, asked BEFORE anything is written (AGL-2068).
 *
 * Not the enforcement — the transaction inside the grant is. This exists so
 * the two doors that only ever create an INVITE (`/api/hosts/members` for an
 * address with no account yet, and `/api/orgs/invites` create) refuse at the
 * point the admin is looking at, rather than mailing someone a link that will
 * be refused when they click it. A race here over-reserves invites; it cannot
 * over-grant access, because access is only ever granted through the
 * transactional path.
 */
export async function collaboratorSeatRefusal(options: {
  orgId: string
  org: Partial<AglynOrgBilling>
  hostIds: string[]
  self?: { uid?: string | null; email?: string | null }
}): Promise<Response | null> {
  const { orgId, org, hostIds, self } = options
  if (!hostIds.length) return null
  try {
    await assertCollaboratorSeats({
      orgRef: firestore().collection('orgs').doc(orgId),
      org,
      hostIds,
      self: self ?? {},
      read: (query) => query.get(),
    })
  } catch (error) {
    const refusal = collaboratorSeatRefusalResponse(error)
    if (refusal) return refusal
    throw error
  }
  return null
}

/**
 * The refusal string, taken from `/api/orgs/members`.
 *
 * The four doors each phrased this differently — "upgrade your plan to invite
 * more members", "to add more members", "This organization is out of team
 * seats", "This workspace has used all N of its team seats" — which is what a
 * gate copied four times produces. One wording now, from the one place the
 * refusal is built. Nothing matches these strings but a human, so the
 * consolidation costs no caller.
 */
function managerSeatMessage(quota: {
  limit: number
  upgradeRequired: boolean
  addonPriceUsd: number | null
}): string {
  return quota.upgradeRequired
    ? `Team seat limit reached (${quota.limit}) — upgrade your ` +
        'plan to add more members'
    : `Team seats full (${quota.limit}) — add seats for ` +
        `$${quota.addonPriceUsd}/mo each from Billing`
}

/**
 * A manager seat refused, thrown rather than returned, for the reason
 * {@link CollaboratorSeatLimitError} is thrown: it has to travel out of
 * `upsertOrgMember`, whose contract is "make it so" and which three routes
 * already call as a bare `await`. A verdict would be silently discarded by
 * every one of them, which is the shape of the bug being fixed.
 */
export class ManagerSeatLimitError extends Error {
  readonly limit: number
  readonly upgradeRequired: boolean
  readonly addonPriceUsd: number | null
  /**
   * Seats the org holds ABOVE `limit`. Non-zero means it is GRANDFATHERED:
   * those managers keep their access and only the NEXT one is refused, so the
   * console can say that instead of letting an admin read a 403 as "somebody
   * was removed".
   */
  readonly retainedOverCap: number
  constructor(quota: {
    limit: number
    upgradeRequired: boolean
    addonPriceUsd: number | null
    retainedOverCap?: number
  }) {
    super(managerSeatMessage(quota))
    this.name = 'ManagerSeatLimitError'
    this.limit = quota.limit
    this.upgradeRequired = quota.upgradeRequired
    this.addonPriceUsd = quota.addonPriceUsd
    this.retainedOverCap = Math.max(0, quota.retainedOverCap ?? 0)
  }
}

/**
 * The manager cap, evaluated against the POST-state and inside the same
 * transaction that performs the grant (AGL-2068, on the manager key).
 *
 * The collaborator cap above learned this the hard way and this is the same
 * defect one key over: all four doors that admit a manager — invite create,
 * invite accept, direct member add and SSO-JIT — read the roster, decided,
 * and then wrote, with nothing between the read and the write. N concurrent
 * accepts all measured against the same roster, all passed, and all landed.
 * Reading THROUGH the transaction is the fix: Firestore tracks the read set,
 * so a second grant that measured the same roster cannot commit — it retries,
 * re-reads a roster that now holds the first, and refuses.
 *
 * PENDING INVITES COUNT, AT EVERY DOOR. Only invite-create counted them
 * before, so the cap was enforced against a different population depending on
 * which door was used — and the doors that ignored them are the ones that
 * actually grant access. An invite reserves the seat it will become, and a
 * cap that only bites on acceptance is walked past by mailing N invitations
 * first. `readSeatEntries` is shared with the collaborator gate precisely so
 * the two populations cannot drift apart again.
 *
 * `checkSeatQuota(org, 'managers', used)` and NOT the per-host collaborator
 * quota: `managersPerOrg` really is org-level, so purchased add-ons raise it
 * (AGL-2439 removed that only for the per-site `members` key).
 *
 * THE GRANDFATHER LIVES HERE, in what this does NOT do. It charges only the
 * TRANSITION into an org-wide seat — `becomesManager` is false when the
 * membership already held one — so an org already above its cap keeps every
 * manager it has, can still have their role or profile rewritten, and is
 * merely refused the next one. There is no sweep and no revocation, and none
 * may be added: the cap binds ADMISSION, never ACCESS.
 */
async function assertManagerSeats(options: {
  orgRef: FirebaseFirestore.DocumentReference
  org: Partial<AglynOrgBilling>
  /** Is this write ADMITTING a manager who was not one already? */
  becomesManager: boolean
  self: {
    uid?: string | null
    email?: string | null
    emails?: readonly (string | null | undefined)[] | null
  }
  read: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>
}): Promise<void> {
  const { orgRef, org, becomesManager, self, read } = options
  if (!becomesManager) return
  const entries = await readSeatEntries(orgRef, read)
  const used = countManagerSeatsExcluding(entries, self)
  const quota = checkSeatQuota(org, 'managers', used)
  if (!quota.allowed) {
    throw new ManagerSeatLimitError({
      ...quota,
      retainedOverCap: Math.max(0, used - quota.limit),
    })
  }
}

/**
 * Is this write admitting a manager who was not one already?
 *
 * The manager analogue of `newlyScopedHosts`, and it exists for the same
 * reason: a seat is charged when it is TAKEN, not every time the row holding
 * it is rewritten. Re-saving an existing manager's title, or moving them from
 * `editor` to `admin`, re-writes a seat they already hold — charging that
 * would strand an over-cap org unable to even demote its way back down.
 *
 * A scoped collaborator being promoted to org-wide DOES take a manager seat,
 * and gives one up on the collaborator side; that is a real transition and is
 * charged.
 */
function becomesOrgManager(options: {
  role: OrgRole
  allHosts: boolean
  hostAccess: Record<string, HostAccessRole>
  existing: Partial<AglynOrgMember> | undefined
}): boolean {
  const next = isOrgWideMember({
    role: options.role,
    allHosts: options.allHosts,
    hostAccess: options.hostAccess,
  } as Partial<AglynOrgMember>)
  if (!next) return false
  // An ABSENT row is not a manager, and `isOrgWideMember(undefined)` is
  // already false — but saying so explicitly keeps the "was it one before?"
  // question readable next to the legacy shape that predates `allHosts`.
  return !options.existing || !isOrgWideMember(options.existing)
}

/**
 * Turn a manager-seat refusal into the 403 the admitting routes return, or
 * null when the error is something else and must keep propagating to the 500.
 *
 * Sits beside `collaboratorSeatRefusalResponse` and stacks with it in a
 * route's catch block, each returning null for a non-match.
 */
export function managerSeatRefusalResponse(error: unknown): Response | null {
  if (!(error instanceof ManagerSeatLimitError)) return null
  return Response.json(
    {
      error: error.message,
      code: 'manager_seat_limit',
      limit: error.limit,
      upgradeRequired: error.upgradeRequired,
      // How many seats the org is over by. NOBODY was removed — the client
      // renders this as retention, not as a loss.
      retainedOverCap: error.retainedOverCap,
    },
    { status: 403 },
  )
}

/**
 * The same cap, asked BEFORE anything is written.
 *
 * Not the enforcement — the transaction inside `upsertOrgMember` is. This
 * exists for the one door that never calls it: `/api/orgs/invites` create
 * writes an invite document directly, so it refuses at the point the admin is
 * looking at rather than mailing someone a link that will be refused when
 * they click it. A race here over-reserves invites; it cannot over-grant
 * access, because access is only ever granted through the transactional path.
 */
export async function managerSeatRefusal(options: {
  orgId: string
  org: Partial<AglynOrgBilling>
  becomesManager: boolean
  self?: { uid?: string | null; email?: string | null }
}): Promise<Response | null> {
  const { orgId, org, becomesManager, self } = options
  if (!becomesManager) return null
  try {
    await assertManagerSeats({
      orgRef: firestore().collection('orgs').doc(orgId),
      org,
      becomesManager,
      self: self ?? {},
      read: (query) => query.get(),
    })
  } catch (error) {
    const refusal = managerSeatRefusalResponse(error)
    if (refusal) return refusal
    throw error
  }
  return null
}

export interface UpsertOrgMemberOptions {
  orgId: string
  uid: string
  role: OrgRole
  allHosts?: boolean
  /** Per-site grants. `author` (AGL-2334) rides the shared union. */
  hostAccess?: Record<string, HostAccessRole>
  /**
   * Further CONFIRMED addresses on the joining account (AGL-2486), so a
   * pending invite addressed to a secondary is recognised as this same
   * person and does not bill them a second collaborator seat. Must contain
   * only addresses proven to belong to `uid`.
   */
  seatAliasEmails?: readonly (string | null | undefined)[] | null
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
 * The owner seat is not writable through the membership door (AGL-1888).
 *
 * An exception, and modelled on {@link CollaboratorSeatLimitError}, for the
 * same reason: it has to travel out of a function whose contract is "make it
 * so" and which three routes call as a bare `await`. A returned verdict would
 * be ignorable at every one of them, which is the shape of the bug.
 */
export class OrgOwnerSeatError extends Error {
  /** Which invariant refused, for the log and the tests. */
  readonly reason: 'grant' | 'demote'
  constructor(reason: 'grant' | 'demote') {
    super(
      reason === 'grant'
        ? 'The owner role cannot be granted through org membership — ' +
            'ownership moves only by transfer.'
        : 'This person owns the organization. Ownership moves only by ' +
            'transfer, from Settings — an invitation cannot change it.',
    )
    this.name = 'OrgOwnerSeatError'
    this.reason = reason
  }
}

/**
 * Turn an owner-seat refusal into a 409, or null when the error is something
 * else and must keep propagating to the 500.
 *
 * Beside {@link collaboratorSeatRefusalResponse} so a route's catch block
 * stays one line and cannot accidentally mask a real fault.
 */
export function orgOwnerSeatRefusalResponse(error: unknown): Response | null {
  if (!(error instanceof OrgOwnerSeatError)) return null
  return Response.json(
    { error: error.message, code: 'org_owner_seat' },
    { status: 409 },
  )
}

/**
 * Creates or updates a member transactionally with its reverse-index
 * entry, then re-syncs host projections.
 *
 * ## The owner seat is refused here, not only in the routes (AGL-1888)
 *
 * It used to say "owner-role guards live in the API routes — this is the
 * mechanism", and that was the defect. Both halves of the org-owner invariant
 * were enforced only at the doors an admin clicks, and invite ACCEPTANCE is a
 * door that re-validates neither:
 *
 *  - **Granting.** `/api/orgs/members` and `/api/orgs/invites` create both
 *    refuse `role === 'owner'` outright, but acceptance passes the invite
 *    doc's STORED role straight through (`/api/orgs/invites` accept, and
 *    `/api/auth/sso-jit`). That is safe today only because every writer of an
 *    invite doc refuses `owner` and the collection is `allow write: if false`
 *    — a latent escalation the moment a fourth invite-writer forgets, and the
 *    invariant that an org has exactly ONE owner is what the whole SSO
 *    break-glass guarantee rests on ({@link transferOrgOwnership} MOVES the
 *    seat; nothing else may create one).
 *  - **Demoting**, which was reachable, self-serve, and irreversible. Invite
 *    creation never checked that the address is already a member, and
 *    acceptance accommodates an existing member re-accepting. So any admin
 *    could invite the OWNER'S own verified address as `viewer`; the owner
 *    clicks a normal-looking invitation to their own organization; this
 *    function merge-writes `role: 'viewer'`, `allHosts: false` onto the owner's
 *    member doc. `orgs/{orgId}.ownerUid` still names them, but every
 *    authorization read goes through the member doc — so `canManageOrg` is
 *    now false, `transfer-ownership` checks `membership.member.role ===
 *    'owner'` and refuses them, `/api/orgs/members` refuses to edit the owner's
 *    membership at all, and `findBreakGlassOrgOwners` (`where role == owner`)
 *    finds nobody. The org loses its owner permanently, recoverable only by
 *    staff. It is the AGL-1375 one-way door rebuilt out of the invite path,
 *    and it needs no SSO to reach.
 *
 * Both checks live HERE because this is the single transaction every door
 * funnels through, and the org doc and the existing member doc are already in
 * its read set — so it costs nothing and cannot be forgotten by a fifth
 * caller. The route-level refusals stay: they are better error messages at
 * the point the admin is looking, not the control.
 *
 * The demotion guard asks BOTH `org.ownerUid` and the stored role, rather
 * than trusting either to stand for the other. They are supposed to agree;
 * an org where they have already diverged is exactly the one that most needs
 * the write refused.
 *
 * {@link createOrganization} and {@link transferOrgOwnership} are unaffected —
 * both write `role: 'owner'` with their own `tx.set`, and remain the only two
 * producers of an owner in the product.
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
    seatAliasEmails,
    displayName,
    photoURL,
    title,
    invitedBy,
  } = options
  // Before the transaction is even opened: this one needs no reads, and
  // refusing here is what lets the spec assert that NOTHING was written
  // rather than that a throw happened somewhere.
  if (role === 'owner') throw new OrgOwnerSeatError('grant')
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
    // The owner's own row is not writable here (AGL-1888). Both facts, not
    // one standing in for the other — see the note on this function.
    if (
      org.ownerUid === uid ||
      (existing.data() as Partial<AglynOrgMember> | undefined)?.role === 'owner'
    ) {
      throw new OrgOwnerSeatError('demote')
    }
    // Collaborator seat cap (AGL-2068), inside this transaction and before
    // any write. This is the door `/api/orgs/members` and invite ACCEPTANCE
    // come through, and neither metered `membersPerHost` at all — both gate
    // on `isOrgWideMember`, which is false for exactly the site-scoped
    // collaborator this charges for. The roster read below joins this
    // transaction's read set, so concurrent accepts serialise instead of all
    // passing the same pre-count.
    await assertCollaboratorSeats({
      orgRef: db.collection('orgs').doc(orgId),
      org: orgSnapshot.data() as Partial<AglynOrgBilling>,
      hostIds: newlyScopedHosts({
        role,
        allHosts: allHosts ?? false,
        hostAccess: hostAccess ?? {},
        existing: existing.data() as Partial<AglynOrgMember> | undefined,
      }),
      self: { uid, email, emails: seatAliasEmails },
      read: (query) => tx.get(query),
    })
    // Manager seat cap, in the same read slot and for the same reason. This
    // is the door invite ACCEPTANCE, `/api/orgs/members` and SSO-JIT all come
    // through, and all three read the roster outside any transaction before
    // this — so concurrent accepts measured one roster and every one of them
    // passed. The read below joins this transaction's read set, which is what
    // serialises them.
    await assertManagerSeats({
      orgRef: db.collection('orgs').doc(orgId),
      org: orgSnapshot.data() as Partial<AglynOrgBilling>,
      becomesManager: becomesOrgManager({
        role,
        allHosts: allHosts ?? false,
        hostAccess: hostAccess ?? {},
        existing: existing.data() as Partial<AglynOrgMember> | undefined,
      }),
      self: { uid, email, emails: seatAliasEmails },
      read: (query) => tx.get(query),
    })
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
 *
 * **It moves `ownerUid` and must never touch `createdByUid`** (AGL-2265).
 * That field is the creator attribution the free-workspace ceiling counts
 * against, and it is what stops a transfer from being a way to launder the
 * count: hand a workspace to an alt account, create a fourth, take it back.
 * Nothing here writes it, and `free-workspace-cap.spec.ts` runs exactly that
 * sequence to keep it that way.
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
  /*
   * A workspace changing hands is the highest-consequence thing that can
   * happen to an account, and until AGL-118 it left no trace anywhere: the
   * transaction above rewrites five documents and wrote nothing that says it
   * happened, so the only evidence was the new state itself.
   *
   * BOTH principals are on the row. The actor is the outgoing owner, who is
   * the only party allowed to perform this, and the target names the
   * incoming one — a transfer identified by one party is half a record, and
   * the half it keeps is the one already implied by `ownerUid`.
   *
   * Emails are read after the fact and best-effort. The uids are the
   * identity; the addresses only save a reader a lookup, so a failure to
   * resolve them must not cost the entry.
   */
  const [fromEmail, toEmail] = await Promise.all(
    [fromUid, toUid].map(async (uid) =>
      firestore()
        .collection('orgs')
        .doc(orgId)
        .collection('members')
        .doc(uid)
        .get()
        .then((snapshot) => {
          const email = snapshot.get('email')
          return typeof email === 'string' ? email : null
        })
        .catch(() => null),
    ),
  )
  await logOrgActivity(
    orgId,
    { uid: fromUid, email: fromEmail },
    'Transferred workspace ownership',
    { type: 'member', id: toUid, ...(toEmail ? { name: toEmail } : {}) },
  )
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
  /** `author` (AGL-2334) edits content and cannot publish. */
  role: HostAccessRole
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
    // Collaborator seat cap (AGL-2068). This door DID meter, but against
    // `hosts/{hostId}/members` — a display roster only its own route writes,
    // so it could not see anyone admitted by invite or by `/api/orgs/members`
    // and under-counted even when it fired. The count now comes off the org
    // roster + pending invites, which is where every door lands.
    await assertCollaboratorSeats({
      orgRef,
      org: orgSnapshot.data() as Partial<AglynOrgBilling>,
      // Asked of the membership AS IT STANDS, not of the merged shape.
      // `grantHostAccess` never touches `role` or `allHosts`, so someone who
      // is already a manager stays one and keeps paying a manager seat — and
      // a legacy pre-`allHosts` row, which `isOrgWideMember` reads as org-wide
      // precisely so it is not locked out, must not be re-classified into a
      // collaborator seat by the act of writing a host key onto it.
      hostIds: (() => {
        const current = existing.data() as Partial<AglynOrgMember> | undefined
        if (existing.exists && isOrgWideMember(current)) return []
        if (current?.hostAccess?.[hostId]) return []
        return [hostId]
      })(),
      self: { uid, email },
      read: (query) => tx.get(query),
    })
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

/**
 * The consent group a site belongs to, read off its owning org.
 *
 * The ONE server-side door to pooling. Every capture surface and every send
 * path resolves a group through this rather than reading
 * `CONSENT_GROUPS_FIELD` itself, so there is one place that decides what a
 * site's consent covers and one place a mistake could live.
 *
 * FAILS TO THE GROUP OF ONE. An org that cannot be resolved, or a read that
 * throws, answers "this site alone" — which withholds mail from an org that
 * had legitimately pooled and never sends mail on a pooling nobody could
 * confirm. That is the only direction a failure here may fall.
 *
 * The org read is `React.cache`-deduped per request by {@link getOrgForHost},
 * so a send that already resolved the org for its policy pays nothing extra.
 */
export async function consentGroupForSite(
  hostId: string,
  org?: Record<string, unknown> | null,
): Promise<ConsentGroup> {
  if (!hostId) throw new Error('[organizations] no site to resolve a group for')
  if (org) return consentGroupForHost(org, hostId)
  const resolved = await getOrgForHost(hostId).catch(() => null)
  return consentGroupForHost(
    (resolved?.org as Record<string, unknown> | undefined) ?? null,
    hostId,
  )
}
