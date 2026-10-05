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

import { registrableDomain } from './outbound-phishing-screen'
import {
  normalizeSendingDomain,
  SENDING_SUBDOMAIN,
  sendingSpfInclude,
} from './sending-domain'

/*==========================================
 * SENDER READINESS — SPF, DKIM, DMARC and whether they line up.
 *
 * The recipient's side of a send is the deliverability engine's
 * (`email-deliverability.ts`); this is the sender's. A receiver decides
 * whether mail from a domain is really that domain's by three records the
 * SENDER publishes:
 *
 *   - SPF, on the envelope (Return-Path) domain, naming the servers that may
 *     send for it;
 *   - DKIM, a public key at `<selector>._domainkey.<domain>`, which the
 *     signature's `d=` names;
 *   - DMARC, on the From domain (or its organizational domain), which says
 *     what to do with mail that fails, and which only passes when SPF or
 *     DKIM passes FOR A DOMAIN THAT ALIGNS WITH THE FROM DOMAIN.
 *
 * Alignment is the part a records table cannot show: every record can be
 * present and the mail can still fail DMARC, because the domain that passed
 * is not the one in the From line. So the verdict here is per record and
 * then aligned — relaxed alignment is "same organizational domain", strict
 * is "the same name", as `adkim=` / `aspf=` ask.
 *
 * Pure: the lookups are the server layer's (`sender-readiness.ts` in
 * `@aglyn/tenant-data-admin`), handed in as TXT answers, `null` for a lookup
 * nobody answered. An unanswered lookup is `unknown`, never `fail` — a
 * resolver outage must not tell a customer to rebuild a working zone.
 *
 * The sending-domain verification (`assessSendingRecords`) already decides
 * whether a Resend domain may SEND, on exact records. This reads the same
 * zone for a different question — will receivers believe it — and never
 * changes a domain's status.
 *==========================================*/

/** How a check came out. `unknown` is a lookup nobody answered. */
export type SenderReadinessState = 'pass' | 'warn' | 'fail' | 'unknown'

/** The `all` mechanism an SPF record ends with. */
export type SpfAllQualifier = '-all' | '~all' | '?all' | '+all'

/** An SPF record, read. */
export interface SpfPolicy {
  /** The `v=spf1` record, or null when there is none (or more than one). */
  record: string | null
  /** How many `v=spf1` records the name publishes; more than one is a permanent error. */
  count: number
  /** Every `include:` target, lowercased. */
  includes: string[]
  /** The `redirect=` target, or null. */
  redirect: string | null
  /** The closing `all`, or null when the record has none. */
  all: SpfAllQualifier | null
}

/** Read a TXT answer as an SPF policy. Only `v=spf1` records count. */
export function parseSpf(records: readonly string[] | null | undefined): SpfPolicy {
  const found = (records ?? [])
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => /^v\s*=\s*spf1(\s|$)/i.test(entry))
  if (found.length !== 1) {
    return { record: null, count: found.length, includes: [], redirect: null, all: null }
  }
  const record = found[0]
  const terms = record.split(/\s+/).slice(1).map((term) => term.toLowerCase())
  const includes = terms
    .filter((term) => /^[+?~-]?include:/.test(term))
    .map((term) => term.slice(term.indexOf(':') + 1).replace(/\.$/, ''))
  const redirect = terms.find((term) => term.startsWith('redirect='))?.slice('redirect='.length).replace(/\.$/, '') ?? null
  const allTerm = terms.find((term) => /^[+?~-]?all$/.test(term)) ?? null
  const all = allTerm ? ((allTerm === 'all' ? '+all' : allTerm) as SpfAllQualifier) : null
  return { record, count: 1, includes, redirect, all }
}

/** Whether an SPF policy names `include` directly, as an include or its redirect. */
export function spfNamesInclude(policy: SpfPolicy, include: string): boolean {
  const wanted = String(include ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!wanted) return false
  return policy.includes.includes(wanted) || policy.redirect === wanted
}

/** DMARC alignment mode: relaxed (same organizational domain) or strict (same name). */
export type DmarcAlignmentMode = 'r' | 's'

/** A DMARC record, read. */
export interface DmarcRecordPolicy {
  record: string | null
  /** `p=`; `absent` when no record applies. */
  policy: 'reject' | 'quarantine' | 'none' | 'absent'
  /** `sp=`, the policy for subdomains, or null when the record sets none. */
  subdomainPolicy: 'reject' | 'quarantine' | 'none' | null
  adkim: DmarcAlignmentMode
  aspf: DmarcAlignmentMode
  /** `rua=` addresses, the aggregate reports' destinations. */
  rua: string[]
  /** `pct=`, 100 when unset. */
  pct: number
}

const DMARC_POLICIES = ['reject', 'quarantine', 'none'] as const
type DmarcPolicyValue = (typeof DMARC_POLICIES)[number]

/**
 * Read a `_dmarc` TXT answer. Only a record that begins `v=DMARC1` counts, as
 * in `assessDmarc`; tags are read case-insensitively and a tag it does not
 * know is ignored.
 */
export function parseDmarcRecord(records: readonly string[] | null | undefined): DmarcRecordPolicy {
  const found = (records ?? [])
    .map((entry) => String(entry ?? '').trim())
    .find((entry) => /^v\s*=\s*DMARC1\b/i.test(entry))
  if (!found) {
    return { record: null, policy: 'absent', subdomainPolicy: null, adkim: 'r', aspf: 'r', rua: [], pct: 100 }
  }
  const tags = new Map<string, string>()
  for (const part of found.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    tags.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim())
  }
  const policyOf = (value: string | undefined): DmarcPolicyValue | null => {
    const lowered = String(value ?? '').toLowerCase()
    return (DMARC_POLICIES as readonly string[]).includes(lowered) ? (lowered as DmarcPolicyValue) : null
  }
  const mode = (value: string | undefined): DmarcAlignmentMode => (String(value ?? '').toLowerCase() === 's' ? 's' : 'r')
  const pct = Number(tags.get('pct'))
  return {
    record: found,
    // A record with an unreadable `p=` is treated as `none`, which is what a
    // receiver does with it.
    policy: policyOf(tags.get('p')) ?? 'none',
    subdomainPolicy: policyOf(tags.get('sp')),
    adkim: mode(tags.get('adkim')),
    aspf: mode(tags.get('aspf')),
    rua: String(tags.get('rua') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    pct: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 100,
  }
}

/** Whether two domains align under a DMARC mode. */
export function dmarcDomainsAlign(a: string, b: string, mode: DmarcAlignmentMode): boolean {
  const left = normalizeSendingDomain(a)
  const right = normalizeSendingDomain(b)
  if (!left || !right) return false
  if (mode === 's') return left === right
  return registrableDomain(left) === registrableDomain(right)
}

/**
 * What a sender publishes for one provider to send as one From domain: where
 * each record is expected, and what it must name.
 */
export interface SenderReadinessExpectation {
  /** Who sends the mail, for the sentences. */
  provider: string
  /** The From domain. */
  fromDomain: string
  /** The envelope (Return-Path) domain, whose SPF a receiver checks. */
  envelopeDomain: string
  /** The `include:` the envelope domain's SPF must carry for this provider. */
  spfInclude: string
  /** The selector the provider signs with. */
  dkimSelector: string
  /** The signature's `d=`, where the key is published. */
  dkimDomain: string
}

/** A readiness expectation's DNS names, for the server layer to look up. */
export function senderReadinessHosts(expectation: SenderReadinessExpectation): {
  spf: string
  dkim: string
  dmarc: string
  organizationalDmarc: string | null
} {
  const from = normalizeSendingDomain(expectation.fromDomain)
  const organizational = registrableDomain(from)
  return {
    spf: normalizeSendingDomain(expectation.envelopeDomain),
    dkim: `${expectation.dkimSelector}._domainkey.${normalizeSendingDomain(expectation.dkimDomain)}`,
    dmarc: `_dmarc.${from}`,
    organizationalDmarc: organizational && organizational !== from ? `_dmarc.${organizational}` : null,
  }
}

/**
 * A Resend sending domain's expectation: mail From `<domain>`, its envelope
 * on `send.<domain>` (the subdomain the records table asks for), signed
 * `d=<domain>` with the domain's issued selector.
 */
export function resendSenderExpectation(record: {
  domain: string
  dkimSelector?: string | null
}): SenderReadinessExpectation | null {
  const domain = normalizeSendingDomain(record?.domain ?? '')
  if (!domain) return null
  return {
    provider: 'the mail provider',
    fromDomain: domain,
    envelopeDomain: `${SENDING_SUBDOMAIN}.${domain}`,
    spfInclude: sendingSpfInclude(),
    dkimSelector: String(record?.dkimSelector ?? '').trim() || 'aglyn',
    dkimDomain: domain,
  }
}

/**
 * Domains Google itself authenticates. A consumer Gmail address has nothing
 * for its owner to publish, so it has no readiness to show.
 */
const GOOGLE_CONSUMER_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com'])

/**
 * A Google Workspace mailbox's expectation: mail From the address's domain,
 * sent through Google with the envelope on the same domain, SPF naming
 * `_spf.google.com` and the key under Google's default `google` selector.
 * `null` for a consumer Gmail address or an unreadable one.
 */
export function googleMailboxSenderExpectation(address: string | null | undefined): SenderReadinessExpectation | null {
  const raw = String(address ?? '').trim().toLowerCase()
  const domain = normalizeSendingDomain(raw.slice(raw.lastIndexOf('@') + 1))
  if (!raw.includes('@') || !domain || GOOGLE_CONSUMER_DOMAINS.has(domain)) return null
  return {
    provider: 'Google Workspace',
    fromDomain: domain,
    envelopeDomain: domain,
    spfInclude: '_spf.google.com',
    dkimSelector: 'google',
    dkimDomain: domain,
  }
}

/** Microsoft's consumer domains, and the tenant domains it names itself. */
const MICROSOFT_CONSUMER_DOMAINS: ReadonlySet<string> = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com'])

/**
 * A Microsoft 365 mailbox's expectation (AGL-3489): mail From the address's
 * domain, sent through Exchange Online with the envelope on the same domain,
 * SPF naming `spf.protection.outlook.com`, and the key under `selector1` —
 * the CNAME Microsoft 365 publishes DKIM through, which a TXT lookup
 * follows. `null` for a consumer Outlook address, an `onmicrosoft.com`
 * tenant address, or an unreadable one: their records are Microsoft's own.
 */
export function microsoftMailboxSenderExpectation(
  address: string | null | undefined,
): SenderReadinessExpectation | null {
  const raw = String(address ?? '').trim().toLowerCase()
  const domain = normalizeSendingDomain(raw.slice(raw.lastIndexOf('@') + 1))
  if (!raw.includes('@') || !domain || MICROSOFT_CONSUMER_DOMAINS.has(domain) || domain.endsWith('.onmicrosoft.com')) {
    return null
  }
  return {
    provider: 'Microsoft 365',
    fromDomain: domain,
    envelopeDomain: domain,
    spfInclude: 'spf.protection.outlook.com',
    dkimSelector: 'selector1',
    dkimDomain: domain,
  }
}

/** The TXT answers a readiness read needs; `null` for a lookup nobody answered. */
export interface SenderReadinessObservation {
  spfTxt: readonly string[] | null
  dkimTxt: readonly string[] | null
  dmarcTxt: readonly string[] | null
  /**
   * `_dmarc` at the organizational domain, asked only when the From domain
   * is a subdomain and publishes no record of its own. `undefined` when it
   * was not asked.
   */
  organizationalDmarcTxt?: readonly string[] | null
}

/** One check, with the sentence a card shows for it. */
export interface SenderReadinessCheck {
  state: SenderReadinessState
  /** Where the record was looked for. */
  host: string
  /** The record as published, when there is one. */
  record: string | null
  detail: string
}

export interface SenderReadiness {
  provider: string
  fromDomain: string
  spf: SenderReadinessCheck & { all: SpfAllQualifier | null; authorizes: boolean }
  dkim: SenderReadinessCheck & { selector: string }
  dmarc: SenderReadinessCheck & {
    policy: DmarcRecordPolicy['policy']
    rua: string[]
    /** The domain whose record applies — the From domain's, or its organizational domain's. */
    policyDomain: string
  }
  /** Whether DMARC passes, and on which mechanism. */
  alignment: SenderReadinessCheck & { spfAligned: boolean | null; dkimAligned: boolean | null }
  /** The worst of the four. */
  overall: SenderReadinessState
  checkedAtMs: number
}

const STATE_RANK: Record<SenderReadinessState, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 }

/** The worst of several states: fail over warn over unknown over pass. */
export function worstSenderReadinessState(states: readonly SenderReadinessState[]): SenderReadinessState {
  return states.reduce<SenderReadinessState>((worst, state) => (STATE_RANK[state] > STATE_RANK[worst] ? state : worst), 'pass')
}

function assessSpf(expectation: SenderReadinessExpectation, host: string, txt: readonly string[] | null): SenderReadiness['spf'] {
  if (!txt) {
    return { state: 'unknown', host, record: null, all: null, authorizes: false, detail: `The SPF lookup for ${host} went unanswered.` }
  }
  const policy = parseSpf(txt)
  if (policy.count > 1) {
    return {
      state: 'fail',
      host,
      record: null,
      all: null,
      authorizes: false,
      detail: `${host} publishes ${policy.count} SPF records. Receivers treat more than one as an error and SPF fails for every message; merge them into one.`,
    }
  }
  if (!policy.record) {
    return {
      state: 'fail',
      host,
      record: null,
      all: null,
      authorizes: false,
      detail: `${host} publishes no SPF record, so no receiver can tell ${expectation.provider} is allowed to send for it.`,
    }
  }
  const authorizes = spfNamesInclude(policy, expectation.spfInclude)
  const base = { host, record: policy.record, all: policy.all, authorizes }
  if (policy.all === '+all') {
    return {
      ...base,
      state: 'fail',
      detail: 'The record ends in +all, which authorizes every server on the internet to send as this domain.',
    }
  }
  if (!authorizes) {
    return {
      ...base,
      state: 'warn',
      detail:
        `The record does not name include:${expectation.spfInclude}. If it reaches it through another ` +
        `include this is fine; otherwise mail sent by ${expectation.provider} fails SPF.`,
    }
  }
  if (policy.all === '-all') {
    return { ...base, state: 'pass', detail: `Authorizes ${expectation.provider} and refuses every other server (-all).` }
  }
  if (policy.all === '~all') {
    return {
      ...base,
      state: 'pass',
      detail: `Authorizes ${expectation.provider}; other servers soft-fail (~all), the usual setting while DMARC does the enforcing.`,
    }
  }
  if (!policy.all && policy.redirect) {
    return { ...base, state: 'pass', detail: `Authorizes ${expectation.provider} through redirect=${policy.redirect}.` }
  }
  return {
    ...base,
    state: 'warn',
    detail:
      policy.all === '?all'
        ? `Authorizes ${expectation.provider}, but ?all says nothing about every other server. End it in ~all or -all.`
        : `Authorizes ${expectation.provider}, but the record has no closing all, which reads as ?all. End it in ~all or -all.`,
  }
}

function assessDkim(expectation: SenderReadinessExpectation, host: string, txt: readonly string[] | null): SenderReadiness['dkim'] {
  const selector = expectation.dkimSelector
  if (!txt) return { state: 'unknown', host, record: null, selector, detail: `The DKIM lookup for ${host} went unanswered.` }
  const keys = txt.map((entry) => String(entry ?? '').trim()).filter((entry) => /(^|;)\s*p\s*=/i.test(entry))
  const live = keys.find((entry) => /(^|;)\s*p\s*=\s*[A-Za-z0-9+/]/.test(entry))
  if (live) {
    return { state: 'pass', host, record: live, selector, detail: `A signing key is published for the ${selector} selector.` }
  }
  if (keys.length) {
    return {
      state: 'fail',
      host,
      record: keys[0],
      selector,
      detail: `The ${selector} selector's key is empty (p=), which revokes it. Mail signed with it fails DKIM.`,
    }
  }
  return {
    state: 'fail',
    host,
    record: null,
    selector,
    detail: `No DKIM key is published for the ${selector} selector, so ${expectation.provider}'s signature cannot be checked.`,
  }
}

function assessDmarcRecord(
  expectation: SenderReadinessExpectation,
  hosts: ReturnType<typeof senderReadinessHosts>,
  observation: SenderReadinessObservation,
): { check: SenderReadiness['dmarc']; policy: DmarcRecordPolicy | null } {
  const from = normalizeSendingDomain(expectation.fromDomain)
  if (!observation.dmarcTxt) {
    return {
      check: {
        state: 'unknown',
        host: hosts.dmarc,
        record: null,
        policy: 'absent',
        rua: [],
        policyDomain: from,
        detail: `The DMARC lookup for ${hosts.dmarc} went unanswered.`,
      },
      policy: null,
    }
  }
  let parsed = parseDmarcRecord(observation.dmarcTxt)
  let host = hosts.dmarc
  let policyDomain = from
  let inherited = false
  if (!parsed.record && hosts.organizationalDmarc) {
    if (observation.organizationalDmarcTxt === null) {
      return {
        check: {
          state: 'unknown',
          host: hosts.organizationalDmarc,
          record: null,
          policy: 'absent',
          rua: [],
          policyDomain: registrableDomain(from),
          detail: `The DMARC lookup for ${hosts.organizationalDmarc} went unanswered.`,
        },
        policy: null,
      }
    }
    const organizational = parseDmarcRecord(observation.organizationalDmarcTxt ?? [])
    if (organizational.record) {
      // A subdomain with no record of its own takes the organizational
      // domain's, under its `sp=` when it sets one.
      parsed = { ...organizational, policy: organizational.subdomainPolicy ?? organizational.policy }
      host = hosts.organizationalDmarc
      policyDomain = registrableDomain(from)
      inherited = true
    }
  }
  const base = { host, record: parsed.record, policy: parsed.policy, rua: parsed.rua, policyDomain }
  if (!parsed.record) {
    return {
      check: {
        ...base,
        state: 'warn',
        detail:
          `${from} publishes no DMARC policy. Gmail and Yahoo expect one from anyone sending in bulk, ` +
          'and without it anyone can send mail claiming to be from this domain.',
      },
      policy: parsed,
    }
  }
  const inheritedNote = inherited ? ` (inherited from ${policyDomain})` : ''
  const reports = parsed.rua.length
    ? ` Aggregate reports go to ${parsed.rua.join(', ')}.`
    : ' It names no rua address, so no aggregate reports reach anyone.'
  if (parsed.policy === 'none') {
    return {
      check: {
        ...base,
        state: parsed.rua.length ? 'pass' : 'warn',
        detail: `p=none${inheritedNote}: DMARC monitors and enforces nothing.${reports}`,
      },
      policy: parsed,
    }
  }
  return {
    check: {
      ...base,
      state: 'pass',
      detail: `p=${parsed.policy}${parsed.pct < 100 ? ` at pct=${parsed.pct}` : ''}${inheritedNote}: mail that fails DMARC is ${
        parsed.policy === 'reject' ? 'refused' : 'sent to spam'
      }.${reports}`,
    },
    policy: parsed,
  }
}

/**
 * Whether one provider's mail as one From domain will be believed: each
 * record, and then whether DMARC passes on a mechanism that aligns.
 */
export function assessSenderReadiness(
  expectation: SenderReadinessExpectation,
  observation: SenderReadinessObservation,
  nowMs: number,
): SenderReadiness {
  const hosts = senderReadinessHosts(expectation)
  const spf = assessSpf(expectation, hosts.spf, observation.spfTxt)
  const dkim = assessDkim(expectation, hosts.dkim, observation.dkimTxt)
  const { check: dmarc, policy } = assessDmarcRecord(expectation, hosts, observation)

  const adkim = policy?.adkim ?? 'r'
  const aspf = policy?.aspf ?? 'r'
  const dkimAligned =
    dkim.state === 'unknown' ? null : dkim.state === 'pass' && dmarcDomainsAlign(expectation.dkimDomain, expectation.fromDomain, adkim)
  const spfAligned =
    spf.state === 'unknown'
      ? null
      : spf.authorizes && spf.state !== 'fail' && dmarcDomainsAlign(expectation.envelopeDomain, expectation.fromDomain, aspf)
  const enforced = policy?.policy === 'reject' || policy?.policy === 'quarantine'
  let alignment: SenderReadiness['alignment']
  const host = normalizeSendingDomain(expectation.fromDomain)
  if (dkimAligned) {
    alignment = {
      state: 'pass',
      host,
      record: null,
      spfAligned,
      dkimAligned,
      detail: `DMARC passes on DKIM: the signature's domain lines up with the From domain${
        adkim === 's' ? ' exactly (adkim=s)' : ''
      }, and a signature survives forwarding.`,
    }
  } else if (spfAligned) {
    alignment = {
      state: 'warn',
      host,
      record: null,
      spfAligned,
      dkimAligned,
      detail:
        'DMARC passes on SPF alone. Forwarding breaks SPF, so forwarded mail fails DMARC until the DKIM key is published.',
    }
  } else if (dkimAligned === null || spfAligned === null) {
    alignment = {
      state: 'unknown',
      host,
      record: null,
      spfAligned,
      dkimAligned,
      detail: 'Alignment cannot be judged until the lookups above are answered.',
    }
  } else {
    const strictMiss =
      (adkim === 's' && dkim.state === 'pass') || (aspf === 's' && spf.authorizes)
        ? ' The DMARC record asks for strict alignment, which only an exact name satisfies.'
        : ''
    alignment = {
      state: 'fail',
      host,
      record: null,
      spfAligned,
      dkimAligned,
      detail: `Neither SPF nor DKIM passes for a domain that lines up with ${host}, so DMARC fails${
        enforced ? ` and p=${policy?.policy} ${policy?.policy === 'reject' ? 'refuses' : 'quarantines'} the mail` : ''
      }.${strictMiss}`,
    }
  }

  return {
    provider: expectation.provider,
    fromDomain: host,
    spf,
    dkim,
    dmarc,
    alignment,
    overall: worstSenderReadinessState([spf.state, dkim.state, dmarc.state, alignment.state]),
    checkedAtMs: nowMs,
  }
}
