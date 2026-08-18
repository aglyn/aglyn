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
 * Workspace-domain SSO policy (AGL-1993).
 *
 * **The rule is about a DOMAIN, not about staff.** An `@aglyn.com` address is a
 * Google Workspace identity, and Workspace is what enforces MFA, disables an
 * account at offboarding, and lets an admin revoke a session. An `@aglyn.com`
 * address that signs in through a project-pool password or a consumer Google
 * account has none of that: it looks like a company identity and is governed
 * like a personal one. That gap is the whole reason this module exists.
 *
 * ## Staff is a SEPARATE axis and this module never reads it
 *
 * Staff may be granted to anybody — SSO or not, `@aglyn.com` or not, project
 * pool or any GCIP tenant including a *customer's*. Nothing here consults the
 * `staff` claim, and `sso-domain-policy.spec.ts` pins that by evaluating every
 * staff permutation and asserting the verdict does not move. The two axes are
 * independent; conflating them would turn a narrow domain control into an
 * accidental SSO mandate for staff, which is explicitly not the policy.
 *
 * These all remain valid, and each has a test:
 *
 * | identity                                   | staff | verdict                   |
 * | ------------------------------------------ | ----- | ------------------------- |
 * | `@aglyn.com` in the designated tenant       | yes   | allowed                   |
 * | personal address, project pool (break-glass)| yes   | allowed — permanent design|
 * | personal address, project pool              | no    | allowed                   |
 * | SSO identity in a CUSTOMER org's tenant     | yes   | allowed                   |
 * | `@aglyn.com` in the PROJECT pool            | any   | **refused** when enforced |
 *
 * Only the last row is what the switch exists for.
 *
 * ## How this differs from `sso-enforcement.ts`
 *
 * {@link enforceSsoSignInMethods} (AGL-1128/1129) strips non-IdP providers from
 * accounts that are ALREADY INSIDE a tenant. It cannot see an identity that
 * never joined the tenant at all — a project-pool `@aglyn.com` account is
 * invisible to every tenant sweep, by construction. Measured on aglyn-main on
 * 2026-08-18: two such accounts existed, one of them holding a live
 * `google.com` provider. This module covers that outside-the-tenant half.
 *
 * ## Shape note: deliberately NOT a discriminated union
 *
 * `strictNullChecks` is off repo-wide, which defeats boolean-discriminant
 * narrowing — a spec can read the wrong arm of a union and pass silently. So
 * the decision is ONE flat interface with a string `verdict`, and specs assert
 * the literal. There is no arm to read by mistake.
 */

/**
 * ## Self-hosting: this policy is CONFIGURATION, never a compiled-in constant
 *
 * Aglyn ships in two shapes — the Aglyn-operated SaaS, and self-hosted installs
 * on the operator's own Firebase project. `aglyn.com` is *our* Workspace
 * domain; a self-hoster has their own domain, their own IdP, or none at all.
 * Baking our domain in would make the rule dead weight for them at best and a
 * lockout at worst, so the governed set is read from configuration and is
 * **empty by default**.
 *
 * Empty means the rule does nothing. That is simultaneously the correct
 * behaviour for a fresh self-host install and the correct OFF state for us —
 * one default serving both, rather than a special case for either.
 *
 * Format — `domain=tenantId`, comma or whitespace separated:
 *
 * ```
 * AGLYN_SSO_REQUIRED_DOMAINS="aglyn.com=aglyn-org-y5v14"
 * ```
 *
 * A map rather than a bare list because "must use SSO" is meaningless without
 * naming WHOSE SSO: the point is IdP lifecycle control, which only the tenant
 * wired to that domain's SAML provider delivers.
 */
export const SSO_REQUIRED_DOMAINS_ENV = 'AGLYN_SSO_REQUIRED_DOMAINS'

export type SsoRequiredDomains = Readonly<Record<string, string>>

/**
 * Parse the configured domain→tenant map. Total: anything unparseable is
 * dropped rather than throwing, because this sits on the authentication path
 * and a malformed env var must not take sign-in down. A dropped entry fails
 * OPEN (the domain is simply ungoverned), which is the safe direction for a
 * rule whose only power is to refuse.
 */
export function parseSsoRequiredDomains(
  raw: string | null | undefined,
): SsoRequiredDomains {
  const map: Record<string, string> = {}
  for (const pair of String(raw ?? '').split(/[,\s]+/)) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const domain = pair.slice(0, eq).trim().toLowerCase()
    const tenantId = pair.slice(eq + 1).trim()
    if (!domain || !tenantId) continue
    map[domain] = tenantId
  }
  return map
}

/**
 * The operator's SSO-required domains. Empty unless configured — see above.
 */
export function ssoRequiredDomains(
  env: Record<string, string | undefined> = process.env,
): SsoRequiredDomains {
  return parseSsoRequiredDomains(env[SSO_REQUIRED_DOMAINS_ENV])
}

export type SsoDomainVerdict =
  /** Domain is not governed. Any pool is fine — this is most of the world. */
  | 'allow-ungoverned'
  /** Governed domain, signed in through the tenant we designated for it. */
  | 'allow-designated-tenant'
  /**
   * Governed domain, signed in through SOME tenant, but not the designated
   * one. Allowed — they did use SSO, and refusing would invent a restriction
   * nobody asked for — but surfaced so a staff-access review can see it.
   */
  | 'allow-foreign-tenant'
  /**
   * Governed domain with NO tenant at all: a project-pool password or consumer
   * Google sign-in. The only refusal this policy ever produces.
   */
  | 'refuse-sso-required'

export interface SsoDomainDecision {
  verdict: SsoDomainVerdict
  /**
   * Whether enforcement WOULD refuse this identity. Independent of whether
   * enforcement is currently switched on — {@link ssoDomainEnforcementEnabled}
   * decides that — so the same evaluation can drive both an audit in
   * report-only mode and the refusal once the switch is flipped.
   */
  refused: boolean
  /** Lower-cased domain, or null when the identity has no email address. */
  domain: string | null
  /** Tenant this domain is required to use, or null when ungoverned. */
  requiredTenantId: string | null
  /** Tenant the identity actually signed in through; null = project pool. */
  tenantId: string | null
  /** Worth a human look even though it is allowed (foreign-tenant case). */
  reviewable: boolean
}

export interface SsoDomainIdentity {
  /** The identity's email address. Absent/empty is treated as ungoverned. */
  email?: string | null
  /**
   * GCIP tenant the identity signed in through — `decoded.firebase?.tenant`,
   * or a `PooledUserRecord.tenantId`. Null/undefined means the project pool.
   *
   * Never inferred and never defaulted to a hard-coded tenant: a uid is only
   * unique WITHIN a pool, and assuming one is how a lookup silently lands on
   * the wrong record.
   */
  tenantId?: string | null
}

/** The domain part of an address, lower-cased. Null when there isn't one. */
export function domainOf(email: string | null | undefined): string | null {
  const address = String(email ?? '').trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 0 || at === address.length - 1) return null
  return address.slice(at + 1)
}

/**
 * Decide the policy for one identity. Pure and total — no Firebase, no env —
 * so a spec can drive every combination directly, and so the audit view and
 * the enforcement path can never disagree about what the policy says.
 */
export function evaluateSsoDomainPolicy(
  identity: SsoDomainIdentity,
  domains: SsoRequiredDomains = ssoRequiredDomains(),
): SsoDomainDecision {
  const domain = domainOf(identity.email)
  const tenantId = identity.tenantId ?? null
  // Exact-match lookup, never a suffix test: `notaglyn.com` ends with
  // `aglyn.com`, and a suffix test would refuse an unrelated company's staff.
  const requiredTenantId = domain
    ? (Object.prototype.hasOwnProperty.call(domains, domain)
        ? domains[domain]
        : null)
    : null

  if (!requiredTenantId) {
    // Ungoverned: a personal address, a customer's address, anything not on
    // the list. Includes the permanent break-glass account by construction
    // rather than by special case — see the staff-access doc.
    return {
      verdict: 'allow-ungoverned',
      refused: false,
      domain,
      requiredTenantId: null,
      tenantId,
      reviewable: false,
    }
  }

  if (tenantId === requiredTenantId) {
    return {
      verdict: 'allow-designated-tenant',
      refused: false,
      domain,
      requiredTenantId,
      tenantId,
      reviewable: false,
    }
  }

  if (tenantId) {
    // A governed address inside somebody else's tenant. They authenticated
    // through an IdP, so the hole this policy closes is not open here — but
    // the IdP is not one Aglyn controls, so it is flagged for review.
    return {
      verdict: 'allow-foreign-tenant',
      refused: false,
      domain,
      requiredTenantId,
      tenantId,
      reviewable: true,
    }
  }

  return {
    verdict: 'refuse-sso-required',
    refused: true,
    domain,
    requiredTenantId,
    tenantId: null,
    reviewable: true,
  }
}

/**
 * THE ENFORCEMENT SWITCH — ships OFF.
 *
 * Off means `evaluateSsoDomainPolicy` still computes `refused`, and callers
 * still record it, but nobody is turned away. That is deliberate: the audit
 * trail accumulates under the real rule before the rule bites, so flipping the
 * switch holds no surprises.
 *
 * Opt-in by exact string. Anything else — unset, empty, `false`, `0`, a typo —
 * is OFF. A security control that switches itself on through a misspelling is
 * a control that can lock people out through a misspelling.
 *
 * Note both halves must be set for anything to happen: this switch AND a
 * non-empty {@link SSO_REQUIRED_DOMAINS_ENV}. A self-host install that sets
 * only this switch still governs nothing.
 *
 * **Precondition for flipping it — written down so it is not re-litigated:**
 *  1. SSO staff access verified working through a REAL sign-in (not a token
 *     inspection): `zach@aglyn.com` reaches `/admin/*` via the SAML tenant.
 *  2. Every identity on a governed domain has been migrated into its tenant or
 *     retired. Measured on aglyn-main 2026-08-18: TWO would have been refused,
 *     neither of them staff — `zachary.gover@aglyn.com` (consumer `google.com`
 *     provider) and `zach+e2e-smoke@aglyn.com` (`password`, an AUTOMATION
 *     account). Flipping before migrating breaks the e2e smoke sign-in.
 *
 * A second staff identity is NOT a precondition: the permanent break-glass
 * account is on an ungoverned domain, so this rule can never refuse it.
 */
export const SSO_DOMAIN_ENFORCEMENT_ENV = 'AGLYN_SSO_DOMAIN_ENFORCEMENT'

export function ssoDomainEnforcementEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[SSO_DOMAIN_ENFORCEMENT_ENV] === 'on'
}

/** What the refused person is told. Names the fix, not the mechanism. */
export const SSO_DOMAIN_REFUSAL_MESSAGE =
  'Sign in with your Aglyn Workspace account (Single sign-on). ' +
  'Accounts on this domain cannot use a password or personal Google sign-in.'

/**
 * The refusal a caller should return, or null to carry on.
 *
 * Returns null whenever the switch is off, so wiring this into an
 * authentication path is inert until Zach flips it — the call site is live,
 * the consequence is not.
 */
export function ssoDomainRefusal(
  identity: SsoDomainIdentity,
  env: Record<string, string | undefined> = process.env,
): { decision: SsoDomainDecision; response: Response } | null {
  const decision = evaluateSsoDomainPolicy(identity, ssoRequiredDomains(env))
  if (!decision.refused) return null
  if (!ssoDomainEnforcementEnabled(env)) return null
  return {
    decision,
    response: Response.json(
      {
        error: SSO_DOMAIN_REFUSAL_MESSAGE,
        reason: 'sso-domain-required',
        domain: decision.domain,
      },
      { status: 403 },
    ),
  }
}

export default evaluateSsoDomainPolicy
