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
 * The workspace-domain SSO policy (AGL-1993), for the account-creation
 * blocking function.
 *
 * DO NOT EDIT THIS BLOCK HERE. It is a verbatim copy of the region of the
 * same name in `libs/tenant/data/admin/src/lib/server/sso-domain-policy.ts`,
 * which is where it is documented and tested. `cloud/functions` cannot import
 * the library, and `apps/console/specs/sso-domain-creation-wiring.spec.ts`
 * fails if the two blocks differ by a single character.
 */

// #region sso-domain-policy
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

/**
 * Addresses on a governed domain that may still sign in OUTSIDE its tenant.
 *
 * For accounts that cannot use the IdP at all because someone outside the
 * company has to sign in with them: the demo login an app store reviewer is
 * given, for example, or an automated sign-up check that creates a new
 * plus-addressed account on every run. Every exception is named and can be
 * read back from configuration:
 *
 * ```
 * AGLYN_SSO_EXEMPT_EMAILS="reviewer@example.com ops+signup-canary*@example.com"
 * ```
 *
 * An entry is an exact address, or one mailbox's plus tag followed by `*`,
 * which also admits every address that extends that tag on the same domain.
 * The `*` is accepted only as the last character of the local part and only
 * after a `+`, so no entry can exempt a whole mailbox or a whole domain; any
 * other entry with a `*` is dropped.
 *
 * Comma or whitespace separated, compared lower-cased. Empty by default.
 */
export const SSO_EXEMPT_EMAILS_ENV = 'AGLYN_SSO_EXEMPT_EMAILS'

export function parseSsoExemptEmails(
  raw: string | null | undefined,
): ReadonlySet<string> {
  const emails = new Set<string>()
  for (const entry of String(raw ?? '').split(/[,\s]+/)) {
    const email = entry.trim().toLowerCase()
    const at = email.lastIndexOf('@')
    if (at <= 0 || at === email.length - 1) continue
    if (email.slice(at + 1).includes('*')) continue
    const local = email.slice(0, at)
    const star = local.indexOf('*')
    if (star !== -1) {
      const plus = local.indexOf('+')
      // One trailing `*`, after a non-empty plus tag: `name+tag*`.
      if (star !== local.length - 1 || plus <= 0 || plus >= star - 1) continue
    }
    emails.add(email)
  }
  return emails
}

/** Whether an address is named by one of the parsed exemption entries. */
export function isSsoExemptEmail(
  email: string | null | undefined,
  exempt: ReadonlySet<string>,
): boolean {
  const address = String(email ?? '').trim().toLowerCase()
  if (!address) return false
  if (exempt.has(address)) return true
  const at = address.lastIndexOf('@')
  if (at <= 0) return false
  const local = address.slice(0, at)
  const domain = address.slice(at + 1)
  for (const entry of exempt) {
    if (!entry.endsWith(`*@${domain}`)) continue
    if (local.startsWith(entry.slice(0, entry.length - domain.length - 2))) {
      return true
    }
  }
  return false
}

export function ssoExemptEmails(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  return parseSsoExemptEmails(env[SSO_EXEMPT_EMAILS_ENV])
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
   * Governed domain, no tenant, but the address is named in
   * {@link SSO_EXEMPT_EMAILS_ENV}. Allowed and reviewable.
   */
  | 'allow-exempt'
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
  exempt: ReadonlySet<string> = ssoExemptEmails(),
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

  if (isSsoExemptEmail(identity.email, exempt)) {
    return {
      verdict: 'allow-exempt',
      refused: false,
      domain,
      requiredTenantId,
      tenantId: null,
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
 *     inspection): a staff account reaches `/admin/*` via the SAML tenant.
 *  2. Every identity on a governed domain has been migrated into its tenant,
 *     retired, or named in {@link SSO_EXEMPT_EMAILS_ENV}. An automation or
 *     reviewer account is the one that bites without warning: nobody is
 *     watching a sign-in page when it fails.
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

/**
 * Whether an account about to be CREATED must be refused. Same switch, same
 * domains, same exemptions as the session mint, so an address the mint would
 * turn away is never created in the first place, and an address it admits
 * is never refused here.
 */
export function ssoDomainCreationRefused(
  identity: SsoDomainIdentity,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!ssoDomainEnforcementEnabled(env)) return false
  return evaluateSsoDomainPolicy(
    identity,
    ssoRequiredDomains(env),
    ssoExemptEmails(env),
  ).refused
}
// #endregion sso-domain-policy
