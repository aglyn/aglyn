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

/*==========================================
 * DOMAIN OWNERSHIP CLAIMS (AGL-3974, parent AGL-3973).
 *
 * "This workspace proved it controls example.com." A site import pulls a
 * person's existing website into Aglyn, and an import is a one-click clone
 * of whatever address is typed, so the content and images are pulled only
 * after the workspace has proved the domain is its own. Payment alone is not
 * a control: the first paying customer was a phisher on a stolen card.
 *
 * ## Why this is not the SSO claim
 *
 * `orgs/{orgId}/ssoDomains/{domain}` (sso-provisioning.ts) is one org per
 * domain, because a verified SSO domain ROUTES every sign-in on it. Owning a
 * site is not exclusive in that way: an agency and its client may both hold
 * a proof for the client's domain, and neither proof routes anything. So the
 * claim here is keyed by (org, domain) and carries no global index:
 * `orgs/{orgId}/domainOwnershipClaims/{domain}`. Rules: an owner or admin of
 * the org reads it (it holds the token they publish); only this module, over
 * the Admin SDK, writes it.
 *
 * ## Three ways to prove it, any one of which is enough
 *
 * - **DNS**: a TXT record `aglyn-domain-verification=<token>` at
 *   `_aglyn-challenge.<domain>`, the same host and prefix SSO uses, matched as
 *   a whole record (`recordsProveOwnership`).
 * - **Meta tag**: `<meta name="aglyn-site-verification" content="<token>">` on
 *   the home page, read by the caller through the site-import crawler's safe
 *   fetch and handed in as `readVerificationMeta`; this module never opens a
 *   socket to a site.
 * - **Email**: a one-time code sent to an address AT the domain (the person
 *   types owner@theirdomain.com). Reading mail there is control of the
 *   domain's mail. The code is stored only as an HMAC under the server's
 *   signing secret, expires in {@link DOMAIN_OWNERSHIP_CODE_TTL_MS}, and is
 *   burned after {@link DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS} wrong tries. The
 *   HMAC matters because an owner or admin can read the claim document: a
 *   plain hash of a six-digit code is reversed by trying a million values.
 *
 * ## Three answers, never two
 *
 * Every check answers `proven`, `not-yet` or `unreachable`. `unreachable`
 * (nobody answered the DNS question, the home page could not be read) is
 * evidence of nothing, the same third state `dns-probe.ts` exists for, and it
 * never demotes a proof already recorded.
 *=========================================*/

import { createHmac, randomBytes, randomInt } from 'crypto'
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { lookalikeBrandForHost } from '@aglyn/shared-util-email/outbound-phishing-screen'
import { lookupTxt as defaultLookupTxt, type DnsLookupResult } from './dns-probe'
import firebaseAdmin from './firebase-admin'
import { tokenSigningSecret } from './media-signing'
import { safeEqual } from './safe-equal'
import {
  challengeValue,
  isPublicEmailDomain,
  recordsProveOwnership,
  SSO_CHALLENGE_PREFIX,
} from './sso-provisioning'

/** The subcollection under `orgs/{orgId}`; the document id is the domain. */
export const DOMAIN_OWNERSHIP_CLAIMS_COLLECTION = 'domainOwnershipClaims'

/** The `name` of the home page meta tag that carries the token. */
export const DOMAIN_OWNERSHIP_META_NAME = 'aglyn-site-verification'

/** The system email that carries the one-time code. */
export const DOMAIN_OWNERSHIP_CODE_EMAIL_KEY = 'domain-ownership-code'

/** How long an emailed code works. */
export const DOMAIN_OWNERSHIP_CODE_TTL_MS = 15 * 60 * 1000

/** Wrong codes allowed before the code is burned and a new one must be sent. */
export const DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS = 5

/** The least time between two codes for one claim. */
export const DOMAIN_OWNERSHIP_CODE_RESEND_MS = 60 * 1000

/** Codes one workspace may send in an hour, across every claim. */
export const DOMAIN_OWNERSHIP_CODES_PER_ORG_PER_HOUR = 10

/** Codes one address may receive in an hour, from every workspace. */
export const DOMAIN_OWNERSHIP_CODES_PER_ADDRESS_PER_HOUR = 5

/**
 * How long a proof stands before an import asks for it again. A domain can
 * lapse and be bought by someone else; a month is short enough that the new
 * owner's content is not imported on the old owner's proof.
 */
export const DOMAIN_OWNERSHIP_PROOF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/
const EMAIL_LOCAL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/i

export type DomainOwnershipMethod = 'dns' | 'meta' | 'email'

/** What one check found. `unreachable` is evidence in neither direction. */
export type DomainOwnershipCheckStatus = 'proven' | 'not-yet' | 'unreachable'

/** The stored document. Times are epoch milliseconds. */
export interface DomainOwnershipClaimDoc {
  domain: string
  token: string
  status: 'pending' | 'proven'
  createdAt: number
  createdBy: string
  provenMethod?: DomainOwnershipMethod
  provenAt?: number
  /** The record host, the page, or the address the proof came from. */
  provenDetail?: string
  lastCheckedAt?: number
  lastChecks?: Partial<Record<DomainOwnershipMethod, DomainOwnershipCheckStatus>>
  emailCode?: {
    address: string
    /** HMAC-SHA256 of the code, keyed by the signing secret. Never the code. */
    hash: string
    sentAt: number
    expiresAt: number
    attempts: number
  } | null
}

/** What the console is shown: the instructions, never the code's hash. */
export interface DomainOwnershipClaimView {
  domain: string
  status: 'pending' | 'proven'
  /** False once a proof is older than {@link DOMAIN_OWNERSHIP_PROOF_MAX_AGE_MS}. */
  current: boolean
  provenMethod: DomainOwnershipMethod | null
  provenAt: number | null
  provenDetail: string | null
  lastChecks: Partial<Record<DomainOwnershipMethod, DomainOwnershipCheckStatus>>
  dns: { host: string; type: 'TXT'; value: string }
  meta: { name: string; content: string; tag: string }
  email: {
    /** Addresses must end in `@<domain>`. */
    domain: string
    pendingAddress: string | null
    expiresAt: number | null
    attemptsLeft: number | null
  }
}

export interface DomainOwnershipCheckResult {
  method: DomainOwnershipMethod
  status: DomainOwnershipCheckStatus
  /** A sentence for the person: what was looked at, and what to do next. */
  message: string
  claim: DomainOwnershipClaimView
}

/** `{ value, error }`, both keys always present, as `validateSsoDomain` does. */
export interface OwnershipDomainCheck {
  domain: string | null
  error: string | null
}

/** A home page's `aglyn-site-verification` values, read by the caller. */
export type ReadVerificationMeta = (
  domain: string,
) => Promise<{ answered: boolean; values: string[]; url?: string }>

/** Sends the code; the default is {@link deliverDomainOwnershipCode}. */
export type DeliverDomainOwnershipCode = (input: {
  orgId: string
  org: Record<string, unknown> | null
  domain: string
  address: string
  code: string
  expiresInMinutes: number
}) => Promise<{ sent: boolean; status?: number; error?: string }>

export interface DomainOwnershipDeps {
  firestore?: FirebaseFirestore.Firestore
  lookupTxt?: (host: string) => Promise<DnsLookupResult<string>>
  readVerificationMeta?: ReadVerificationMeta
  deliverCode?: DeliverDomainOwnershipCode
  now?: () => number
  /** The HMAC key for codes; the default is `TOKEN_SIGNING_SECRET`. */
  secret?: () => string
  mintToken?: () => string
  mintCode?: () => string
}

/*------------------------------------------
 * Pure helpers
 *-----------------------------------------*/

/**
 * The domain a claim is about: lowercased, any scheme, path, port or address
 * prefix a person pasted removed, and a leading `www.` folded into the bare
 * name, because the site's two names are one site to its owner and the
 * crawler treats them as one origin.
 */
export function normalizeOwnershipDomain(input: string): OwnershipDomainCheck {
  let raw = String(input ?? '').trim().toLowerCase()
  const at = raw.lastIndexOf('@')
  if (at >= 0 && !raw.includes('/')) raw = raw.slice(at + 1)
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  raw = raw.split(/[/?#]/)[0] ?? ''
  raw = raw.replace(/:\d+$/, '').replace(/\.+$/, '').replace(/^www\./, '')
  if (!raw || !DOMAIN_PATTERN.test(raw)) {
    return { domain: null, error: 'Enter your website’s address, for example example.com' }
  }
  if (isPublicEmailDomain(raw)) {
    return {
      domain: null,
      error: 'That is an email provider’s domain, not a website you own.',
    }
  }
  if (lookalikeBrandForHost(raw)) {
    return { domain: null, error: 'That address looks like another company’s website.' }
  }
  return { domain: raw, error: null }
}

/** The TXT record host for a domain. */
export function domainOwnershipRecordHost(domain: string): string {
  return `${SSO_CHALLENGE_PREFIX}.${domain}`
}

/** The meta tag a person pastes into their home page's `<head>`. */
export function domainOwnershipMetaTag(token: string): string {
  return `<meta name="${DOMAIN_OWNERSHIP_META_NAME}" content="${token}">`
}

/** Exact, whole-value match, for the reason `recordsProveOwnership` gives. */
export function metaValuesProveOwnership(values: readonly string[], token: string): boolean {
  if (!token) return false
  return values.some((value) => safeEqual(String(value ?? '').trim(), token))
}

/**
 * The address a code may go to: a plausible mailbox whose domain IS the
 * claim's domain (the `www.` twin included), and nothing else. A parent or a
 * sibling domain proves nothing about this one.
 */
export function ownershipEmailAddress(input: string, domain: string): string | null {
  const address = String(input ?? '').trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at <= 0) return null
  const local = address.slice(0, at)
  const host = address.slice(at + 1)
  if (!EMAIL_LOCAL_PATTERN.test(local) || local.startsWith('.') || local.endsWith('.')) {
    return null
  }
  if (host !== domain && host !== `www.${domain}`) return null
  return address
}

/** HMAC of a code, bound to the claim and the address it was sent to. */
export function hashOwnershipCode(
  secret: string,
  input: { orgId: string; domain: string; address: string; code: string },
): string {
  return createHmac('sha256', secret)
    .update(`domain-ownership-code\n${input.orgId}\n${input.domain}\n${input.address}\n${input.code}`)
    .digest('hex')
}

/** Whether a stored proof is still one an import may rely on. */
export function isOwnershipProofCurrent(
  claim: Pick<DomainOwnershipClaimDoc, 'status' | 'provenAt'> | null | undefined,
  now: number,
): boolean {
  if (!claim || claim.status !== 'proven' || typeof claim.provenAt !== 'number') return false
  return now - claim.provenAt <= DOMAIN_OWNERSHIP_PROOF_MAX_AGE_MS
}

export function domainOwnershipClaimView(
  claim: DomainOwnershipClaimDoc,
  now: number,
): DomainOwnershipClaimView {
  const code = claim.emailCode ?? null
  const codeLive = Boolean(code && code.expiresAt > now && code.attempts < DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS)
  return {
    domain: claim.domain,
    status: claim.status,
    current: isOwnershipProofCurrent(claim, now),
    provenMethod: claim.provenMethod ?? null,
    provenAt: claim.provenAt ?? null,
    provenDetail: claim.provenDetail ?? null,
    lastChecks: claim.lastChecks ?? {},
    dns: {
      host: domainOwnershipRecordHost(claim.domain),
      type: 'TXT',
      value: challengeValue(claim.token),
    },
    meta: {
      name: DOMAIN_OWNERSHIP_META_NAME,
      content: claim.token,
      tag: domainOwnershipMetaTag(claim.token),
    },
    email: {
      domain: claim.domain,
      pendingAddress: codeLive ? code?.address ?? null : null,
      expiresAt: codeLive ? code?.expiresAt ?? null : null,
      attemptsLeft: codeLive && code ? DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS - code.attempts : null,
    },
  }
}

/*------------------------------------------
 * Firestore
 *-----------------------------------------*/

function resolved(deps: DomainOwnershipDeps) {
  return {
    firestore: deps.firestore ?? firebaseAdmin.app().firestore(),
    lookupTxt: deps.lookupTxt ?? defaultLookupTxt,
    now: deps.now ?? Date.now,
    secret: deps.secret ?? tokenSigningSecret,
    mintToken: deps.mintToken ?? (() => randomBytes(24).toString('base64url')),
    mintCode: deps.mintCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0')),
  }
}

function claimRef(firestore: FirebaseFirestore.Firestore, orgId: string, domain: string) {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(DOMAIN_OWNERSHIP_CLAIMS_COLLECTION)
    .doc(domain)
}

async function readClaim(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  domain: string,
): Promise<DomainOwnershipClaimDoc | null> {
  const snapshot = await claimRef(firestore, orgId, domain).get()
  return snapshot.exists ? (snapshot.data() as DomainOwnershipClaimDoc) : null
}

/**
 * Start (or re-read) a claim. Idempotent: an existing claim keeps its token,
 * because a new one would break a record or tag the person already published.
 */
export async function issueDomainOwnershipClaim(
  orgId: string,
  rawDomain: string,
  uid: string,
  deps: DomainOwnershipDeps = {},
): Promise<{ claim: DomainOwnershipClaimView | null; error: string | null }> {
  const { domain, error } = normalizeOwnershipDomain(rawDomain)
  if (!domain) return { claim: null, error }
  const io = resolved(deps)
  const ref = claimRef(io.firestore, orgId, domain)
  const existing = await readClaim(io.firestore, orgId, domain)
  if (existing?.token) return { claim: domainOwnershipClaimView(existing, io.now()), error: null }
  const claim: DomainOwnershipClaimDoc = {
    domain,
    token: io.mintToken(),
    status: 'pending',
    createdAt: io.now(),
    createdBy: uid,
    lastChecks: {},
    emailCode: null,
  }
  await ref.set(claim)
  return { claim: domainOwnershipClaimView(claim, io.now()), error: null }
}

/** Every claim the org holds, newest first. */
export async function listDomainOwnershipClaims(
  orgId: string,
  deps: DomainOwnershipDeps = {},
): Promise<DomainOwnershipClaimView[]> {
  const io = resolved(deps)
  const snapshot = await io.firestore
    .collection('orgs')
    .doc(orgId)
    .collection(DOMAIN_OWNERSHIP_CLAIMS_COLLECTION)
    .get()
  return snapshot.docs
    .map((doc) => doc.data() as DomainOwnershipClaimDoc)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .map((claim) => domainOwnershipClaimView(claim, io.now()))
}

/**
 * Whether the org holds a CURRENT proof for the domain: the one question an
 * import asks before it pulls a page or an image.
 */
export async function isDomainOwnershipProven(
  orgId: string,
  rawDomain: string,
  deps: DomainOwnershipDeps = {},
): Promise<boolean> {
  const { domain } = normalizeOwnershipDomain(rawDomain)
  if (!domain) return false
  const io = resolved(deps)
  return isOwnershipProofCurrent(await readClaim(io.firestore, orgId, domain), io.now())
}

/** Writes one check's outcome; a proof is only ever added, never removed. */
async function recordCheck(
  io: ReturnType<typeof resolved>,
  orgId: string,
  claim: DomainOwnershipClaimDoc,
  method: DomainOwnershipMethod,
  status: DomainOwnershipCheckStatus,
  detail: string,
  extra: Partial<DomainOwnershipClaimDoc> = {},
): Promise<DomainOwnershipClaimDoc> {
  const now = io.now()
  const next: DomainOwnershipClaimDoc = {
    ...claim,
    ...extra,
    lastCheckedAt: now,
    lastChecks: { ...(claim.lastChecks ?? {}), [method]: status },
    ...(status === 'proven'
      ? { status: 'proven', provenMethod: method, provenAt: now, provenDetail: detail }
      : {}),
  }
  await claimRef(io.firestore, orgId, claim.domain).set(next)
  return next
}

const CHECK_MESSAGES: Record<'dns' | 'meta', Record<DomainOwnershipCheckStatus, string>> = {
  dns: {
    proven: 'Found the DNS record. Your site is verified.',
    'not-yet':
      'The DNS record is not there yet. Changes can take a few minutes to an hour to appear; try again soon.',
    unreachable: 'DNS did not answer just now. Nothing has changed; try again in a minute.',
  },
  meta: {
    proven: 'Found the tag on your home page. Your site is verified.',
    'not-yet':
      'The tag is not on your home page yet. Publish the page with the tag in its head section, then try again.',
    unreachable: 'Your home page could not be read just now. Nothing has changed; try again in a minute.',
  },
}

/** Look for the DNS record or the meta tag now. */
export async function checkDomainOwnership(
  orgId: string,
  rawDomain: string,
  method: 'dns' | 'meta',
  deps: DomainOwnershipDeps = {},
): Promise<{ result: DomainOwnershipCheckResult | null; error: string | null }> {
  const { domain, error } = normalizeOwnershipDomain(rawDomain)
  if (!domain) return { result: null, error }
  const io = resolved(deps)
  const claim = await readClaim(io.firestore, orgId, domain)
  if (!claim?.token) return { result: null, error: 'Add the site first.' }

  let status: DomainOwnershipCheckStatus
  let detail: string
  if (method === 'dns') {
    detail = domainOwnershipRecordHost(domain)
    const lookup = await io.lookupTxt(detail).catch(() => ({ answered: false, records: [] }))
    status = !lookup.answered
      ? 'unreachable'
      : recordsProveOwnership(lookup.records, claim.token)
        ? 'proven'
        : 'not-yet'
  } else {
    detail = `https://${domain}/`
    const read = deps.readVerificationMeta
    const found = read
      ? await read(domain).catch(() => ({ answered: false, values: [] as string[], url: undefined }))
      : { answered: false, values: [] as string[], url: undefined }
    if (found.url) detail = found.url
    status = !found.answered
      ? 'unreachable'
      : metaValuesProveOwnership(found.values, claim.token)
        ? 'proven'
        : 'not-yet'
  }
  const next = await recordCheck(io, orgId, claim, method, status, detail)
  return {
    error: null,
    result: {
      method,
      status,
      message: CHECK_MESSAGES[method][status],
      claim: domainOwnershipClaimView(next, io.now()),
    },
  }
}

/** Email a one-time code to an address at the domain. */
export async function sendDomainOwnershipCode(
  orgId: string,
  rawDomain: string,
  rawAddress: string,
  context: { org: Record<string, unknown> | null },
  deps: DomainOwnershipDeps = {},
): Promise<{ claim: DomainOwnershipClaimView | null; error: string | null; status: number }> {
  const { domain, error } = normalizeOwnershipDomain(rawDomain)
  if (!domain) return { claim: null, error, status: 400 }
  const io = resolved(deps)
  const claim = await readClaim(io.firestore, orgId, domain)
  if (!claim?.token) return { claim: null, error: 'Add the site first.', status: 404 }
  const address = ownershipEmailAddress(rawAddress, domain)
  if (!address) {
    return {
      claim: null,
      error: `Enter an email address that ends in @${domain}.`,
      status: 400,
    }
  }
  const now = io.now()
  if (claim.emailCode && now - claim.emailCode.sentAt < DOMAIN_OWNERSHIP_CODE_RESEND_MS) {
    return { claim: null, error: 'A code was just sent. Wait a minute before asking for another.', status: 429 }
  }
  const code = io.mintCode()
  const deliver = deps.deliverCode ?? deliverDomainOwnershipCode
  const sent = await deliver({
    orgId,
    org: context.org,
    domain,
    address,
    code,
    expiresInMinutes: Math.round(DOMAIN_OWNERSHIP_CODE_TTL_MS / 60_000),
  })
  if (!sent.sent) {
    return { claim: null, error: sent.error ?? 'The code could not be sent.', status: sent.status ?? 502 }
  }
  const next: DomainOwnershipClaimDoc = {
    ...claim,
    emailCode: {
      address,
      hash: hashOwnershipCode(io.secret(), { orgId, domain, address, code }),
      sentAt: now,
      expiresAt: now + DOMAIN_OWNERSHIP_CODE_TTL_MS,
      attempts: 0,
    },
  }
  await claimRef(io.firestore, orgId, domain).set(next)
  return { claim: domainOwnershipClaimView(next, now), error: null, status: 200 }
}

/**
 * Check a code the person typed. Counted in a transaction, so parallel
 * guesses cannot get past the attempt limit between a read and a write.
 */
export async function confirmDomainOwnershipCode(
  orgId: string,
  rawDomain: string,
  rawCode: string,
  deps: DomainOwnershipDeps = {},
): Promise<{ result: DomainOwnershipCheckResult | null; error: string | null }> {
  const { domain, error } = normalizeOwnershipDomain(rawDomain)
  if (!domain) return { result: null, error }
  const io = resolved(deps)
  const ref = claimRef(io.firestore, orgId, domain)
  const typed = String(rawCode ?? '').replace(/\s+/g, '')
  const outcome = await io.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const claim = snapshot.exists ? (snapshot.data() as DomainOwnershipClaimDoc) : null
    if (!claim?.token) return { claim: null, status: null, message: 'Add the site first.' }
    const now = io.now()
    const code = claim.emailCode
    if (!code) {
      return { claim, status: 'not-yet' as const, message: 'Send a code first.' }
    }
    if (code.expiresAt <= now || code.attempts >= DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS) {
      return {
        claim,
        status: 'not-yet' as const,
        message: 'That code has expired. Send a new one.',
      }
    }
    const expected = code.hash
    const presented = /^\d{6}$/.test(typed)
      ? hashOwnershipCode(io.secret(), { orgId, domain, address: code.address, code: typed })
      : ''
    if (presented && safeEqual(presented, expected)) {
      const next: DomainOwnershipClaimDoc = {
        ...claim,
        status: 'proven',
        provenMethod: 'email',
        provenAt: now,
        provenDetail: code.address,
        lastCheckedAt: now,
        lastChecks: { ...(claim.lastChecks ?? {}), email: 'proven' },
        emailCode: null,
      }
      tx.set(ref, next)
      return { claim: next, status: 'proven' as const, message: 'Code accepted. Your site is verified.' }
    }
    const attempts = code.attempts + 1
    const left = DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS - attempts
    const next: DomainOwnershipClaimDoc = {
      ...claim,
      lastCheckedAt: now,
      lastChecks: { ...(claim.lastChecks ?? {}), email: 'not-yet' },
      emailCode: { ...code, attempts },
    }
    tx.set(ref, next)
    return {
      claim: next,
      status: 'not-yet' as const,
      message:
        left > 0
          ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right, and it can no longer be used. Send a new one.',
    }
  })
  if (!outcome.claim || !outcome.status) return { result: null, error: outcome.message }
  return {
    error: null,
    result: {
      method: 'email',
      status: outcome.status,
      message: outcome.message,
      claim: domainOwnershipClaimView(outcome.claim, io.now()),
    },
  }
}

/*------------------------------------------
 * The email
 *-----------------------------------------*/

/**
 * Sends the `domain-ownership-code` system email in the workspace's brand,
 * after two ceilings: per workspace, so one cannot mail a domain's whole
 * staff, and per address, so no address is flooded from many workspaces.
 */
export const deliverDomainOwnershipCode: DeliverDomainOwnershipCode = async (input) => {
  if (!isEmailConfigured()) {
    return { sent: false, status: 501, error: 'Email is not configured on this deployment.' }
  }
  const { consumeRateLimit } = await import('./rate-limit-store')
  const perOrg = await consumeRateLimit(`domain-ownership-code:${input.orgId}`, {
    limit: DOMAIN_OWNERSHIP_CODES_PER_ORG_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  })
  if (!perOrg.allowed) {
    return { sent: false, status: 429, error: 'Too many codes sent. Try again in an hour.' }
  }
  const perAddress = await consumeRateLimit(`domain-ownership-code-target:${input.address}`, {
    limit: DOMAIN_OWNERSHIP_CODES_PER_ADDRESS_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  })
  if (!perAddress.allowed) {
    return { sent: false, status: 429, error: 'Too many codes for that address. Try again later.' }
  }
  const { renderSystemEmailContent, systemEmailBrand } = await import('./render-system-email')
  const branding = resolveBrandingProfile((input.org ?? null) as never)
  const workspace = String(input.org?.['name'] ?? '').trim() || 'A workspace'
  const text = [
    `${workspace} asked to confirm that ${input.domain} belongs to them, so they can bring the ` +
      `site into ${branding.productName}.`,
    '',
    `Your code: ${input.code}`,
    '',
    `It works for ${input.expiresInMinutes} minutes. Type it where you asked for it.`,
    '',
    'If you did not ask for this, ignore this email. Nothing is copied from your site without the code.',
  ].join('\n')
  const content = await renderSystemEmailContent(
    DOMAIN_OWNERSHIP_CODE_EMAIL_KEY,
    {
      'org.name': workspace,
      domain: input.domain,
      code: input.code,
      expiresInMinutes: String(input.expiresInMinutes),
    },
    systemEmailBrand(input.org ?? null),
    { subject: `Your code to verify ${input.domain}`, text },
  )
  const result = await sendEmail({
    to: input.address,
    ...content,
    fromName: branding.fromName,
    context: DOMAIN_OWNERSHIP_CODE_EMAIL_KEY,
  })
  if (!result.sent) {
    return { sent: false, status: 502, error: 'The code could not be sent. Try again.' }
  }
  const { meterOrgEmail } = await import('./email-metering')
  await meterOrgEmail(input.orgId).catch(() => undefined)
  return { sent: true }
}
