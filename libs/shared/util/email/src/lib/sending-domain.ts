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
 * **A SELECTED sending domain that is not verified refuses the send. It never
 * falls back to any other identity.** {@link resolveSendingIdentity} has no
 * arm that reaches another address from a selected-but-unverified domain, and
 * {@link sendingIdentityRefusal} is what a caller must print.
 *
 * Silent fallback would be wrong three ways, and each is independently
 * disqualifying: the customer believes their DNS is finished when it is not;
 * the recipient sees a `From:` they did not expect from a brand they did;
 * and the tenant's reputation risk lands back on the shared domain the custom
 * domain existed to move it off.
 *
 * **SELECTED is the load-bearing word.** A site that has chosen nothing has
 * made no statement about what its recipients will see, so there is nothing to
 * contradict — and it still has receipts to send. That site sends on the
 * shared platform identity, which is what the console has always told
 * merchants happens. The two cases look similar and are opposites: one is a
 * merchant whose instruction we would be ignoring, the other is a merchant who
 * gave none.
 *
 * ## The shared identity is TRANSACTIONAL only
 *
 * The shared identity pools reputation across every site using it, which is
 * acceptable for mail a recipient asked for by acting — a receipt, a reset, a
 * booking confirmation — and is not acceptable for mail a merchant chose to
 * send. Complaints follow bulk sending, so one merchant's imported list would
 * be charged against every other site's password resets, and the pool would
 * stop delivering the messages that have no alternative.
 *
 * That is a REPUTATION rule and not a pricing one. It happens to line up with
 * the tiers — a site entitled to send marketing is a site entitled to a domain
 * of its own — but it would hold if the price list changed tomorrow, and
 * nothing here reads a plan.
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
   *
   * Requested per-org, but ISSUED by the provider: a provider that signs on a
   * selector of its own choosing overwrites this when the key is recorded,
   * because the record the customer publishes has to be the record the
   * provider will actually sign under. See `sendingDomainProvider`.
   */
  dkimSelector: string
  /** The public key the provider issued, base64, without the `p=` prefix. */
  dkimPublicKey?: string | null
  /** The provider's return-path host for bounce and complaint routing. */
  returnPathHost?: string | null
  /**
   * The provider's own id for the domain object it created.
   *
   * Stored so a re-request can recognize a domain this deployment already
   * created rather than creating a second one, and so an operator can find
   * the object in the provider's dashboard. Never a credential.
   */
  providerDomainId?: string | null
  createdAtMs?: number | null
  verifiedAtMs?: number | null
  lastCheckedAtMs?: number | null
  /**
   * Why the last issuing attempt did not produce a key.
   *
   * A REASON on a record still at `requested`, never a half-written
   * `records-issued`. A provider that answered `4xx` has issued nothing, and
   * a domain whose status says records exist while its DKIM value is empty
   * would print a blank record for the customer to publish — which reads as
   * our bug and cannot ever verify.
   */
  lastIssueError?: string | null
  lastIssueAtMs?: number | null
  /** What the last conclusive lookup saw, for a surface that shows the gap. */
  lastMissing?: string[] | null
}

/**
 * A provider's failure reduced to something safe to store, log and print.
 *
 * Provider error bodies are attacker-adjacent text we did not write, and the
 * one thing that must never appear in a Firestore document, a log line or an
 * admin surface is the credential that made the call. Vendor keys have a
 * recognizable shape — a short prefix, an underscore, a long opaque body
 * (`re_`, `sk_`, `rk_`, `whsec_`) — and an `Authorization` header echoed into
 * an error message carries the whole thing.
 *
 * This is the LAST line rather than the only one: callers build their detail
 * from a fixed vocabulary and never from response prose, so nothing should
 * reach here that needs redacting. A guard that is only ever a no-op in
 * practice is exactly the guard worth having on a secret.
 */
export function safeProviderDetail(input: string | null | undefined): string {
  return String(input ?? '')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z]{2,8}_[A-Za-z0-9]{12,}\b/g, '[redacted]')
    .trim()
    .slice(0, 120)
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
  Did the customer publish the records?
==========================================*/

/** What a set of lookups saw. Assembled by the durable half, compared here. */
export interface SendingDnsObservation {
  /** TXT at `send.<domain>`. */
  spfTxt: readonly string[]
  /** TXT at `<selector>._domainkey.<domain>`. */
  dkimTxt: readonly string[]
  /** MX at `send.<domain>`. */
  mx: readonly { exchange: string; priority: number }[]
  /**
   * False when ANY of the three lookups failed to get an answer.
   *
   * One unreachable lookup poisons the whole observation rather than being
   * treated as an empty one: a partial read cannot distinguish a customer who
   * published two of three records from a resolver that answered twice.
   */
  conclusive: boolean
}

export type SendingVerificationStatus =
  | 'verified'
  /** We got answers, and at least one required record is not there. */
  | 'failed'
  /** Nobody answered. Not evidence in either direction. */
  | 'inconclusive'

export interface SendingVerification {
  status: SendingVerificationStatus
  /** Keys of the required records not seen. Empty when verified. */
  missing: string[]
}

/**
 * Compare the records we asked for against the records that are live.
 *
 * Pure, and separated from the lookups for the reason `sso-drift-logic.ts` is
 * separated from `sso-provisioning.ts`: the decision a customer's verification
 * rests on should be reachable from a test without standing up DNS, so the
 * route's spec can fake the I/O and run the REAL comparison.
 *
 * `inconclusive` is the load-bearing arm. A resolver outage must not be read
 * as every customer deleting their records at the same instant, so it produces
 * neither `verified` nor `failed` and the caller leaves the stored status
 * alone. This is the same three-state discipline the SSO drift sweep uses, for
 * the same reason.
 *
 * The SPF comparison is a `startsWith` on `v=spf1` plus a search for the
 * include, not an exact match: a zone may legitimately carry a longer policy
 * with extra mechanisms, and demanding our exact string would fail a
 * configuration that works. The DKIM comparison IS exact on the key, because
 * a key that is nearly right is a key that does not sign.
 */
export function assessSendingRecords(
  record: Parameters<typeof sendingDnsRecords>[0],
  observation: SendingDnsObservation,
): SendingVerification {
  const required = sendingDomainRequiredRecords(record)

  /*
   * A domain with no issued DKIM key can never verify, whatever else is live.
   *
   * Checked on the DKIM record specifically rather than on the requirement set
   * being empty: SPF and the return path both have values before a key is
   * issued, so a domain with no signing key at all would otherwise satisfy
   * every requirement in the set and reach the sending state. DKIM is the
   * record that must align for DMARC — a domain that cannot sign is exactly
   * the domain this feature must not let send.
   */
  const hasDkim = required.some((entry) => entry.purpose === 'dkim')
  if (!required.length || !hasDkim) {
    return { status: 'failed', missing: ['dkim-key-not-issued'] }
  }
  if (!observation?.conclusive) return { status: 'inconclusive', missing: [] }

  const include = `include:${sendingSpfInclude()}`
  const missing: string[] = []

  for (const entry of required) {
    const key = sendingRecordKey(entry)
    if (entry.purpose === 'spf') {
      const found = (observation.spfTxt ?? []).some(
        (txt) =>
          /^v\s*=\s*spf1\b/i.test(String(txt ?? '').trim()) &&
          String(txt).toLowerCase().includes(include),
      )
      if (!found) missing.push(key)
    } else if (entry.purpose === 'dkim') {
      const expected = entry.value.replace(/^p=/, '')
      const found = (observation.dkimTxt ?? []).some((txt) =>
        String(txt ?? '')
          .replace(/\s+/g, '')
          .includes(expected.replace(/\s+/g, '')),
      )
      if (!found) missing.push(key)
    } else if (entry.purpose === 'return-path') {
      const found = (observation.mx ?? []).some(
        (mx) => String(mx?.exchange ?? '').toLowerCase() === entry.value.toLowerCase(),
      )
      if (!found) missing.push(key)
    }
  }

  return missing.length
    ? { status: 'failed', missing }
    : { status: 'verified', missing: [] }
}

/*==========================================
  Which identity does a send leave on?
==========================================*/

/**
 * WHO IS SPEAKING in this message, which is the whole of what decides whether
 * `USAGE_EMAIL_FROM` is reachable.
 *
 * `platform` — Aglyn talking to its own customers. Billing, account notices,
 * console password resets, staff alerts. These belong on `aglyn.com` and are
 * the only mail that does.
 *
 * `tenant` — a site talking to its visitors. Marketing AND transactional: a
 * receipt, a booking reminder, a membership password reset are all the tenant
 * speaking, and all of them carry the tenant's list quality. These leave on
 * the site's own domain or they do not leave at all.
 *
 * The distinction is not promotional-versus-not. A merchant who imports a
 * purchased list and mails it produces complaints; if that merchant's receipts
 * ride the same domain as the platform's invoices, one merchant's import
 * degrades every other merchant's account mail. Splitting by CONTENT would put
 * the receipts on the safe domain and leave the reputation shared anyway,
 * because the complaints follow the domain and not the subject line.
 */
export type SendingIdentityAudience = 'platform' | 'tenant'

/**
 * WHAT KIND OF MESSAGE this is, which decides whether the shared tenant
 * identity is reachable.
 *
 * `transactional` — the recipient's own action produced it, or a fact about
 * their order or account did. A receipt, a password reset, a booking
 * confirmation, a supplier notice. **Never blocked**, on any tier, by anything
 * in this module: a merchant who cannot send a receipt does not have a
 * degraded product, they have no product.
 *
 * `marketing` — the merchant chose to send it. A campaign, an abandoned-cart
 * sweep, a restock alert, a flow step. It carries the merchant's list quality,
 * so it may only leave on a domain whose reputation is that merchant's own.
 *
 * Orthogonal to {@link SendingIdentityAudience}, which asks WHO is speaking.
 * Both axes are needed and neither implies the other: platform mail is all
 * transactional today, tenant mail is both, and the answer to "may this leave
 * on the pooled address" needs the second axis specifically.
 *
 * Defaults to `transactional` wherever it is unset, and the polarity is
 * deliberate — the same one `resolveSendPriority` chose for the same reason.
 * Enumerating what is RESTRICTED means a caller who forgets sends a receipt
 * that goes; enumerating what is permitted means a caller who forgets drops
 * one. The forgotten-marketing case is caught structurally instead, in
 * `sendEmail`, which derives the answer from fields a marketing send is
 * already required to carry rather than from one more thing to remember.
 */
export type SendingIdentityPurpose = 'transactional' | 'marketing'

export interface SendingIdentityInput {
  /**
   * The site's chosen sending domain, or null when it has not chosen one.
   */
  selection?: SendingDomainSelection | null
  /** `USAGE_EMAIL_FROM`, the platform's own verified identity. */
  platformFrom?: string | null
  /**
   * The shared tenant identity — `sharedTenantSendingFrom()`, an address on
   * the mail apex.
   *
   * Passed in rather than read from the environment here, so this module stays
   * pure and free of a dependency on `platform-sending-domain.ts` (which
   * imports from this file; reading it here would be a cycle). The durable
   * half supplies it, which is also the layer that knows whether this
   * deployment has one.
   */
  sharedFrom?: string | null
  /** See {@link SendingIdentityPurpose}. Defaults to `transactional`. */
  purpose?: SendingIdentityPurpose
  /**
   * Whose mail this is. Defaults to `platform`, which is what every caller
   * that resolves a PLATFORM identity means and never has to say.
   *
   * A default is safe here only because the tenant side never reaches this
   * function directly: `resolveHostSendingIdentity` is the single door for
   * host-scoped mail and it passes `tenant` unconditionally. A tenant caller
   * cannot forget the flag, because it is not the tenant caller that sets it.
   */
  audience?: SendingIdentityAudience
}

export type SendingIdentitySource =
  /** A domain this site has verified — its own name, or one inside our apex. */
  | 'custom'
  /**
   * The pooled tenant identity on the mail apex. Transactional mail from a
   * site that has no domain of its own.
   */
  | 'shared'
  /** `USAGE_EMAIL_FROM`. Aglyn's own mail, never a tenant's. */
  | 'platform'

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
  /**
   * TENANT mail from a site with no sending domain, on a deployment that has
   * no shared identity configured either.
   *
   * An OPERATOR fault, not a customer one — the shared identity is derived
   * from the mail apex and needs no tenant action — so it is the tenant-side
   * twin of `platform-unconfigured` rather than something a merchant can fix.
   * It stays a refusal and not a fallback for the same reason that one does:
   * `aglyn.com` carries the platform's own billing and account mail, and a
   * tenant's list quality must never be charged against it.
   */
  | 'tenant-identity-unprovisioned'
  /**
   * MARKETING mail from a site that has no domain of its own.
   *
   * The shared identity carries transactional mail for every site using it, so
   * admitting one merchant's campaign would charge that campaign's complaint
   * rate against every other site's receipts and password resets — the messages
   * with no alternative and no way to opt out of the consequence.
   *
   * Distinct from `tenant-identity-unprovisioned` because the remedy is
   * different in kind: that one is waiting on us, and this one is waiting on
   * the merchant to have a domain whose reputation is theirs to spend.
   */
  | 'shared-identity-marketing'

export interface SendingIdentityRefusal {
  code: SendingIdentityRefusalCode
  /** The domain at fault, or null for `platform-unconfigured`. */
  domain: string | null
  /** One sentence naming the cause and the next action. */
  message: string
  /** Record keys the last conclusive lookup did not see. */
  missing: string[]
}

/**
 * What a merchant is told when marketing meets the pooled identity.
 *
 * ONE string, because it is produced from two places that must not drift: the
 * resolver, when a caller declares the purpose up front, and
 * {@link sharedIdentityMarketingRefusal}, when the send path notices at the
 * last moment. Two copies is how the route comes to explain one rule while the
 * backstop explains another.
 *
 * It names the remedy in both forms a merchant can actually reach — verify a
 * domain, or use the one their site is issued — because "not allowed" without
 * a next action is the refusal shape this module exists to avoid.
 */
const SHARED_IDENTITY_MARKETING_MESSAGE =
  'Marketing email does not leave on the shared Aglyn address. That address ' +
  'carries receipts and password resets for every site using it, and one ' +
  'campaign’s complaint rate would be charged against all of them. Send ' +
  'marketing from a domain of this site’s own — either one you verify, or ' +
  'the one this site is issued automatically.'

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
 * 1. Selection, `verified` → that identity.
 * 2. Selection, anything else → **REFUSED**.
 * 3. No selection, `tenant` audience, `marketing` → **REFUSED**.
 * 4. No selection, `tenant` audience, `transactional` → the shared identity,
 *    if this deployment has one; **REFUSED** if it does not.
 * 5. No selection, `platform` audience → the platform identity, named as such.
 *
 * There is no arm that reaches ANY other address from an unverified selection.
 * A customer who has told us to send as their domain has made a statement
 * about what their recipients will see; quietly sending as somebody else
 * instead is not a degraded version of honoring it. That is arm 2, it is
 * checked before anything else, and neither the shared identity nor the
 * platform one is consulted inside it.
 *
 * Arms 3 and 4 are the site that has chosen nothing. It is not the same case
 * and must not get the same answer: there is no instruction to contradict, and
 * a site that cannot send a receipt is not a site. So transactional mail goes,
 * on the pooled identity, which is what the console has always disclosed. What
 * does NOT go is marketing, because the pool is only usable while nobody is
 * spending it on a list.
 *
 * Arm 5 is the platform's own mail and is unreachable from a tenant audience,
 * which is what keeps a merchant's list quality off `aglyn.com`. The `tenant`
 * checks sit ABOVE the `platformFrom` read rather than inside it, so the
 * platform address is not preferred-but-overridable for a tenant — it is
 * simply not an address this audience can reach.
 *
 * Deciding all of it here rather than at the call sites is what makes it a
 * property: `resolveHostSendingIdentity` passes `tenant` for every host-scoped
 * send, so no individual caller has to remember.
 */
export function resolveSendingIdentity(
  input: SendingIdentityInput,
): SendingIdentityVerdict {
  const selection = input?.selection ?? null
  const platformFrom = String(input?.platformFrom ?? '').trim() || null
  const audience: SendingIdentityAudience =
    input?.audience === 'tenant' ? 'tenant' : 'platform'
  const sharedFrom = String(input?.sharedFrom ?? '')
    .trim()
    .toLowerCase()
  // Defaulted to the arm that can never be blocked. See `SendingIdentityPurpose`.
  const purpose: SendingIdentityPurpose =
    input?.purpose === 'marketing' ? 'marketing' : 'transactional'

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

  /*
   * TENANT mail with nothing selected. The PLATFORM identity is not consulted
   * at all — not preferred-but-overridable, not a last resort. It is simply
   * not an address this audience can reach, which is why these checks sit
   * above the `platformFrom` read rather than inside it.
   */
  if (audience === 'tenant') {
    /*
     * Re-validated here rather than trusted, for the same reason `localPart` is
     * on the selection branch: this is the one function that decides what goes
     * into a `From:` header, and a malformed address reaching the provider is a
     * failed send whose cause names the wrong layer.
     */
    const sharedAt = sharedFrom.lastIndexOf('@')
    const sharedLocal =
      sharedAt > 0 ? normalizeLocalPart(sharedFrom.slice(0, sharedAt)) : ''
    const sharedDomain =
      sharedAt > 0 ? normalizeSendingDomain(sharedFrom.slice(sharedAt + 1)) : ''
    const shared =
      sharedLocal && sharedDomain ? `${sharedLocal}@${sharedDomain}` : ''

    /*
     * Marketing first, and BEFORE the "is a shared identity configured" check.
     *
     * Otherwise a deployment with no pool would answer a campaign with "your
     * domain is being set up, try again shortly" — which is a promise that a
     * later attempt will succeed, and it will not: marketing never leaves on
     * the pool however well provisioned it is. A refusal that misdescribes
     * what is wrong sends a merchant to wait for something that is not coming.
     */
    if (purpose === 'marketing') {
      return {
        from: null,
        source: null,
        domain: null,
        summary: 'Blocked: marketing needs a sending domain of its own.',
        refusal: {
          code: 'shared-identity-marketing',
          domain: null,
          missing: [],
          message: SHARED_IDENTITY_MARKETING_MESSAGE,
        },
      }
    }

    if (shared) {
      return {
        from: shared,
        source: 'shared',
        domain: sharedDomain,
        summary:
          `Sending as ${shared} on a shared Aglyn domain. Delivery ` +
          'reputation there is pooled with the other sites using it, and ' +
          'only receipts and account email leave on it.',
        refusal: null,
      }
    }

    return {
      from: null,
      source: null,
      domain: null,
      summary: 'Blocked: this deployment has no shared sending identity.',
      refusal: {
        code: 'tenant-identity-unprovisioned',
        domain: null,
        missing: [],
        message:
          'This site has no sending domain of its own, and this deployment ' +
          'has no shared sending identity configured for it to fall back to, ' +
          'so the message was refused rather than sent from the platform’s ' +
          'own address. This is an operator setting, not something the site ' +
          'can fix.',
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

/**
 * The refusal a MARKETING message owes when its resolved identity turns out to
 * be a pooled one, or null.
 *
 * The second half of the marketing rule, and the half that does not depend on
 * anybody remembering. {@link resolveSendingIdentity} refuses marketing when it
 * is TOLD the purpose — which the campaign route does, so the merchant gets a
 * `409` naming the cause. But identities are resolved once and reused for
 * thousands of messages, sometimes by a caller that does not know what will be
 * sent through them, and the default purpose is `transactional` because the
 * cost of guessing wrong in the other direction is a dropped password reset.
 *
 * So the verdict is re-examined at the send, where the message itself is in
 * hand and the question "is this marketing" has a structural answer rather than
 * a declared one. Same shape as the send-rate governor, which is likewise
 * enforced at the route and again here: a resolution is skippable and a
 * declaration is forgettable, so neither may be the only thing between a
 * merchant's list and the pool that carries everybody's receipts.
 *
 * Takes the verdict rather than the source string so a caller cannot pass the
 * wrong field, and returns the same refusal shape every other arm produces so
 * `sendEmail` has one thing to print.
 */
export function sharedIdentityMarketingRefusal(
  verdict: SendingIdentityVerdict | null | undefined,
): SendingIdentityRefusal | null {
  if (verdict?.source !== 'shared') return null
  return {
    code: 'shared-identity-marketing',
    domain: verdict?.domain ?? null,
    missing: [],
    message: SHARED_IDENTITY_MARKETING_MESSAGE,
  }
}
