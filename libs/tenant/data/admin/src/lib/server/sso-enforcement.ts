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
 *  4. **Never leave the ORG with no way in** (AGL-1888). Property 1 protects
 *     one account at a time and is blind to the org-level failure: strip every
 *     account down to the SAML link and the pool is perfectly consistent right
 *     up until the IdP stops answering, at which point nobody can sign in and
 *     we cannot let them back in either. `zach@aglyn.com` is in that state
 *     today. So enforcement REFUSES unless the org keeps a way in that does
 *     not depend on the IdP: either a DESIGNATED break-glass account inside
 *     the pool, or an org owner who lives OUTSIDE it
 *     ({@link findBreakGlassOrgOwners}). The second is what makes the first
 *     satisfiable at all — nothing inside a pool we provisioned can hold a
 *     password, so for a while this guard could only ever say no.
 */

import type { UserRecord } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { authForPool } from './auth-pools'
import {
  findBreakGlassOrgOwners,
  type SsoBreakGlassOwner,
} from './sso-break-glass-owners'
import { invalidateTokenRevocationCache } from './token-revocation'
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

/** Why an account with removable providers was left alone. */
export type SsoEnforcementSkip = 'would-orphan' | 'break-glass'

export interface SsoEnforcementAccount {
  uid: string
  email: string | null
  /** Providers removed (or that would be, in a dry run). */
  unlinked: string[]
  /** Providers left in place. */
  kept: string[]
  /** Why an account with removable providers was left alone. */
  skipped?: SsoEnforcementSkip
}

/**
 * Whether this org would still have a way in if its IdP stopped answering
 * (AGL-1888).
 */
export interface SsoLockoutAssessment {
  /**
   * True when the org keeps at least one way in that its IdP does not
   * mediate: a DESIGNATED break-glass account inside the pool, or an org
   * owner outside it.
   */
  safe: boolean
  /** Designated break-glass uids that actually retain a non-IdP credential. */
  retainedBy: string[]
  /**
   * Designated uids that do NOT protect anybody — either absent from the pool,
   * or holding nothing but the IdP link. Named rather than silently ignored:
   * a designation that protects nothing is worse than none, because it reads
   * as protection.
   */
  ineffective: string[]
  /**
   * Org owners in the PROJECT pool (AGL-1888 option (a)). The sweep cannot
   * see these accounts, so an IdP that stops answering cannot lock them out.
   * Named, not counted: the admin has to recognise the person.
   */
  ownersOutsidePool: SsoBreakGlassOwner[]
  /**
   * The owner lookup could not be completed. `ownersOutsidePool` is then
   * INCOMPLETE rather than empty, so the refusal must say we could not check
   * instead of asserting the org has nobody. Never makes an org safe.
   */
  ownerLookupFailed: boolean
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
  /**
   * Whether the org retains a way in that does not depend on its IdP
   * (AGL-1888). Present on the DRY RUN too — that is the point, since the
   * rehearsal is where an org is supposed to discover it needs one.
   */
  lockout: SsoLockoutAssessment
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
        /** Accounts the org designated to keep a non-IdP way in (AGL-1888). */
        breakGlassUids?: unknown
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

  const breakGlassUids = Array.isArray(sso?.breakGlassUids)
    ? (sso.breakGlassUids as unknown[]).map(String).filter(Boolean)
    : []

  const pool = authForPool(tenantId)
  const page = await pool.listUsers(TENANT_USER_CAP)
  const accounts: SsoEnforcementAccount[] = []
  const changedUids: string[] = []
  const breakGlass = new Set(breakGlassUids)

  for (const record of page.users) {
    const summary = planAccount(record, providerId, breakGlass)
    accounts.push(summary)
  }

  // The half the pool cannot supply (AGL-1888 option (a)). Run for the DRY
  // RUN too: the rehearsal is where an org learns whether it may enforce, and
  // a rehearsal that skipped this would report a lockout risk the real run
  // then disagrees with.
  const ownerLookup = await findBreakGlassOrgOwners(orgId, providerId, tenantId)
  const lockout = assessSsoLockoutRisk(
    accounts,
    providerId,
    breakGlassUids,
    ownerLookup.owners,
    ownerLookup.unavailable,
  )

  // THE PRE-FLIGHT (AGL-1888). Planned first, refused before a single
  // `updateUser` — this is the whole reason the plan is computed separately
  // from being carried out. Half a sweep is the worst outcome available: the
  // accounts already stripped are stripped, and the org is locked out with no
  // record of how far it got.
  //
  // The dry run is exempt, and has to be. The rehearsal is exactly how an org
  // FINDS OUT it needs a break-glass account, so refusing to rehearse would
  // leave them guessing at the requirement they are being held to.
  //
  // No override parameter. An `acknowledgeLockoutRisk: true` a caller can pass
  // is not a guard, it is a spelling of the guard being off — and the caller
  // that would pass it is the one already convinced enforcement is fine.
  if (!dryRun && !lockout.safe) {
    throw new SsoEnforcementError(SSO_LOCKOUT_REFUSAL)
  }

  for (const summary of accounts) {
    const record = page.users.find((user) => user.uid === summary.uid)
    if (!record) continue
    if (!summary.unlinked.length || summary.skipped) continue
    if (!dryRun) {
      await pool.updateUser(record.uid, {
        providersToUnlink: summary.unlinked,
      })
      // Only for accounts that actually changed (property 2 above). An
      // existing session outlives the unlink otherwise.
      await pool.revokeRefreshTokens(record.uid)
      // This process refuses the old token NOW (AGL-1881); every other one
      // converges within TOKEN_REVOCATION_TTL_MS.
      invalidateTokenRevocationCache(record.uid, tenantId)
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
    lockout,
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
 *
 * @param breakGlass uids the org has DESIGNATED to keep their other sign-in
 *        methods (AGL-1888). Deliberately a parameter rather than a lookup:
 *        this function is the whole decision and stays pure, so the rehearsal
 *        and the real run cannot diverge on it either.
 */
export function planAccount(
  record: UserRecord,
  providerId: string,
  breakGlass: ReadonlySet<string> = new Set(),
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
  // Property 4 (AGL-1888): a designated break-glass account keeps everything.
  //
  // This IS a standing bypass of SSO enforcement, and it is meant to be —
  // that is what makes it a way back in when the IdP stops answering. The
  // alternative is the state `zach@aglyn.com` is in today: every account in
  // the pool holds nothing but a SAML link, and a lapsed certificate or a
  // deleted SAML app locks the organization out of itself permanently.
  //
  // Checked AFTER the orphan rule so the two cannot disagree about an account
  // that is both, and it changes nothing for a break-glass account that has
  // no removable provider anyway — `skipped` marks a decision, so it is set
  // only where there was something to decide.
  if (unlinked.length && breakGlass.has(record.uid)) {
    return { ...summary, unlinked: [], kept: providers, skipped: 'break-glass' }
  }
  return summary
}

/**
 * Would this org still have a way in after the sweep? (AGL-1888)
 *
 * Pure, and over the PLANNED accounts rather than the raw records, so it
 * answers the question about the state enforcement is actually about to
 * create rather than the one it is in now.
 *
 * ONLY A DESIGNATED ACCOUNT COUNTS. An account that happens to retain a
 * password because it is misconfigured — the `would-orphan` case, which has no
 * IdP link at all — is not break-glass: nobody chose it, it may be a stale
 * record or a service account, and an org protected by an accident it does not
 * know about is not protected. Requiring the designation is what makes this a
 * control rather than a coincidence.
 *
 * A designation only counts when the account actually holds something OTHER
 * than the org's IdP. Naming an account whose sole credential is the SAML link
 * is the most natural way to get this wrong — it looks like a break-glass
 * account and provides nothing, because it fails in exactly the situation it
 * exists for.
 *
 * THE SECOND WAY IN IS NOT IN THE POOL AT ALL (AGL-1888 option (a)). An org
 * owner holding a project-level credential is invisible to the sweep — the
 * enforcement pass lists `authForPool(tenantId)` and never touches the
 * project pool — so a lapsed certificate cannot reach them. No designation is
 * required for those: nobody has to be told to keep the key they already
 * hold, and requiring a tick would put the requirement back out of reach for
 * exactly the org that already satisfies it. Whether such an owner exists is
 * decided by {@link findBreakGlassOrgOwners}, which is where the seven
 * conditions live; this function only counts what it is handed, so that the
 * rehearsal and the real run cannot disagree.
 *
 * `ownerLookupFailed` deliberately does NOT make an org safe. It exists so a
 * refusal can distinguish "you have nobody" from "we could not check" — an
 * error swallowed into an empty list renders as a measured zero, and nothing
 * about it looks wrong.
 */
export function assessSsoLockoutRisk(
  accounts: readonly SsoEnforcementAccount[],
  providerId: string,
  breakGlass: readonly string[],
  ownersOutsidePool: readonly SsoBreakGlassOwner[] = [],
  ownerLookupFailed = false,
): SsoLockoutAssessment {
  const designated = [...new Set(breakGlass.filter(Boolean))]
  const byUid = new Map(accounts.map((account) => [account.uid, account]))
  const retainedBy: string[] = []
  const ineffective: string[] = []
  for (const uid of designated) {
    const account = byUid.get(uid)
    const protects = Boolean(
      account?.kept.some((id) => id !== providerId),
    )
    if (protects) retainedBy.push(uid)
    else ineffective.push(uid)
  }
  const owners = [...ownersOutsidePool]
  return {
    safe: retainedBy.length > 0 || owners.length > 0,
    retainedBy,
    ineffective,
    ownersOutsidePool: owners,
    ownerLookupFailed,
  }
}

/**
 * The refusal an org sees when enforcing would lock it out of itself.
 *
 * Says what to do, because a refusal that only says no sends someone to turn
 * the guard off. Deliberately free of a product name — this string is read by
 * self-host operators too.
 */
export const SSO_LOCKOUT_REFUSAL =
  'Enforcing single sign-on would remove every sign-in method that does not ' +
  'go through your identity provider, and this organization would be left ' +
  'with no way in that survives your identity provider failing. If its ' +
  'certificate lapses or its application is removed, nobody would be able ' +
  'to sign in and we could not let you back in either. Give the ' +
  'organization one of two things first: an owner who signs in outside your ' +
  'identity pool, or a designated break-glass account inside it that keeps ' +
  'a password.'

export default enforceSsoSignInMethods
