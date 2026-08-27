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
 * Several email addresses per account (AGL-2486) — GitHub's model, adopted
 * verbatim because the answer to "how should a secondary address interact
 * with an SSO domain claim?" was "do whatever github does to handle this".
 *
 * ## The one rule everything else here exists to serve
 *
 * **Adding an address to an account NEVER grants organization access.**
 *
 * On GitHub, org membership comes from an invitation or from SAML/SCIM
 * provisioning by the IdP. Verified domains drive notification restrictions
 * and badges; they do not auto-join anybody. SAML SSO links an *external
 * identity* — the assertion the IdP makes at sign-in — to the account. It
 * never matches on the domain of an address the user typed into a settings
 * form.
 *
 * That distinction is load-bearing HERE in a way it is not on GitHub, because
 * Aglyn has `/api/auth/sso-jit`, which just-in-time provisions org membership
 * from a verified email's domain. If a secondary address could satisfy an
 * `ssoDomains` lookup, then adding an address to your own account would JIT
 * you into somebody else's organization — a privilege escalation delivered by
 * a feature that looks like a convenience. So:
 *
 *  - SSO domain routing and JIT provisioning read the identity **the IdP
 *    asserted at sign-in** (`decoded.email`, re-verified against the org's
 *    GCIP tenant). Never this collection.
 *  - Where a domain is consulted outside the SSO flow at all, it is derived
 *    from the **primary** address only — which is the Firebase Auth record's
 *    email, i.e. the same string the token carries.
 *  - A secondary address is a *sign-in identifier* and a *delivery address*.
 *    It is never an authorization input.
 *
 * `apps/console/specs/account-emails-never-reach-sso.spec.ts` is the negative
 * proof, and it is written to FAIL if the guards are removed.
 *
 * ## Why the primary is special, and why it cannot always be moved
 *
 * The primary IS the Firebase Auth record's email. It is what
 * `decoded.email` carries, so it is the input to
 * `evaluateSsoDomainPolicy` at the session mint and to the invite-accept
 * comparison. Re-designating it therefore CHANGES an authorization input —
 * which is why {@link evaluatePrimaryChange} exists and why it refuses to
 * move a primary off an SSO-governed domain. Without that refusal, this
 * feature would hand every governed account a one-click way out of its own
 * organization's sign-in policy. See the verdict docs below.
 *
 * ## This module is PURE
 *
 * No Firebase, no env, no I/O — every fact it decides on is passed in. That
 * is deliberate and copied from `sso-domain-policy.ts`: a spec can drive
 * every combination directly, and the console (which shows the user *why* a
 * control is disabled) and the API route (which enforces it) can never
 * disagree about what the policy says.
 */

/**
 * How many addresses one account may hold, primary included.
 *
 * THE CAP IS NOT DECORATION. `users/{uid}/emails` is a new subcollection, and
 * this repo has a recorded hole from shipping exactly one of those with no
 * ceiling (AGL-2266: content entries, a free org minting unbounded Firestore
 * documents from the browser). The rules deny client writes here outright —
 * see the `emails` match block — so the browser cannot create these at all;
 * this number is the server-side ceiling that stops the API route being the
 * unbounded writer instead. Every add path counts before it writes.
 *
 * Five rather than GitHub's much larger allowance: each address costs a
 * verification email, and the point of the feature is "my work address and my
 * personal one", not address collecting.
 */
export const MAX_ACCOUNT_EMAILS = 5

/** RFC 5321's practical ceiling; also what Firebase Auth accepts. */
export const ACCOUNT_EMAIL_MAX_LENGTH = 254

/**
 * The addresses this feature accepts.
 *
 * Deliberately NARROWER than RFC 5322, for a reason beyond tidiness: a
 * normalized address is used verbatim as a Firestore **document id** (both
 * `users/{uid}/emails/{address}` and `emailIdentityIndex/{address}`), so the
 * pattern has to exclude every string a document id may not be:
 *
 *  - no `/` — the one character a document id genuinely cannot contain;
 *  - no leading/trailing/doubled dot in the local part, so the id can never be
 *    `.` or `..`;
 *  - the required `@` means the id can never match Firestore's reserved
 *    `__.*__` form.
 *
 * A hash would also have worked and would have been unreadable in the
 * console, in an export, and in a support conversation. The uniqueness index
 * is a thing humans have to debug, so it stays legible.
 */
export const ACCOUNT_EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * Trim, lower-case, validate. Returns null for anything this feature will not
 * store — callers treat null as "reject", never as "store the raw input".
 *
 * **Lower-casing the LOCAL part is a deliberate, lossy choice.** RFC 5321 says
 * the local part is the receiving server's business and may be
 * case-sensitive; in practice no mainstream provider treats it that way, and
 * Firebase Auth lower-cases it too. It has to happen here because uniqueness
 * is the whole security property: if `Ada@acme.com` and `ada@acme.com` could
 * both be verified, they would be two index entries for one mailbox and the
 * sign-in identifier would be ambiguous — which is the account-takeover shape
 * this feature has to avoid.
 *
 * What is NOT normalized away, on purpose: plus-addressing and dots in the
 * local part. `a+b@x.com` and `a@x.com` are the same mailbox at Gmail and
 * different mailboxes almost everywhere else, so collapsing them would refuse
 * an address the user legitimately owns at every provider that is not Gmail.
 * Two accounts CAN therefore hold `a@x.com` and `a+b@x.com` separately; that
 * is correct, because delivery is what an address means here.
 */
export function normalizeAccountEmail(input: unknown): string | null {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  if (!raw || raw.length > ACCOUNT_EMAIL_MAX_LENGTH) return null
  if (!ACCOUNT_EMAIL_PATTERN.test(raw)) return null
  return raw
}

/**
 * The domain of an address, lower-cased; null when there isn't one.
 *
 * Same shape and same `lastIndexOf` as `domainOf` in `sso-domain-policy.ts`.
 * It is duplicated rather than imported because that module is server-only
 * (`@aglyn/tenant-data-admin`) and this one is imported by the console's
 * client bundle — an nx boundary the lint enforces.
 *
 * WHERE THIS MAY BE USED: display, and the primary-change policy below.
 * NOT for resolving an org, an IdP, or a membership. Those read the address
 * the IdP asserted, and there is exactly one of those.
 */
export function accountEmailDomain(email: string | null | undefined): string | null {
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 0 || at === address.length - 1) return null
  return address.slice(at + 1)
}

/** One row of `users/{uid}/emails`. */
export interface AccountEmail {
  /** Normalized address; mirrors the document id. */
  address: string
  /**
   * Proven by an emailed round-trip. An UNVERIFIED address does nothing at
   * all: it is not a sign-in identifier, it receives no account mail beyond
   * its own verification, it holds no claim on the address against another
   * account, and it cannot be made primary.
   */
  verified: boolean
  /**
   * Exactly one per account. The primary is the Firebase Auth record's email
   * — receipts, account-critical mail, and every domain-derived decision read
   * it and only it.
   */
  primary: boolean
}

/** Why a primary re-designation was refused. */
export type PrimaryChangeVerdict =
  /** Allowed. */
  | 'ok'
  /** No such address on this account. */
  | 'unknown-address'
  /** The address exists but has not completed its round-trip. */
  | 'unverified'
  /** It is already the primary; a no-op, refused so the UI need not guess. */
  | 'already-primary'
  /**
   * THE SECURITY REFUSAL. The CURRENT primary sits on a domain this
   * deployment requires SSO for, and the requested primary does not.
   *
   * The primary is `decoded.email`. `evaluateSsoDomainPolicy` reads
   * `decoded.email` at the session mint and refuses an account on a governed
   * domain that did not come through the designated tenant. So an account
   * governed by that policy could add a personal address, promote it, and
   * walk straight out of the rule — with no IdP involved and nothing in the
   * org's control plane recording it.
   *
   * Refused rather than merely flagged: the whole point of the policy is that
   * the account cannot choose to be ungoverned.
   */
  | 'sso-governed-escape'
  /**
   * The requested primary sits on a governed domain the account cannot
   * satisfy — promoting it would make the NEXT session mint refuse them.
   *
   * This is self-lockout rather than escalation, so it is refused for the
   * user's sake rather than the platform's: verifying a mailbox proves
   * delivery, it does not put the account inside the org's IdP.
   */
  | 'sso-governed-lockout'

export interface PrimaryChangeFacts {
  /** The account's current primary, or null when it somehow has none. */
  current: AccountEmail | null
  /** The row the caller asked to promote, or null when they named an unknown address. */
  next: AccountEmail | null
  /**
   * `ssoRequiredDomains()` — domain → the GCIP tenant id that domain must
   * sign in through. Empty on a self-host install and on any deployment that
   * has not configured the policy, which makes both refusals inert there.
   */
  requiredDomains: Record<string, string>
  /**
   * The tenant the account actually signed in through; null = project pool.
   * Straight from `decoded.firebase?.tenant`, never inferred.
   */
  tenantId: string | null
  /**
   * Whether the enforcement switch (`AGLYN_SSO_DOMAIN_ENFORCEMENT`) is on.
   *
   * The LOCKOUT refusal is gated on it, because with the switch off promoting
   * a governed address locks nobody out. The ESCAPE refusal is NOT gated on
   * it — see {@link evaluatePrimaryChange}.
   */
  enforcementEnabled: boolean
}

export interface PrimaryChangeDecision {
  allowed: boolean
  verdict: PrimaryChangeVerdict
  /** What the person is told. Null when allowed. */
  message: string | null
}

/** Exact-match lookup, never a suffix test — `notacme.com` ends with `acme.com`. */
function requiredTenantFor(
  domain: string | null,
  domains: Record<string, string>,
): string | null {
  if (domain === null || domain === '') return null
  if (!Object.prototype.hasOwnProperty.call(domains, domain)) return null
  return domains[domain] ?? null
}

/**
 * May this account promote `next` to primary?
 *
 * Pure and total, so the console can grey out the control with the same
 * verdict the API route refuses with.
 *
 * ## Why the ESCAPE refusal ignores the enforcement switch
 *
 * `ssoDomainRefusal` ships inert: it computes `refused` but returns null
 * until `AGLYN_SSO_DOMAIN_ENFORCEMENT=on`, so the audit trail accumulates
 * under the real rule before the rule bites. That is right for a gate that
 * turns people away.
 *
 * It is exactly wrong for this one. A primary change is PERSISTENT: promote a
 * personal address while the switch is off, and when the switch is later
 * flipped the account is simply not on a governed domain any more. The
 * escape would already have happened, silently, and the audit trail the
 * inert period was supposed to build would record nothing — because from the
 * policy's point of view there is no longer anything to record.
 *
 * So the escape is refused whenever the deployment has CONFIGURED governed
 * domains, switch or no switch. A deployment that has configured none — every
 * self-host install, and Aglyn itself until the domains are set — is
 * unaffected, because `requiredDomains` is empty and `requiredTenantFor`
 * returns null for everything.
 */
export function evaluatePrimaryChange(
  facts: PrimaryChangeFacts,
): PrimaryChangeDecision {
  const next = facts.next
  if (next === null || next === undefined) {
    return {
      allowed: false,
      verdict: 'unknown-address',
      message: 'That address is not on this account.',
    }
  }
  if (next.verified !== true) {
    return {
      allowed: false,
      verdict: 'unverified',
      message: 'Confirm this address before making it your primary.',
    }
  }
  if (next.primary === true) {
    return {
      allowed: false,
      verdict: 'already-primary',
      message: 'That address is already your primary.',
    }
  }

  const currentAddress =
    facts.current === null || facts.current === undefined
      ? null
      : facts.current.address
  const currentRequired = requiredTenantFor(
    accountEmailDomain(currentAddress),
    facts.requiredDomains,
  )
  const nextRequired = requiredTenantFor(
    accountEmailDomain(next.address),
    facts.requiredDomains,
  )

  // ESCAPE: leaving a governed domain for one the policy does not reach.
  // Note this compares the REQUIREMENT, not the domain — moving between two
  // domains that are both governed by the same tenant is not an escape.
  if (currentRequired !== null && nextRequired !== currentRequired) {
    return {
      allowed: false,
      verdict: 'sso-governed-escape',
      message:
        'Your organization requires single sign-on for this address, so it ' +
        'has to stay your primary. Ask an administrator to change it for you.',
    }
  }

  // LOCKOUT: moving ONTO a governed domain the account does not sign in
  // through. Verifying a mailbox proves delivery; it does not put you inside
  // the organization's identity provider.
  if (
    facts.enforcementEnabled === true &&
    nextRequired !== null &&
    facts.tenantId !== nextRequired
  ) {
    return {
      allowed: false,
      verdict: 'sso-governed-lockout',
      message:
        'That address is on a domain that signs in through an identity ' +
        'provider. Making it your primary would lock this account out, so ' +
        'sign in through that provider instead.',
    }
  }

  return { allowed: true, verdict: 'ok', message: null }
}

/**
 * Whether an address may be removed.
 *
 * Two floors, both from GitHub: the primary is not removable (demote it
 * first), and the LAST VERIFIED address is not removable — an account with no
 * verified address has no way to receive a password reset, which is an
 * account nobody can recover.
 */
export function canRemoveAccountEmail(
  address: string,
  emails: readonly AccountEmail[],
): { allowed: boolean; message: string | null } {
  const row = emails.find((entry) => entry.address === address)
  if (row === undefined) {
    return { allowed: false, message: 'That address is not on this account.' }
  }
  if (row.primary === true) {
    return {
      allowed: false,
      message:
        'This is your primary address. Make another address primary first.',
    }
  }
  if (row.verified === true) {
    const otherVerified = emails.filter(
      (entry) => entry.verified === true && entry.address !== address,
    )
    if (otherVerified.length === 0) {
      return {
        allowed: false,
        message:
          'This is your only confirmed address — removing it would leave no ' +
          'way to recover this account.',
      }
    }
  }
  return { allowed: true, message: null }
}
