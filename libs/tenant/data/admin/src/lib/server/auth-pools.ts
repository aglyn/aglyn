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
 * Cross-pool Firebase Auth lookups (AGL-1122).
 *
 * Enterprise SSO (AGL-1101) signs users into a per-org **GCIP tenant**, and a
 * tenant has its OWN user pool. A project-level `getUserByEmail` /
 * `listUsers` does not see those users at all — measured on aglyn-main:
 * the owner of aglyn-org returned `auth/user-not-found` at project level and
 * was present only under tenant `aglyn-org-y5v14`.
 *
 * That silently broke five separate things: staff could not find, view,
 * disable or grant staff to an SSO user; adding one to an org or a site by
 * email 404'd into "send them an invite" for an account that already exists;
 * and `notifyStaff` skipped SSO staff entirely. Fixing those one route at a
 * time would guarantee the next new route reintroduces the bug, so every
 * caller goes through here instead.
 *
 * Custom claims are per-pool too: `setCustomUserClaims` on the project pool
 * cannot grant staff to a tenant user. `authForPool` hands back the right
 * `BaseAuth` so a mutation lands in the pool the user actually lives in.
 */

import type { BaseAuth, UserRecord } from 'firebase-admin/auth'
import firebaseAdmin from './firebase-admin'

const auth = () => firebaseAdmin.app().auth()

/** A user plus the pool they were found in (`null` = the project pool). */
export interface PooledUserRecord {
  record: UserRecord
  /** GCIP tenant id, or null when the user is in the project-level pool. */
  tenantId: string | null
  /**
   * Other pools that ALSO hold this uid (AGL-1962). Normally absent: a uid is
   * unique within a pool, and the pools are meant to hold different people.
   *
   * It is populated when the same uid turns up in more than one pool, which
   * means something minted a custom token for one pool's uid against another
   * pool — `signInWithCustomToken` CREATES the account when the uid is absent,
   * so the mistake manufactures an empty shadow account rather than failing.
   * Measured on production: `QQ7fixtureUid0000000000000001` existed in both the
   * project pool and `aglyn-org-y5v14`, the project copy created by
   * `/api/presence/token` minting an SSO user's tenant uid at project level.
   *
   * This is the marker, not a deletion: `listUsersAcrossPools` still returns
   * every record, and `collapseCrossPoolUidRows` — which is what a display
   * uses — keeps this field on the row it keeps, so a collision is still
   * legible after the rows are merged (AGL-2005).
   */
  uidAlsoInPools?: (string | null)[]
}

/**
 * Does this record show that a human ever authenticated as it? (AGL-2005)
 *
 * An address or a provider entry is the evidence. `signInWithCustomToken`
 * mints an account out of nothing when the uid is absent from the pool the
 * token was minted in, and the record it manufactures has neither: measured
 * on production, the `IHumyGGhGxZKjVV26qCRx5Okf573` project-pool twin had
 * `email: null` and `providerData: []` while the real SSO record carried
 * `zach@aglyn.com` and `saml.aglyn-workspace`.
 *
 * `displayName` and custom claims deliberately do NOT count. Both can be
 * written onto any record after the fact — `updateProfile` and `grantStaff`
 * in the staff console do exactly that — so a shadow that a staff action had
 * already landed on would start qualifying as an identity and go on winning
 * the lookups it should be losing. The bar has to be a signal the forgery
 * cannot acquire by being acted upon.
 */
export function isIdentifiedUserRecord(record: UserRecord): boolean {
  if (!record) return false
  return Boolean(record.email) || (record.providerData?.length ?? 0) > 0
}

/**
 * How strongly a record identifies its human, for choosing between two that
 * share a uid (AGL-2005). Ordering only — the numbers have no other meaning.
 *
 * Email and provider data lead because they are what `isIdentifiedUserRecord`
 * trusts; the rest break ties between records that both qualify.
 */
export function identityStrength(record: UserRecord): number {
  if (!record) return 0
  let score = 0
  if (record.email) score += 8
  if ((record.providerData?.length ?? 0) > 0) score += 4
  if (record.phoneNumber) score += 2
  if (record.displayName) score += 1
  if (Object.keys(record.customClaims ?? {}).length > 0) score += 1
  return score
}

/**
 * Collapse rows sharing a uid to ONE row apiece (AGL-2005).
 *
 * **Zach, 2026-08-18:** "We still have two users list in this list with the
 * same uid but one without an email attached, this needs fixed we should only
 * see one user, even if they are sso."
 *
 * AGL-1962 deliberately refused to merge, on the grounds that collapsing two
 * accounts could hide an identity split. That reasoning still stands for two
 * DISTINCT accounts — which is why this keys on **uid** and never on email.
 * Two people who happen to share an address are two accounts with two uids
 * and stay two rows; merging them on email would delete a real user from the
 * staff console, a worse bug than the one being fixed and an invisible one.
 *
 * A repeated uid is different in kind: a uid is unique WITHIN a pool, so the
 * same uid in two pools is not two people, it is one person plus an artifact
 * of a cross-pool custom-token mint. Those merge.
 *
 * Two rules make the merge safe:
 *
 *  - **The identified record wins.** Ranked by `identityStrength`, so an
 *    emailless, providerless artifact can never be the row staff see — the
 *    exact inversion that let the shadow win every uid lookup.
 *  - **The collision is not discarded.** `markCrossPoolUidCollisions` runs
 *    here rather than being left to the caller, so the surviving row always
 *    carries `uidAlsoInPools` naming the pools that were folded into it. One
 *    row, and it still says it was two.
 *
 * The survivor takes the FIRST occurrence's position so list ordering does
 * not shuffle, and ties keep the earlier row so the result is deterministic.
 */
export function collapseCrossPoolUidRows(
  users: PooledUserRecord[],
): PooledUserRecord[] {
  // Marked here, not by the caller. A caller that forgot would silently turn
  // this into the cover-up the merge is explicitly not allowed to be.
  const marked = markCrossPoolUidCollisions(users)
  const winnerByUid = new Map<string, PooledUserRecord>()
  for (const user of marked) {
    const incumbent = winnerByUid.get(user.record.uid)
    if (
      !incumbent ||
      identityStrength(user.record) > identityStrength(incumbent.record)
    ) {
      winnerByUid.set(user.record.uid, user)
    }
  }
  const emitted = new Set<string>()
  const collapsed: PooledUserRecord[] = []
  for (const user of marked) {
    const uid = user.record.uid
    if (emitted.has(uid)) continue
    emitted.add(uid)
    collapsed.push(winnerByUid.get(uid) ?? user)
  }
  return collapsed
}

/**
 * Flag every uid that appears in more than one pool, in place of hiding it.
 *
 * Pure and total, so a spec can drive it without Firebase. Callers must pass
 * the rows they intend to show together — a collision it cannot see is one
 * it cannot report.
 */
export function markCrossPoolUidCollisions(
  users: PooledUserRecord[],
): PooledUserRecord[] {
  const poolsByUid = new Map<string, (string | null)[]>()
  for (const user of users) {
    const pools = poolsByUid.get(user.record.uid) ?? []
    pools.push(user.tenantId)
    poolsByUid.set(user.record.uid, pools)
  }
  return users.map((user) => {
    const pools = poolsByUid.get(user.record.uid) ?? []
    if (pools.length < 2) return user
    // Everyone holding this uid EXCEPT this row's own pool. Compared by
    // index, not by value: two rows from the same pool would be a Firebase
    // impossibility, but filtering by value would silently drop a real one.
    const others = pools.filter((_, index) => index !== pools.indexOf(user.tenantId))
    return { ...user, uidAlsoInPools: others }
  })
}

/**
 * Every GCIP tenant on the project. Cached briefly: this is asked once per
 * lookup and the set changes only when an enterprise org is onboarded.
 * Fails soft to an empty list — a tenant-listing outage must degrade to
 * today's project-only behaviour rather than break sign-in-adjacent routes.
 */
let tenantCache: { ids: string[]; at: number } | null = null
const TENANT_CACHE_MS = 60_000

export async function listAuthTenantIds(): Promise<string[]> {
  const now = Date.now()
  if (tenantCache && now - tenantCache.at < TENANT_CACHE_MS) {
    return tenantCache.ids
  }
  try {
    const ids: string[] = []
    let pageToken: string | undefined
    do {
      const page = await auth().tenantManager().listTenants(100, pageToken)
      ids.push(...page.tenants.map((tenant) => tenant.tenantId))
      pageToken = page.pageToken
    } while (pageToken)
    tenantCache = { ids, at: now }
    return ids
  } catch (error) {
    console.error('tenant listing failed; falling back to project pool', error)
    return tenantCache?.ids ?? []
  }
}

/** Test seam — drops the tenant cache so a spec can vary the tenant set. */
export function resetAuthTenantCache(): void {
  tenantCache = null
}

/** The `BaseAuth` for a pool: the project pool for null, else the tenant's. */
export function authForPool(tenantId: string | null | undefined): BaseAuth {
  return tenantId
    ? auth().tenantManager().authForTenant(tenantId)
    : auth()
}

/**
 * Find a user by email across the project pool and every GCIP tenant.
 *
 * The project pool is tried first — it holds every non-SSO user, which is
 * almost all of them, so the common case stays a single call. Returns null
 * when no pool has the address, which is the only honest answer for "this
 * person has no Aglyn account".
 */
export async function findUserByEmailAcrossPools(
  email: string,
): Promise<PooledUserRecord | null> {
  const address = email.trim().toLowerCase()
  if (!address) return null
  try {
    return { record: await auth().getUserByEmail(address), tenantId: null }
  } catch {
    // Not in the project pool — fall through to the tenants.
  }
  for (const tenantId of await listAuthTenantIds()) {
    try {
      const record = await authForPool(tenantId).getUserByEmail(address)
      return { record, tenantId }
    } catch {
      // Not in this tenant; keep looking.
    }
  }
  return null
}

/**
 * Find a user by uid across the project pool and every GCIP tenant. Same
 * shape as the email lookup — a uid is only unique WITHIN a pool, so the
 * caller needs to know which pool answered before it mutates anything.
 *
 * **First pool to answer is NOT good enough** (AGL-2005). This used to return
 * the project pool's record the moment it existed, which is how a forged
 * emailless twin won every uid lookup for a real SSO user: `grantStaff`,
 * `disable`, `setRole`, `updateProfile`, `revokeRefreshTokens`, impersonate,
 * usage-email, resolve-people, org-lockdown and erasure all landed on a
 * record nobody can sign in as. Two of those were caught having happened —
 * a `revokeRefreshTokens` dated 2026-08-14 sat on the twin while the real
 * account's `tokensValidAfterTime` never moved, so "sign out everywhere" did
 * nothing at all.
 *
 * So a pool's answer is accepted only when the record it returns actually
 * identifies someone, and the winner is chosen by the SAME rule the staff
 * list collapses rows with. That equivalence is the point: the row staff
 * click is the record the action mutates, by construction rather than by
 * coincidence.
 *
 * The fast path survives intact — a project account with an address or a
 * provider is returned without any tenant call, which is nearly every
 * account. Only a record carrying no identity at all pays for the sweep.
 */
export async function findUserByUidAcrossPools(
  uid: string,
): Promise<PooledUserRecord | null> {
  if (!uid) return null
  const matches: PooledUserRecord[] = []
  try {
    const record = await auth().getUser(uid)
    if (isIdentifiedUserRecord(record)) return { record, tenantId: null }
    // Held, not returned. It is still the answer if nothing better exists —
    // an anonymous or half-created account legitimately looks like this, and
    // refusing it here would break every caller that handles those.
    matches.push({ record, tenantId: null })
  } catch {
    // Not in the project pool.
  }
  for (const tenantId of await listAuthTenantIds()) {
    try {
      const record = await authForPool(tenantId).getUser(uid)
      matches.push({ record, tenantId })
      // Stop at the first pool that knows who this is. Scanning the rest
      // would cost a call per enterprise tenant on a path that runs during
      // sign-in and billing, and a uid identified in two tenant pools is not
      // a shape Firebase can produce — tenant uids are minted per pool.
      if (isIdentifiedUserRecord(record)) break
    } catch {
      // Keep looking.
    }
  }
  if (!matches.length) return null
  return collapseCrossPoolUidRows(matches)[0] ?? null
}

export interface PooledUserPage {
  users: PooledUserRecord[]
  /** Project-pool cursor; null when the project pool is exhausted. */
  nextPageToken: string | null
  /**
   * True once the project pool is exhausted and the tenant users have been
   * appended. Tenant pools are NOT paginated here — enterprise SSO pools are
   * small, and silently dropping their tail would recreate exactly the
   * invisibility this module exists to fix. `tenantTruncated` says when that
   * assumption stopped holding rather than letting it fail quietly.
   */
  tenantsIncluded: boolean
  /** Tenants whose users hit the cap and were cut short. */
  tenantTruncated: string[]
}

/** How many tenant users a single page will carry before reporting a cut. */
const TENANT_USER_CAP = 500

/**
 * One page of users across every pool: the project pool paginates as before,
 * and tenant users are appended on the LAST page so they can never be lost
 * between cursors. Callers render `tenantId` so an SSO account is
 * recognisable — it is not editable the same way a project user is.
 */
export async function listUsersAcrossPools(
  pageSize: number,
  pageToken?: string,
): Promise<PooledUserPage> {
  const page = await auth().listUsers(pageSize, pageToken)
  const users: PooledUserRecord[] = page.users.map((record) => ({
    record,
    tenantId: null,
  }))
  if (page.pageToken) {
    return {
      users,
      nextPageToken: page.pageToken,
      tenantsIncluded: false,
      tenantTruncated: [],
    }
  }
  const tenantTruncated: string[] = []
  for (const tenantId of await listAuthTenantIds()) {
    try {
      const tenantPage = await authForPool(tenantId).listUsers(TENANT_USER_CAP)
      users.push(
        ...tenantPage.users.map((record) => ({ record, tenantId })),
      )
      if (tenantPage.pageToken) tenantTruncated.push(tenantId)
    } catch (error) {
      console.error(`listing users for tenant ${tenantId} failed`, error)
    }
  }
  return {
    // Marked only here, where every pool's rows are in hand (AGL-1962). The
    // earlier return above carries project rows alone, and a uid cannot
    // collide with itself inside one pool, so there is nothing to find there.
    users: markCrossPoolUidCollisions(users),
    nextPageToken: null,
    tenantsIncluded: true,
    tenantTruncated,
  }
}

/** Where a claim mutation landed, so a caller can audit the POOL as well. */
export interface StaffClaimWrite {
  uid: string
  /** The pool the claim was written to; null = the project pool. */
  tenantId: string | null
  email: string | null
  claims: Record<string, unknown>
}

/**
 * Write custom claims to the pool the uid ACTUALLY lives in (AGL-1993).
 *
 * The hazard this exists to remove: `setCustomUserClaims` is per-pool, and a
 * grant aimed at the wrong pool does not error — on the project pool it
 * either throws `user-not-found` (loud, fine) or, when a phantom shadow record
 * shares the uid, silently succeeds against the WRONG record. That is not
 * hypothetical: on 2026-08-18 uid `IHumyGGhGxZKjVV26qCRx5Okf573` existed in
 * both the project pool and `aglyn-org-y5v14`. That phantom won every lookup
 * until AGL-2005 made {@link findUserByUidAcrossPools} rank an IDENTIFIED
 * record above an unidentified one rather than taking the first pool to
 * answer.
 *
 * So resolution and mutation are bound together here rather than left to each
 * caller to pair correctly, and the resolved pool is RETURNED so the audit row
 * can record which pool was written — "granted staff to uid X" is not a
 * complete record when a uid can name two accounts.
 *
 * Never assumes a pool. Staff may live in the project pool, in Aglyn's own
 * tenant, or in a CUSTOMER org's tenant, and hard-coding any of them would
 * silently fail the moment a third exists.
 */
export async function setClaimsInOwningPool(
  uid: string,
  claims: Record<string, unknown>,
): Promise<StaffClaimWrite | null> {
  const found = await findUserByUidAcrossPools(uid)
  if (!found) return null
  await authForPool(found.tenantId).setCustomUserClaims(uid, claims)
  return {
    uid,
    tenantId: found.tenantId,
    email: found.record.email ?? null,
    claims,
  }
}

/**
 * Every uid carrying the `staff` claim, across all pools. Staff is a custom
 * claim, which is not queryable, so this scans — the caller caches it.
 */
export async function listStaffUidsAcrossPools(): Promise<string[]> {
  const uids: string[] = []
  const scan = async (pool: BaseAuth) => {
    let pageToken: string | undefined
    do {
      const page = await pool.listUsers(1000, pageToken)
      for (const record of page.users) {
        if (record.customClaims?.['staff']) uids.push(record.uid)
      }
      pageToken = page.pageToken
    } while (pageToken)
  }
  await scan(auth())
  for (const tenantId of await listAuthTenantIds()) {
    try {
      await scan(authForPool(tenantId))
    } catch (error) {
      console.error(`staff scan for tenant ${tenantId} failed`, error)
    }
  }
  return uids
}
