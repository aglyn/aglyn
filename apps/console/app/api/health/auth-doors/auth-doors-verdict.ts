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
 * The door verdicts, pure (AGL-2586).
 *
 * Every health check the platform had measured a COMPONENT — is Firestore
 * reachable, are the crons beating, is the rate limiter storing. Not one
 * asserted that a person can complete a journey, and for three days from
 * launch day nobody could sign up while every component read green.
 *
 * These are the verdicts for the doors that are not email-and-password:
 * password recovery, the verification link, Google, SSO and passkeys. The
 * verdicts are PURE and take their facts as arguments, so every red branch is
 * driven by a spec rather than by waiting for the outage — the constraint the
 * issue puts first, because a green that cannot go red is what let signup die
 * unnoticed.
 *
 * ## Two rules the codes obey
 *
 * **A code is an enum, never a message.** The endpoint that reports these is
 * public and unauthenticated. An Identity Platform error message can carry a
 * project id, a service-account address or a config path, and the raw config
 * these probes read carries an OAuth client secret and the password-hash
 * signer key. Nothing here accepts free text: every input is already reduced
 * to a boolean, a count or a member of a closed set by the caller.
 *
 * **"Cannot tell" is not "fine".** A probe that could not reach the thing it
 * watches reports degraded, the same rule the signup counter follows. The one
 * exception is a door that genuinely does not exist on this install — an
 * install with no SSO pools has no SSO to break — and that arm says so in its
 * code rather than being silently green.
 */

import type { HealthCheck } from '@aglyn/aglyn/server'

/**
 * Which door a check speaks for. The body groups by this, so a reader sees
 * "google is shut" rather than "check 3 failed".
 */
export type AuthDoor =
  | 'password-reset'
  | 'email-verification'
  | 'google-oauth'
  | 'sso'
  | 'passkey'

export interface AuthDoorCheck extends HealthCheck {
  door: AuthDoor
  /**
   * What green MEANS for this door, in one clause.
   *
   * Carried in the response on purpose. The failure this whole issue is about
   * was a green nobody could interrogate: a reader who cannot tell what a
   * check asserts cannot tell what its silence is worth, and will assume it
   * covers more than it does. Every string here is a fixed literal — never
   * assembled from anything a request or a provider supplied.
   */
  asserts: string
}

/**
 * How the third-party side of a door answered.
 *
 * `answered` separates "the provider replied and the reply was a refusal"
 * from "nothing replied". They need opposite responses: the first is our
 * configuration, the second is their availability or our network.
 */
export interface ProviderAnswer {
  answered: boolean
  /**
   * The reply's meaning, already classified by the caller into a closed set.
   * Never a provider message.
   */
  verdict:
    | 'accepted'
    | 'provider-not-configured'
    | 'origin-not-authorized'
    | 'api-key-rejected'
    | 'appcheck-rejected'
    | 'refused'
}

/**
 * Classify an Identity Toolkit REST failure into {@link ProviderAnswer}'s
 * closed set.
 *
 * The mapping is the whole point of the function: these are the four ways the
 * OAuth door actually breaks, and each one reads identically from the
 * outside — a sign-in button that does nothing.
 *
 *  - `OPERATION_NOT_ALLOWED` — the provider is disabled, or its client id was
 *    removed from Identity Platform. The AGL-2586 failure mode named as
 *    "a wrong or expired client id".
 *  - `INVALID_CONTINUE_URI` / `UNAUTHORIZED_DOMAIN` — the console's own
 *    origin is no longer on the authorized-domain list. The other named
 *    failure mode, and the one four separate issues found by hand
 *    (AGL-1135, AGL-1344, AGL-1486, AGL-1940).
 *  - App Check — the precondition the browser handshake also has to satisfy.
 *  - an invalid API key — the public key the client bundle ships was rotated
 *    or restricted.
 *
 * `message` is read only to CHOOSE a member of the set; it is never returned,
 * and the default is the anonymous `refused` rather than anything derived
 * from it.
 */
export function classifyIdentityToolkitFailure(
  status: number,
  message: string,
): ProviderAnswer['verdict'] {
  const text = String(message ?? '').toUpperCase()
  if (text.includes('APP CHECK') || text.includes('APPCHECK')) {
    return 'appcheck-rejected'
  }
  if (text.includes('API KEY') || text.includes('API_KEY')) {
    return 'api-key-rejected'
  }
  if (text.includes('OPERATION_NOT_ALLOWED')) return 'provider-not-configured'
  if (
    text.includes('INVALID_CONTINUE_URI') ||
    text.includes('UNAUTHORIZED_DOMAIN') ||
    text.includes('INVALID_DOMAIN')
  ) {
    return 'origin-not-authorized'
  }
  // A 401/403 with nothing recognisable in it is still an authentication
  // refusal rather than a provider outage, and saying so beats `refused`.
  if (status === 401 || status === 403) return 'api-key-rejected'
  return 'refused'
}

/**
 * Did a one-time-code redemption endpoint answer, and did it answer CORRECTLY?
 *
 * The probe presents a code that is deliberately not a code. A well-formed
 * refusal (`INVALID_OOB_CODE`) is the SUCCESS: it proves the redemption
 * endpoint is live, the public API key is accepted and the App Check
 * precondition is satisfied, without a real account and without burning a
 * real code. Anything else — silence, a different error, or an acceptance —
 * means the half of the journey that happens AFTER the email arrives is not
 * known to work, which is the half nothing has ever asserted.
 */
export interface RedemptionAnswer {
  answered: boolean
  /** True only for the expected `INVALID_OOB_CODE` refusal. */
  rejectedTheInvalidCode: boolean
  /** Set when `answered` and the refusal was not the expected one. */
  verdict?: ProviderAnswer['verdict']
}

function redemptionFault(
  redemption: RedemptionAnswer,
): string | undefined {
  if (!redemption.answered) return 'redeem-unreachable'
  if (!redemption.rejectedTheInvalidCode) {
    return `redeem-${redemption.verdict ?? 'unexpected'}`
  }
  return undefined
}

/**
 * Forgot password → reset link (AGL-2586).
 *
 * Three facts, and each is a separate way the door shuts while every
 * component stays green:
 *
 *  - **the origin resolves.** `resolveAuthActionOrigin` decides the host a
 *    reset link is built on, from server config rather than from the request.
 *    If it stops yielding an allowlisted console origin, every emailed link
 *    points somewhere that cannot redeem — the link is dead and the send
 *    still reports success, because the send DID succeed.
 *  - **email is configured.** The route already fails soft on this by
 *    design: it logs and answers 200, because telling a stranger whether an
 *    address has an account is an enumeration oracle. That correctness
 *    choice is exactly why nothing external can see the outage, so this is
 *    the only place it becomes visible.
 *  - **the code can be redeemed.** Minting is not the journey; clicking is.
 *
 * NOT asserted, deliberately: that a real reset mail leaves the building.
 * `generatePasswordResetLink` refuses to distinguish a missing account from a
 * present one — measured on the live project, an address that does not exist
 * comes back `auth/internal-error` rather than `auth/user-not-found`, which
 * is Firebase's email-enumeration protection working as intended. So there is
 * no negative case to probe with, and a positive one would need a standing
 * synthetic account. That account does not exist and is not created here: a
 * probe identity is a decision about production, not a side effect of adding
 * a check, and `docs/UPTIME_AND_SLA.md` records what it would take.
 */
export function passwordResetDoorHealth(
  facts: {
    originAllowlisted: boolean
    emailConfigured: boolean
    redemption: RedemptionAnswer
  },
  ms: number,
): AuthDoorCheck {
  const base = {
    door: 'password-reset' as const,
    ms,
    asserts:
      'the reset link is built on an allowlisted console origin, email is ' +
      'configured, and the redemption endpoint refuses an invalid code',
  }
  if (!facts.originAllowlisted) {
    return { ...base, ok: false, code: 'origin-not-resolvable' }
  }
  if (!facts.emailConfigured) {
    return { ...base, ok: false, code: 'email-not-configured' }
  }
  const fault = redemptionFault(facts.redemption)
  if (fault) return { ...base, ok: false, code: fault }
  return { ...base, ok: true }
}

/**
 * Email verification link actually verifies (AGL-2586).
 *
 * The link is minted today and nothing asserts that following it works. Three
 * facts close that, none of which needs an account:
 *
 *  - **the mint path answers.** Asking for a verification link for an address
 *    that deliberately does not exist must come back `auth/user-not-found`.
 *    A well-formed refusal is a SUCCESSFUL probe — the same trick the root
 *    health check plays on Firestore by reading a document meant to be
 *    missing. It proves the credential, the network, the project and the
 *    Identity Toolkit API without minting a redeemable code for anybody.
 *  - **the rewrite is sound.** AGL-1112 takes Firebase's link apart and
 *    rebuilds it on our own handler page, so a drift in that rewriting
 *    produces a mail whose button goes nowhere. Checked on a synthetic code.
 *  - **redemption is live.** The half after the click.
 *
 * `mintVerdict` is the caller's classification of the mint outcome, already
 * reduced: `expected-refusal` is the green, `unexpected-success` means the
 * probe address somehow resolved to an account (a probe that stopped being a
 * probe), and the rest are faults.
 */
export function emailVerificationDoorHealth(
  facts: {
    mintVerdict:
      | 'expected-refusal'
      | 'unexpected-success'
      | 'unreachable'
      | 'other-error'
    linkOnConsoleOrigin: boolean
    linkCarriesCode: boolean
    redemption: RedemptionAnswer
  },
  ms: number,
): AuthDoorCheck {
  const base = {
    door: 'email-verification' as const,
    ms,
    asserts:
      'the link mint path answers, the minted link is rebuilt on a console ' +
      'handler URL carrying the code, and redemption refuses an invalid code',
  }
  if (facts.mintVerdict === 'unreachable') {
    return { ...base, ok: false, code: 'mint-unreachable' }
  }
  if (facts.mintVerdict === 'other-error') {
    return { ...base, ok: false, code: 'mint-error' }
  }
  if (facts.mintVerdict === 'unexpected-success') {
    // The probe address is meant to be unclaimable. If it resolved, the probe
    // just minted a live code for somebody — report it rather than pass.
    return { ...base, ok: false, code: 'probe-address-exists' }
  }
  if (!facts.linkOnConsoleOrigin) {
    return { ...base, ok: false, code: 'link-off-console-origin' }
  }
  if (!facts.linkCarriesCode) {
    return { ...base, ok: false, code: 'link-carries-no-code' }
  }
  const fault = redemptionFault(facts.redemption)
  if (fault) return { ...base, ok: false, code: fault }
  return { ...base, ok: true }
}

/**
 * Google OAuth reachability (AGL-2586, constraint 5).
 *
 * We cannot log into Google in a probe, and pretending to would be a check
 * that fails for reasons unrelated to what it watches — the shape the uptime
 * workflow's own header warns about. What CAN be asserted is the step the
 * browser takes FIRST: ask Identity Platform to build the Google
 * authorization URL for our console origin.
 *
 * That single call is answered by the same configuration the real handshake
 * depends on, so it goes red on precisely the two failures the issue names:
 * a provider whose client id is wrong, expired or removed
 * (`provider-not-configured`), and a console origin dropped from the
 * authorized-domain list (`origin-not-authorized`). It creates nothing,
 * signs nobody in, and touches no account.
 *
 * `carriesClientId` is the last clause and it is not decoration: Identity
 * Platform answers 200 with an authorization URL, and a URL with no
 * `client_id` on it is a button that lands on a Google error page. The
 * VALUE is never read out of it — only its presence.
 */
export function googleOauthDoorHealth(
  facts: {
    answer: ProviderAnswer
    authUriOnGoogle: boolean
    carriesClientId: boolean
  },
  ms: number,
): AuthDoorCheck {
  const base = {
    door: 'google-oauth' as const,
    ms,
    asserts:
      'Identity Platform builds a Google authorization URL for the console ' +
      'origin, carrying a client id — config reachability, not a login',
  }
  if (!facts.answer.answered) {
    return { ...base, ok: false, code: 'provider-unreachable' }
  }
  if (facts.answer.verdict !== 'accepted') {
    return { ...base, ok: false, code: facts.answer.verdict }
  }
  if (!facts.authUriOnGoogle) {
    return { ...base, ok: false, code: 'auth-uri-not-google' }
  }
  if (!facts.carriesClientId) {
    return { ...base, ok: false, code: 'auth-uri-has-no-client-id' }
  }
  return { ...base, ok: true }
}

/**
 * SSO (SAML/OIDC) reachability (AGL-2586, constraint 5).
 *
 * SSO does not sign anyone into the project pool. Each org gets its OWN GCIP
 * tenant with its own user pool (AGL-1122), so the machinery every SSO
 * sign-in needs before it can even begin is the tenant manager: if listing
 * pools stops working — the API disabled, the credential's role changed,
 * GCIP turned off — every enterprise customer is locked out at once and no
 * component check moves.
 *
 * Then, on a bounded sample of those pools, at least one ENABLED SAML or OIDC
 * provider must still exist. A pool whose provider config was deleted or
 * disabled is a door with no handle, and that is a per-tenant edit made in a
 * console UI with no deploy step behind it — the same shape as the
 * authorized-domain drift.
 *
 * `poolCount` of zero is OK and says so. An install with no SSO customers has
 * no SSO to break, and reporting an outage for a feature nobody bought is the
 * false alarm that teaches people to ignore the board.
 *
 * NOT asserted: that any particular org's identity provider will accept an
 * assertion. That needs the customer's IdP, which is theirs and not ours to
 * probe. COUNTS ONLY leave this function — never a tenant id, an org name or
 * a provider id, all of which identify a customer.
 */
export function ssoDoorHealth(
  facts: {
    /** Null when the tenant manager could not be reached at all. */
    poolCount: number | null
    sampledPools: number
    poolsWithEnabledProvider: number
  },
  ms: number,
): AuthDoorCheck {
  const base = {
    door: 'sso' as const,
    ms,
    asserts:
      'the per-org GCIP tenant pools list, and a bounded sample of them ' +
      'still carries an enabled SAML or OIDC provider',
  }
  if (facts.poolCount === null) {
    return { ...base, ok: false, code: 'pools-unavailable' }
  }
  if (facts.poolCount === 0) {
    return { ...base, ok: true, code: 'no-sso-pools' }
  }
  if (facts.sampledPools > 0 && facts.poolsWithEnabledProvider === 0) {
    return { ...base, ok: false, code: 'no-enabled-provider' }
  }
  return { ...base, ok: true }
}

/**
 * Passkey reachability (AGL-2586, constraint 5).
 *
 * A passkey ceremony cannot be completed by a probe — the second step needs
 * an authenticator holding a private key, which is the entire point of the
 * mechanism. The step before it can, and it is where the door actually
 * breaks: the relying-party context.
 *
 * `resolveRpContext` refuses any origin that is not the workspace domain or a
 * subdomain of it, and the RP id it returns is baked into every stored
 * credential. Get `NEXT_PUBLIC_WORKSPACE_DOMAIN` wrong on a deployment and
 * the console's own origin stops resolving — every registration and every
 * sign-in 400s with `bad-origin`, and nothing else in the platform notices.
 * Issuing a real discoverable-credential challenge for the canonical console
 * origin exercises exactly that, plus the WebAuthn library, and stores
 * nothing.
 */
export function passkeyDoorHealth(
  facts: { rpContextResolved: boolean; challengeIssued: boolean },
  ms: number,
): AuthDoorCheck {
  const base = {
    door: 'passkey' as const,
    ms,
    asserts:
      'the console origin resolves to a relying-party context and a ' +
      'discoverable-credential challenge can be issued for it',
  }
  if (!facts.rpContextResolved) {
    return { ...base, ok: false, code: 'rp-origin-rejected' }
  }
  if (!facts.challengeIssued) {
    return { ...base, ok: false, code: 'challenge-unavailable' }
  }
  return { ...base, ok: true }
}

/**
 * The address every mint probe asks about.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered, so this
 * address cannot come to exist, cannot be claimed by anyone, and cannot
 * receive mail. That is what makes the refusal it provokes a stable green
 * rather than a race with whoever signs up next.
 */
export const AUTH_DOOR_PROBE_ADDRESS =
  'console-health-probe-does-not-exist@probe.invalid'

/**
 * The code every redemption probe presents.
 *
 * Deliberately not code-shaped. Firebase one-time codes are opaque, so
 * nothing here depends on their format — only on the endpoint refusing this
 * one.
 */
export const AUTH_DOOR_PROBE_OOB_CODE =
  'aglyn-health-probe-not-a-real-oob-code'
