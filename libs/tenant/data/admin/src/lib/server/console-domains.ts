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
 * Registration, DNS ownership proof and Vercel attachment for a custom
 * **console** domain — the "verify + attach" half of AGL-1099 (AGL-1373).
 *
 * ⚠️ **THIS LANDS DARK, AND MUST STAY DARK.** AGL-1099 says it outright:
 * *"Do NOT ship 1099b alone: attaching a domain that then cannot authenticate
 * is worse than not attaching it, because it looks finished."* Nothing here is
 * reachable from a user-facing path, nothing calls `activateConsoleDomain`, and
 * no domain has been attached. Two things must land first:
 *
 * - **1099d — the App Check reCAPTCHA allowlist.** The 1099a proof-of-concept
 *   (`docs/design/agl-1099a-poc-findings.md`) measured that App Check, *not*
 *   Firebase's authorized-domain list, is the gate: an unattested
 *   `signInWithCustomToken` 401s with "Firebase App Check token is invalid"
 *   **before** token validation. Same page, same app id, only the origin
 *   differing — an allowlisted origin minted a token and reached credential
 *   validation; a non-allowlisted one failed at `appCheck/recaptcha-error`. So
 *   the allowlist entry is a hard **functional** prerequisite and not merely
 *   the commercial ceiling the design called it. **1099d blocks 1099c.**
 * - **1099e — the handoff itself.** A console domain shares no parent domain
 *   with `aglyn.com`, so the `.aglyn.com` session cookie cannot reach it.
 *
 * ## Why this is not `/api/domains/attach|verify|detach`
 *
 * Those routes are shaped around `hosts/{hostId}`, a `cname` field and the
 * `customDomain` entitlement. A console domain is keyed on the **domain**,
 * owned by an **org**, and gated on `whiteLabel`. Re-pointing them at the
 * console project would mean parameterising the auth model, the entitlement,
 * the uniqueness query and the Firestore shape — at which point it is not
 * reuse. What *is* reused is `workspace-domains.ts`, which already talks to
 * `VERCEL_CONSOLE_PROJECT_ID`, already carries a deadline, and already never
 * throws (AGL-1353 D8).
 *
 * ## The uniqueness invariant, which is the whole security property
 *
 * `attachProjectDomain` tolerates Vercel's `domain_already_in_use` as success.
 * That is only safe while the Firestore claim indexes **every** name Vercel
 * holds for us. If a name reaches Vercel without a claim, a second org can
 * claim it here, read `already-exists` as health, and have its visitors served
 * — or redirected — to a stranger's console. That is AGL-743 exactly: there,
 * `host.cname` was written client-side *before* the uniqueness check, so losing
 * the race still left the loser holding the domain and `get-host.ts` resolved
 * the duplicate by Firestore document order.
 *
 * So: **`claimConsoleDomain` claims the primary and every twin in ONE
 * transaction, or none of them**, and `activateConsoleDomain` attaches exactly
 * the set that transaction claimed. Neither half is optional, and a twin
 * introduced later without going through `consoleDomainNames` reopens the hole.
 */

import { randomBytes } from 'crypto'
import { checkEntitlement } from '@aglyn/aglyn/server'
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import firebaseAdmin from './firebase-admin'
import {
  challengeValue,
  recordsProveOwnership,
  resolveChallengeTxt,
  SSO_CHALLENGE_PREFIX,
  type DomainCheck,
} from './sso-provisioning'
import {
  attachProjectDomain,
  detachProjectDomain,
  type WorkspaceDomainResult,
} from './workspace-domains'

const firestore = () => firebaseAdmin.app().firestore()

/** Collection name, kept in one place so the rules file and this agree. */
export const CONSOLE_DOMAINS_COLLECTION = 'consoleDomains'

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DOMAIN_PATTERN = new RegExp(`^${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,63}$`)

/** RFC 1035: a fully-qualified name is at most 253 octets. */
const MAX_DOMAIN_LENGTH = 253

/**
 * Names nobody may claim, as the domain itself **or as any subdomain of it**.
 *
 * Two families, blocked for different reasons.
 *
 * **Ours.** `aglyn.com` passes `customConsoleDomain`'s shape check today, and
 * so do `app.aglyn.com` and `console.aglyn.com` — the console's own hostnames.
 * A blocklist keyed on the registrable domain covers every entry of
 * `PRODUCTION_DOMAINS` in `security-origins.js` without duplicating that list
 * here, and keeps covering names added to it later. There is a test that walks
 * the real file and asserts exactly that, so the two cannot drift apart.
 *
 * **Shared app-hosting suffixes.** Nobody controls the zone at
 * `something.vercel.app` in the sense this feature needs — and AGL-1353
 * measured that `aglyn-console-aglyn.vercel.app` is already a fully functional
 * second console, the AGL-1135 shape on a less credible name. A customer
 * proving control of a name a platform hands out for free is proving something
 * that can be re-handed to someone else.
 */
const RESERVED_SUFFIXES = [
  'aglyn.com',
  'aglyn.io',
  'aglyn.app',
  'aglyn.dev',
  'vercel.app',
  'vercel.sh',
  'web.app',
  'firebaseapp.com',
  'appspot.com',
  'cloudfunctions.net',
  'run.app',
  'pages.dev',
  'workers.dev',
  'netlify.app',
  'github.io',
  'herokuapp.com',
  'azurewebsites.net',
  'amplifyapp.com',
  'onrender.com',
  'fly.dev',
  'ngrok.io',
  'ngrok-free.app',
  'trycloudflare.com',
  // RFC 2606 / 6761 special-use names, plus the ones a misconfigured resolver
  // answers for. None of these can be proved by a public TXT lookup.
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'test',
  'example',
  'invalid',
  'onion',
]

/**
 * Multi-label public suffixes, blocked as a **whole name only**.
 *
 * `acme.co.uk` is a perfectly good customer domain; `co.uk` is not a domain at
 * all. This is a short list rather than the Public Suffix List on purpose —
 * pulling in a PSL dependency to reject a name no registrar would sell is not
 * a trade worth making, and the single-label rule below catches the far more
 * common `com` / `net` case for free.
 */
const BARE_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.za',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.mx',
  'com.cn',
  'com.tr',
  'co.in',
  'co.kr',
  'com.sg',
  'com.hk',
])

/**
 * Trim, lowercase, drop a trailing root dot, and tolerate a pasted URL.
 *
 * People paste `https://console.acme.com/` into a domain field constantly, and
 * refusing that is a support ticket rather than a security control — the value
 * is re-validated against the shape below either way.
 */
export function normalizeConsoleDomain(input: string): string {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return ''
  return raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@]*@/, '')
    .split(/[/?#]/)[0]
    .replace(/\.+$/, '')
}

/**
 * Shape, length and reserved-name check.
 *
 * `{ domain, error }` with both keys always present rather than a discriminated
 * union, matching `validateSsoDomain` — `strictNullChecks` is off repo-wide and
 * an `{ ok: true } | { ok: false }` union does not narrow reliably once it
 * crosses a library boundary.
 */
export function validateConsoleDomain(input: string): DomainCheck {
  const domain = normalizeConsoleDomain(input)
  if (!domain || domain.length > MAX_DOMAIN_LENGTH || !DOMAIN_PATTERN.test(domain)) {
    return {
      domain: null,
      error: 'Enter a valid domain, for example console.acme.com',
    }
  }
  const labels = domain.split('.')
  if (labels.length < 2) {
    return { domain: null, error: 'Enter a full domain name, not a single label' }
  }
  if (BARE_PUBLIC_SUFFIXES.has(domain)) {
    return { domain: null, error: 'Enter a domain your organization owns' }
  }
  for (const suffix of RESERVED_SUFFIXES) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) {
      return {
        domain: null,
        error: 'That domain is reserved and cannot be used as a console domain',
      }
    }
  }
  return { domain, error: null }
}

/**
 * Every name this claim covers: the primary, then its twins.
 *
 * **A twin is a name we attach to Vercel that is not the one the customer
 * asked for**, and it is the sharp edge of the whole file. Attaching
 * `acme.com` without also attaching `www.acme.com` leaves half the traffic on
 * the floor; attaching `www.acme.com` without *claiming* it leaves a name in
 * our Vercel project that no Firestore document accounts for — and then a
 * second org claims it, `attachProjectDomain` answers `already-exists`, and
 * that org's visitors are redirected to the first org's console. The name is
 * therefore derived here, claimed here, and attached from the same list.
 *
 * The apex test is deliberately narrow: exactly two labels. `acme.co.uk` is
 * also an apex and gets no twin, which costs a customer a `www` redirect they
 * can ask for by hand. Guessing wrong in the other direction — treating
 * `console.acme.com` as an apex and quietly reserving `www.console.acme.com` —
 * would reserve names on an org's behalf that it never asked for, and a
 * reservation is the thing that locks another org out.
 */
export function consoleDomainNames(domain: string): string[] {
  const primary = normalizeConsoleDomain(domain)
  if (!primary) return []
  const labels = primary.split('.')
  if (labels.length !== 2) return [primary]
  return [primary, `www.${primary}`]
}

export type ConsoleDomainStatus = 'pending' | 'verified' | 'active' | 'suspended'

export interface ConsoleDomainClaimView {
  domain: string
  orgId: string
  status: ConsoleDomainStatus
  token: string
  /** Every name the claim reserves — primary first. */
  names: string[]
  /** Fully-qualified host the TXT record goes on. */
  recordHost: string
  /** Exact value the TXT record must carry. */
  recordValue: string
  verified: boolean
  lastRecords?: string[]
}

/** Both keys always present, one always null — see `validateConsoleDomain`. */
export interface ConsoleDomainResult {
  claim: ConsoleDomainClaimView | null
  error: string | null
  /** HTTP status a route should return. 200 whenever `claim` is set. */
  status: number
}

export class ConsoleDomainTakenError extends Error {
  readonly domain: string
  constructor(domain: string) {
    super(`Console domain already claimed: ${domain}`)
    this.name = 'ConsoleDomainTakenError'
    this.domain = domain
  }
}

const claimRef = (domain: string) =>
  firestore().collection(CONSOLE_DOMAINS_COLLECTION).doc(domain)

function claimView(
  domain: string,
  data: Record<string, unknown>,
): ConsoleDomainClaimView {
  const token = String(data?.txtToken ?? '')
  const names = Array.isArray(data?.names)
    ? (data.names as string[])
    : consoleDomainNames(domain)
  return {
    domain,
    orgId: String(data?.orgId ?? ''),
    status: (data?.status as ConsoleDomainStatus) ?? 'pending',
    token,
    names,
    recordHost: `${SSO_CHALLENGE_PREFIX}.${domain}`,
    recordValue: challengeValue(token),
    verified: data?.status === 'verified' || data?.status === 'active',
    lastRecords: (data?.lastRecords as string[]) ?? undefined,
  }
}

/**
 * The org's `whiteLabel` entitlement, read server-side.
 *
 * AGL-1354 removed `brandingProfile` from what a client may write, so a server
 * route is now the only writer of `customConsoleDomain` — which makes this the
 * only place the gate can live. A gate that is bypassable is not a gate, and
 * this one was, on any plan, straight from the client SDK, until that landed.
 */
async function orgIsEntitled(orgId: string): Promise<boolean> {
  const snapshot = await firestore().collection('orgs').doc(orgId).get()
  if (!snapshot.exists) return false
  return checkEntitlement(
    snapshot.data() as Partial<AglynOrgBilling>,
    'whiteLabel',
  )
}

/**
 * Claim the primary and every twin in ONE transaction, or none of them.
 *
 * Modelled on the `orgSlugs` reservation in `organizations.ts`: read inside the
 * transaction, refuse if someone else holds it, write in the same transaction.
 * Every name is read with a single `getAll` so the whole set is covered by one
 * transaction's read-set — claiming a twin in a follow-up write is precisely
 * the AGL-743 hole this exists to close.
 *
 * Idempotent for the owning org, and it **keeps the existing token**: reissuing
 * would invalidate a TXT record the customer may already have published and
 * turn a working setup into a mysterious failure (the same reasoning as
 * `issueDomainClaim`).
 *
 * Throws `ConsoleDomainTakenError` when any name in the set belongs to another
 * org. Exported for the integration test, which needs to drive the transaction
 * under real contention.
 */
export async function claimConsoleDomain(
  orgId: string,
  domain: string,
): Promise<ConsoleDomainClaimView> {
  const names = consoleDomainNames(domain)
  const primary = names[0]
  const db = firestore()
  const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()

  return db.runTransaction(async (tx) => {
    const refs = names.map((name) =>
      db.collection(CONSOLE_DOMAINS_COLLECTION).doc(name),
    )
    // ONE read covering the whole set. Firestore requires every read before
    // every write in a transaction, so this also fixes the ordering.
    const snapshots = await tx.getAll(...refs)
    for (const snapshot of snapshots) {
      if (snapshot.exists && snapshot.get('orgId') !== orgId) {
        throw new ConsoleDomainTakenError(snapshot.id)
      }
    }
    const existing = snapshots[0]
    const token = existing.exists
      ? String(existing.get('txtToken') ?? '')
      : randomBytes(24).toString('hex')
    const status: ConsoleDomainStatus = existing.exists
      ? ((existing.get('status') as ConsoleDomainStatus) ?? 'pending')
      : 'pending'

    snapshots.forEach((snapshot, index) => {
      tx.set(
        refs[index],
        {
          orgId,
          primaryHost: primary,
          role: index === 0 ? 'primary' : 'redirect',
          names,
          txtToken: token,
          status,
          vercelState: snapshot.get('vercelState') ?? 'pending',
          createdAt: snapshot.exists ? snapshot.get('createdAt') : now,
          updatedAt: now,
        },
        { merge: true },
      )
    })
    return claimView(primary, { orgId, status, txtToken: token, names })
  })
}

/**
 * Start (or re-read) a registration: entitlement, validation, then the claim.
 *
 * The order matters. An org without `whiteLabel` must not be able to learn
 * whether a domain is free, and must not leave a `pending` claim behind that
 * blocks the org that *is* entitled to it.
 */
export async function registerConsoleDomain(options: {
  orgId: string
  domain: string
}): Promise<ConsoleDomainResult> {
  const orgId = String(options?.orgId ?? '')
  if (!orgId) return { claim: null, error: 'Unknown organization', status: 400 }
  if (!(await orgIsEntitled(orgId))) {
    return {
      claim: null,
      error: 'A custom console domain requires the Agency plan',
      status: 403,
    }
  }
  const { domain, error } = validateConsoleDomain(options?.domain)
  if (!domain) return { claim: null, error: error ?? 'Invalid domain', status: 400 }
  try {
    return { claim: await claimConsoleDomain(orgId, domain), error: null, status: 200 }
  } catch (thrown) {
    if (thrown instanceof ConsoleDomainTakenError) {
      return {
        claim: null,
        error: 'That domain is already connected to another organization',
        status: 409,
      }
    }
    throw thrown
  }
}

/**
 * Re-read DNS and record the verdict.
 *
 * Re-reads the claim first and refuses if the caller does not own it — the
 * `publishSsoDomains` discipline, where nothing reaches the collection sign-in
 * consults until a fresh lookup has seen the record. The comparison itself is
 * `recordsProveOwnership`, an exact match on a whole TXT record: a substring
 * test would accept `aglyn-domain-verification=<token>-and-more`, and a prefix
 * test would accept anything that merely starts the same way.
 */
export async function verifyConsoleDomain(options: {
  orgId: string
  domain: string
}): Promise<ConsoleDomainResult> {
  const orgId = String(options?.orgId ?? '')
  const { domain, error } = validateConsoleDomain(options?.domain)
  if (!domain) return { claim: null, error: error ?? 'Invalid domain', status: 400 }

  const snapshot = await claimRef(domain).get()
  if (!snapshot.exists || snapshot.get('orgId') !== orgId) {
    return { claim: null, error: 'No claim on that domain', status: 404 }
  }
  if (!(await orgIsEntitled(orgId))) {
    return {
      claim: null,
      error: 'A custom console domain requires the Agency plan',
      status: 403,
    }
  }

  const token = String(snapshot.get('txtToken') ?? '')
  const records = await resolveChallengeTxt(domain)
  const proved = recordsProveOwnership(records, token)
  const status: ConsoleDomainStatus = proved
    ? snapshot.get('status') === 'active'
      ? 'active'
      : 'verified'
    : 'pending'
  await claimRef(domain).set(
    {
      status,
      lastRecords: records.slice(0, 10),
      verifiedAt: proved
        ? (snapshot.get('verifiedAt') ??
          firebaseAdmin.firestore.FieldValue.serverTimestamp())
        : null,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  const view = claimView(domain, {
    ...snapshot.data(),
    status,
    txtToken: token,
    lastRecords: records,
  })
  return proved
    ? { claim: view, error: null, status: 200 }
    : {
        claim: view,
        error: `No matching TXT record at ${view.recordHost}`,
        status: 409,
      }
}

export interface ConsoleDomainAttachment {
  domain: string
  results: WorkspaceDomainResult[]
  attached: boolean
}

/**
 * Attach every claimed name to the console Vercel project.
 *
 * ⚠️ Not called from anywhere. It exists so the mechanism is complete and
 * tested; wiring it to a route is 1099c's job and must not happen before 1099d
 * (see the header).
 *
 * Refuses unless the claim is this org's **and** currently verified, and unless
 * the org still passes `whiteLabel`. The names come from the stored claim, not
 * from `consoleDomainNames`, so a change to the twin rule can never attach a
 * name the transaction did not reserve.
 *
 * Twins are registered as per-domain **redirects to the primary**, and the
 * redirect value is a **bare hostname** — `attachProjectDomain` enforces that,
 * because `https://${target}` is rejected by Vercel with a message that blames
 * the target for being absent rather than the format (AGL-1365).
 */
export async function activateConsoleDomain(options: {
  orgId: string
  domain: string
}): Promise<ConsoleDomainResult & { attachment: ConsoleDomainAttachment | null }> {
  const orgId = String(options?.orgId ?? '')
  const { domain, error } = validateConsoleDomain(options?.domain)
  if (!domain) {
    return { claim: null, error: error ?? 'Invalid domain', status: 400, attachment: null }
  }
  const snapshot = await claimRef(domain).get()
  if (!snapshot.exists || snapshot.get('orgId') !== orgId) {
    return { claim: null, error: 'No claim on that domain', status: 404, attachment: null }
  }
  if (!(await orgIsEntitled(orgId))) {
    return {
      claim: null,
      error: 'A custom console domain requires the Agency plan',
      status: 403,
      attachment: null,
    }
  }
  const status = snapshot.get('status')
  if (status !== 'verified' && status !== 'active') {
    return {
      claim: null,
      error: 'Prove ownership of the domain before attaching it',
      status: 409,
      attachment: null,
    }
  }

  const names: string[] = Array.isArray(snapshot.get('names'))
    ? snapshot.get('names')
    : [domain]
  const primary = names[0]
  const results: WorkspaceDomainResult[] = []
  for (const [index, name] of names.entries()) {
    results.push(
      await attachProjectDomain(
        name,
        index === 0 ? {} : { redirectTo: primary },
      ),
    )
  }
  const attached = results.every(
    (result) => result.outcome === 'attached' || result.outcome === 'already-exists',
  )
  await claimRef(domain).set(
    {
      status: attached ? 'active' : 'verified',
      vercelState: attached ? 'attached' : 'pending',
      activatedAt: attached
        ? (snapshot.get('activatedAt') ??
          firebaseAdmin.firestore.FieldValue.serverTimestamp())
        : null,
      // Bumped on every activation so a session minted against a previous
      // attachment of the same name is not honoured (AGL-1353 D6).
      sessionEpoch: Date.now(),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  const view = claimView(domain, {
    ...snapshot.data(),
    status: attached ? 'active' : 'verified',
  })
  return {
    claim: view,
    error: attached ? null : 'Vercel did not accept every name',
    status: attached ? 200 : 502,
    attachment: { domain: primary, results, attached },
  }
}

/**
 * Detach every name and drop the claim, in that order.
 *
 * Vercel first: a claim released while the name is still on the project is the
 * unindexed-name hole in the header, opened deliberately. If a detach fails the
 * claim is kept and the caller is told, so the name stays reserved to the org
 * that still holds it in Vercel.
 */
export async function releaseConsoleDomain(options: {
  orgId: string
  domain: string
}): Promise<{ released: boolean; results: WorkspaceDomainResult[]; error: string | null }> {
  const orgId = String(options?.orgId ?? '')
  const { domain } = validateConsoleDomain(options?.domain)
  if (!domain) return { released: false, results: [], error: 'Invalid domain' }
  const snapshot = await claimRef(domain).get()
  if (!snapshot.exists || snapshot.get('orgId') !== orgId) {
    return { released: false, results: [], error: 'No claim on that domain' }
  }
  const names: string[] = Array.isArray(snapshot.get('names'))
    ? snapshot.get('names')
    : [domain]

  const results: WorkspaceDomainResult[] = []
  for (const name of names) results.push(await detachProjectDomain(name))
  const clear = results.every(
    (result) =>
      result.outcome === 'detached' ||
      result.outcome === 'not-found' ||
      result.outcome === 'skipped',
  )
  if (!clear) {
    return {
      released: false,
      results,
      error: 'The domain is still attached to the project',
    }
  }
  const batch = firestore().batch()
  for (const name of names) {
    batch.delete(firestore().collection(CONSOLE_DOMAINS_COLLECTION).doc(name))
  }
  await batch.commit()
  return { released: true, results, error: null }
}

/**
 * Drop a claim that was never attached, without touching Vercel.
 *
 * The counterpart to claiming from the branding form: an org that clears or
 * changes `customConsoleDomain` must not leave its old reservation standing,
 * or it locks another org out of a name nobody is using. Deliberately refuses
 * once the claim has proved ownership or reached Vercel — releasing *that*
 * needs `releaseConsoleDomain`, because a claim dropped while the name is
 * still on the project is the unindexed-name hole in the header.
 */
export async function releasePendingConsoleDomain(options: {
  orgId: string
  domain: string
}): Promise<boolean> {
  const orgId = String(options?.orgId ?? '')
  const domain = normalizeConsoleDomain(options?.domain)
  if (!orgId || !domain) return false
  const snapshot = await claimRef(domain).get()
  if (!snapshot.exists || snapshot.get('orgId') !== orgId) return false
  if (snapshot.get('status') !== 'pending') return false
  if (snapshot.get('vercelState') === 'attached') return false
  const names: string[] = Array.isArray(snapshot.get('names'))
    ? snapshot.get('names')
    : [domain]
  const batch = firestore().batch()
  for (const name of names) {
    batch.delete(firestore().collection(CONSOLE_DOMAINS_COLLECTION).doc(name))
  }
  await batch.commit()
  return true
}

/**
 * Why a host may — or may not — be served the console (AGL-1099c).
 *
 * `reason` is not decoration. `unknown` and `degraded` both mean "serve it,
 * this gate has no opinion", and they mean it for opposite causes; every other
 * value means "refuse". Collapsing them into a boolean is how a lookup outage
 * would come to read the same as a revoked entitlement.
 */
export type ConsoleDomainReason =
  | 'active'
  | 'unknown'
  | 'no-org'
  | 'not-entitled'
  | 'not-active'
  | 'degraded'

export interface ConsoleDomainVerdict {
  /** A claim exists for this exact host. */
  known: boolean
  /** The console may be served here, pinned to `orgSlug`. */
  servable: boolean
  /**
   * Workspace slug of the owning org — where a refused visitor is sent, and
   * the org the path is rewritten under when servable. Never the `orgId`: a
   * verdict is read by an unauthenticated route.
   */
  orgSlug: string | null
  reason: ConsoleDomainReason
  /** The lookup could not be completed. Honour it, never cache it. */
  degraded: boolean
}

const UNKNOWN_VERDICT: ConsoleDomainVerdict = {
  known: false,
  servable: false,
  orgSlug: null,
  reason: 'unknown',
  degraded: false,
}

const DEGRADED_VERDICT: ConsoleDomainVerdict = {
  known: false,
  servable: false,
  orgSlug: null,
  reason: 'degraded',
  degraded: true,
}

/**
 * Stop serving a domain whose org no longer holds `whiteLabel`, and make it
 * stick.
 *
 * **This is the fail-closed half of the entitlement, and it is a write on a
 * read path on purpose.** Nothing in the codebase reacts to a plan change —
 * the Stripe webhook writes `plan` and says outright that entitlements resolve
 * at read time, which is sufficient for rendering and insufficient for a
 * hostname (AGL-1353 D7). Rather than add a fan-out to the webhook or a cron
 * that has to be believed, the first request to arrive after a downgrade
 * converts the read-time verdict into stored state: `status: 'suspended'` plus
 * a `sessionEpoch` bump, across **every** name the claim covers, so the twin
 * cannot outlive its primary.
 *
 * The epoch is what makes this more than cosmetic. A refusal that only lives
 * in a verdict leaves already-minted cookies valid; bumping the epoch is the
 * lever that invalidates them at our boundary (AGL-1353 D6).
 *
 * Deliberately NOT the inverse: re-upgrading does not re-activate. Activation
 * attaches names to Vercel and — until AGL-1378 resolves — depends on a manual
 * App Check allowlist entry, so it stays an explicit act through
 * `activateConsoleDomain`, never a side effect of a plan read.
 *
 * Never throws: a suspension that fails to persist still refuses this request,
 * and the next one tries again.
 */
async function suspendOnDowngrade(
  domain: string,
  snapshot: FirebaseFirestore.DocumentSnapshot,
): Promise<void> {
  const status = snapshot.get('status')
  if (status === 'suspended') return
  const names: string[] = Array.isArray(snapshot.get('names'))
    ? snapshot.get('names')
    : [domain]
  try {
    const batch = firestore().batch()
    for (const name of names) {
      batch.set(
        firestore().collection(CONSOLE_DOMAINS_COLLECTION).doc(name),
        {
          status: 'suspended',
          suspendedReason: 'entitlement',
          sessionEpoch: Date.now(),
          suspendedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }
    await batch.commit()
  } catch (error) {
    console.error('[console-domains] suspend on downgrade failed', error)
  }
}

/**
 * Host → org, for the middleware gate and the session-route boundary.
 *
 * **One host pins exactly one org.** That is enforced by the document being
 * keyed on the host and claimed transactionally (see the header), not by
 * anything here — this function only ever reads the pin, and there is no input
 * by which a caller can ask for a different org.
 *
 * The three "serve it anyway" answers, and why each is right:
 *
 * - **`unknown`** — no claim on this host. localhost, preview deployments and
 *   self-hosted installs all land here, and they must keep working. It is safe
 *   because of the detach ordering `releaseConsoleDomain` enforces: Vercel
 *   first, documents second, and the claim is kept if the detach fails. So a
 *   name the console project still answers for always has a document, and a
 *   name with no document cannot reach this deployment through the console
 *   project at all (AGL-1430's correspondence — do not break it).
 * - **`degraded`** — Firestore could not be reached. Fails OPEN, matching the
 *   workspace gate and for the reason AGL-1135 recorded: the Vercel domain
 *   allowlist is the boundary, and a customer's console going dark because a
 *   lookup timed out is worse than the residual exposure. Never cached.
 * - a claim that is `active` and entitled.
 *
 * Everything else refuses. In particular a `verified` claim is **not**
 * servable: until AGL-1378 clears, activation includes a manual App Check
 * allowlist entry, so "ownership proved" must never imply "serve it".
 */
export async function resolveConsoleDomain(
  host: string,
): Promise<ConsoleDomainVerdict> {
  const domain = normalizeConsoleDomain(host)
  if (!domain) return UNKNOWN_VERDICT

  let snapshot: FirebaseFirestore.DocumentSnapshot
  try {
    snapshot = await claimRef(domain).get()
  } catch {
    return DEGRADED_VERDICT
  }
  if (!snapshot.exists) return UNKNOWN_VERDICT

  const orgId = String(snapshot.get('orgId') ?? '')
  if (!orgId) return { ...UNKNOWN_VERDICT, known: true, reason: 'no-org' }

  let orgSnapshot: FirebaseFirestore.DocumentSnapshot
  try {
    orgSnapshot = await firestore().collection('orgs').doc(orgId).get()
  } catch {
    return DEGRADED_VERDICT
  }
  // A claim pointing at an org that no longer exists refuses, but is NOT
  // suspended: `checkEntitlement(undefined)` resolves to the free plan, so
  // writing a suspension off a missing document would be recording an
  // entitlement verdict that was never actually read (the loading-default
  // class this repo keeps hitting). Refuse now, decide when there is data.
  if (!orgSnapshot.exists) {
    return { ...UNKNOWN_VERDICT, known: true, reason: 'no-org' }
  }

  const org = orgSnapshot.data() as Partial<AglynOrgBilling> & { slug?: string }
  const orgSlug = String(org?.slug ?? '') || null

  if (!checkEntitlement(org, 'whiteLabel')) {
    await suspendOnDowngrade(domain, snapshot)
    return { known: true, servable: false, orgSlug, reason: 'not-entitled', degraded: false }
  }
  if (snapshot.get('status') !== 'active') {
    return { known: true, servable: false, orgSlug, reason: 'not-active', degraded: false }
  }
  return { known: true, servable: true, orgSlug, reason: 'active', degraded: false }
}

/**
 * The org a console domain belongs to, or null.
 *
 * Read-only, and used today only to refuse a `customConsoleDomain` that another
 * org already holds. Routing reads `resolveConsoleDomain` instead, which asks
 * the entitlement question this one does not.
 */
export async function getConsoleDomainClaim(
  domain: string,
): Promise<{ orgId: string; status: ConsoleDomainStatus } | null> {
  const normalized = normalizeConsoleDomain(domain)
  if (!normalized) return null
  const snapshot = await claimRef(normalized).get()
  if (!snapshot.exists) return null
  return {
    orgId: String(snapshot.get('orgId') ?? ''),
    status: (snapshot.get('status') as ConsoleDomainStatus) ?? 'pending',
  }
}
