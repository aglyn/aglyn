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
 * Break-glass by way of an org owner who lives OUTSIDE the SSO pool
 * (AGL-1888, option (a) — decided).
 *
 * ## Why this exists
 *
 * `assessSsoLockoutRisk` only ever looked inside the org's GCIP tenant, and
 * nothing inside that tenant can hold a credential the IdP does not mediate:
 * `provisionSsoPool` creates the pool with `emailSignInConfig.enabled: false`,
 * `/api/orgs/members/password` refuses outright on `tenantId`, and a social
 * login cannot be linked to a governed account at all. So the pre-flight was
 * unsatisfiable and enforcement was unreachable for every org.
 *
 * The way out is the account the pre-flight was always described as wanting:
 * *"at least one org owner holding a project-level credential"*. A
 * project-pool account is not in the tenant, so the enforcement sweep cannot
 * see it, let alone strip it — the same invisibility that made SSO users
 * disappear from the staff console (AGL-1122) is what makes this work.
 *
 * ## The property being checked
 *
 * **Could this person still sign in if the org's IdP stopped answering?** A
 * lapsed certificate, a deleted SAML application, a revoked provider config.
 * Every condition below exists because failing it means the answer is no —
 * or means we cannot establish that the answer is yes, which for a control
 * whose failure mode is "a paying customer loses its console permanently" is
 * the same thing.
 *
 *  1. **Role `owner`, not `admin`.** The narrow reading of the decision, and
 *     the strict one. An org whose only owner is an SSO account can promote a
 *     project-level member to owner — a self-serve action — so requiring the
 *     stronger role does not put anybody back in front of a support queue.
 *  2. **Present in the PROJECT pool**, resolved there directly rather than
 *     through {@link findUserByUidAcrossPools}: the question is not "where
 *     does this uid live", it is "does a project-pool record exist", and a
 *     cross-pool resolver answering with the tenant record would silently
 *     turn a pooled account into a qualifying one.
 *  3. **Not the emailless twin.** A cross-pool `signInWithCustomToken`
 *     manufactures a project-pool record with no address and no providers
 *     (AGL-1962/2005) — a record nobody can sign in as, and exactly the shape
 *     a bare existence check accepts. There is no separate test for it here:
 *     conditions (5) and (6) are each strictly stronger than
 *     {@link isIdentifiedUserRecord}, so calling that as well would be a
 *     guard no mutation can make fail — a control that reads as a check and
 *     is not one. The twin is rejected, and the spec names which condition
 *     does it.
 *  4. **NOT also in the org's tenant pool.** A uid in both pools is that same
 *     collision seen from the other side, and it makes the identity ambiguous
 *     at the moment it matters most. Refused rather than guessed.
 *  5. **Not disabled**, and **email verified**. The console refuses an
 *     unverified session before it reaches any org setting
 *     (`emailUnverifiedResponse`), so an unverified owner cannot turn
 *     enforcement back off — which is the entire job of a break-glass
 *     account. A credential that cannot be used is not a credential.
 *  6. **Holds a provider that is not the org's IdP.** Same rule the in-pool
 *     assessment uses, applied to the project-pool record.
 *  7. **Not on a domain the operator REQUIRES SSO for**
 *     ({@link evaluateSsoDomainPolicy}). This is the subtle one. A
 *     project-pool `@aglyn.com` password is a perfectly good credential right
 *     up until `AGLYN_SSO_DOMAIN_ENFORCEMENT` is switched on, at which point
 *     that identity is refused at sign-in and the break-glass account
 *     silently stops being one. `refused` is computed independently of the
 *     switch by design, so this reads the rule rather than today's setting.
 *
 * Note what is deliberately NOT required: that the credential be a password.
 * A project-pool `google.com` link survives a lapsed SAML certificate just as
 * a password does — the org's IdP does not mediate it. The residual is that a
 * customer whose IdP and mailbox are the same vendor (Workspace SAML plus
 * Workspace Google sign-in) has a correlated failure if the whole vendor
 * account is deleted rather than the SAML app; that is a narrower failure
 * than the one this control exists for, and the docs say so.
 *
 * ## Failing safe
 *
 * Every error path yields **no owners**, which makes the assessment unsafe
 * and enforcement refuse. `unavailable` is carried alongside so the refusal
 * can say "we could not check" instead of "you have nobody" — a swallowed
 * query that renders as a measured zero is worse than an error, because
 * nothing looks wrong.
 */

import { authForPool } from './auth-pools'
import { evaluateSsoDomainPolicy } from './sso-domain-policy'
import firebaseAdmin from './firebase-admin'

/**
 * ## One predicate, two callers
 *
 * The seven conditions live in {@link qualifiesAsBreakGlassOwner}, asked of
 * ONE uid, because two places need the same answer about different people:
 *
 *  - {@link findBreakGlassOrgOwners} asks it of every owner on the roster,
 *    which is what the enforcement pre-flight consumes;
 *  - the ownership-transfer guard asks it of the person about to BECOME the
 *    only owner, before the transfer happens (AGL-1888).
 *
 * The second caller exists because an org has exactly one owner at a time —
 * `transferOrgOwnership` moves the role rather than adding a second holder —
 * so a transfer can move the whole of an org's break-glass protection onto an
 * account inside the pool, after the pre-flight has already passed, with the
 * sweep long since finished. The pre-flight is a gate at one moment; this is
 * the same question asked again at the only other moment the answer can
 * change. Written as one function rather than two so the transfer guard
 * cannot drift into a second, laxer definition of who counts.
 */

/** An org owner who would still be able to sign in without the org's IdP. */
export interface SsoBreakGlassOwner {
  uid: string
  email: string | null
  /** Project-pool sign-in methods, none of them the org's IdP. */
  providers: string[]
}

export interface SsoBreakGlassOwnerLookup {
  owners: SsoBreakGlassOwner[]
  /**
   * True when a lookup failed for a reason that is not "no such user" — an
   * Auth or Firestore outage. The owner list is then INCOMPLETE, not empty,
   * and the caller must not report "this org has nobody" on the strength of
   * it.
   */
  unavailable: boolean
}

/** Owners walked in one lookup. An org with more has other problems. */
const OWNER_SCAN_CAP = 25

/** Firebase's "this pool does not have that uid" — a real negative. */
const NOT_FOUND = 'auth/user-not-found'

const codeOf = (error: unknown): string =>
  String((error as { code?: unknown })?.code ?? '')

/** Whether ONE account would still be a way in without the org's IdP. */
export interface SsoBreakGlassVerdict {
  /** The qualifying owner, or null when this account does not count. */
  owner: SsoBreakGlassOwner | null
  /**
   * A lookup failed for a reason that is not "no such user". `owner` is then
   * null because we could not establish that it should be anything else —
   * never because we established the account does not qualify. A caller must
   * refuse on this, not treat it as a clean negative.
   */
  unavailable: boolean
}

const DOES_NOT_QUALIFY: SsoBreakGlassVerdict = {
  owner: null,
  unavailable: false,
}
const COULD_NOT_CHECK: SsoBreakGlassVerdict = { owner: null, unavailable: true }

/**
 * The seven conditions, asked of one uid.
 *
 * Callers must distinguish the two answers that both carry a null owner. A
 * null owner with `unavailable` false means "we checked, and no"; a null owner
 * with `unavailable` true means "we could not check". Collapsing them is how a
 * swallowed query starts rendering as a measured zero.
 *
 * @param uid - the account being judged. NOT checked for org membership here;
 *   both callers establish that first, by different routes (a roster query,
 *   and `transferOrgOwnership`'s own "must already be a member" transaction).
 * @param providerId - the org's SAML provider id, so a project-pool record
 *   holding only that provider cannot qualify
 * @param tenantId - the org's GCIP pool, checked for the collision in (4)
 */
export async function qualifiesAsBreakGlassOwner(
  uid: string,
  providerId: string,
  tenantId: string,
): Promise<SsoBreakGlassVerdict> {
  let record
  try {
    // Written inline rather than through a hoisted `projectPool` const so
    // the AGL-1122 guard can SEE that the receiver is pool-scoped: it
    // matches on the receiver text, and a variable named `projectPool` is
    // indistinguishable to it from a bare `auth().getUser`. A guard that
    // cannot read a legitimate call is one somebody widens, so the call
    // site moves instead of the guard.
    record = await authForPool(null).getUser(uid)
  } catch (error) {
    // Not in the project pool is the ORDINARY answer here — it means this
    // owner signs in through the IdP like everyone else. Anything else is
    // an outage, and an outage must not read as a clean negative.
    if (codeOf(error) !== NOT_FOUND) {
      console.error(`[sso] project-pool lookup failed for ${uid}`, error)
      return COULD_NOT_CHECK
    }
    return DOES_NOT_QUALIFY
  }
  // (5) Both halves. A disabled account is not a way in, and an unverified
  // address cannot reach an org setting to undo enforcement.
  //
  // These two also subsume (3): the emailless cross-pool artifact has no
  // address, so it never gets past the line below. That is why there is no
  // `isIdentifiedUserRecord` call here — it could never be the condition
  // that rejects anything, and a guard no mutation can break is not a
  // guard.
  if (record.disabled) return DOES_NOT_QUALIFY
  if (!record.email || !record.emailVerified) return DOES_NOT_QUALIFY
  // (6) The same rule the in-pool assessment applies. Also the second half
  // of (3): a record with no providers at all cannot qualify.
  const providers = (record.providerData ?? [])
    .map((info) => info?.providerId)
    .filter((id): id is string => Boolean(id) && id !== providerId)
  if (!providers.length) return DOES_NOT_QUALIFY
  // (7) A domain the operator requires SSO for. Read from the RULE, not
  // from whether the switch happens to be on today.
  if (evaluateSsoDomainPolicy({ email: record.email, tenantId: null }).refused) {
    return DOES_NOT_QUALIFY
  }
  // (4) Last, because it costs a call: the same uid in the org's own pool.
  try {
    await authForPool(tenantId).getUser(uid)
    // It answered — this uid names an account in the pool as well, so the
    // sweep will touch it and "which record is this owner" has no answer.
    return DOES_NOT_QUALIFY
  } catch (error) {
    if (codeOf(error) !== NOT_FOUND) {
      console.error(`[sso] tenant-pool lookup failed for ${uid}`, error)
      return COULD_NOT_CHECK
    }
  }
  return {
    owner: { uid, email: record.email ?? null, providers },
    unavailable: false,
  }
}

/**
 * Org owners who hold a credential the org's IdP does not mediate.
 *
 * @param orgId - the organization being enforced
 * @param providerId - the org's SAML provider id, so a project-pool record
 *   holding only that provider cannot qualify
 * @param tenantId - the org's GCIP pool, checked for the collision in (4)
 */
export async function findBreakGlassOrgOwners(
  orgId: string,
  providerId: string,
  tenantId: string,
): Promise<SsoBreakGlassOwnerLookup> {
  let ownerUids: string[]
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .where('role', '==', 'owner')
      .get()
    ownerUids = snapshot.docs.slice(0, OWNER_SCAN_CAP).map((doc) => doc.id)
  } catch (error) {
    console.error(`[sso] owner roster read failed for ${orgId}`, error)
    return { owners: [], unavailable: true }
  }

  const owners: SsoBreakGlassOwner[] = []
  let unavailable = false

  for (const uid of ownerUids) {
    const verdict = await qualifiesAsBreakGlassOwner(uid, providerId, tenantId)
    // Accumulated rather than returned early: one unreachable owner must not
    // hide the qualifying one standing next to them, and it must not be
    // forgotten either. An org is safe if ANY owner qualifies, and the caller
    // still gets told the picture is incomplete.
    if (verdict.unavailable) unavailable = true
    if (verdict.owner) owners.push(verdict.owner)
  }

  return { owners, unavailable }
}

export default findBreakGlassOrgOwners
