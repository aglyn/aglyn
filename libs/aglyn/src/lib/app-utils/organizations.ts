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
 * Organization helpers (AGL-233): slug policy for workspace subdomains
 * (`{slug}.aglyn.com`) and role math shared by the org APIs, the console
 * UI, and the Firestore rules' mental model. See
 * docs/MULTI_TENANT_FIRESTORE.md.
 */

import type {
  AglynOrgMember,
  HostAccessRole,
  HostUid,
  OrgRole,
  ScopeToken,
  UserOrgMembership,
} from '../foundation'
import {
  generateSubdomain,
  isBlockedSubdomain,
  SUBDOMAIN_PATTERN,
} from './host-naming'
import {
  hostScopeToken,
  ORG_SCOPE_TOKEN,
  visibleToTokens,
} from './scope-tokens'

/** Same lexical policy as host subdomains: 3–30 lowercase/digits/dashes. */
export const ORG_SLUG_PATTERN = SUBDOMAIN_PATTERN

/**
 * Org workspace slugs ride the host reserved/profanity blocklist plus
 * console-specific labels the workspace router must own.
 */
const RESERVED_ORG_ONLY = new Set(['staff', 'org', 'orgs', 'workspace'])

export function isBlockedOrgSlug(slug: string): boolean {
  return RESERVED_ORG_ONLY.has(slug.toLowerCase()) || isBlockedSubdomain(slug)
}

export function isValidOrgSlug(slug: string): boolean {
  return ORG_SLUG_PATTERN.test(slug) && !isBlockedOrgSlug(slug)
}

/** Best-effort slug from an org name; '' when nothing usable remains. */
export function generateOrgSlug(name: string): string {
  const slug = generateSubdomain(name)
  return slug && !isBlockedOrgSlug(slug) ? slug : ''
}

export const ORG_ROLES: readonly OrgRole[] = [
  'owner',
  'admin',
  'editor',
  'viewer',
]

const ORG_ROLE_WEIGHT: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  viewer: 0,
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ORG_ROLE_WEIGHT
}

export function orgRoleAtLeast(
  role: OrgRole | null | undefined,
  minimum: OrgRole,
): boolean {
  if (!role || !(role in ORG_ROLE_WEIGHT)) return false
  return ORG_ROLE_WEIGHT[role] >= ORG_ROLE_WEIGHT[minimum]
}

/** Org settings, members, invites, host creation: admin and owner. */
export function canManageOrg(role: OrgRole | null | undefined): boolean {
  return orgRoleAtLeast(role, 'admin')
}

/**
 * The member's effective role on one host, or null for no access.
 * Owner/admin span every host; editor/viewer resolve through `allHosts`
 * (mapped to their org role) or the per-host access map.
 */
export function hostRoleFor(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid,
): HostAccessRole | null {
  const role = member?.role
  if (!isOrgRole(role)) return null
  if (role === 'owner' || role === 'admin') return 'admin'
  const explicit = member?.hostAccess?.[hostId]
  if (explicit) return explicit
  return member?.allHosts ? role : null
}

/** Whether the member may mutate a host's content (admin or editor on it). */
export function canWriteHost(
  member: Partial<AglynOrgMember> | null | undefined,
  hostId: HostUid,
): boolean {
  const role = hostRoleFor(member, hostId)
  return role === 'admin' || role === 'editor'
}

/**
 * Whether a member's reach is the whole org rather than a list of sites.
 *
 * Owner and admin always are; editor/viewer are only when `allHosts` says
 * so — **or** when the membership predates the flag entirely. A pre-
 * `allHosts` doc carries neither the flag nor a `hostAccess` map, and
 * reading that as "scoped, with access to nothing" would lock real members
 * out of their own workspace. A site collaborator ALWAYS has a non-empty
 * `hostAccess` (that is what `grantHostAccess` writes), so the absence of
 * both is the legacy shape, not a scoped one.
 *
 * Single source of truth for `resolveOrgPermissions` (the server gate),
 * `projectMemberScopeTokens` (the rules projection), and the rules'
 * own `isOrgWideMember()` — three copies of this predicate that disagree
 * is a privilege bug, not a style problem (AGL-1026, AGL-1038).
 */
export function isOrgWideMember(
  member: Partial<AglynOrgMember> | null | undefined,
): boolean {
  if (!member) return false
  const role = member.role
  if (role === 'owner' || role === 'admin') return true
  if (member.allHosts === true) return true
  const scoping = member.hostAccess
  return (
    member.allHosts === undefined && !Object.keys(scoping ?? {}).length
  )
}

/**
 * How many of these roster entries consume a **manager** seat (AGL-1113).
 *
 * `orgs/{orgId}/members` holds BOTH org managers and site-scoped
 * collaborators — adding a collaborator to one site writes an org member doc
 * with `allHosts:false` + `hostAccess`, so a raw `.count()` of the collection
 * billed every collaborator as a manager. Collaborators are metered
 * separately, per host, against `membersPerHost` at
 * `hosts/{hostId}/members` — counting them here charged them twice and
 * tripped the manager gate for orgs nowhere near their manager limit.
 *
 * Reuses `isOrgWideMember` rather than filtering on `allHosts` directly:
 * owner/admin are managers whatever the flag says, and a pre-`allHosts` doc
 * is a manager too. A Firestore `where('allHosts','==',true)` count gets both
 * of those wrong, which is why callers pass entries in and count here.
 *
 * Accepts pending INVITES as well as members — an invite carries the same
 * `role`/`allHosts`/`hostAccess` shape and reserves the seat it will become.
 */
export function countManagerSeats(
  entries: ReadonlyArray<Partial<AglynOrgMember> | null | undefined>,
): number {
  let count = 0
  for (const entry of entries) if (isOrgWideMember(entry)) count += 1
  return count
}

/**
 * What KIND of user a console row represents (AGL-1114) — the distinction
 * that decides which seat they consume, and the one the Team table could not
 * express because a manager and a collaborator differ only by fields the
 * table never showed.
 *
 * Deliberately NOT the same axis as `role`. A `role: 'editor'` is a manager
 * when their reach is the whole org and a collaborator when it is two sites;
 * reading the role alone is the mistake that let a collaborator look like
 * team staff (see the org-leak and role-gate work).
 *
 * `siteMember` is the third kind and never appears in `orgs/{id}/members` at
 * all: it is an end-user account on a PUBLISHED site (`siteMembers`), not a
 * console user. It is listed here so the vocabulary is complete and so a
 * surface that does mix the two populations (the staff user directory) has a
 * label for it — it is free and uncounted on every plan (AGL-889).
 */
export type ConsoleUserType = 'manager' | 'collaborator' | 'siteMember'

export const CONSOLE_USER_TYPE_LABELS: Record<ConsoleUserType, string> = {
  manager: 'Team manager',
  collaborator: 'Site collaborator',
  siteMember: 'Site member',
}

/** One line on what each kind is and what it costs — tooltip/legend copy. */
export const CONSOLE_USER_TYPE_HINTS: Record<ConsoleUserType, string> = {
  manager:
    'Reaches the whole organization. Uses one of your team (manager) seats.',
  collaborator:
    'Scoped to specific sites. Uses a collaborator seat on each site they ' +
    'can reach, not a team seat.',
  siteMember:
    'An end-user account on a published site, not a console user. Free and ' +
    'unlimited on every plan.',
}

/**
 * Classify an `orgs/{orgId}/members` entry (or a pending invite, same shape).
 * Never returns `siteMember` — nothing in that collection is one; the value
 * exists for surfaces that list published-site accounts alongside console
 * users and must label them.
 */
export function consoleUserType(
  member: Partial<AglynOrgMember> | null | undefined,
): Exclude<ConsoleUserType, 'siteMember'> {
  return isOrgWideMember(member) ? 'manager' : 'collaborator'
}

/**
 * Whether an account is governed by enterprise SSO (AGL-1128) — it lives in
 * an org's GCIP tenant pool rather than the project pool, so its identity is
 * owned by the customer's IdP.
 *
 * `tenantId` is the whole signal: Firebase sets it on the user whenever the
 * account belongs to a tenant, and only SSO accounts do.
 */
export function isSsoGovernedAccount(
  user: { tenantId?: string | null } | null | undefined,
): boolean {
  return Boolean(user?.tenantId)
}

/**
 * Whether the account may connect an additional consumer sign-in provider.
 *
 * **No, for any SSO-governed account.** The customer's IdP is the single gate
 * they bought: they revoke there, enforce MFA there, offboard there. A linked
 * personal Google account is a way in their IdP can never see or revoke —
 * exactly what SSO is purchased to prevent.
 *
 * Deliberately NOT gated on `sso.enforced`. That flag exists so we never
 * LOCK OUT an existing sign-in method; it is not a licence to hand out new
 * bypasses meanwhile. Nothing here removes a provider an account already has,
 * so this can never lock anyone out.
 *
 * This is the intent, not the boundary — the boundary is upstream, since a
 * GCIP tenant only accepts providers enabled on that tenant. Both matter: the
 * boundary is remote config that could drift, and a UI that offers a
 * security-regressing action is wrong even when the action would fail.
 */
export function canLinkSocialProvider(
  user: { tenantId?: string | null } | null | undefined,
): boolean {
  return !isSsoGovernedAccount(user)
}

/**
 * The same question as `isOrgWideMember`, asked of the `users/{uid}/orgs`
 * reverse-index row instead of the member doc (AGL-1032).
 *
 * The console navigates from the index — it is what `useOrgScope` loads —
 * and the index carries a MIRROR of the predicate, not the inputs to it, so
 * this cannot recompute: `role: 'viewer'` on the index means "viewer",
 * whether the member reaches every site or one.
 *
 * Reads a missing flag as org-wide, for the same reason `isOrgWideMember`
 * reads a missing `allHosts` that way: rows written before the mirror
 * existed have no flag, and hiding the workspace from a real member is a
 * worse failure than showing org chrome to a collaborator whose reads the
 * rules refuse anyway. Owner/admin are org-wide by role regardless of the
 * mirror, so a stale row can never lock an admin out.
 *
 * Navigation only — never an access decision. AGL-1026 (rules) and the
 * Admin-SDK scope checks are the boundary.
 */
export function isOrgWideMembership(
  membership:
    | Pick<UserOrgMembership, 'role' | 'orgWide'>
    | null
    | undefined,
): boolean {
  if (!membership) return true
  if (membership.role === 'owner' || membership.role === 'admin') return true
  return membership.orgWide !== false
}

/**
 * The `scopeTokens` projection stamped onto member docs (AGL-1038) so the
 * rules can intersect a caller's reach with a resource's `visibleTo` —
 * rules have no `.map()`, so `hostAccess`'s keys cannot be turned into
 * tokens at evaluation time and have to be denormalized here.
 *
 * Org-wide members get `['org']`; they own the org and read everything in
 * it, scoped or not (the rules short-circuit on them anyway). A scoped
 * collaborator gets `'org'` plus one token per granted host — `'org'`
 * because an org-WIDE resource stays readable by any member, which is
 * today's behavior and not something this project narrows.
 *
 * Not capped at `MAX_SCOPE_HOSTS`: the rules' `hasAny` has no 30-value
 * limit, only the client `array-contains-any` query does, so a member of
 * more than 30 sites is a listing problem for AGL-1044 to chunk, not a
 * reason to under-grant here.
 */
export function projectMemberScopeTokens(
  member: Partial<AglynOrgMember> | null | undefined,
): ScopeToken[] {
  if (isOrgWideMember(member)) return [ORG_SCOPE_TOKEN]
  const hostIds = Object.keys(member?.hostAccess ?? {})
  return [ORG_SCOPE_TOKEN, ...hostIds.map(hostScopeToken)]
}

/**
 * A member's effective read set: the stored `scopeTokens` projection when it
 * is there, recomputed from the membership when it is not.
 *
 * The fallback is the security-relevant half and it was written out by hand
 * in four places (`use-scope-tokens`, `erase-scope`, the media sign route,
 * and by omission in `resolveMediaScope`, which only ever recomputed). Four
 * copies of "what may this member see" is the shape that eventually
 * disagrees, and a copy that reads `member.scopeTokens` WITHOUT the
 * `.length` guard silently grants nothing to a member the AGL-1040 backfill
 * has not reached — or, written the other way round, grants everything.
 *
 * Recomputing is the safe fallback rather than a convenience: it produces
 * exactly what `grantHostAccess` would have stamped, so an unstamped member
 * doc behaves as its `hostAccess` says, never as "no access" and never as
 * org-wide.
 */
export function memberScopeTokens(
  member: Partial<AglynOrgMember> | null | undefined,
): ScopeToken[] {
  const stored = member?.scopeTokens
  return stored?.length ? stored : projectMemberScopeTokens(member)
}

/**
 * May this member see a resource carrying `visibleTo`? (AGL-1037/1038)
 *
 * The whole client-side/server-side authorization question in one place:
 * org-wide members read everything they own; everyone else needs their read
 * set to intersect the resource's scope. Absent/empty `visibleTo` is
 * org-wide by the same rule the Firestore rules use, so an unbackfilled
 * resource does not vanish.
 *
 * Every Admin-SDK path must call this (or `scopeAllows`, which wraps an
 * already-resolved scope) — the Admin SDK bypasses rules entirely, so this
 * IS the enforcement there, not a second opinion about it.
 *
 * NOT a membership check, and never a substitute for one: a `null` member
 * "can see" an org-wide resource here, because the question this answers is
 * "is this resource in scope for that reach", not "is this person in the
 * org". Resolve membership first and refuse the caller if there is none —
 * conflating the two is exactly how AGL-1026 exposed a whole org.
 */
export function memberCanSee(
  member: Partial<AglynOrgMember> | null | undefined,
  visibleTo: readonly string[] | null | undefined,
): boolean {
  if (isOrgWideMember(member)) return true
  return visibleToTokens(visibleTo ?? undefined, memberScopeTokens(member))
}

/**
 * The `memberRoles` projection stamped onto host docs so Firestore rules
 * authorize host content with the single host-doc read they already do
 * (docs/MULTI_TENANT_FIRESTORE.md §5). Recomputed by the membership API
 * whenever a member changes; owner/admin appear on every host.
 */
export function projectHostMemberRoles(
  members: ReadonlyArray<Partial<AglynOrgMember> & { $id: string }>,
  hostId: HostUid,
): Record<string, HostAccessRole> {
  const projection: Record<string, HostAccessRole> = {}
  for (const member of members) {
    const role = hostRoleFor(member, hostId)
    if (role) projection[member.$id] = role
  }
  return projection
}
