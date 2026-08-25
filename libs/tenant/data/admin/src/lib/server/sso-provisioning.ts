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
 * Self-serve enterprise SSO provisioning (AGL-1210).
 *
 * Before this, `tenantManager()` appeared six times in the repo and every one
 * was `authForTenant(...)` — authenticating against a pool somebody had made by
 * hand in the Firebase console. There was no `createTenant` and no
 * `createProviderConfig` anywhere, so onboarding an SSO org meant a person
 * clicking through GCIP and then writing `tenantId`/`providerId` onto the org
 * doc. This module is the write half that removes that step.
 *
 * ## Domain verification is the security gate, not a formality
 *
 * `ssoDomains/{domain}` routes every sign-in for a domain to whichever org
 * claims it. Letting an org self-assert that claim would be an
 * account-takeover vector: claim `competitor.com`, and their employees' sign-in
 * attempts arrive at your IdP. `domainVerified` used to be staff-attested,
 * which is exactly the human step self-serve removes — so the attestation has
 * to be replaced by proof, not deleted.
 *
 * The proof is a DNS TXT record at `_aglyn-challenge.<domain>` carrying a token
 * we generated for THAT org and THAT domain. Only someone who controls the
 * domain's zone can publish it, and a token issued to one org is worthless to
 * another. Nothing reaches `sso.domains` — the array sign-in actually consults
 * — until a lookup has seen the record.
 *
 * DNS resolution mirrors `/api/domains/verify` (AGL-734): pinned public
 * resolvers rather than the runtime's default, because a stale zone once made
 * Vercel's own resolver return NXDOMAIN for records every public resolver could
 * see. The fallback is deliberately narrow — a genuine "no such record" answer
 * must stay a failure, and only an unreachable resolver falls through.
 */

import { promises as dns, Resolver as CallbackResolver } from 'dns'
import { randomBytes } from 'crypto'
import type { BaseAuth } from 'firebase-admin/auth'
import firebaseAdmin from './firebase-admin'
import type { DomainProbe } from './sso-drift-logic'

const auth = () => firebaseAdmin.app().auth()
const firestore = () => firebaseAdmin.app().firestore()

/** Subdomain the challenge record is published at. */
export const SSO_CHALLENGE_PREFIX = '_aglyn-challenge'

/** Prefix on the TXT value, so an unrelated record cannot pass by accident. */
export const SSO_TXT_PREFIX = 'aglyn-domain-verification='

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/

/** Same pinned resolvers as the custom-domain check — see the header note. */
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8']

/**
 * Domains nobody may claim for SSO, however well they prove ownership.
 *
 * A consumer mailbox provider is shared by millions of unrelated people, so
 * "proves control of the zone" and "is entitled to govern every account on it"
 * come apart completely. Verifying `gmail.com` is possible for exactly one
 * party, and routing every Gmail user's sign-in to their IdP is not a thing
 * that party should be able to do either.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'fastmail.com',
  'hey.com',
  'qq.com',
  '163.com',
  '126.com',
])

export function normalizeSsoDomain(input: string): string {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  const at = raw.lastIndexOf('@')
  return (at >= 0 ? raw.slice(at + 1) : raw).replace(/^@+/, '').replace(/\.$/, '')
}

/**
 * `{ value, error }` rather than a discriminated union on purpose: an
 * `{ ok: true } | { ok: false }` union does not narrow reliably once it crosses
 * a library boundary in this repo (`strictNullChecks` is off), and the caller
 * ends up unable to reach either arm's fields. Both keys always present, one of
 * them always null.
 */
export interface DomainCheck {
  domain: string | null
  error: string | null
}

export function validateSsoDomain(input: string): DomainCheck {
  const domain = normalizeSsoDomain(input)
  if (!domain || !DOMAIN_PATTERN.test(domain)) {
    return { domain: null, error: 'Enter a valid domain, for example acme.com' }
  }
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return {
      domain: null,
      error:
        'Public email domains cannot be used for SSO — they are shared by ' +
        'people outside your organization. Use a domain your organization owns.',
    }
  }
  return { domain, error: null }
}

/**
 * TXT records at the challenge host, lowercased and unwrapped.
 *
 * A TXT answer arrives as an array of string CHUNKS per record (DNS splits
 * strings over 255 bytes), so each record is joined before comparison —
 * otherwise a long token would never match.
 */
export async function resolveChallengeTxt(domain: string): Promise<string[]> {
  const host = `${SSO_CHALLENGE_PREFIX}.${domain}`
  const flatten = (records: string[][]) =>
    records.map((chunks) => chunks.join('').trim())
  try {
    const resolver = new CallbackResolver()
    resolver.setServers(PUBLIC_RESOLVERS)
    const records = await new Promise<string[][]>((resolve, reject) => {
      resolver.resolveTxt(host, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      )
    })
    return flatten(records)
  } catch (error) {
    // ENOTFOUND/ENODATA are real answers — the name has no TXT record. Only an
    // unreachable resolver falls through, so a genuine miss stays a failure.
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      return []
    }
    try {
      return flatten(await dns.resolveTxt(host))
    } catch {
      return []
    }
  }
}

/** The exact TXT value an org must publish for a domain. */
export function challengeValue(token: string): string {
  return `${SSO_TXT_PREFIX}${token}`
}

/**
 * Does this set of TXT records prove control of the zone for THIS token?
 *
 * Extracted so the comparison that domain verification rests on is reachable
 * from a test without standing up Firestore. It is deliberately an exact match
 * on a whole record: a substring test would accept
 * `aglyn-domain-verification=<token>-and-more`, and a prefix test would accept
 * any record that merely starts the same way. Neither proves anything.
 */
export function recordsProveOwnership(
  records: readonly string[],
  token: string,
): boolean {
  if (!token) return false
  return records.includes(challengeValue(token))
}

/*==========================================
 * PERIODIC RE-VERIFICATION (AGL-1210, the residual the 2026-08-23 audit named).
 *
 * A domain is proven ONCE, when an admin presses Verify, and then routes that
 * domain's sign-ins forever. A company that lets its domain lapse — or sells
 * it — keeps the routing until a human revokes it. The audit called that
 * "the account-takeover shape in slow motion", and it is the last residual on
 * an otherwise strong proof.
 *
 * ## Why this REPORTS and never revokes
 *
 * The obvious fix — re-run the lookup, drop the domain when it fails — is a
 * worse bug than the one it closes. `resolveChallengeTxt` cannot tell "the
 * record is gone" from "the resolver did not answer", because BOTH return an
 * empty array. So a resolver blip during the sweep looks exactly like every
 * customer simultaneously deleting their TXT record, and an automated revoke
 * would log out every enterprise on the platform at once. That is the
 * `reverify-plugin-versions` argument — a lint that can stop a plugin in every
 * workspace is a kill switch with no human in it — and the lockdown argument,
 * where an unreachable Firestore is an outage rather than a verdict.
 *
 * So this half adds two things and deliberately nothing else:
 *
 *   1. {@link probeChallengeTxt} — a THIRD state. `unreachable` is not
 *      evidence, and is never counted as a failure.
 *   2. {@link assessDomainDrift} — consecutive CONCLUSIVE failures over a
 *      minimum wall-clock age before a domain is even reported as drifted.
 *
 * Revocation stays exactly where it was: {@link revokeDomain}, an explicit act
 * by a person. Detection with a human decision beats an automated action that
 * can log out a paying customer.
 *
 * ## Why the risk tolerates a slow answer
 *
 * The threat needs a domain to lapse, clear ~30 days of registrar grace and
 * ~30 days of redemption, drop, and be re-bought. That is months, not days.
 * And the first harm is not silent credential theft: routing still points at
 * the ORIGINAL org's IdP, where the new owner's staff have no account. The
 * concrete harm is that the new legitimate owner cannot claim their own domain
 * (`issueDomainClaim` refuses a domain another org already routes) and their
 * users are misdirected. Weeks of grace cost that risk almost nothing, and buy
 * immunity from the resolver blip that would otherwise be self-inflicted.
 *=========================================*/

/**
 * The pure half of re-verification — the probe STATES and the decision made
 * from them — lives in `sso-drift-logic.ts` and is re-exported here so the
 * public surface is one module. It has no imports at all, which is what lets
 * the console route's spec run the REAL decision against faked I/O.
 */
export {
  assessDomainDrift,
  SSO_DRIFT_FAILURES_BEFORE_REPORT,
  SSO_DRIFT_MIN_AGE_MS,
  type DomainDriftAction,
  type DomainDriftState,
  type DomainDriftVerdict,
  type DomainProbe,
  type DomainProbeStatus,
} from './sso-drift-logic'

/**
 * Re-check a claim's TXT record, distinguishing silence from absence.
 *
 * Same pinned public resolvers and same fallback as {@link resolveChallengeTxt}
 * — this is not a second opinion about DNS, it is the same lookup reporting one
 * more bit. NXDOMAIN/ENOTFOUND/ENODATA are ANSWERS ("that name has no TXT
 * record") and stay conclusive; anything else from both the pinned resolvers
 * and the runtime fallback is `unreachable`.
 *
 * Never throws: a sweep across every org must not stop at the first bad zone.
 */
export async function probeChallengeTxt(
  domain: string,
  token: string,
): Promise<DomainProbe> {
  const host = `${SSO_CHALLENGE_PREFIX}.${domain}`
  const flatten = (records: string[][]) =>
    records.map((chunks) => chunks.join('').trim())
  const settle = (records: string[]): DomainProbe => ({
    status: recordsProveOwnership(records, token) ? 'proven' : 'missing',
    records: records.slice(0, 5),
  })
  /** Codes that are a real answer rather than a failure to get one. */
  const conclusive = (code: string) =>
    code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN'

  try {
    const resolver = new CallbackResolver()
    resolver.setServers(PUBLIC_RESOLVERS)
    const records = await new Promise<string[][]>((resolve, reject) => {
      resolver.resolveTxt(host, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      )
    })
    return settle(flatten(records))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (conclusive(code)) return settle([])
    try {
      return settle(flatten(await dns.resolveTxt(host)))
    } catch (fallbackError) {
      const fallbackCode = (fallbackError as NodeJS.ErrnoException)?.code
      // The pinned resolvers gave us nothing usable. Only the fallback's own
      // answer can still make this conclusive; otherwise we genuinely do not
      // know, and saying so is the entire feature.
      if (conclusive(fallbackCode)) return settle([])
      return { status: 'unreachable', records: [] }
    }
  }
}

export interface SsoDomainClaimView {
  domain: string
  token: string
  verified: boolean
  /** Fully-qualified host the record goes on. */
  recordHost: string
  /** Exact value the record must carry. */
  recordValue: string
  lastRecords?: string[]
}

const claimRef = (orgId: string, domain: string) =>
  firestore().collection('orgs').doc(orgId).collection('ssoDomains').doc(domain)

/**
 * Start (or re-read) a claim on a domain. Idempotent: an existing claim keeps
 * its token, because reissuing would invalidate a record the customer may have
 * already published and turn a working setup into a mysterious failure.
 */
export async function issueDomainClaim(
  orgId: string,
  rawDomain: string,
): Promise<{ claim: SsoDomainClaimView | null; error: string | null }> {
  const { domain, error } = validateSsoDomain(rawDomain)
  if (!domain) return { claim: null, error: error ?? 'Invalid domain' }

  // One domain, one org. Without this a second org could hold a live claim on
  // a domain already governed elsewhere and race it at verification time.
  const existing = await firestore()
    .collection('ssoDomains')
    .doc(domain)
    .get()
  if (existing.exists && existing.get('orgId') !== orgId) {
    return {
      claim: null,
      error: 'That domain is already verified by another organization.',
    }
  }

  const ref = claimRef(orgId, domain)
  const snapshot = await ref.get()
  const stored = snapshot.exists
    ? (snapshot.get('token') as string | undefined)
    : undefined
  const token = stored || randomBytes(24).toString('base64url')
  if (!snapshot.exists) {
    await ref.set({
      domain,
      token,
      verified: false,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
  } else if (!stored) {
    // A claim document that EXISTS but carries NO token is a shape AGL-1887
    // introduced: {@link attestSsoDomain} writes the attestation marker and
    // nothing else, because a staff attestation has no DNS challenge behind
    // it. Before self-serve, every claim document was created here and so
    // always had a token — `exists` and `has a token` were the same fact.
    //
    // They are not any more, and conflating them broke the upgrade path for
    // exactly the orgs AGL-1887 exists to serve. `exists` alone decided
    // whether to persist, so "Set up DNS proof" on an attested domain minted
    // a token, showed the admin a TXT record built from it, and stored it
    // NOWHERE — a different value on every click. `verifyDomainClaim` re-reads
    // `snapshot.get('token')`, finds `undefined`, and could never match the
    // record they had just published. An attested domain could never become a
    // verified one.
    //
    // MERGE, and `verified` is deliberately NOT written: the attestation has
    // to survive being upgraded, and a claim already midway through DNS is not
    // this branch's to demote.
    await ref.set({ domain, token }, { merge: true })
  }
  return {
    error: null,
    claim: {
      domain,
      token,
      verified: Boolean(snapshot.get('verified')),
      recordHost: `${SSO_CHALLENGE_PREFIX}.${domain}`,
      recordValue: challengeValue(token),
      lastRecords: snapshot.get('lastRecords') as string[] | undefined,
    },
  }
}

export interface DomainVerifyResult {
  domain: string
  verified: boolean
  /** What the lookup actually saw — the difference between "missing" and "wrong". */
  records: string[]
  expected: string
}

/**
 * Check a claim against live DNS and, on success, promote the domain into
 * `sso.domains` — the array that sign-in consults.
 *
 * Failure is recorded but never destructive: a transient DNS outage must not
 * silently un-govern a domain mid-flight. Removal is `revokeDomain`, which is
 * an explicit act.
 */
export async function verifyDomainClaim(
  orgId: string,
  rawDomain: string,
): Promise<{ result: DomainVerifyResult | null; error: string | null }> {
  const { domain, error } = validateSsoDomain(rawDomain)
  if (!domain) return { result: null, error: error ?? 'Invalid domain' }

  const ref = claimRef(orgId, domain)
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    return { result: null, error: 'No claim on that domain — add it first.' }
  }
  const token = snapshot.get('token') as string
  const expected = challengeValue(token)
  const records = await resolveChallengeTxt(domain)
  const verified = recordsProveOwnership(records, token)

  await ref.set(
    {
      verified,
      lastCheckedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      ...(verified
        ? {
            verifiedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            lastRecords: firebaseAdmin.firestore.FieldValue.delete(),
          }
        : { lastRecords: records.slice(0, 5) }),
    },
    { merge: true },
  )

  if (verified) {
    await firestore()
      .collection('orgs')
      .doc(orgId)
      .set(
        {
          sso: {
            domains: firebaseAdmin.firestore.FieldValue.arrayUnion(domain),
            domainVerified: true,
          },
        },
        { merge: true },
      )
  }

  return { error: null, result: { domain, verified, records, expected } }
}

/**
 * Drop a domain: out of `sso.domains`, and its public routing doc deactivated.
 *
 * Order matters. The public doc goes first, because it is the one an attacker
 * would benefit from: while it says `active`, sign-ins for the domain still
 * route to this org's IdP regardless of what the org doc says.
 */
export async function revokeDomain(
  orgId: string,
  rawDomain: string,
): Promise<void> {
  const domain = normalizeSsoDomain(rawDomain)
  if (!domain) return
  const publicRef = firestore().collection('ssoDomains').doc(domain)
  const publicSnapshot = await publicRef.get()
  if (publicSnapshot.exists && publicSnapshot.get('orgId') === orgId) {
    await publicRef.set({ active: false }, { merge: true })
  }
  await firestore()
    .collection('orgs')
    .doc(orgId)
    .set(
      {
        sso: {
          domains: firebaseAdmin.firestore.FieldValue.arrayRemove(domain),
        },
      },
      { merge: true },
    )
  await claimRef(orgId, domain).delete().catch(() => undefined)
}

/**
 * What the customer needs to type into their IdP. Derived, never stored —
 * these are properties of OUR deployment, and a stale stored copy would send
 * somebody to configure an ACS URL we no longer serve.
 *
 * The callback is Firebase Auth's own handler on the project `authDomain`;
 * `rpEntityId` is the relying-party entity id their IdP will see.
 */
export interface SsoServiceMetadata {
  acsUrl: string
  entityId: string
  authDomain: string
}

/**
 * Thrown by `ssoServiceMetadata()` when this deployment has no auth origin at
 * all (AGL-2020).
 *
 * Deliberately names the variables and NOT a value: handing the operator
 * a `*.firebaseapp.com` example here is how they end up pasting somebody
 * else's project id into their IdP. `sso-provisioning.spec.ts` asserts this
 * string mentions no Aglyn host.
 */
export const SSO_AUTH_ORIGIN_UNCONFIGURED_MESSAGE =
  'Single sign-on is not configured for this deployment: no auth origin ' +
  'could be resolved. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID — or one of ' +
  'NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST, NEXT_PUBLIC_WORKSPACE_DOMAIN or ' +
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN — and rebuild.'

/**
 * A HOST, never a URL.
 *
 * These strings are compared byte for byte — by GCIP against the assertion's
 * Audience, and by the IdP against the Reply URL it posts to. An operator who
 * pastes `https://auth.aglyn.com/` into the env var would otherwise produce
 * `https://https://auth.aglyn.com//__/auth/handler` and reject every
 * assertion, which presents as "SSO stopped working" with nothing in the
 * config that looks wrong.
 */
function normalizeAuthHost(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

/**
 * The auth origin this deployment actually serves (AGL-1381).
 *
 * Mirrors `resolveFirebaseAuthDomain()` in the client's `firebase-config`: on a
 * workspace deployment the whole OAuth/SAML handshake is funnelled through one
 * dedicated same-site origin, `auth.<workspaceDomain>`, which reverse-proxies
 * Firebase's `/__/auth/*` helpers (AGL-462). The IdP has to post the assertion
 * to THAT origin — the one holding the pending-redirect state — or browser
 * storage partitioning severs the two halves of the flow.
 *
 * The order is load-bearing:
 *
 *   1. `NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST` — an explicit override wins.
 *   2. `auth.<NEXT_PUBLIC_WORKSPACE_DOMAIN>` — the deployed workspace origin.
 *      Derived only when the variable is actually set, never defaulted: falling
 *      back to `auth.aglyn.com` would point a self-hosted install at OUR auth
 *      origin, and it would also make the `firebaseapp.com` arm unreachable.
 *      It sits ABOVE `AUTH_DOMAIN` because production sets both, and the
 *      branded host is the one production serves.
 *   3–4. the project's `*.firebaseapp.com` domain — localhost, previews that
 *      are not on the workspace domain, the emulator, and self-host installs
 *      that have not stood up an auth subdomain.
 *
 * When all four are absent this THROWS (AGL-2020). It used to default the
 * project id to `aglyn-main` — ours — which is the anti-pattern AGL-1919
 * exists to prevent, and it was silent in both directions that matter:
 * `provisionSsoPool()` wrote our origin into the operator's OWN GCIP provider
 * as `rpEntityId`/`callbackURL`, and the console printed it as the Reply URL
 * for their customer to paste into their IdP. A third party's SAML assertions
 * would then be posted at infrastructure the operator does not run.
 *
 * Throwing rather than degrading is deliberate, and this is the one place in
 * the self-host audit where "run with the feature off" is not available: there
 * is no empty value to fall back to. `authDomain: ''` emits
 * `https:///__/auth/handler`, which GCIP accepts on write and which then
 * rejects every assertion afterwards with nothing in the config that looks
 * wrong — the same "looks configured, works never" shape as an App Check
 * provider built on `undefined`. SSO is opt-in and deliberately configured, so
 * an operator reaching this has asked for it; a named error telling them which
 * variable to set is strictly better than either wrong origin.
 *
 * The READ path degrades instead of 500ing: `/api/orgs/sso?action=status`
 * catches this and returns `metadata: null` with the message, so the settings
 * page renders the reason rather than a wrong instruction. The WRITE path
 * (`provisionSsoPool`) lets it fly.
 *
 * `entityId` carries the scheme. It is not cosmetic: live GCIP for the first
 * SSO org holds `https://auth.aglyn.com`, and Google Workspace is already
 * sending that exact Audience. Emitting the bare host here would be written
 * over the working config by the next `provisionSsoPool()` save and lock out
 * every SSO-only user in the org. `sso-provisioning.spec.ts` pins both strings
 * character for character for that reason.
 */
export function ssoServiceMetadata(): SsoServiceMetadata {
  const workspaceDomain = normalizeAuthHost(
    process.env['NEXT_PUBLIC_WORKSPACE_DOMAIN'],
  )
  const projectId = String(
    process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] ?? '',
  ).trim()
  const authDomain =
    normalizeAuthHost(process.env['NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST']) ||
    (workspaceDomain ? `auth.${workspaceDomain}` : '') ||
    normalizeAuthHost(process.env['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN']) ||
    (projectId ? `${projectId}.firebaseapp.com` : '')
  if (!authDomain) throw new Error(SSO_AUTH_ORIGIN_UNCONFIGURED_MESSAGE)
  return {
    authDomain,
    acsUrl: `https://${authDomain}/__/auth/handler`,
    entityId: `https://${authDomain}`,
  }
}

/**
 * GCIP display names are constrained (4–20 chars, must start with a letter,
 * letters/digits/hyphens only). An org slug can violate every one of those, so
 * derive rather than pass through — a rejected display name would surface as an
 * opaque provisioning failure at the worst moment.
 */
export function poolDisplayName(orgSlug: string, orgId: string): string {
  const base = `${orgSlug || orgId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
  const padded = (base || 'org').slice(0, 20)
  return padded.length >= 4 ? padded : `${padded}-org`.slice(0, 20)
}

export interface SamlIdpMetadata {
  entityId: string
  ssoUrl: string
  certificates: string[]
}

export interface ProvisionResult {
  tenantId: string
  providerId: string
  /** True when this call created the pool rather than reusing one. */
  createdPool: boolean
  /** True when this call created the provider rather than updating one. */
  createdProvider: boolean
}

/**
 * Create (or update) the org's GCIP pool and its SAML provider.
 *
 * Idempotent by construction: an org that already has a `tenantId` reuses it,
 * and a provider that already exists is UPDATED rather than recreated. Creating
 * a second pool would strand every user in the first one — they are separate
 * user namespaces, so "just make a new one" silently locks out everybody who
 * has already signed in.
 */
export async function provisionSsoPool(options: {
  orgId: string
  orgSlug: string
  existingTenantId?: string
  existingProviderId?: string
  displayName: string
  idp: SamlIdpMetadata
}): Promise<ProvisionResult> {
  const { orgId, orgSlug, existingTenantId, existingProviderId, idp } = options
  const manager = auth().tenantManager()
  const metadata = ssoServiceMetadata()

  let tenantId = existingTenantId
  let createdPool = false
  if (!tenantId) {
    const tenant = await manager.createTenant({
      displayName: poolDisplayName(orgSlug, orgId),
      emailSignInConfig: { enabled: false, passwordRequired: false },
    })
    tenantId = tenant.tenantId
    createdPool = true
  }

  const tenantAuth: BaseAuth = manager.authForTenant(tenantId)
  const providerId = existingProviderId || `saml.${poolDisplayName(orgSlug, orgId)}`
  const config = {
    displayName: options.displayName || 'Single sign-on',
    enabled: true,
    idpEntityId: idp.entityId,
    ssoURL: idp.ssoUrl,
    x509Certificates: idp.certificates,
    rpEntityId: metadata.entityId,
    callbackURL: metadata.acsUrl,
  }

  let createdProvider = false
  try {
    await tenantAuth.getProviderConfig(providerId)
    await tenantAuth.updateProviderConfig(providerId, config)
  } catch {
    await tenantAuth.createProviderConfig({ providerId, ...config })
    createdProvider = true
  }

  return { tenantId, providerId, createdPool, createdProvider }
}

/**
 * Is this claim a STAFF ATTESTATION that the org owns the domain? (AGL-1887)
 *
 * The second of exactly two ways a domain can be proven, and the one that
 * exists for orgs onboarded before self-serve. Their domain was written onto
 * `sso.domains` by a person who checked, with no claim document behind it — so
 * `unpublishSsoDomains` deactivated their routing happily and
 * `publishSsoDomains` then refused to bring it back. Off worked, on did not,
 * and for `aglyn-org` the owner's only credential lives inside the pool that
 * stops answering (AGL-1888).
 *
 * A POSITIVE MARKER, never an absence. The rejected alternative was to treat
 * "a routing doc already exists naming this org" as permission to re-publish,
 * which makes `unpublish` non-final and would let a domain whose claim was
 * revoked come back. What is trusted here is a field a staff member wrote on
 * purpose, and it says WHO, so the trust is attributable.
 *
 * WHY THIS IS NOT A CLIENT-REACHABLE HOLE, which is the only question that
 * matters about it:
 *
 *  - `orgs/{orgId}/ssoDomains/{domain}` is `allow read, write: if false` in
 *    `cloud/firebase-firestore.rules` — deny-all for every client, reads
 *    included. Only the Admin SDK, which bypasses rules, can write here.
 *  - No customer-reachable route writes this field. `issueDomainClaim` is the
 *    only claim writer on the org's own path and it writes `domain`, `token`,
 *    `verified: false` and `createdAt` — never `attestedBy`.
 *  - {@link attestSsoDomain} is the only writer, and it is staff-only by
 *    construction: it lives here, server-side, and takes the attesting uid.
 *
 * That is why AGL-1887's proposed rules change is NOT part of this: the
 * subcollection is already deny-all, and adding a rule permitting a narrower
 * write than "none" would loosen it, not tighten it.
 *
 * A non-empty STRING, checked strictly. `true`, `1` or `{}` are not an
 * attestation by anybody, and a field that can be satisfied by any truthy
 * value is one a future careless write can satisfy by accident.
 */
export function isStaffAttestedClaim(attestedBy: unknown): boolean {
  return typeof attestedBy === 'string' && attestedBy.trim().length > 0
}

/**
 * Record that staff have verified, out of band, that an org owns a domain
 * (AGL-1887).
 *
 * This is the write half of the attestation {@link isStaffAttestedClaim}
 * reads, and it exists so there is exactly ONE way the marker can be created
 * and it is a named function with an actor on it — rather than a field somebody
 * sets by hand in the Firebase console with no record of who or why.
 *
 * `verified` is left FALSE and untouched. The two facts are different: DNS
 * verification is a proof we re-ran ourselves, an attestation is a person
 * vouching. Collapsing them would make an attested domain indistinguishable
 * from a DNS-proven one in the data, and the `verified` flag is what
 * `verifyDomainClaim` owns.
 *
 * Not exposed through `/api/orgs/sso`, deliberately. An org admin proving
 * their own domain has DNS for that; an attestation is us saying we checked,
 * and a customer-reachable path that wrote it would be a customer-reachable
 * path to publishing any domain.
 */
export async function attestSsoDomain(options: {
  orgId: string
  domain: string
  /** The staff member vouching. Recorded, and required. */
  attestedByUid: string
  note?: string | null
}): Promise<{ domain: string | null; error: string | null }> {
  const { domain, error } = validateSsoDomain(options.domain)
  if (!domain) return { domain: null, error: error ?? 'Invalid domain' }
  if (!isStaffAttestedClaim(options.attestedByUid)) {
    return { domain: null, error: 'An attestation needs the staff uid making it.' }
  }

  // Same uniqueness rule `issueDomainClaim` enforces. An attestation must not
  // be a way around "one domain, one org" — if another org already holds live
  // routing for this domain, that conflict is resolved by a human before
  // anything is written, not by whoever attests last.
  const existing = await firestore().collection('ssoDomains').doc(domain).get()
  if (existing.exists && existing.get('orgId') !== options.orgId) {
    return {
      domain: null,
      error: 'That domain is already verified by another organization.',
    }
  }

  await claimRef(options.orgId, domain).set(
    {
      domain,
      attestedBy: options.attestedByUid.trim(),
      attestedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      attestationNote: options.note?.trim() || null,
    },
    // MERGE, so an existing claim keeps its token and its `verified` state. A
    // fresh document is created for the pre-self-serve orgs that have none,
    // which is the whole point, but an attestation must never reset a claim
    // the org is midway through proving by DNS.
    { merge: true },
  )
  return { domain, error: null }
}

/**
 * Publish the public routing docs — the last step, and the one that actually
 * turns SSO on for a domain.
 *
 * Only PROVEN domains are written — DNS-verified, or staff-attested per
 * {@link isStaffAttestedClaim}. This function is the single writer of
 * `ssoDomains`, so the invariant "a live routing doc implies proven ownership"
 * is enforceable by reading one place.
 */
export async function publishSsoDomains(options: {
  orgId: string
  tenantId: string
  providerId: string
  protocol: 'saml' | 'oidc'
  displayName?: string
  domains: string[]
}): Promise<string[]> {
  const { orgId, tenantId, providerId, protocol, displayName } = options
  const published: string[] = []
  const batch = firestore().batch()
  for (const raw of options.domains) {
    const domain = normalizeSsoDomain(raw)
    if (!domain) continue
    // Re-read the claim rather than trusting the caller's list: this is the
    // boundary where an unverified domain would become live, so the check
    // belongs here and not only at the call site.
    //
    // TWO ways to be proven, and no third (AGL-1887). `verified === true` is
    // DNS, re-checked by us; `attestedBy` is a named staff member vouching for
    // an org onboarded before self-serve existed. Both are POSITIVE markers on
    // the org's own claim document, which no client can write.
    //
    // What this must never become is an unconditional accept, or an inference
    // from the routing doc already existing. That check is what stops an org
    // publishing routing for a domain it does not own and intercepting another
    // company's sign-ins — see `sso-publish-gate.emulator.spec.ts`, which
    // exercises every refusal branch, and `sso-attested-restore.spec.ts`,
    // which pins the boundary this loosening must not cross.
    const claim = await claimRef(orgId, domain).get()
    if (!claim.exists) continue
    const proven =
      claim.get('verified') === true ||
      isStaffAttestedClaim(claim.get('attestedBy'))
    if (!proven) continue
    batch.set(
      firestore().collection('ssoDomains').doc(domain),
      {
        orgId,
        tenantId,
        providerId,
        protocol,
        displayName: displayName ?? null,
        active: true,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    published.push(domain)
  }
  await batch.commit()
  return published
}

/** Deactivate every routing doc this org owns (disable, not delete). */
export async function unpublishSsoDomains(orgId: string): Promise<void> {
  const owned = await firestore()
    .collection('ssoDomains')
    .where('orgId', '==', orgId)
    .get()
  if (owned.empty) return
  const batch = firestore().batch()
  owned.docs.forEach((doc) => batch.set(doc.ref, { active: false }, { merge: true }))
  await batch.commit()
}
