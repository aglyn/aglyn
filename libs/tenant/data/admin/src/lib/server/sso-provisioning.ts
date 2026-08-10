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
  const token =
    (snapshot.exists && (snapshot.get('token') as string)) ||
    randomBytes(24).toString('base64url')
  if (!snapshot.exists) {
    await ref.set({
      domain,
      token,
      verified: false,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
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
  const authDomain =
    normalizeAuthHost(process.env['NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST']) ||
    (workspaceDomain ? `auth.${workspaceDomain}` : '') ||
    normalizeAuthHost(process.env['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN']) ||
    `${process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] || 'aglyn-main'}.firebaseapp.com`
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
 * Publish the public routing docs — the last step, and the one that actually
 * turns SSO on for a domain.
 *
 * Only verified domains are written. This function is the single writer of
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
    const claim = await claimRef(orgId, domain).get()
    if (!claim.exists || claim.get('verified') !== true) continue
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
