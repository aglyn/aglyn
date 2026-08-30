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
 * CUSTOM SENDING DOMAINS — policy half.
 *
 * Everything the platform sends leaves from one verified identity
 * (`USAGE_EMAIL_FROM`) on one domain. A tenant's campaign and another tenant's
 * password reset therefore share a DKIM `d=` and a reputation: one merchant's
 * complaint rate is charged against every merchant's authentication mail. A
 * custom sending domain is the control that moves a tenant's reputation onto a
 * domain that tenant owns.
 *
 * ## Pure, and dependency-free, for the same reason `send-rate.ts` is
 *
 * The decision — which identity does this send leave on, and may it leave at
 * all — is a pure function of a stored record and the environment. It is
 * unit-testable with no Firestore harness, no DNS resolver and no route. The
 * durable half (the record, the DNS probe, the verification sweep) lives in
 * `@aglyn/tenant-data-admin`, which is the only layer that may hold the Admin
 * SDK. `@aglyn/shared-util-email` is `scope:shared` and may not import it.
 *
 * ## THE BOUNDARY THAT MATTERS MOST
 *
 * **An unverified sending domain refuses the send. It never falls back to the
 * platform identity.** {@link resolveSendingIdentity} has no arm that reaches
 * a platform address from a selected-but-unverified domain, and
 * {@link sendingIdentityRefusal} is what a caller must print.
 *
 * Silent fallback would be wrong three ways, and each is independently
 * disqualifying: the customer believes their DNS is finished when it is not;
 * the recipient sees a `From:` they did not expect from a brand they did;
 * and the tenant's reputation risk lands back on the shared domain the custom
 * domain existed to move it off.
 *
 * The failure mode this guards against is the house one. `USAGE_EMAIL_FROM`
 * was empty in production for weeks; because mail is best-effort at every
 * call site, every send returned `{sent: false, reason: 'unconfigured'}`,
 * nothing threw, and no surface said anything was wrong. A refusal that is
 * only a log line is that same defect wearing a new reason string — so the
 * refusal carries the domain, the missing records, and a sentence a person can
 * act on, and the campaign route answers it as a `409` rather than a no-op.
 *
 * ## Scope: this module issues records and decides. It does not verify.
 *
 * Reading live DNS belongs to the durable half, which reuses the pinned-
 * resolver probe that already backs SSO domain verification — the one that
 * distinguishes "the record is absent" from "nobody answered". That third
 * state is why {@link SendingDomainStatus} has no arm meaning "checked and we
 * are not sure": an unreachable resolver leaves the stored status alone.
 */

/*==========================================
  The record
==========================================*/

/**
 * Where a domain is in its verification lifecycle.
 *
 * Persisted, unlike the site-domain machine's live-computed
 * `ProjectDomainState`. A site domain can be re-read from the hosting provider
 * on every request; a sending domain's proof is a DKIM key the mail provider
 * issued once, and the send path must be able to answer "may this leave?"
 * without a network call on the critical path of every message.
 */
export type SendingDomainStatus =
  /**
   * The customer asked for the domain. No records exist to publish yet,
   * because issuing them needs a provider credential that may be absent.
   */
  | 'requested'
  /** Records are issued and shown. The customer has DNS work to do. */
  | 'records-issued'
  /** A lookup has seen every required record. This is the only sending state. */
  | 'verified'
  /**
   * A lookup got a conclusive answer and the records were wrong or absent.
   * Distinct from `records-issued` so a surface can say "we looked, and it is
   * not there" rather than leaving a customer to wonder whether we ever
   * checked. Never reached from an unreachable resolver.
   */
  | 'failed'

/** The lifecycle in order, for a surface that renders progress. */
export const SENDING_DOMAIN_STATUSES: readonly SendingDomainStatus[] = [
  'requested',
  'records-issued',
  'verified',
  'failed',
]

/**
 * The stored record, one per domain per org.
 *
 * Per-ORG rather than per-host: DNS control is proved once for a name, and an
 * agency running four sites on `client.com` should publish the DKIM record
 * once, not four times. Which identity a given site *uses* is a separate,
 * per-host choice ({@link SendingDomainSelection}) — that split is what lets
 * one verification serve the agency case without making every site repeat the
 * DNS chore.
 */
export interface SendingDomainRecord {
  /** Normalized, lowercased, no trailing dot. Also the document id. */
  domain: string
  status: SendingDomainStatus
  /**
   * The DKIM selector this domain signs with. Per-org rather than a shared
   * `resend`, so two orgs verifying the same name cannot collide on one
   * record — and so revoking one org's identity cannot invalidate another's.
   */
  dkimSelector: string
  /** The public key the provider issued, base64, without the `p=` prefix. */
  dkimPublicKey?: string | null
  /** The provider's return-path host for bounce and complaint routing. */
  returnPathHost?: string | null
  createdAtMs?: number | null
  verifiedAtMs?: number | null
  lastCheckedAtMs?: number | null
  /** What the last conclusive lookup saw, for a surface that shows the gap. */
  lastMissing?: string[] | null
}

/**
 * Which sending identity one site uses, resolved for a send.
 *
 * The `localPart` is stored, never taken from a request: an address assembled
 * from user input is a `From:` override, and the one invariant `applyFromName`
 * was built to hold is that the address cannot move off a verified identity.
 */
export interface SendingDomainSelection {
  domain: string
  status: SendingDomainStatus
  /** Mailbox to send as, for example `hello`. */
  localPart: string
  /** Required records not seen by the last conclusive lookup. */
  missing?: string[] | null
}

/*==========================================
  Domain validation
==========================================*/

const DOMAIN_PATTERN =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/**
 * Domains whose mail nobody but their operator may authorize.
 *
 * Publishing our DKIM record in one of these zones is impossible, so a claim
 * on one can never verify — but refusing it up front is a sentence the
 * customer can act on rather than a verification that silently never
 * completes.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'zoho.com',
  'fastmail.com',
  'hey.com',
  'qq.com',
  '163.com',
  '126.com',
])

/**
 * `{ value, error }` rather than a discriminated union, matching
 * `validateSsoDomain`: `strictNullChecks` is off repo-wide, so an
 * `{ ok: true } | { ok: false }` union does not narrow across a library
 * boundary and the caller ends up unable to reach either arm's fields. Both
 * keys always present, exactly one of them null.
 */
export interface SendingDomainCheck {
  domain: string | null
  error: string | null
}

export function normalizeSendingDomain(input: string): string {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  const at = raw.lastIndexOf('@')
  return (at >= 0 ? raw.slice(at + 1) : raw)
    .replace(/^@+/, '')
    .replace(/\.$/, '')
}

export function validateSendingDomain(input: string): SendingDomainCheck {
  const domain = normalizeSendingDomain(input)
  if (!domain || !DOMAIN_PATTERN.test(domain)) {
    return { domain: null, error: 'Enter a valid domain, for example acme.com' }
  }
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return {
      domain: null,
      error:
        'Mailbox providers do not delegate sending for their own domains, so ' +
        'this domain can never be verified. Use a domain you own.',
    }
  }
  return { domain, error: null }
}

/**
 * The mailbox part of an address, validated so a stored `localPart` cannot
 * smuggle a second address or a header into the `From:` line.
 */
export function normalizeLocalPart(input: string): string {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  return /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(raw) ? raw : ''
}

/*==========================================
  The records the customer must publish
==========================================*/

/**
 * The subdomain the envelope sender and its bounce routing live on.
 *
 * A subdomain rather than the root for two reasons the customer feels: their
 * existing root SPF is untouched, so their Workspace or Microsoft mail keeps
 * authenticating; and this SPF does not spend any of the root record's
 * ten-lookup budget, which is a limit that fails closed and is easy to reach.
 */
export const SENDING_SUBDOMAIN = 'send'

/**
 * `||` not `??`, matching the rest of the env reads in this repo: an empty
 * string is a variable somebody set to nothing, not a configured value, and an
 * empty SPF include would print an instruction that authorizes no one.
 *
 * Configurable because a self-host operator may front a different provider —
 * the same reason `AGLYN_DOMAIN_PROVIDER` exists. The defaults describe the
 * provider this deployment actually uses.
 */
export function sendingSpfInclude(): string {
  return process.env.AGLYN_EMAIL_SPF_INCLUDE || 'amazonses.com'
}

export function sendingReturnPathHost(): string {
  return (
    process.env.AGLYN_EMAIL_RETURN_PATH_HOST ||
    'feedback-smtp.us-east-1.amazonses.com'
  )
}

/** What a record is for, so a surface can group and explain rather than dump. */
export type SendingRecordPurpose = 'spf' | 'dkim' | 'return-path' | 'dmarc'

/** One DNS record, as the customer's registrar labels it. */
export interface SendingDnsRecord {
  type: 'TXT' | 'MX'
  /** Fully-qualified name the record goes on. */
  name: string
  value: string
  /** `MX` only. */
  priority?: number
  purpose: SendingRecordPurpose
  /**
   * Whether verification waits on it. DMARC never blocks: it is the
   * customer's policy about their own domain and we must not make publishing
   * one a condition of using our product.
   */
  required: boolean
  /** Why this record exists, in a sentence aimed at whoever edits the zone. */
  note: string
}

/**
 * Every record for a domain, in the order a customer should create them.
 *
 * ONE function, so the records a card prints and the records the verifier
 * accepts cannot drift apart. `tenant-dns.ts` carries the same invariant for
 * site domains and documents what it cost to learn: a wizard printing one
 * target while the route checked another produced a check that could not fail,
 * then a check that could not pass, over three separate issues.
 *
 * The DKIM value is absent until the provider issues a key. That is a real
 * state, not an error — {@link sendingDomainRequiredRecords} treats a record
 * with no value as unpublishable and keeps the domain out of `records-issued`.
 */
export function sendingDnsRecords(
  record: Pick<
    SendingDomainRecord,
    'domain' | 'dkimSelector' | 'dkimPublicKey' | 'returnPathHost'
  >,
): SendingDnsRecord[] {
  const domain = normalizeSendingDomain(record?.domain)
  const selector = String(record?.dkimSelector ?? '').trim() || 'aglyn'
  const sendHost = `${SENDING_SUBDOMAIN}.${domain}`
  const returnPath = record?.returnPathHost || sendingReturnPathHost()
  const dkimKey = String(record?.dkimPublicKey ?? '').trim()

  return [
    {
      type: 'TXT',
      name: sendHost,
      value: `v=spf1 include:${sendingSpfInclude()} ~all`,
      purpose: 'spf',
      required: true,
      note:
        `Authorizes our infrastructure for mail whose envelope sender is ` +
        `${sendHost}. It sits on this subdomain so your existing root SPF is ` +
        `untouched.`,
    },
    {
      type: 'TXT',
      name: `${selector}._domainkey.${domain}`,
      value: dkimKey ? `p=${dkimKey}` : '',
      purpose: 'dkim',
      required: true,
      note:
        'The signing key. This is the record DMARC alignment depends on — ' +
        'without it, mail from your domain fails whatever policy you publish.',
    },
    {
      type: 'MX',
      name: sendHost,
      value: returnPath,
      priority: 10,
      purpose: 'return-path',
      required: true,
      note:
        'Routes bounces and spam complaints back to us so they can be ' +
        'suppressed. It is on the send subdomain and does not affect mail ' +
        'delivered to your normal inboxes.',
    },
  ]
}

/** The subset verification waits on, and only those with a value to publish. */
export function sendingDomainRequiredRecords(
  record: Parameters<typeof sendingDnsRecords>[0],
): SendingDnsRecord[] {
  return sendingDnsRecords(record).filter(
    (entry) => entry.required && Boolean(entry.value),
  )
}

/**
 * A stable key for one record, used to report which are still missing without
 * putting a full DKIM public key into a status document or a log line.
 */
export function sendingRecordKey(entry: SendingDnsRecord): string {
  return `${entry.type}:${entry.name}`
}

/** `TXT   send.acme.com   →   v=spf1 …`, matching `formatDnsInstruction`. */
export function formatSendingRecord(entry: SendingDnsRecord): string {
  const target = entry.priority ? `${entry.priority} ${entry.value}` : entry.value
  return `${String(entry.type).padEnd(5)}  ${entry.name}  →  ${target}`
}

/*==========================================
  DMARC — read and warn, never write
==========================================*/

/**
 * A customer's DMARC policy is theirs. We read it because it changes what an
 * unverified domain does to their mail, and we must never ask them to weaken
 * it to accommodate us.
 */
export type DmarcPolicy = 'reject' | 'quarantine' | 'none' | 'absent'

export interface DmarcAssessment {
  policy: DmarcPolicy
  /** The record as published, or null when there is none. */
  record: string | null
  /**
   * What this policy does to mail we cannot authenticate. Phrased as a
   * consequence rather than as the record's contents: a customer deciding
   * whether to finish their DNS needs the outcome, not the syntax.
   */
  consequence: string
}

/**
 * Read a `_dmarc` TXT answer.
 *
 * Only records that actually begin `v=DMARC1` count. A zone often carries
 * unrelated TXT records at any name, and treating the first string found as a
 * policy would report a verification token as `p=none`.
 */
export function assessDmarc(records: readonly string[]): DmarcAssessment {
  const found = (records ?? [])
    .map((entry) => String(entry ?? '').trim())
    .find((entry) => /^v\s*=\s*DMARC1\b/i.test(entry))

  if (!found) {
    return {
      policy: 'absent',
      record: null,
      consequence:
        'Your domain publishes no DMARC policy. Mail we cannot authenticate ' +
        'will usually still be delivered, and anyone may send mail claiming ' +
        'to be from your domain.',
    }
  }

  const policy = /(^|;)\s*p\s*=\s*(reject|quarantine|none)\b/i.exec(found)
  const value = (policy?.[2] ?? 'none').toLowerCase() as DmarcPolicy

  if (value === 'reject') {
    return {
      policy: 'reject',
      record: found,
      consequence:
        'Your domain publishes p=reject. Until the DKIM record below is ' +
        'live, every message we send from this domain is refused outright — ' +
        'not filed as spam, refused.',
    }
  }
  if (value === 'quarantine') {
    return {
      policy: 'quarantine',
      record: found,
      consequence:
        'Your domain publishes p=quarantine. Until the DKIM record below is ' +
        'live, our mail from this domain lands in spam, which reads as low ' +
        'engagement rather than as a configuration problem.',
    }
  }
  return {
    policy: 'none',
    record: found,
    consequence:
      'Your domain publishes p=none, which monitors but enforces nothing. ' +
      'Mail we cannot authenticate is still delivered.',
  }
}

/**
 * The DMARC record we suggest to a domain that has none, offered and never
 * required.
 *
 * `p=none` deliberately: it starts reporting without changing the delivery of
 * any mail the customer already sends from other systems. Recommending
 * `p=reject` to a domain whose other senders are unknown to us would break
 * their invoicing or their helpdesk, and we would not find out.
 */
export function dmarcRecommendation(domain: string): SendingDnsRecord {
  return {
    type: 'TXT',
    name: `_dmarc.${normalizeSendingDomain(domain)}`,
    value: 'v=DMARC1; p=none; rua=mailto:dmarc@' + normalizeSendingDomain(domain),
    purpose: 'dmarc',
    required: false,
    note:
      'Recommended, not required, and yours to set. This starts DMARC in ' +
      'report-only mode so you can see who sends as your domain before you ' +
      'enforce anything. Point rua at a mailbox you read.',
  }
}

/*==========================================
  Which identity does a send leave on?
==========================================*/

export interface SendingIdentityInput {
  /**
   * The site's chosen sending domain, or null when it has not chosen one.
   * Null is the ordinary case and resolves to the platform identity.
   */
  selection?: SendingDomainSelection | null
  /** `USAGE_EMAIL_FROM`, the platform's own verified identity. */
  platformFrom?: string | null
}

export type SendingIdentitySource = 'custom' | 'platform'

/**
 * Why a send was refused. Every arm is a state a customer can be walked out
 * of, which is the test for whether a refusal is worth having.
 */
export type SendingIdentityRefusalCode =
  /** A domain is selected and its DNS is not finished. */
  | 'domain-unverified'
  /** A domain is selected and a lookup found its records wrong or absent. */
  | 'domain-failed'
  /** No custom domain, and the platform identity is not configured either. */
  | 'platform-unconfigured'

export interface SendingIdentityRefusal {
  code: SendingIdentityRefusalCode
  /** The domain at fault, or null for `platform-unconfigured`. */
  domain: string | null
  /** One sentence naming the cause and the next action. */
  message: string
  /** Record keys the last conclusive lookup did not see. */
  missing: string[]
}

export interface SendingIdentityVerdict {
  /** Null whenever `refusal` is set. */
  from: string | null
  /** Null whenever `refusal` is set. */
  source: SendingIdentitySource | null
  domain: string | null
  /**
   * What a surface prints, in every outcome including refusal. Requirement:
   * the surface must always be able to say which identity is in use, so this
   * is never empty and never needs the caller to compose it.
   */
  summary: string
  /** Null on success. Both keys always present — `strictNullChecks` is off. */
  refusal: SendingIdentityRefusal | null
}

/**
 * Choose the identity a message leaves on, or refuse.
 *
 * The whole rule, and the reason this function exists rather than an inline
 * `?:` at the send site:
 *
 * 1. No selection → the platform identity, named as such.
 * 2. Selection, `verified` → the custom identity.
 * 3. Selection, anything else → **REFUSED**.
 *
 * There is no fourth arm, and specifically there is no arm that reaches a
 * platform address from an unverified selection. A customer who has told us to
 * send as their domain has made a statement about what their recipients will
 * see; quietly sending as somebody else instead is not a degraded version of
 * honoring it.
 */
export function resolveSendingIdentity(
  input: SendingIdentityInput,
): SendingIdentityVerdict {
  const selection = input?.selection ?? null
  const platformFrom = String(input?.platformFrom ?? '').trim() || null

  if (selection) {
    const domain = normalizeSendingDomain(selection.domain)
    const localPart = normalizeLocalPart(selection.localPart)
    const missing = (selection.missing ?? []).map(String).filter(Boolean)

    if (selection.status === 'verified' && domain && localPart) {
      const from = `${localPart}@${domain}`
      return {
        from,
        source: 'custom',
        domain,
        summary: `Sending as ${from} on your verified domain ${domain}.`,
        refusal: null,
      }
    }

    // A selected domain that is verified but has no usable address is a
    // storage fault, not a customer one, and it is still not a reason to send
    // as somebody else.
    const code: SendingIdentityRefusalCode =
      selection.status === 'failed' ? 'domain-failed' : 'domain-unverified'

    return {
      from: null,
      source: null,
      domain: domain || null,
      summary: `Blocked: ${domain || 'the selected domain'} is not verified.`,
      refusal: {
        code,
        domain: domain || null,
        missing,
        message:
          code === 'domain-failed'
            ? `We checked the DNS for ${domain} and the required records are ` +
              `not published yet, so this send was refused rather than sent ` +
              `from a different address. Publish the records shown on the ` +
              `sending domain card, then verify.`
            : `${domain || 'The selected sending domain'} has not been ` +
              `verified yet, so this send was refused rather than sent from a ` +
              `different address. Publish the records shown on the sending ` +
              `domain card, then verify.`,
      },
    }
  }

  if (!platformFrom) {
    return {
      from: null,
      source: null,
      domain: null,
      summary: 'Blocked: no sending identity is configured.',
      refusal: {
        code: 'platform-unconfigured',
        domain: null,
        missing: [],
        message:
          'This deployment has no sending identity. Set USAGE_EMAIL_FROM, or ' +
          'verify a custom sending domain.',
      },
    }
  }

  const platformDomain = normalizeSendingDomain(platformFrom)
  return {
    from: platformFrom,
    source: 'platform',
    domain: platformDomain || null,
    summary: `Sending as ${platformFrom} on the shared platform domain.`,
    refusal: null,
  }
}

/**
 * The refusal on a verdict, or null.
 *
 * A function rather than `verdict.refusal` at each call site for the reason
 * `rateLimitedRetryAtMs` is one: with `strictNullChecks` off, consumers cannot
 * narrow this union reliably across the library boundary, and every call site
 * would re-derive the same defensive read.
 */
export function sendingIdentityRefusal(
  verdict: SendingIdentityVerdict | null | undefined,
): SendingIdentityRefusal | null {
  return verdict?.refusal ?? null
}
