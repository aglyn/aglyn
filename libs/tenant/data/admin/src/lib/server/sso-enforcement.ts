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
 * SSO enforcement sweep (AGL-1129): when an org turns on `sso.enforced`,
 * every account in its GCIP tenant loses any sign-in method that is not the
 * org's own IdP.
 *
 * AGL-1128 stopped SSO-governed accounts from linking NEW consumer providers.
 * This is the grandfathering half: an account that linked Google before
 * enforcement keeps a way in that the customer's IdP cannot see or revoke, and
 * a bypass that predates the switch is still a bypass.
 *
 * Runs against the TENANT pool via `authForPool` — project-level Admin SDK
 * calls cannot see, let alone mutate, these accounts (AGL-1122).
 *
 * Three properties this must have, in order of how badly they bite:
 *
 *  1. **Never unlink down to zero.** An account whose only provider is the one
 *     we are about to remove would be orphaned — reachable by nobody, not even
 *     the IdP. Skipped and reported, never assumed away: being in the tenant
 *     does not prove the SAML link is present.
 *  2. **Revoke refresh tokens for accounts it actually changed.** Unlinking
 *     does not end a live session, so without this the bypass simply has a
 *     clock on it. Only for accounts that changed — a sweep that revoked
 *     everyone would sign out the org's whole staff on a no-op run.
 *  3. **Idempotent.** Re-running is the natural way to catch accounts created
 *     between the flag flip and the sweep, so a second run must be a no-op
 *     rather than a second round of revocations.
 */

import type { UserRecord } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { authForPool } from './auth-pools'
import firebaseAdmin from './firebase-admin'
import { notifyUsers } from './notifications'

const firestore = () => firebaseAdmin.app().firestore()

/** How many tenant accounts one sweep will walk. Enterprise pools are small. */
const TENANT_USER_CAP = 1000

export interface SsoEnforcementOptions {
  /** Staff uid recorded on the audit rows; `system` for an automated run. */
  actorUid?: string
  /** Report what would change without touching anything. */
  dryRun?: boolean
  /**
   * Run even when `sso.enforced` is false. ONLY for a rehearsal against a
   * throwaway account — the flag is the customer's instruction, and acting
   * without it removes sign-in methods nobody asked us to remove.
   */
  force?: boolean
}

export interface SsoEnforcementAccount {
  uid: string
  email: string | null
  /** Providers removed (or that would be, in a dry run). */
  unlinked: string[]
  /** Providers left in place. */
  kept: string[]
  /** Why an account with removable providers was left alone. */
  skipped?: 'would-orphan'
}

export interface SsoEnforcementResult {
  orgId: string
  tenantId: string
  providerId: string
  dryRun: boolean
  /** Accounts walked. */
  scanned: number
  /** Accounts whose providers changed (0 on a converged re-run). */
  changed: number
  accounts: SsoEnforcementAccount[]
  /** True when the tenant holds more accounts than one sweep walks. */
  truncated: boolean
}

export class SsoEnforcementError extends Error {}

/**
 * Strip non-IdP sign-in methods from every account in an org's SSO tenant.
 *
 * Throws when the org has no active SSO config, or when `sso.enforced` is
 * false without `force` — enforcement is the customer's switch, and running
 * this without it would be us deciding to remove their people's sign-in
 * methods on our own.
 */
export async function enforceSsoSignInMethods(
  orgId: string,
  options: SsoEnforcementOptions = {},
): Promise<SsoEnforcementResult> {
  const { actorUid = 'system', dryRun = false, force = false } = options
  const db = firestore()
  const orgSnapshot = await db.collection('orgs').doc(orgId).get()
  if (!orgSnapshot.exists) {
    throw new SsoEnforcementError(`No such organization: ${orgId}`)
  }
  const sso = orgSnapshot.get('sso') as
    | {
        tenantId?: string
        providerId?: string
        enforced?: boolean
        status?: string
      }
    | undefined
  const tenantId = sso?.tenantId
  const providerId = sso?.providerId
  if (!tenantId || !providerId) {
    throw new SsoEnforcementError(`${orgId} has no SSO tenant configured`)
  }
  if (sso?.status !== 'active') {
    throw new SsoEnforcementError(
      `${orgId} SSO status is "${sso?.status ?? 'unset'}", not active`,
    )
  }
  if (!sso?.enforced && !force) {
    throw new SsoEnforcementError(
      `${orgId} has sso.enforced = false — nothing to enforce`,
    )
  }

  const pool = authForPool(tenantId)
  const page = await pool.listUsers(TENANT_USER_CAP)
  const accounts: SsoEnforcementAccount[] = []
  const changedUids: string[] = []

  for (const record of page.users) {
    const summary = planAccount(record, providerId)
    accounts.push(summary)
    if (!summary.unlinked.length || summary.skipped) continue
    if (!dryRun) {
      await pool.updateUser(record.uid, {
        providersToUnlink: summary.unlinked,
      })
      // Only for accounts that actually changed (property 2 above). An
      // existing session outlives the unlink otherwise.
      await pool.revokeRefreshTokens(record.uid)
      await db.collection('adminAudit').add({
        actorUid,
        action: 'org.sso.enforceSignInMethods',
        target: `users/${record.uid}`,
        before: { providers: providerIdsOf(record) },
        after: {
          providers: summary.kept,
          orgId,
          tenantId,
          unlinked: summary.unlinked,
          tokensRevoked: true,
        },
        at: FieldValue.serverTimestamp(),
      })
    }
    changedUids.push(record.uid)
  }

  if (!dryRun && changedUids.length) {
    // Explaining it beats a mysteriously missing button on their next visit.
    await notifyUsers(changedUids, {
      type: 'system.signInMethodRemoved',
      title: 'Your sign-in methods changed',
      body:
        'Your organization now requires single sign-on, so other sign-in ' +
        'methods have been removed from your account. Sign in through your ' +
        'organization instead.',
      orgId,
      link: '/manage/user',
    })
  }

  return {
    orgId,
    tenantId,
    providerId,
    dryRun,
    scanned: page.users.length,
    changed: changedUids.length,
    accounts,
    truncated: Boolean(page.pageToken),
  }
}

const providerIdsOf = (record: UserRecord): string[] =>
  (record.providerData ?? [])
    .map((info) => info?.providerId)
    .filter((id): id is string => Boolean(id))

/**
 * What one account loses, decided without mutating anything so the dry run
 * and the real run cannot disagree.
 *
 * `password` counts as a provider to strip: an email/password credential on a
 * governed account is exactly the sort of standing bypass enforcement is
 * bought to remove, and it is not the org's IdP.
 */
export function planAccount(
  record: UserRecord,
  providerId: string,
): SsoEnforcementAccount {
  const providers = providerIdsOf(record)
  const unlinked = providers.filter((id) => id !== providerId)
  const kept = providers.filter((id) => id === providerId)
  const summary: SsoEnforcementAccount = {
    uid: record.uid,
    email: record.email ?? null,
    unlinked,
    kept,
  }
  // Property 1: an account with nothing but removable providers keeps them.
  // It is misconfigured, not a bypass to close, and orphaning it would turn a
  // security tightening into a lockout with no way back.
  if (unlinked.length && !kept.length) {
    return { ...summary, unlinked: [], kept: providers, skipped: 'would-orphan' }
  }
  return summary
}

export default enforceSsoSignInMethods
