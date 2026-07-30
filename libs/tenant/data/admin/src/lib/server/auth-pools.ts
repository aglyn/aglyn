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
 */
export async function findUserByUidAcrossPools(
  uid: string,
): Promise<PooledUserRecord | null> {
  if (!uid) return null
  try {
    return { record: await auth().getUser(uid), tenantId: null }
  } catch {
    // Not in the project pool.
  }
  for (const tenantId of await listAuthTenantIds()) {
    try {
      return { record: await authForPool(tenantId).getUser(uid), tenantId }
    } catch {
      // Keep looking.
    }
  }
  return null
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
    users,
    nextPageToken: null,
    tenantsIncluded: true,
    tenantTruncated,
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
