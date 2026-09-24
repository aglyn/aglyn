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
 * WILL THIS ADDRESS BOUNCE? — ANSWERED BEFORE THE SEND (AGL-3328).
 *
 * The one engine every email path asks: the Resend sender through
 * `sendEmail`'s preflight seam, campaigns before their review count, the
 * CRM at capture time, and Sequences at enrollment and before each send.
 * It answers from three free facts and nothing else:
 *
 * 1. **The address itself** — its syntax, a typo'd provider domain
 *    (`gmial.com`, which is SUGGESTED, never corrected), a disposable
 *    domain, a role address (`info@`), which warns for bulk and cold mail
 *    only.
 * 2. **The domain's MX** — no MX at all, RFC 7505's null MX (`.`), or no MX
 *    but an address record, which RFC 5321 §5.1 still delivers to and so
 *    only warns.
 * 3. **The gateway's history with the sending domain** — see
 *    `mail-gateway.ts`: a gateway that refused this sender twice lately
 *    holds the next BULK send into it.
 *
 * Never an SMTP `RCPT TO` probe. A probe is a connection to the recipient's
 * server that sends nothing, which is exactly what a directory-harvest
 * attack looks like, and gateways list the probing IP for it. Nor a paid
 * verification API: the free checks are the whole of this module.
 *
 * ## The two severities that stop mail, and who they may stop
 *
 * - **refuse** — the domain takes no mail. Every purpose, transactional
 *   included: a password reset to a domain with no MX is a hard bounce
 *   charged to the sending domain, and nobody receives it either way.
 * - **hold** — the gateway refused this sender twice. BULK and COLD mail
 *   only. Mail the recipient asked for (a password reset, a receipt, a
 *   booking confirmation) is never held for a gateway: the person is
 *   waiting for it, and one more refusal costs less than their not getting
 *   it.
 *
 * A public mailbox provider is never refused for its MX. `gmail.com` has MX
 * records; a resolver that says otherwise is having a bad minute, and a
 * refusal there would suppress real people.
 *
 * ## Pure
 *
 * DNS is handed in as a {@link MailDnsResolver}. This library's barrel
 * reaches the browser, so `node:dns` belongs to the server layer that
 * installs the preflight — `@aglyn/tenant-data-admin`.
 *==========================================*/

import {
  classifyMailGateway,
  MAIL_DOMAIN_INTEL_TTL_MS,
  MAIL_DOMAIN_NEGATIVE_TTL_MS,
  type MailGateway,
  type MailGatewayStanding,
  mailGatewayHolds,
  mailGatewayHoldSentence,
  normalizeMailHost,
} from './mail-gateway'

/*==========================================
 * THE ADDRESS
 *==========================================*/

/** RFC 1035's ceiling on a name, which no real domain reaches. */
const DOMAIN_MAX = 253

/** A label: letters, digits and hyphens, not starting or ending on a hyphen. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** The local part a mailbox provider accepts in practice: RFC 5322's dot-atom. */
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/

/** An address as the checks read it: trimmed and lowercased, or `null` when it is not one. */
export function normalizeDeliverabilityEmail(value: unknown): string | null {
  const address = String(value ?? '')
    .trim()
    .toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 1 || at === address.length - 1 || address.length > 254) return null
  const local = address.slice(0, at)
  const domain = address.slice(at + 1)
  if (local.length > 64 || !LOCAL_PART.test(local)) return null
  if (!isDeliverabilityDomain(domain)) return null
  return address
}

/** Whether a value is a domain with at least two labels and a non-numeric top level. */
export function isDeliverabilityDomain(value: unknown): boolean {
  const domain = String(value ?? '')
  if (!domain || domain.length > DOMAIN_MAX) return false
  const labels = domain.split('.')
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false
  return !/^\d+$/.test(labels[labels.length - 1])
}

/** The domain of an address, lowercased, or `null` for a value that is not one. */
export function emailAddressDomain(email: unknown): string | null {
  const address = normalizeDeliverabilityEmail(email)
  return address ? address.slice(address.lastIndexOf('@') + 1) : null
}

/**
 * The mailboxes a company's shared inbox answers as rather than a person.
 * Legal to mail and often read, but a cold email or a campaign sent there
 * reaches nobody who asked for it, and a spam report from a shared inbox is
 * a report from the whole company.
 */
const ROLE_LOCAL_PARTS: ReadonlySet<string> = new Set(
  // A word list rather than quoted strings: `marketing` is also a plugin's
  // id, and `check:plugin-domain-in-core` reads a quoted one as a plugin's
  // domain leaking into shared code — which a mailbox name is not.
  (
    'abuse accounts admin administrator billing careers contact enquiries ' +
    'help hello hr info inquiries jobs mail marketing media news no-reply ' +
    'noreply office postmaster press privacy sales security service support ' +
    'team webmaster'
  ).split(' '),
)

/** Whether an address is a role mailbox (`info@`, `sales@`), read before any `+tag`. */
export function isRoleEmailAddress(email: unknown): boolean {
  const address = normalizeDeliverabilityEmail(email)
  if (!address) return false
  const local = address.slice(0, address.lastIndexOf('@')).split('+')[0]
  return ROLE_LOCAL_PARTS.has(local)
}

/**
 * Domains that hand out a mailbox that expires. Not a complete list — no
 * list is — but the ones a signup form actually meets.
 */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '20minutemail.com',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.net',
])

/** Whether a domain is a disposable-mailbox provider. */
export function isDisposableEmailDomain(domain: unknown): boolean {
  return DISPOSABLE_DOMAINS.has(normalizeMailHost(domain))
}

/**
 * The providers a mistyped domain is compared against. Long labels only: a
 * three-letter label (`aol`, `msn`) is one keystroke from dozens of real
 * domains, and a suggestion there would be noise.
 */
const TYPO_TARGETS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'comcast.net',
  'protonmail.com',
  'verizon.net',
  'sbcglobal.net',
  'bellsouth.net',
]

/** Real providers one keystroke from a target, which must never be "corrected". */
const TYPO_EXEMPT: ReadonlySet<string> = new Set([
  'mail.com',
  'gmx.com',
  'ymail.com',
  'email.com',
  'hotmail.co.uk',
  'yahoo.co.uk',
  'outlook.fr',
])

/** Top-level domains that are a slip of `com` or `net`. */
const TLD_SLIPS: Readonly<Record<string, string>> = {
  co: 'com',
  con: 'com',
  cm: 'com',
  om: 'com',
  comm: 'com',
  cmo: 'com',
  ocm: 'com',
  vom: 'com',
  xom: 'com',
  cpm: 'com',
  coom: 'com',
  ne: 'net',
  nte: 'net',
  ner: 'net',
  nett: 'net',
}

/** Damerau–Levenshtein distance, stopping early above 1: only "one slip" matters here. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diffs: number[] = []
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) diffs.push(index)
      if (diffs.length > 2) return false
    }
    if (diffs.length === 1) return true
    // One transposition of neighbors: `gmial` for `gmail`.
    return (
      diffs.length === 2 &&
      diffs[1] === diffs[0] + 1 &&
      a[diffs[0]] === b[diffs[1]] &&
      a[diffs[1]] === b[diffs[0]]
    )
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a]
  for (let index = 0; index < longer.length; index += 1) {
    if (longer.slice(0, index) + longer.slice(index + 1) === shorter) return true
  }
  return false
}

/**
 * The provider a domain most likely meant, or `null` — a SUGGESTION a
 * surface may offer, never a correction applied: `gmial.com` may be a real
 * domain somebody owns, and changing an address a person typed is sending
 * their mail to someone else.
 */
export function suggestEmailDomain(domain: unknown): string | null {
  const name = normalizeMailHost(domain)
  if (!name || TYPO_EXEMPT.has(name) || TYPO_TARGETS.includes(name)) return null
  const dot = name.lastIndexOf('.')
  if (dot < 1) return null
  const label = name.slice(0, dot)
  const tld = name.slice(dot + 1)
  for (const target of TYPO_TARGETS) {
    const targetDot = target.lastIndexOf('.')
    const targetLabel = target.slice(0, targetDot)
    const targetTld = target.slice(targetDot + 1)
    if (label === targetLabel && TLD_SLIPS[tld] === targetTld) return target
    if (tld === targetTld && label.length >= 4 && withinOneEdit(label, targetLabel)) return target
  }
  return null
}

/*==========================================
 * THE DOMAIN'S MX
 *==========================================*/

/** One MX record as a resolver answers it. */
export interface MailMxRecord {
  exchange: string
  priority: number
}

/**
 * The DNS the checks read, handed in by the server layer.
 *
 * `resolveMx` resolves the domain's MX records. A domain that publishes
 * none resolves `[]` or rejects with a `code` of `ENOTFOUND`, `ENODATA` or
 * `NXDOMAIN` — Node's own convention — and any other rejection is a
 * resolver that could not answer, which the checks read as "unknown" and
 * never as "no MX".
 *
 * `resolveAddress`, when given, answers whether the domain has an address
 * record (A or AAAA): the implicit MX a domain with no MX is still
 * delivered to. Omitted, a domain with no MX reads as `no_mx`.
 */
export interface MailDnsResolver {
  resolveMx(domain: string): Promise<ReadonlyArray<MailMxRecord>>
  resolveAddress?(domain: string): Promise<boolean>
}

/**
 * What a domain's DNS says about receiving mail.
 *
 * - `mx` — it publishes MX records.
 * - `implicit_mx` — no MX, but an address record, which RFC 5321 §5.1 still
 *   delivers to. Deliverable; warned, because it is usually a domain whose
 *   mail was never set up.
 * - `null_mx` — RFC 7505's `MX 0 .`: the domain says outright it takes no mail.
 * - `no_mx` — no MX and no address record: nothing to deliver to.
 */
export type MailDomainStatus = 'mx' | 'implicit_mx' | 'null_mx' | 'no_mx'

/** One domain's answer, as the platform cache stores it. */
export interface MailDomainIntel {
  domain: string
  status: MailDomainStatus
  /** The MX exchanges, lowest preference first; empty for every status but `mx`. */
  mx: string[]
  gateway: MailGateway
  /** When the domain was looked up; trusted for {@link mailDomainIntelTtlMs}. */
  resolvedAtMs: number
}

export const MAIL_DOMAIN_STATUSES: readonly MailDomainStatus[] = ['mx', 'implicit_mx', 'null_mx', 'no_mx']

/** Whether a status means the domain takes no mail. */
export function mailDomainRefusesMail(status: MailDomainStatus | null | undefined): boolean {
  return status === 'no_mx' || status === 'null_mx'
}

/** How long an answer is trusted: a week for a domain that takes mail, a day for one that does not. */
export function mailDomainIntelTtlMs(status: MailDomainStatus): number {
  return mailDomainRefusesMail(status) ? MAIL_DOMAIN_NEGATIVE_TTL_MS : MAIL_DOMAIN_INTEL_TTL_MS
}

/** Whether a cached answer is still trusted at `nowMs`. */
export function isMailDomainIntelFresh(intel: MailDomainIntel | null | undefined, nowMs: number): boolean {
  return Boolean(intel) && intel.resolvedAtMs + mailDomainIntelTtlMs(intel.status) > nowMs
}

/** The resolver's codes that mean "this domain has no such record", as opposed to "I could not ask". */
const NO_RECORD_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'NOTFOUND'])

/** Whether a resolver rejection is an answer ("no such record") rather than a failure to get one. */
export function isNoRecordDnsError(error: unknown): boolean {
  return NO_RECORD_CODES.has(String((error as { code?: unknown })?.code ?? '').toUpperCase())
}

/** A stored answer in its model shape, or `null` for no document or an unreadable one. */
export function readStoredMailDomainIntel(
  id: string,
  data: Record<string, unknown> | null | undefined,
): MailDomainIntel | null {
  if (!data) return null
  const status = (MAIL_DOMAIN_STATUSES as readonly unknown[]).includes(data['status'])
    ? (data['status'] as MailDomainStatus)
    : null
  if (!status) return null
  const mx = Array.isArray(data['mx']) ? data['mx'].filter((entry): entry is string => typeof entry === 'string') : []
  const resolvedAtMs = typeof data['resolvedAtMs'] === 'number' && Number.isFinite(data['resolvedAtMs']) ? data['resolvedAtMs'] : 0
  return {
    domain: typeof data['domain'] === 'string' && data['domain'] ? data['domain'] : id,
    status,
    mx,
    gateway: status === 'mx' ? classifyMailGateway(mx) : status === 'implicit_mx' ? 'other' : 'none',
    resolvedAtMs,
  }
}

/**
 * A domain's mail setup, looked up — see {@link MailDomainStatus}. Rejects
 * when the resolver could not answer, and the caller decides what a missing
 * answer means; every path here reads it as "unknown" and sends.
 */
export async function resolveMailDomain(
  resolver: MailDnsResolver,
  domain: string,
  nowMs: number,
): Promise<MailDomainIntel> {
  let records: ReadonlyArray<MailMxRecord>
  try {
    records = await resolver.resolveMx(domain)
  } catch (error) {
    if (!isNoRecordDnsError(error)) throw error
    records = []
  }
  const exchanges = [...(records ?? [])]
    .filter((record) => record && typeof record.exchange === 'string')
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
    .map((record) => normalizeMailHost(record.exchange))
  const real = exchanges.filter((exchange) => exchange && exchange !== '.')
  if (real.length) {
    return { domain, status: 'mx', mx: real, gateway: classifyMailGateway(real), resolvedAtMs: nowMs }
  }
  // Records that are all "." (or empty, as Node reports a null MX) are RFC
  // 7505's null MX: the domain says it takes no mail, whatever its A says.
  if (exchanges.length) return { domain, status: 'null_mx', mx: [], gateway: 'none', resolvedAtMs: nowMs }
  if (resolver.resolveAddress) {
    let addressed: boolean
    try {
      addressed = await resolver.resolveAddress(domain)
    } catch (error) {
      if (!isNoRecordDnsError(error)) throw error
      addressed = false
    }
    if (addressed) return { domain, status: 'implicit_mx', mx: [], gateway: 'other', resolvedAtMs: nowMs }
  }
  return { domain, status: 'no_mx', mx: [], gateway: 'none', resolvedAtMs: nowMs }
}

/*==========================================
 * THE VERDICT
 *==========================================*/

/**
 * Who a message is for, which decides what may stop it — see the module
 * note. `transactional` is mail the recipient asked for; `bulk` is a
 * campaign, a workflow's marketing step, a sweep; `cold` is a sequence to
 * somebody who has not written to the sender.
 */
export type EmailSendPurpose = 'transactional' | 'bulk' | 'cold'

export type EmailDeliverabilityCode =
  | 'invalid_syntax'
  | 'no_mx'
  | 'null_mx'
  | 'implicit_mx'
  | 'typo_domain'
  | 'disposable_domain'
  | 'role_address'
  | 'gateway_held'

export type EmailDeliverabilitySeverity = 'refuse' | 'hold' | 'warn'

export interface EmailDeliverabilityFinding {
  code: EmailDeliverabilityCode
  severity: EmailDeliverabilitySeverity
  /** A sentence a surface shows as is. */
  message: string
  /** `typo_domain` only: the address with the suggested domain. Never applied for the person. */
  suggestion?: string
}

/**
 * What the checks conclude, worst first: `refused` (never sent), `held`
 * (bulk and cold mail wait for a person), `deliverable` (nothing stops it,
 * warnings or not), `unchecked` (the MX could not be read, so nothing is
 * known — and nothing is stopped).
 */
export type EmailDeliverabilityOutcome = 'refused' | 'held' | 'deliverable' | 'unchecked'

export interface EmailDeliverabilityVerdict {
  /** The address, normalized, or `null` when it is not one. */
  email: string | null
  domain: string | null
  outcome: EmailDeliverabilityOutcome
  findings: EmailDeliverabilityFinding[]
  intel: MailDomainIntel | null
  gateway: MailGatewayStanding | null
}

export interface EmailDeliverabilityInput {
  email: unknown
  purpose: EmailSendPurpose
  /** The domain's MX answer; `null` or absent when it could not be read. */
  intel?: MailDomainIntel | null
  /** The gateway's standing with the sending domain, when the caller read the ledger. */
  gateway?: MailGatewayStanding | null
  /**
   * The domain is a public mailbox provider (`gmail.com`), which is never
   * refused for its MX. The list lives with the CRM's, so the caller asks.
   */
  publicMailbox?: boolean
  /** A person already released the gateway hold for this address. */
  holdReleased?: boolean
}

const SEVERITY_RANK: Record<EmailDeliverabilitySeverity, number> = { refuse: 0, hold: 1, warn: 2 }

/** The whole verdict for one address — see the module note. */
export function assessEmailDeliverability(input: EmailDeliverabilityInput): EmailDeliverabilityVerdict {
  const email = normalizeDeliverabilityEmail(input.email)
  if (!email) {
    return {
      email: null,
      domain: null,
      outcome: 'refused',
      findings: [
        {
          code: 'invalid_syntax',
          severity: 'refuse',
          message: `${String(input.email ?? '').trim() || 'This'} is not an email address.`,
        },
      ],
      intel: null,
      gateway: null,
    }
  }
  const domain = email.slice(email.lastIndexOf('@') + 1)
  const findings: EmailDeliverabilityFinding[] = []
  const bulk = input.purpose !== 'transactional'
  const intel = input.intel ?? null

  if (intel && !input.publicMailbox) {
    if (intel.status === 'no_mx') {
      findings.push({
        code: 'no_mx',
        severity: 'refuse',
        message: `${domain} has no mail server, so ${email} would bounce.`,
      })
    } else if (intel.status === 'null_mx') {
      findings.push({
        code: 'null_mx',
        severity: 'refuse',
        message: `${domain} publishes a null MX record: it says it accepts no email, so ${email} would bounce.`,
      })
    } else if (intel.status === 'implicit_mx') {
      findings.push({
        code: 'implicit_mx',
        severity: 'warn',
        message: `${domain} has no MX record. Mail may still reach its web server's address, but most domains like this never set up email.`,
      })
    }
  }

  const suggestion = suggestEmailDomain(domain)
  if (suggestion) {
    const local = email.slice(0, email.lastIndexOf('@'))
    findings.push({
      code: 'typo_domain',
      severity: 'warn',
      message: `Did you mean ${local}@${suggestion}? ${domain} looks like a typo.`,
      suggestion: `${local}@${suggestion}`,
    })
  }
  if (isDisposableEmailDomain(domain)) {
    findings.push({
      code: 'disposable_domain',
      severity: 'warn',
      message: `${domain} hands out mailboxes that expire, so this address may stop working soon.`,
    })
  }
  if (bulk && isRoleEmailAddress(email)) {
    findings.push({
      code: 'role_address',
      severity: 'warn',
      message: `${email} is a shared role inbox rather than a person, which marketing and cold mail should avoid.`,
    })
  }

  const gateway = input.gateway ?? null
  if (bulk && gateway && input.holdReleased !== true && mailGatewayHolds(gateway)) {
    findings.push({
      code: 'gateway_held',
      severity: 'hold',
      message: `${mailGatewayHoldSentence(gateway.gateway, gateway.blocked30)}, so bulk mail to ${domain} is held.`,
    })
  }

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  const outcome: EmailDeliverabilityOutcome = findings.some((finding) => finding.severity === 'refuse')
    ? 'refused'
    : findings.some((finding) => finding.severity === 'hold')
      ? 'held'
      : intel
        ? 'deliverable'
        : 'unchecked'
  return { email, domain, outcome, findings, intel, gateway }
}

/** The finding that decided a refusal or a hold, or `null` when nothing stops the address. */
export function decidingDeliverabilityFinding(verdict: EmailDeliverabilityVerdict): EmailDeliverabilityFinding | null {
  return verdict.findings.find((finding) => finding.severity !== 'warn') ?? null
}

/**
 * What a bulk send's review says about the addresses the checks took out,
 * or `null` when they took out nobody: "3 recipients excluded: no mail
 * server · 2 behind a gateway that refused this sender".
 */
export function deliverabilityExclusionSummary(counts: {
  noMailServer?: number | null
  gatewayHeld?: number | null
}): string | null {
  const noMailServer = Math.max(0, Math.floor(Number(counts?.noMailServer) || 0))
  const gatewayHeld = Math.max(0, Math.floor(Number(counts?.gatewayHeld) || 0))
  const total = noMailServer + gatewayHeld
  if (!total) return null
  const parts = [
    ...(noMailServer ? [`${noMailServer.toLocaleString('en-US')} no mail server`] : []),
    ...(gatewayHeld ? [`${gatewayHeld.toLocaleString('en-US')} behind a gateway that refused this sender`] : []),
  ]
  return `${total.toLocaleString('en-US')} ${total === 1 ? 'recipient' : 'recipients'} excluded: ${parts.join(' · ')}`
}

/*==========================================
 * THE SEAM ON `sendEmail`
 *
 * `sendEmail` lives in this library and the store it would need lives in
 * `@aglyn/tenant-data-admin`, which imports this one — so the durable half
 * reaches the send by injection, the way the send-rate governor and the
 * marketing gate do. Nothing installed is nothing checked: a deployment
 * without the server layer sends as it always did.
 *==========================================*/

/** What `sendEmail` asks before a message leaves. */
export interface EmailDeliverabilityPreflightRequest {
  /** The recipients, normalized and lowercased. */
  recipients: string[]
  purpose: EmailSendPurpose
  /** The domain the message leaves from, or `null` when it could not be read. */
  sendingDomain: string | null
  /**
   * Whose reputation the sending domain is: a site's own verified domain
   * (`custom`), the pooled tenant identity (`shared`), or Aglyn's own
   * (`platform`). The last two are learned at platform level, where a block
   * hurts every tenant.
   */
  sendingSource: 'custom' | 'shared' | 'platform'
  context?: string
  hostId?: string | null
}

export interface EmailDeliverabilityPreflightVerdict {
  /** Recipients whose domain takes no mail. Never sent, whatever the purpose. */
  refused: Array<{ email: string; code: EmailDeliverabilityCode; reason: string }>
  /** Recipients behind a gateway that refused this sender twice. Bulk and cold mail only. */
  held: Array<{ email: string; gateway: MailGateway; reason: string }>
}

export type EmailDeliverabilityPreflight = (
  request: EmailDeliverabilityPreflightRequest,
) => Promise<EmailDeliverabilityPreflightVerdict>

let installedPreflight: EmailDeliverabilityPreflight | null = null

/** Installs the durable preflight. Called once, from `@aglyn/tenant-data-admin`. */
export function setEmailDeliverabilityPreflight(preflight: EmailDeliverabilityPreflight | null): void {
  installedPreflight = preflight
}

/** The installed preflight, or `null` when nothing has been installed. */
export function getEmailDeliverabilityPreflight(): EmailDeliverabilityPreflight | null {
  return installedPreflight
}

/** Test seam: forget any installed preflight. */
export function resetEmailDeliverabilityPreflightForTests(): void {
  installedPreflight = null
}

/**
 * How long `sendEmail` waits for the preflight before sending anyway. A
 * cold lookup is one DNS round trip and one document read; a preflight
 * slower than this is an outage on the control, and a control outage must
 * not become a mail outage.
 */
export const EMAIL_DELIVERABILITY_PREFLIGHT_TIMEOUT_MS = 2_500
