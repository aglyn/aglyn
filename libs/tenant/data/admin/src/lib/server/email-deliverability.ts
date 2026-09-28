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
 * THE PLATFORM'S DELIVERABILITY STORE (AGL-3328).
 *
 * The durable half of `@aglyn/shared-util-email`'s deliverability engine:
 * the DNS lookups, the cache and the ledger, and the preflight this module
 * installs on `sendEmail` when it loads — the way `email-send-rate` installs
 * the governor, so every server surface that imports this library's barrel
 * gets it without a call at each entrypoint.
 *
 * ## Two collections at the top level, one under an organization
 *
 * - `mailDomains/{domain}` — a recipient domain's MX answer. A fact about
 *   the world, not about an organization, so it is cached ONCE for the whole
 *   platform: the first organization to write to a domain warms it for every
 *   other. A week for a domain that takes mail, a day for one that does not.
 * - `mailGatewayLedger/{sendingDomain}~{gateway}` — what a gateway did with
 *   one sending domain's mail: the Resend path's ledger. A Resend sending
 *   domain is one name on one provider account — the platform's own, a
 *   shared pool member, or one site's verified domain — so the domain alone
 *   is the key, and a pooled or platform domain is flagged `shared`: a block
 *   there hurts every tenant, and the staff console shows it.
 * - `orgs/{orgId}/mailGatewayLedger/{sendingDomain}~{gateway}` — the same
 *   ledger for a connected mailbox (Sequences). A mailbox's domain is not
 *   one organization's — two workspaces can each connect a `gmail.com`
 *   mailbox — so its record stays with the organization that sends from it.
 *
 * All three are server-written; clients read them only as the rules allow,
 * staff for the top level and members for their organization's.
 *
 * ## Failing open, and asking twice before saying no
 *
 * Every read here fails OPEN: a resolver that cannot answer, a store that
 * cannot be read, is "unknown", and unknown sends. The one answer that stops
 * mail — "this domain has no MX" — is asked of two resolvers, the pinned
 * public ones and the runtime's own, and stands only when both agree; and a
 * stale "no MX" is never reused when a fresh lookup cannot be made.
 *==========================================*/

import { isPublicMailboxDomain } from '@aglyn/aglyn/app-utils/crm'
import {
  applyMailGatewayOutcome,
  assessEmailDeliverability,
  decidingDeliverabilityFinding,
  type EmailDeliverabilityPreflightRequest,
  type EmailDeliverabilityPreflightVerdict,
  type EmailDeliverabilityVerdict,
  type EmailDeliveryEvent,
  type EmailSendPurpose,
  getEmailConfig,
  isDeliverabilityDomain,
  isMailDomainIntelFresh,
  isMailGatewayBlock,
  isSharedSendingDomain,
  type MailDnsResolver,
  type MailDomainIntel,
  type MailGateway,
  type MailGatewayLedger,
  mailGatewayLedgerKey,
  mailGatewayOfHost,
  type MailGatewayOutcome,
  mailGatewayStanding,
  type MailGatewayStanding,
  mailDomainRefusesMail,
  MAIL_GATEWAY_DAILY_DELIVERY_CAP,
  mailGatewayDay,
  mailGatewayHolds,
  normalizeDeliverabilityEmail,
  normalizeLedgerSendingDomain,
  readBounceText,
  readStoredMailDomainIntel,
  readStoredMailGatewayLedger,
  resolveMailDomain,
  scrubBounceDiagnostic,
  setEmailDeliverabilityPreflight,
  bareSenderAddress,
} from '@aglyn/shared-util-email'
import { promises as dns } from 'dns'
import { isConclusiveDnsCode, lookupAddress, lookupMx } from './dns-probe'
import type { EmailDeliveryEventOutcome } from './email-delivery-log'
import { suppressEmail } from './email-suppression'
import { firebaseAdmin } from './firebase-admin'

type Firestore = FirebaseFirestore.Firestore

/** The platform MX cache, keyed by recipient domain. */
export const MAIL_DOMAINS_COLLECTION = 'mailDomains'

/** The gateway ledger, at the top level and under an organization — see the module note. */
export const MAIL_GATEWAY_LEDGER_COLLECTION = 'mailGatewayLedger'

/**
 * Where a ledger lives: `null` for the top level (a Resend sending domain),
 * or the organization a connected mailbox belongs to.
 */
export type MailGatewayLedgerScope = { orgId: string } | null

/** What the reads and writes here need beside their input; every field defaults to the platform's. */
export interface MailDeliverabilityDeps {
  firestore?: Firestore
  resolver?: MailDnsResolver
  nowMs?: number
}

const defaultFirestore = (): Firestore => firebaseAdmin.app().firestore() as Firestore

/** `getAll` takes this many references at most per call. */
const GET_ALL_CHUNK = 300

/** Domains looked up at once when a batch is cold. */
const LOOKUP_CONCURRENCY = 16

/*==========================================
 * DNS
 *==========================================*/

/** A resolver rejection that means nobody answered, which every caller reads as "unknown". */
function unanswered(domain: string, what: string): Error {
  return Object.assign(new Error(`the ${what} lookup for ${domain} went unanswered`), { code: 'EUNANSWERED' })
}

/**
 * The platform's resolver: the pinned public resolvers first, and — for the
 * one answer that stops mail, "no MX" — the runtime's own as a second
 * opinion that must agree. See the module note.
 */
export function platformMailDnsResolver(): MailDnsResolver {
  return {
    async resolveMx(domain) {
      const pinned = await lookupMx(domain)
      if (!pinned.answered) throw unanswered(domain, 'MX')
      if (pinned.records.length) return pinned.records
      try {
        return (await dns.resolveMx(domain)).map((record) => ({
          exchange: String(record?.exchange ?? '')
            .trim()
            .toLowerCase()
            .replace(/\.$/, ''),
          priority: Number(record?.priority) || 0,
        }))
      } catch (error) {
        if (isConclusiveDnsCode((error as NodeJS.ErrnoException)?.code)) return []
        throw unanswered(domain, 'MX')
      }
    },
    async resolveAddress(domain) {
      const result = await lookupAddress(domain)
      if (!result.answered) throw unanswered(domain, 'address')
      return result.records.length > 0
    },
  }
}

/*==========================================
 * THE MX CACHE
 *==========================================*/

/**
 * A process-lifetime copy of the answers already read, so a campaign's
 * five hundred messages to one domain ask the store once. Bounded, oldest
 * out first; trusted exactly as long as the stored answer is.
 */
const domainMemory = new Map<string, MailDomainIntel>()
const DOMAIN_MEMORY_MAX = 5_000

function rememberDomain(intel: MailDomainIntel): void {
  if (domainMemory.has(intel.domain)) domainMemory.delete(intel.domain)
  else if (domainMemory.size >= DOMAIN_MEMORY_MAX) {
    const oldest = domainMemory.keys().next().value
    if (oldest !== undefined) domainMemory.delete(oldest)
  }
  domainMemory.set(intel.domain, intel)
}

/** A ledger read, remembered for a minute so a batch does not re-read it per message. */
const ledgerMemory = new Map<string, { ledger: MailGatewayLedger | null; readAtMs: number }>()
const LEDGER_MEMORY_MS = 60_000
const LEDGER_MEMORY_MAX = 2_000

function rememberLedger(path: string, ledger: MailGatewayLedger | null, nowMs: number): void {
  if (ledgerMemory.has(path)) ledgerMemory.delete(path)
  else if (ledgerMemory.size >= LEDGER_MEMORY_MAX) {
    const oldest = ledgerMemory.keys().next().value
    if (oldest !== undefined) ledgerMemory.delete(oldest)
  }
  ledgerMemory.set(path, { ledger, readAtMs: nowMs })
}

/** Test seam: forget everything remembered in this process. */
export function resetMailDeliverabilityMemoryForTests(): void {
  domainMemory.clear()
  ledgerMemory.clear()
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await work(item)
    }
  })
  await Promise.all(runners)
}

/**
 * Each domain's MX answer, keyed by domain: remembered, stored and fresh, or
 * looked up and stored. `null` for a domain that could not be looked up and
 * has no answer that may stand — see the module note.
 */
export async function readMailDomains(
  domains: readonly string[],
  deps: MailDeliverabilityDeps = {},
): Promise<Map<string, MailDomainIntel | null>> {
  const nowMs = deps.nowMs ?? Date.now()
  const answers = new Map<string, MailDomainIntel | null>()
  const wanted = [...new Set(domains.map((domain) => String(domain ?? '').trim().toLowerCase()))].filter(
    isDeliverabilityDomain,
  )
  const missing: string[] = []
  for (const domain of wanted) {
    const remembered = domainMemory.get(domain)
    if (remembered && isMailDomainIntelFresh(remembered, nowMs)) answers.set(domain, remembered)
    else missing.push(domain)
  }
  if (!missing.length) return answers

  const firestore = deps.firestore ?? defaultFirestore()
  const collection = firestore.collection(MAIL_DOMAINS_COLLECTION)
  const stored = new Map<string, MailDomainIntel | null>()
  try {
    for (let start = 0; start < missing.length; start += GET_ALL_CHUNK) {
      const chunk = missing.slice(start, start + GET_ALL_CHUNK)
      const snapshots = await firestore.getAll(...chunk.map((domain) => collection.doc(domain)))
      chunk.forEach((domain, index) => {
        const snapshot = snapshots[index]
        stored.set(domain, readStoredMailDomainIntel(domain, snapshot?.exists ? snapshot.data() : undefined))
      })
    }
  } catch (error) {
    console.error('[deliverability] the MX cache could not be read; looking the domains up', error)
  }

  const stale: string[] = []
  for (const domain of missing) {
    const answer = stored.get(domain) ?? null
    if (answer && isMailDomainIntelFresh(answer, nowMs)) {
      answers.set(domain, answer)
      rememberDomain(answer)
    } else {
      stale.push(domain)
    }
  }

  const resolver = deps.resolver ?? platformMailDnsResolver()
  await eachLimited(stale, LOOKUP_CONCURRENCY, async (domain) => {
    const previous = stored.get(domain) ?? null
    let fresh: MailDomainIntel
    try {
      fresh = await resolveMailDomain(resolver, domain, nowMs)
    } catch (error) {
      // Nobody answered. A stale "takes mail" still says the domain takes
      // mail; a stale "takes none" is not reused to stop a send.
      console.warn(`[deliverability] the MX of ${domain} could not be looked up`, (error as Error)?.message ?? error)
      answers.set(domain, previous && !mailDomainRefusesMail(previous.status) ? previous : null)
      return
    }
    answers.set(domain, fresh)
    rememberDomain(fresh)
    try {
      await collection.doc(domain).set({
        domain,
        status: fresh.status,
        mx: fresh.mx,
        gateway: fresh.gateway,
        resolvedAtMs: fresh.resolvedAtMs,
      })
    } catch (error) {
      // The cache is a convenience; the answer is already in hand.
      console.error(`[deliverability] the MX of ${domain} could not be cached`, error)
    }
  })
  return answers
}

/*==========================================
 * THE LEDGER
 *==========================================*/

function ledgerCollection(firestore: Firestore, scope: MailGatewayLedgerScope) {
  return scope
    ? firestore.collection('orgs').doc(scope.orgId).collection(MAIL_GATEWAY_LEDGER_COLLECTION)
    : firestore.collection(MAIL_GATEWAY_LEDGER_COLLECTION)
}

function ledgerPath(scope: MailGatewayLedgerScope, key: string): string {
  return scope ? `orgs/${scope.orgId}/${MAIL_GATEWAY_LEDGER_COLLECTION}/${key}` : `${MAIL_GATEWAY_LEDGER_COLLECTION}/${key}`
}

/** The platform's own sending domain: `USAGE_EMAIL_FROM`'s. */
function platformFromDomain(): string | null {
  const address = bareSenderAddress(getEmailConfig().from)
  return address ? address.slice(address.lastIndexOf('@') + 1) : null
}

/**
 * Whether a block on this sending domain hurts every tenant — Aglyn's own
 * domain or a shared pool member — which the staff console surfaces first.
 */
export function isSharedMailSendingDomain(domain: string | null | undefined): boolean {
  const name = normalizeLedgerSendingDomain(domain)
  if (!name) return false
  return isSharedSendingDomain(name) || name === platformFromDomain()
}

/** The ledger of each gateway named for one sending domain, keyed by gateway; `null` where none exists yet. */
export async function readMailGatewayLedgers(
  scope: MailGatewayLedgerScope,
  sendingDomain: string,
  gateways: readonly MailGateway[],
  deps: MailDeliverabilityDeps = {},
): Promise<Map<MailGateway, MailGatewayLedger | null>> {
  const nowMs = deps.nowMs ?? Date.now()
  const domain = normalizeLedgerSendingDomain(sendingDomain)
  const answers = new Map<MailGateway, MailGatewayLedger | null>()
  const wanted = [...new Set(gateways)].filter((gateway) => gateway !== 'none')
  if (!domain || !wanted.length) return answers
  const unread: MailGateway[] = []
  for (const gateway of wanted) {
    const remembered = ledgerMemory.get(ledgerPath(scope, mailGatewayLedgerKey(domain, gateway)))
    if (remembered && remembered.readAtMs + LEDGER_MEMORY_MS > nowMs) answers.set(gateway, remembered.ledger)
    else unread.push(gateway)
  }
  if (!unread.length) return answers
  const firestore = deps.firestore ?? defaultFirestore()
  const collection = ledgerCollection(firestore, scope)
  const keys = unread.map((gateway) => mailGatewayLedgerKey(domain, gateway))
  const snapshots = await firestore.getAll(...keys.map((key) => collection.doc(key)))
  unread.forEach((gateway, index) => {
    const snapshot = snapshots[index]
    const ledger = readStoredMailGatewayLedger(keys[index], snapshot?.exists ? snapshot.data() : undefined)
    answers.set(gateway, ledger)
    rememberLedger(ledgerPath(scope, keys[index]), ledger, nowMs)
  })
  return answers
}

/**
 * Counts one outcome on a sending domain's ledger with a gateway. Never
 * throws: the send or the bounce it records has already happened, and a
 * lost count understates a gateway while a thrown one loses the step that
 * called. A delivery past the day's cap costs no write at all.
 */
export async function recordMailGatewayOutcome(
  scope: MailGatewayLedgerScope,
  input: {
    sendingDomain: string
    gateway: MailGateway
    outcome: MailGatewayOutcome
    count?: number
    atMs: number
    /** A refusal's diagnostic, scrubbed here of addresses before it is kept. */
    detail?: string | null
  },
  deps: MailDeliverabilityDeps = {},
): Promise<void> {
  const sendingDomain = normalizeLedgerSendingDomain(input.sendingDomain)
  if (!sendingDomain || input.gateway === 'none') return
  const key = mailGatewayLedgerKey(sendingDomain, input.gateway)
  const path = ledgerPath(scope, key)
  if (input.outcome === 'delivered') {
    const remembered = ledgerMemory.get(path)?.ledger
    const today = remembered?.days?.[mailGatewayDay(input.atMs)]
    if ((today?.delivered ?? 0) >= MAIL_GATEWAY_DAILY_DELIVERY_CAP) return
  }
  try {
    const firestore = deps.firestore ?? defaultFirestore()
    const ref = ledgerCollection(firestore, scope).doc(key)
    const written = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const current = readStoredMailGatewayLedger(key, snapshot.exists ? snapshot.data() : undefined)
      const next = applyMailGatewayOutcome(current, {
        sendingDomain,
        gateway: input.gateway,
        outcome: input.outcome,
        count: input.count,
        atMs: input.atMs,
        detail: scrubBounceDiagnostic(input.detail),
      })
      if (!next) return current
      transaction.set(ref, {
        ...next,
        ...(scope ? { orgId: scope.orgId } : { shared: isSharedMailSendingDomain(sendingDomain) }),
      })
      return next
    })
    rememberLedger(path, written ?? null, input.atMs)
  } catch (error) {
    console.error(`[deliverability] the ledger could not count a ${input.outcome} for ${sendingDomain} at ${input.gateway}`, error)
  }
}

/*==========================================
 * THE VERDICTS
 *==========================================*/

/** What a batch read needs to know about the mail being sent. */
export interface MailDeliverabilityQuestion {
  emails: readonly string[]
  purpose: EmailSendPurpose
  /** The domain the mail leaves from; without one, no ledger is read and nothing is held. */
  sendingDomain: string | null
  scope: MailGatewayLedgerScope
  /** Addresses a person already released the gateway hold for. */
  holdReleased?: (email: string) => boolean
}

/**
 * The deliverability verdict for every address, keyed by the address as
 * given: the MX answers read (and refreshed) above, joined to the sending
 * domain's ledger with each gateway they name. A ledger that cannot be read
 * reads as no history, which holds nothing.
 */
export async function readMailDeliverability(
  question: MailDeliverabilityQuestion,
  deps: MailDeliverabilityDeps = {},
): Promise<Map<string, EmailDeliverabilityVerdict>> {
  const nowMs = deps.nowMs ?? Date.now()
  const normalized = new Map<string, string | null>()
  for (const email of question.emails) normalized.set(email, normalizeDeliverabilityEmail(email))
  const domains = [...normalized.values()]
    .filter((email): email is string => Boolean(email))
    .map((email) => email.slice(email.lastIndexOf('@') + 1))
  const intel = await readMailDomains(domains, { ...deps, nowMs })

  const sendingDomain = normalizeLedgerSendingDomain(question.sendingDomain)
  let ledgers = new Map<MailGateway, MailGatewayLedger | null>()
  if (sendingDomain) {
    const gateways = [...intel.values()]
      .filter((entry): entry is MailDomainIntel => Boolean(entry))
      .map((entry) => entry.gateway)
    try {
      ledgers = await readMailGatewayLedgers(question.scope, sendingDomain, gateways, { ...deps, nowMs })
    } catch (error) {
      console.error('[deliverability] the gateway ledger could not be read; reading as no history', error)
    }
  }

  const verdicts = new Map<string, EmailDeliverabilityVerdict>()
  for (const [given, email] of normalized) {
    const domain = email ? email.slice(email.lastIndexOf('@') + 1) : null
    const answer = domain ? (intel.get(domain) ?? null) : null
    const standing: MailGatewayStanding | null =
      answer && sendingDomain ? mailGatewayStanding(answer.gateway, ledgers.get(answer.gateway) ?? null, nowMs) : null
    verdicts.set(
      given,
      assessEmailDeliverability({
        email: given,
        purpose: question.purpose,
        intel: answer,
        gateway: standing,
        publicMailbox: domain ? isPublicMailboxDomain(domain) : false,
        holdReleased: email ? question.holdReleased?.(email) === true : false,
      }),
    )
  }
  return verdicts
}

/** Whether a verdict refuses because the domain takes no mail — the refusal that suppresses. */
export function isNoMailServerVerdict(verdict: EmailDeliverabilityVerdict | null | undefined): boolean {
  const deciding = verdict ? decidingDeliverabilityFinding(verdict) : null
  return deciding?.code === 'no_mx' || deciding?.code === 'null_mx'
}

/** Whether a verdict holds bulk mail for its gateway. */
export function isGatewayHeldVerdict(verdict: EmailDeliverabilityVerdict | null | undefined): boolean {
  const deciding = verdict ? decidingDeliverabilityFinding(verdict) : null
  return deciding?.code === 'gateway_held'
}

/** A campaign's audience after the checks, with who was excluded and why. */
export interface DeliverableRecipients {
  deliverable: string[]
  /** Addresses whose domain takes no mail. */
  noMailServer: string[]
  /** Addresses behind a gateway that refused this sending domain twice lately. */
  gatewayHeld: string[]
}

/**
 * A bulk audience with the addresses that would bounce, or that sit behind
 * a gateway holding this sending domain, taken out — the count a campaign's
 * review shows before Send, and the filter its batches run. Fails open: an
 * error keeps everyone.
 */
export async function filterDeliverableRecipients(
  input: { emails: readonly string[]; sendingDomain: string | null; purpose?: EmailSendPurpose },
  deps: MailDeliverabilityDeps = {},
): Promise<DeliverableRecipients> {
  const answer: DeliverableRecipients = { deliverable: [], noMailServer: [], gatewayHeld: [] }
  let verdicts: Map<string, EmailDeliverabilityVerdict>
  try {
    verdicts = await readMailDeliverability(
      { emails: input.emails, purpose: input.purpose ?? 'bulk', sendingDomain: input.sendingDomain, scope: null },
      deps,
    )
  } catch (error) {
    console.error('[deliverability] the audience could not be checked; keeping everyone', error)
    return { ...answer, deliverable: [...input.emails] }
  }
  for (const email of input.emails) {
    const verdict = verdicts.get(email)
    if (isNoMailServerVerdict(verdict)) answer.noMailServer.push(email)
    else if (isGatewayHeldVerdict(verdict)) answer.gatewayHeld.push(email)
    else answer.deliverable.push(email)
  }
  return answer
}

/*==========================================
 * THE PREFLIGHT ON `sendEmail`
 *==========================================*/

/**
 * What `sendEmail` asks before a message leaves — see the seam in
 * `@aglyn/shared-util-email`. Refuses every recipient whose domain takes no
 * mail, and files the address on the platform suppression list with its own
 * reason; holds bulk mail behind a gateway that refused this sending domain
 * twice. The Resend path's ledger is keyed by the sending domain alone.
 */
export async function runEmailDeliverabilityPreflight(
  request: EmailDeliverabilityPreflightRequest,
  deps: MailDeliverabilityDeps = {},
): Promise<EmailDeliverabilityPreflightVerdict> {
  const verdicts = await readMailDeliverability(
    {
      emails: request.recipients,
      purpose: request.purpose,
      sendingDomain: request.sendingDomain,
      scope: null,
    },
    deps,
  )
  const answer: EmailDeliverabilityPreflightVerdict = { refused: [], held: [] }
  for (const [email, verdict] of verdicts) {
    const deciding = decidingDeliverabilityFinding(verdict)
    if (!deciding) continue
    if (isNoMailServerVerdict(verdict)) {
      answer.refused.push({ email, code: deciding.code, reason: deciding.message })
      await suppressEmail({
        email,
        reason: 'no_mail_server',
        context: request.context ?? null,
        hostId: request.hostId ?? null,
        ...(deps.firestore ? { firestore: deps.firestore } : {}),
      }).catch((error) => {
        console.error('[deliverability] a refused address could not be suppressed', error)
      })
    } else if (isGatewayHeldVerdict(verdict) && verdict.gateway) {
      answer.held.push({ email, gateway: verdict.gateway.gateway, reason: deciding.message })
    }
  }
  return answer
}

/**
 * Puts the preflight on `sendEmail`'s path. **Called at module load**, from
 * the bottom of this file, for the reason `installEmailSendGovernor` is.
 * Idempotent; the closure holds no state of its own.
 */
export function installEmailDeliverabilityPreflight(): void {
  // A harness that stands a partial email library in for the real one
  // still loads this module; the seam is simply not there to install on.
  if (typeof setEmailDeliverabilityPreflight !== 'function') return
  setEmailDeliverabilityPreflight((request) => runEmailDeliverabilityPreflight(request))
}

/*==========================================
 * WHAT THE PROVIDER'S EVENTS TEACH THE LEDGER
 *==========================================*/

/** The events the ledger learns from, keyed the way the delivery log decides "first". */
const outcomeKey = (event: { providerMessageId: string; to: string; type: string }) =>
  `${event.providerMessageId}|${event.to}|${event.type}`

/**
 * Counts what a Resend webhook reported on the sending domain's ledger: a
 * delivery credits the gateway in front of the recipient, and a permanent
 * bounce that reads as the gateway refusing the SENDER — not an unknown
 * address — counts as a block, filed under the gateway the bounce names
 * (its remote server, or its own words) or else the domain's MX. Only an
 * event the delivery log saw for the first time counts, so a redelivered
 * webhook counts nothing twice. Answers how many outcomes it recorded.
 */
export async function recordDeliverabilityFromDeliveryEvents(
  events: readonly EmailDeliveryEvent[],
  outcomes: readonly EmailDeliveryEventOutcome[] | null,
  deps: MailDeliverabilityDeps = {},
): Promise<number> {
  const first = new Set((outcomes ?? []).filter((outcome) => outcome.firstOfType).map(outcomeKey))
  const counted = events.filter((event) => {
    if (!first.has(outcomeKey(event))) return false
    if (!normalizeLedgerSendingDomain(bareSenderAddress(event.from))) return false
    if (event.type === 'delivered') return true
    return (
      event.type === 'bounced' &&
      event.bounceType === 'permanent' &&
      isMailGatewayBlock({ status: event.bounceStatus ?? null, diagnostic: event.detail })
    )
  })
  if (!counted.length) return 0
  const intel = await readMailDomains(
    counted.map((event) => event.to.slice(event.to.lastIndexOf('@') + 1)),
    deps,
  ).catch(() => new Map<string, MailDomainIntel | null>())
  let recorded = 0
  for (const event of counted) {
    const sender = bareSenderAddress(event.from) as string
    const sendingDomain = sender.slice(sender.lastIndexOf('@') + 1)
    const known = intel.get(event.to.slice(event.to.lastIndexOf('@') + 1))?.gateway ?? null
    const gateway =
      event.type === 'bounced'
        ? (mailGatewayOfHost(event.remoteMta) ?? readBounceText(event.detail).gateway ?? known)
        : known
    if (!gateway || gateway === 'none') continue
    // `other` is many unrelated exchanges and never holds, so a delivery
    // there would be a write that decides nothing; a refusal is still kept.
    if (event.type === 'delivered' && gateway === 'other') continue
    await recordMailGatewayOutcome(
      null,
      {
        sendingDomain,
        gateway,
        outcome: event.type === 'bounced' ? 'blocked' : 'delivered',
        atMs: event.at,
        detail: event.type === 'bounced' ? event.detail : null,
      },
      deps,
    )
    recorded += 1
  }
  return recorded
}

/*==========================================
 * THE STAFF READ
 *==========================================*/

/** One row of the platform ledger as the staff console shows it. */
export interface MailGatewayLedgerRow extends MailGatewayLedger {
  id: string
  /** A pooled or platform sending domain: a block there hurts every tenant. */
  shared: boolean
  standing: MailGatewayStanding
  /** Whether bulk mail from this domain into this gateway is held today. */
  holds: boolean
}

/** The platform ledger, most recently moved first. */
export async function listMailGatewayLedgers(
  options: { limit?: number } = {},
  deps: MailDeliverabilityDeps = {},
): Promise<MailGatewayLedgerRow[]> {
  const nowMs = deps.nowMs ?? Date.now()
  const firestore = deps.firestore ?? defaultFirestore()
  const limit = Math.min(Math.max(1, Math.floor(Number(options.limit) || 100)), 500)
  const snapshot = await firestore
    .collection(MAIL_GATEWAY_LEDGER_COLLECTION)
    .orderBy('updatedAtMs', 'desc')
    .limit(limit)
    .get()
  const rows: MailGatewayLedgerRow[] = []
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>
    const ledger = readStoredMailGatewayLedger(doc.id, data)
    if (!ledger) continue
    const standing = mailGatewayStanding(ledger.gateway, ledger, nowMs)
    rows.push({
      ...ledger,
      id: doc.id,
      shared: data['shared'] === true || isSharedMailSendingDomain(ledger.sendingDomain),
      standing,
      holds: mailGatewayHolds(standing),
    })
  }
  return rows
}

installEmailDeliverabilityPreflight()
