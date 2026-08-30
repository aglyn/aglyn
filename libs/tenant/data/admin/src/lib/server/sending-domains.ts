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
 * CUSTOM SENDING DOMAINS — durable half.
 *
 * The record, the DNS lookups and the status transitions. The decisions all
 * live in `@aglyn/shared-util-email`'s `sending-domain.ts`, which is pure;
 * this module is the I/O around them, and it holds no policy of its own.
 *
 * ## Per-org record, per-host selection
 *
 * The record is at `orgs/{orgId}/sendingDomains/{domain}`, alongside
 * `orgs/{orgId}/ssoDomains/{domain}` and for the same reason: proving control
 * of a zone is a property of the ORG that proved it, and an agency running
 * four sites on `client.com` should publish the DKIM record once rather than
 * four times.
 *
 * Which identity a given site SENDS on is a separate per-host field,
 * `hosts/{hostId}.sendingDomain`. That split is what answers the two halves of
 * the question at once: per-org verification keeps the DNS chore down, and a
 * per-host selection is what an agency's client actually wants, because the
 * `From:` their recipients see belongs to the site, not to the agency.
 *
 * ## Reads are cheap on purpose
 *
 * `resolveHostSendingIdentity` is on the path of a campaign send, so it reads
 * the host document the caller already has and at most ONE org subcollection
 * document. It never scans, never lists, and never touches DNS — the standing
 * rule against unrequested reads on a hot path applies here more than most,
 * because a campaign resolves an identity once for thousands of messages.
 *
 * ## Why the provider call is not in here
 *
 * Issuing a DKIM key means creating a domain at the mail provider, which needs
 * a credential that can create things — a different one from the send-only
 * `RESEND_API_KEY`, which is exactly why `email-health.ts` can use the domains
 * endpoint as a read-only credential probe.
 *
 * That credential belongs to the console alone, so the driver that reads it
 * lives in the console app — `apps/console/utils/server/` — and not here.
 * **This library is imported by the tenant runtime**, which
 * serves untrusted published sites; a module it can import is a module whose
 * environment read is one bug away from being reachable from a site request.
 * A file in `apps/console` is not importable from the tenant app at all —
 * there is no path mapping to it and nx's module boundaries forbid app→app —
 * so the isolation is structural rather than a convention.
 *
 * What stays here is the seam: {@link recordIssuedSendingDomain} takes what a
 * provider returned, and {@link recordSendingDomainIssueFailure} takes what it
 * refused. `requestSendingDomain` still stops at `requested`, and a domain
 * stopped there refuses sends, which is the correct behavior for a domain that
 * has no signing key.
 */

import {
  assessDmarc,
  assessSendingRecords,
  normalizeLocalPart,
  normalizeSendingDomain,
  resolveSendingIdentity,
  safeProviderDetail,
  SENDING_SUBDOMAIN,
  sendingDnsRecords,
  sendingDomainRequiredRecords,
  sendingRecordKey,
  validateSendingDomain,
  type DmarcAssessment,
  type SendingDnsRecord,
  type SendingDomainRecord,
  type SendingDomainSelection,
  type SendingIdentityVerdict,
} from '@aglyn/shared-util-email'
import firebaseAdmin from './firebase-admin'
import { lookupMx, lookupTxt } from './dns-probe'

const firestore = () => firebaseAdmin.app().firestore()

/** Subcollection under the owning org. */
export const SENDING_DOMAINS_COLLECTION = 'sendingDomains'

const domainRef = (orgId: string, domain: string) =>
  firestore()
    .collection('orgs')
    .doc(orgId)
    .collection(SENDING_DOMAINS_COLLECTION)
    .doc(domain)

/**
 * The DKIM selector issued to one org for one domain.
 *
 * Includes the org id so two orgs verifying the same name occupy different
 * record names. Without that they would share `resend._domainkey.<domain>`,
 * and whichever verified second would overwrite the first — or, worse, inherit
 * the first's verification without ever publishing anything.
 */
export function sendingDkimSelector(orgId: string): string {
  const safe = String(orgId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24)
  return `aglyn${safe ? `-${safe}` : ''}`
}

/** Both keys always present, one always null — `strictNullChecks` is off. */
export interface SendingDomainResult {
  record: SendingDomainRecord | null
  error: string | null
  /** The HTTP status a route should answer with. */
  status: number
}

function readRecord(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): SendingDomainRecord | null {
  if (!snapshot?.exists) return null
  const data = snapshot.data() ?? {}
  return {
    domain: String(data.domain ?? snapshot.id),
    status: data.status ?? 'requested',
    dkimSelector: String(data.dkimSelector ?? ''),
    dkimPublicKey: data.dkimPublicKey ?? null,
    returnPathHost: data.returnPathHost ?? null,
    providerDomainId: data.providerDomainId ?? null,
    createdAtMs: Number(data.createdAtMs) || null,
    verifiedAtMs: Number(data.verifiedAtMs) || null,
    lastCheckedAtMs: Number(data.lastCheckedAtMs) || null,
    lastIssueError: data.lastIssueError ?? null,
    lastIssueAtMs: Number(data.lastIssueAtMs) || null,
    lastMissing: Array.isArray(data.lastMissing) ? data.lastMissing : null,
  }
}

/**
 * Start (or re-read) a claim on a sending domain.
 *
 * Idempotent, and deliberately non-destructive on a re-request: an existing
 * record keeps its selector and its key, because reissuing either would
 * invalidate a record the customer may already have published and turn a
 * working setup into a mysterious failure. This mirrors `issueDomainClaim`.
 */
export async function requestSendingDomain(options: {
  orgId: string
  domain: string
}): Promise<SendingDomainResult> {
  const { domain, error } = validateSendingDomain(options?.domain)
  if (!domain) return { record: null, error, status: 400 }
  if (!options?.orgId) {
    return { record: null, error: 'Missing organization', status: 400 }
  }

  const ref = domainRef(options.orgId, domain)
  const existing = await ref.get()
  if (existing.exists) {
    return { record: readRecord(existing), error: null, status: 200 }
  }

  const record: SendingDomainRecord = {
    domain,
    status: 'requested',
    dkimSelector: sendingDkimSelector(options.orgId),
    dkimPublicKey: null,
    returnPathHost: null,
    createdAtMs: Date.now(),
  }
  await ref.set(record, { merge: true })
  return { record, error: null, status: 201 }
}

/**
 * Record the key the mail provider issued, moving the domain to
 * `records-issued` so the customer has something to publish.
 *
 * Separated from {@link requestSendingDomain} because it needs a credential
 * that may not exist. Nothing here calls the provider: the caller supplies
 * what it was given, so a deployment whose key cannot create domains still has
 * a working path — an operator can complete this step by hand — and this
 * module never grows a dependency on a credential it cannot assume. The
 * console holds the credential and the driver that uses it; this library,
 * which the tenant runtime also imports, holds neither.
 *
 * ## `records-issued` is a promise that records exist
 *
 * The write is refused unless the resulting record actually yields a DKIM
 * record with a value. The alternative is the failure this whole feature is
 * arranged against: a status saying the customer has records to publish, next
 * to a records table with an empty DKIM row, which cannot ever verify and
 * reads to the customer as our bug.
 *
 * ## An issued key is never overwritten
 *
 * A second call carrying a DIFFERENT key is refused rather than applied. The
 * customer may already have published the first one, and replacing it turns a
 * finished setup into a domain that silently stops signing. Re-recording the
 * SAME key is a no-op and succeeds, so a retried request is safe.
 *
 * The SELECTOR, by contrast, comes from the provider when it supplies one:
 * the record a customer publishes has to be the name the provider will sign
 * under, and `sendingDkimSelector` only proposes it.
 */
export async function recordIssuedSendingDomain(options: {
  orgId: string
  domain: string
  dkimPublicKey: string
  /** The selector the provider issued, when it chose its own. */
  dkimSelector?: string
  returnPathHost?: string
  providerDomainId?: string
}): Promise<SendingDomainResult> {
  const domain = normalizeSendingDomain(options?.domain)
  const key = String(options?.dkimPublicKey ?? '').trim()
  if (!domain) {
    return { record: null, error: 'Missing domain', status: 400 }
  }

  const ref = domainRef(options.orgId, domain)
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    return { record: null, error: 'No claim on that domain', status: 404 }
  }

  const existing = readRecord(snapshot)
  const held = String(existing?.dkimPublicKey ?? '').trim()
  if (held && held !== key) {
    return {
      record: existing,
      error:
        'That domain already has an issued signing key. Release the domain ' +
        'and add it again to start over.',
      status: 409,
    }
  }

  const selector =
    String(options?.dkimSelector ?? '').trim() || existing?.dkimSelector || ''
  const returnPathHost = options.returnPathHost || existing?.returnPathHost

  /*
   * The only thing standing between a caller and `records-issued`, and it is
   * asked of the SAME function that prints the records for the customer and
   * that the verifier compares against — not a truthiness check on the key,
   * which would be this write's private opinion of what "publishable" means
   * and could agree with nothing else.
   */
  const issued = sendingDomainRequiredRecords({
    domain,
    dkimSelector: selector,
    dkimPublicKey: key,
    returnPathHost,
  })
  if (!issued.some((entry) => entry.purpose === 'dkim')) {
    return {
      record: existing,
      error: 'Refusing to issue records for a domain with no publishable DKIM record',
      status: 400,
    }
  }

  await ref.set(
    {
      status: 'records-issued',
      dkimPublicKey: key,
      ...(selector ? { dkimSelector: selector } : {}),
      ...(options.returnPathHost
        ? { returnPathHost: options.returnPathHost }
        : {}),
      ...(options.providerDomainId
        ? { providerDomainId: String(options.providerDomainId) }
        : {}),
      // A previous failure is not part of the record once it succeeded.
      lastIssueError: firebaseAdmin.firestore.FieldValue.delete(),
    },
    { merge: true },
  )
  return { record: readRecord(await ref.get()), error: null, status: 200 }
}

/**
 * Record that the provider did not issue anything, WITHOUT moving the status.
 *
 * The point of a separate function is that there is no path from a provider
 * failure to `records-issued`. A `4xx` or `5xx` means no key exists, so the
 * domain stays `requested` — where it refuses sends, which is correct for a
 * domain that cannot sign — and carries a reason an admin can act on instead
 * of appearing to have finished.
 *
 * `detail` is a short code the caller built from a fixed vocabulary, never a
 * provider's response body. {@link safeProviderDetail} is the second line:
 * an `Authorization` header echoed back by a provider must not become a
 * Firestore document.
 */
export async function recordSendingDomainIssueFailure(options: {
  orgId: string
  domain: string
  detail: string
}): Promise<void> {
  const domain = normalizeSendingDomain(options?.domain)
  if (!options?.orgId || !domain) return
  const ref = domainRef(options.orgId, domain)
  if (!(await ref.get()).exists) return
  await ref.set(
    {
      lastIssueError: safeProviderDetail(options.detail) || 'unknown',
      lastIssueAtMs: Date.now(),
    },
    { merge: true },
  )
}

export interface SendingDomainView {
  record: SendingDomainRecord
  /** Exactly what the customer must publish. */
  records: SendingDnsRecord[]
  /** Their DMARC policy, read and never written. */
  dmarc: DmarcAssessment | null
}

/** One domain plus the records it needs, for a surface that shows both. */
export async function getSendingDomain(
  orgId: string,
  rawDomain: string,
): Promise<SendingDomainView | null> {
  const domain = normalizeSendingDomain(rawDomain)
  if (!orgId || !domain) return null
  const record = readRecord(await domainRef(orgId, domain).get())
  if (!record) return null
  return { record, records: sendingDnsRecords(record), dmarc: null }
}

export async function listSendingDomains(
  orgId: string,
): Promise<SendingDomainRecord[]> {
  if (!orgId) return []
  const snapshot = await firestore()
    .collection('orgs')
    .doc(orgId)
    .collection(SENDING_DOMAINS_COLLECTION)
    .get()
  return snapshot.docs.map(readRecord).filter(Boolean)
}

/**
 * Read the customer's DMARC policy.
 *
 * Advisory in both directions: it never blocks verification and it is never
 * written. A domain under `p=reject` with our DKIM unpublished hard-fails
 * every message, and a customer deserves to be told that before they wonder
 * why their campaign vanished.
 */
export async function readDmarcPolicy(
  rawDomain: string,
): Promise<DmarcAssessment | null> {
  const domain = normalizeSendingDomain(rawDomain)
  if (!domain) return null
  const lookup = await lookupTxt(`_dmarc.${domain}`)
  // An unreachable lookup is not "they have no policy" — saying so would tell
  // a customer under p=reject that they have no protection.
  if (!lookup.answered) return null
  return assessDmarc(lookup.records)
}

/**
 * Check the live DNS and move the record to `verified` or `failed`.
 *
 * Never throws: a sweep across every org must not stop at the first bad zone.
 *
 * An INCONCLUSIVE result writes nothing but the check time. A resolver outage
 * must not un-verify a working domain — which would silently stop that
 * tenant's mail — and must not fail a customer who is midway through
 * publishing either. This is the `hold` arm the SSO drift sweep uses, and the
 * reason `assessSendingRecords` has three outcomes rather than two.
 */
export async function verifySendingDomain(
  orgId: string,
  rawDomain: string,
): Promise<{
  record: SendingDomainRecord | null
  missing: string[]
  inconclusive: boolean
  error: string | null
}> {
  const domain = normalizeSendingDomain(rawDomain)
  if (!orgId || !domain) {
    return { record: null, missing: [], inconclusive: false, error: 'Invalid domain' }
  }

  const ref = domainRef(orgId, domain)
  const record = readRecord(await ref.get())
  if (!record) {
    return {
      record: null,
      missing: [],
      inconclusive: false,
      error: 'No claim on that domain — add it first.',
    }
  }

  const sendHost = `${SENDING_SUBDOMAIN}.${domain}`
  const dkimHost = `${record.dkimSelector}._domainkey.${domain}`
  const [spf, dkim, mx] = await Promise.all([
    lookupTxt(sendHost),
    lookupTxt(dkimHost),
    lookupMx(sendHost),
  ])

  const verdict = assessSendingRecords(record, {
    spfTxt: spf.records,
    dkimTxt: dkim.records,
    mx: mx.records,
    conclusive: spf.answered && dkim.answered && mx.answered,
  })

  const now = Date.now()
  if (verdict.status === 'inconclusive') {
    await ref.set({ lastCheckedAtMs: now }, { merge: true })
    return { record, missing: [], inconclusive: true, error: null }
  }

  const verified = verdict.status === 'verified'
  await ref.set(
    {
      status: verified ? 'verified' : 'failed',
      lastCheckedAtMs: now,
      ...(verified
        ? {
            verifiedAtMs: now,
            lastMissing: firebaseAdmin.firestore.FieldValue.delete(),
          }
        : { lastMissing: verdict.missing }),
    },
    { merge: true },
  )

  return {
    record: readRecord(await ref.get()),
    missing: verdict.missing,
    inconclusive: false,
    error: null,
  }
}

/**
 * Drop a claim.
 *
 * The host selections pointing at it are NOT rewritten to the platform
 * identity. A site that was sending as its own domain and now has no verified
 * one must refuse, not quietly revert — silently moving a tenant's mail back
 * onto the shared domain is the exact fallback this feature exists to prevent,
 * and doing it during a delete would be no better than doing it during a send.
 */
export async function releaseSendingDomain(
  orgId: string,
  rawDomain: string,
): Promise<void> {
  const domain = normalizeSendingDomain(rawDomain)
  if (!orgId || !domain) return
  await domainRef(orgId, domain)
    .delete()
    .catch(() => undefined)
}

/*==========================================
  The read on the send path
==========================================*/

/**
 * The identity one host sends on, ready to hand to `sendEmail`.
 *
 * Two document reads at most, and none at all for the overwhelmingly common
 * case of a host that has selected nothing. The host document is passed in
 * rather than re-fetched because every caller already holds it.
 */
export async function resolveHostSendingIdentity(options: {
  orgId: string | null | undefined
  /** `hosts/{hostId}.sendingDomain`, the site's selection. */
  selectedDomain: string | null | undefined
  /** `hosts/{hostId}.sendingLocalPart`, defaulted when unset. */
  selectedLocalPart?: string | null
  platformFrom?: string | null
}): Promise<SendingIdentityVerdict> {
  const platformFrom =
    options?.platformFrom ?? process.env.USAGE_EMAIL_FROM ?? null
  const domain = normalizeSendingDomain(options?.selectedDomain ?? '')

  if (!domain || !options?.orgId) {
    return resolveSendingIdentity({ selection: null, platformFrom })
  }

  const record = readRecord(await domainRef(options.orgId, domain).get())

  /*
   * A selection naming a domain with no record refuses rather than falling
   * back. The record can be gone because it was released, or because the
   * selection was written against a different org — both mean the site is
   * configured to send as a domain nothing has verified, and neither is a
   * reason to send as somebody else.
   */
  const selection: SendingDomainSelection = record
    ? {
        domain: record.domain,
        status: record.status,
        localPart: normalizeLocalPart(options.selectedLocalPart ?? '') || 'hello',
        missing: record.lastMissing ?? [],
      }
    : { domain, status: 'failed', localPart: '', missing: [] }

  return resolveSendingIdentity({ selection, platformFrom })
}

/** The record keys a surface highlights as outstanding. */
export function outstandingSendingRecords(
  record: SendingDomainRecord,
): SendingDnsRecord[] {
  const missing = new Set(record?.lastMissing ?? [])
  if (!missing.size) return []
  return sendingDnsRecords(record).filter((entry) =>
    missing.has(sendingRecordKey(entry)),
  )
}
