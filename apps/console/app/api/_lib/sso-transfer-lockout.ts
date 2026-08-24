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
 * Ownership transfer must not undo the SSO break-glass pre-flight (AGL-1888).
 *
 * ## The hole this closes
 *
 * `enforce-apply` refuses unless the org keeps a way in that its IdP does not
 * mediate. For every pool we provision that way is an **org owner outside the
 * pool** — nothing inside a pool we created can hold a password, so the
 * in-pool designation is available only to hand-made legacy pools.
 *
 * An org has exactly **one** owner. `transferOrgOwnership` moves the role and
 * demotes the previous holder to admin (AGL-232); there is no path anywhere in
 * the product that creates a second owner, which was confirmed rather than
 * assumed — `/api/orgs/members` and `/api/orgs/invites` both refuse
 * `role === 'owner'` outright, and the members card offers only admin, editor
 * and viewer.
 *
 * So for the ordinary enforced org, the entire break-glass guarantee rests on
 * one account, and one self-serve click can move it onto an account inside the
 * pool. The pre-flight has already passed. The sweep has already run. Nothing
 * re-checks, and the org is returned to the exact state AGL-1888 exists to
 * prevent — silently, with the console still reporting enforcement as healthy.
 * That is the AGL-1375 one-way door rebuilt out of a different part.
 *
 * ## Why the check lives here and not in `transferOrgOwnership`
 *
 * It belongs one layer down, where it could not be skipped. It cannot go
 * there: `organizations.ts` is imported by `notifications.ts`, which
 * `sso-enforcement.ts` imports, so the library reaching back for the engine is
 * a cycle. Rather than duplicate the assessment to break the cycle — a second
 * copy of a security control is worse than none, because the copies diverge
 * and the weaker one is the one that decides — the check sits at the single
 * production call site and `sso-transfer-lockout-wiring.spec.ts` pins that
 * there is still exactly one and that it still calls this first.
 *
 * ## Nothing here re-implements the decision
 *
 * Two calls, both into the shipped engine:
 *
 *  - {@link enforceSsoSignInMethods} as a DRY RUN, for `lockout.retainedBy` —
 *    the in-pool designations that genuinely retain a non-IdP credential. That
 *    protection belongs to the designation list, not to the owner seat, so a
 *    transfer cannot take it away and an org holding one is not refused.
 *  - {@link qualifiesAsBreakGlassOwner} for the person about to become the
 *    only owner. The same seven conditions the pre-flight applies, asked of
 *    the post-transfer state instead of the current one.
 *
 * ## Failing closed
 *
 * Every path that cannot establish safety refuses. An org whose `enforced`
 * flag is set but whose SSO config is missing, an engine that throws, a
 * lookup that reports an outage — all refuse, because the cost of a wrong
 * "allowed" is a paying customer permanently locked out of their own console
 * and the cost of a wrong "refused" is a support conversation. This is the
 * CSRF discipline, not the rate-limiting one.
 *
 * It is not a dead end. An owner who genuinely means to hand the organization
 * to an account inside the pool can stop enforcing first, transfer, and
 * enforce again — at which point the pre-flight runs properly and tells them
 * what they are giving up. The refusal says so.
 */

import {
  enforceSsoSignInMethods,
  qualifiesAsBreakGlassOwner,
} from '@aglyn/tenant-data-admin'

/** Shown to the org when the transfer would strand them. */
export const SSO_TRANSFER_LOCKOUT_REFUSAL =
  'Transferring ownership would leave this organization with no way in if ' +
  'your identity provider stopped answering — the new owner signs in through ' +
  'that provider, and enforcement has removed every other sign-in method from ' +
  'your pool. Choose an owner who signs in outside it, or stop enforcing ' +
  'single sign-on first.'

/** Shown when we could not establish that the transfer is safe. */
export const SSO_TRANSFER_LOCKOUT_UNKNOWN =
  'We could not check whether this transfer would leave your organization ' +
  'without a way in, so it was not made. Nothing changed. Try again, or stop ' +
  'enforcing single sign-on first.'

export interface SsoTransferLockoutVerdict {
  /** True when the transfer must not proceed. */
  refused: boolean
  /**
   * Why, for the response body and the activity log. Null when allowed.
   */
  reason: string | null
  /**
   * Distinguishes "we checked, and this would strand you" from "we could not
   * check". Both refuse; only the first is a statement about the org.
   */
  verdict: 'allowed' | 'would-strand' | 'could-not-check'
}

const ALLOWED: SsoTransferLockoutVerdict = {
  refused: false,
  reason: null,
  verdict: 'allowed',
}
const WOULD_STRAND: SsoTransferLockoutVerdict = {
  refused: true,
  reason: SSO_TRANSFER_LOCKOUT_REFUSAL,
  verdict: 'would-strand',
}
const COULD_NOT_CHECK: SsoTransferLockoutVerdict = {
  refused: true,
  reason: SSO_TRANSFER_LOCKOUT_UNKNOWN,
  verdict: 'could-not-check',
}

/**
 * Whether handing this org to `toUid` would leave it with no way in.
 *
 * @param orgId - the organization changing hands
 * @param toUid - the account that will be its ONLY owner afterwards
 * @param org - the org document's data, already read by the caller. An absent
 *   document yields `allowed` here and fails in `transferOrgOwnership`'s own
 *   transaction instead; this function's job is the lockout question, and
 *   inventing a second "unknown org" refusal would just report it twice.
 */
export async function assessOwnershipTransferLockout(
  orgId: string,
  toUid: string,
  org: Record<string, unknown> | undefined,
): Promise<SsoTransferLockoutVerdict> {
  const sso = org?.['sso'] as
    | { tenantId?: string; providerId?: string; enforced?: boolean }
    | undefined

  // ONLY an enforced org can be stranded by a transfer. Before enforcement
  // the accounts in the pool still hold whatever they came with, and
  // enforcement's own pre-flight runs before any of it is stripped — so
  // refusing here would be blocking a transfer that endangers nobody.
  //
  // `enforced !== true` rather than `!enforced`: with `strictNullChecks` off
  // an absent field is indistinguishable from `false` by truthiness, and the
  // explicit comparison says which one this branch means. Both answers are
  // the same here, and that is the point — an org with no `sso` field at all
  // is the overwhelmingly common case and must not pay for this check.
  if (sso?.enforced !== true) return ALLOWED

  const tenantId = sso.tenantId
  const providerId = sso.providerId
  if (!tenantId || !providerId) {
    // Enforcement is on and we cannot tell which pool or provider it means.
    // Not a state the product can reach through its own routes; refusing is
    // the only answer that does not guess about a lockout.
    console.error(
      `[sso] ${orgId} has sso.enforced without a tenant or provider id`,
    )
    return COULD_NOT_CHECK
  }

  let retainedInPool: string[]
  try {
    // A dry run. Every write in the engine is behind `if (!dryRun)`, and this
    // is the same call `enforce-apply` makes as its own pre-flight. `force`
    // because the flag's state is not what is being asked about.
    const rehearsal = await enforceSsoSignInMethods(orgId, {
      dryRun: true,
      force: true,
    })
    retainedInPool = rehearsal.lockout.retainedBy
  } catch (error) {
    console.error(`[sso] transfer lockout rehearsal failed for ${orgId}`, error)
    return COULD_NOT_CHECK
  }

  // A designated in-pool break-glass account that really retains a non-IdP
  // credential protects the org regardless of who owns it. The designation
  // list is org state, not owner state, so this transfer cannot remove it.
  if (retainedInPool.length) return ALLOWED

  // Otherwise the org's only way in is an owner outside the pool — and after
  // this transfer there is exactly one owner.
  const candidate = await qualifiesAsBreakGlassOwner(
    toUid,
    providerId,
    tenantId,
  )
  if (candidate.unavailable) return COULD_NOT_CHECK
  return candidate.owner ? ALLOWED : WOULD_STRAND
}

export default assessOwnershipTransferLockout
