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
 * WHAT SEQUENCES KNOWS ABOUT THE DOMAINS IT WRITES TO (AGL-3326).
 *
 * Both halves live on the platform (AGL-3328), in `@aglyn/tenant-data-admin`'s
 * `email-deliverability`, which the Resend path reads and writes too:
 *
 * - a recipient domain's MX — the platform-wide `mailDomains/{domain}`
 *   cache, looked up with the resolver the caller hands in and trusted for
 *   a week (a day for a domain that takes no mail). The first workspace to
 *   write to a domain warms it for every other;
 * - the ledger — `orgs/{orgId}/mailGatewayLedger/{sendingDomain}~{gateway}`,
 *   keyed by the MAILBOX's sending domain, because a gateway refuses a
 *   sender: the Barracuda that refused `aglyn.io` refuses `aglyn.io`, not
 *   the organization's other mailbox on another domain. It stays under the
 *   organization because a mailbox's domain is not one organization's — two
 *   workspaces can each connect a `gmail.com` mailbox.
 *
 * A read that could not be made answers `null` for the addresses it
 * covered, which the gates refuse as "we couldn't check" — except that a
 * stale answer that the domain takes mail outranks no answer. A domain that
 * resolves to no MX is `none`, and the gates block it.
 *
 * ## The two collections this module wrote first
 *
 * `outreachDomainIntel` and `outreachGatewayStats` are READ THROUGH, not
 * migrated. The first held MX answers, which a lookup re-derives, so it is
 * no longer read. The second held a per-gateway ledger with no sending
 * domain; its days are summed into every sending domain's standing for the
 * thirty days they can still hold a send — the conservative reading, since
 * an organization with one mailbox domain loses nothing and one with two
 * holds a little more. Nothing writes either any more; both are retired,
 * with their rules, once the window has passed.
 */

import {
  type MailDnsResolver,
  type MailDomainIntel,
  type MailGatewayOutcome,
  mailGatewayStanding,
  normalizeLedgerSendingDomain,
  resolveMailDomain,
} from '@aglyn/shared-util-email'
import {
  readMailDomains,
  readMailGatewayLedgers,
  recordMailGatewayOutcome,
} from '@aglyn/tenant-data-admin/server/email-deliverability'
import type { OutreachGatewayStanding, OutreachMailGateway } from '../engine/mail-gateway'
import { OUTREACH_MAIL_GATEWAYS } from '../engine/mail-gateway'
import { outreachEmailDomain } from '../engine/do-not-contact-domain'
import type { OutreachGatewayStats, OutreachMailbox } from '../model/outreach.types'
import { outreachOrgCollection } from './outreach-records'

type Firestore = FirebaseFirestore.Firestore

/** One MX record as Node's resolver answers it. */
export interface OutreachMxRecord {
  exchange: string
  priority: number
}

/**
 * `dns.promises.resolveMx`, or a stand-in: the platform hands in its own
 * resolver, the specs hand in a table. Rejects the way Node does — `code`
 * `ENOTFOUND` or `ENODATA` for a domain with no MX — and any other
 * rejection is a resolver that could not answer.
 */
export type OutreachResolveMx = (domain: string) => Promise<ReadonlyArray<OutreachMxRecord>>

/** What a domain-intel read needs beside the store. */
export interface OutreachDomainIntelReadInput {
  resolveMx: OutreachResolveMx
  /**
   * Whether a domain with no MX has an address record — the implicit MX
   * RFC 5321 still delivers to. Omitted, a domain with no MX reads as none.
   */
  resolveAddress?: (domain: string) => Promise<boolean>
  nowMs: number
  /**
   * The domain the mailbox sends from (AGL-3328): the ledger is keyed by
   * it. Omitted or `null`, no ledger is read and nothing is held.
   */
  sendingDomain?: string | null
}

/** The resolver the platform store reads with, from what a caller hands in. */
function resolverOf(input: Pick<OutreachDomainIntelReadInput, 'resolveMx' | 'resolveAddress'>): MailDnsResolver {
  return {
    resolveMx: input.resolveMx,
    ...(input.resolveAddress ? { resolveAddress: input.resolveAddress } : {}),
  }
}

/** The domain a mailbox's mail leaves from: its send-as address's, else the account's. */
export function outreachMailboxSendingDomain(
  mailbox: Pick<OutreachMailbox, 'sendAs' | 'email'> | null | undefined,
): string | null {
  return normalizeLedgerSendingDomain(mailbox?.sendAs || mailbox?.email)
}

/**
 * A domain's MX, resolved and classified. A domain the resolver says has no
 * MX answers `none`; a resolver that could not answer rejects, and the
 * caller decides what a missing answer means.
 */
export async function resolveOutreachDomainMx(
  resolveMx: OutreachResolveMx,
  domain: string,
): Promise<{ mx: string[]; gateway: OutreachMailGateway }> {
  const intel = await resolveMailDomain({ resolveMx }, domain, 0)
  return { mx: intel.mx, gateway: intel.gateway }
}

/**
 * The MX answer for every address, keyed by address — read through the
 * platform cache, and looked up and stored when missing or stale. An
 * address with no domain, and one whose domain could not be looked up and
 * was never known, answers `null`.
 */
export async function readOutreachDomainIntel(
  firestore: Firestore,
  _orgId: string,
  emails: readonly string[],
  input: OutreachDomainIntelReadInput,
): Promise<Map<string, MailDomainIntel | null>> {
  const answers = new Map<string, MailDomainIntel | null>()
  const domainOf = new Map<string, string>()
  for (const email of emails) {
    const domain = outreachEmailDomain(email)
    if (domain) domainOf.set(email, domain)
    else answers.set(email, null)
  }
  if (!domainOf.size) return answers
  let intel: Map<string, MailDomainIntel | null>
  try {
    intel = await readMailDomains([...new Set(domainOf.values())], {
      firestore,
      resolver: resolverOf(input),
      nowMs: input.nowMs,
    })
  } catch (error) {
    console.error('[outreach] domain intel lookup failed; reading as unchecked', error)
    intel = new Map()
  }
  for (const [email, domain] of domainOf) answers.set(email, intel.get(domain) ?? null)
  return answers
}

const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}
const ms = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const gatewayOf = (value: unknown): OutreachMailGateway | null =>
  (OUTREACH_MAIL_GATEWAYS as readonly unknown[]).includes(value) ? (value as OutreachMailGateway) : null

/** A stored per-gateway ledger from before the sending domain keyed it, or `null` for no document. */
export function readStoredOutreachGatewayStats(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachGatewayStats | null {
  if (!data) return null
  const gateway = gatewayOf(data['gateway']) ?? gatewayOf(id)
  if (!gateway) return null
  const days: OutreachGatewayStats['days'] = {}
  const raw = data['days']
  if (raw && typeof raw === 'object') {
    for (const [day, counts] of Object.entries(raw as Record<string, unknown>)) {
      const entry = (counts && typeof counts === 'object' ? counts : {}) as Record<string, unknown>
      days[day] = { sent: count(entry['sent']), delivered: count(entry['delivered']), blocked: count(entry['blocked']) }
    }
  }
  return {
    gateway,
    sent: count(data['sent']),
    delivered: count(data['delivered']),
    blocked: count(data['blocked']),
    lastBlockedAtMs: ms(data['lastBlockedAtMs']),
    days,
    updatedAtMs: ms(data['updatedAtMs']) ?? 0,
  }
}

/** The per-gateway ledgers written before the sending domain keyed them — see the module note. */
async function readLegacyGatewayStats(
  firestore: Firestore,
  orgId: string,
  gateways: readonly OutreachMailGateway[],
): Promise<Map<OutreachMailGateway, OutreachGatewayStats | null>> {
  const answers = new Map<OutreachMailGateway, OutreachGatewayStats | null>()
  const wanted = [...new Set(gateways)].filter((gateway) => gateway !== 'none')
  if (!wanted.length) return answers
  const collection = outreachOrgCollection(firestore, orgId, 'gatewayStats')
  const snapshots = await firestore.getAll(...wanted.map((gateway) => collection.doc(gateway)))
  wanted.forEach((gateway, index) => {
    const snapshot = snapshots[index]
    answers.set(gateway, readStoredOutreachGatewayStats(gateway, snapshot?.exists ? snapshot.data() : undefined))
  })
  return answers
}

/** Two standings for one gateway, summed. */
function sumStandings(a: OutreachGatewayStanding, b: OutreachGatewayStanding): OutreachGatewayStanding {
  return {
    gateway: a.gateway,
    blocked7: a.blocked7 + b.blocked7,
    delivered7: a.delivered7 + b.delivered7,
    blocked30: a.blocked30 + b.blocked30,
    delivered30: a.delivered30 + b.delivered30,
  }
}

/**
 * The gateway standing of every address, keyed by address: the MX answer
 * read (and refreshed) above, joined to the mailbox's sending-domain ledger
 * with each gateway it names, plus what the legacy per-gateway ledger still
 * holds. `null` for an address whose domain could not be checked.
 */
export async function readOutreachGatewayStandings(
  firestore: Firestore,
  orgId: string,
  emails: readonly string[],
  input: OutreachDomainIntelReadInput,
): Promise<Map<string, OutreachGatewayStanding | null>> {
  const intel = await readOutreachDomainIntel(firestore, orgId, emails, input)
  const gateways = [...intel.values()]
    .filter((entry): entry is MailDomainIntel => entry !== null)
    .map((entry) => entry.gateway)
  const sendingDomain = normalizeLedgerSendingDomain(input.sendingDomain)
  let ledgers: Awaited<ReturnType<typeof readMailGatewayLedgers>>
  let legacy: Map<OutreachMailGateway, OutreachGatewayStats | null>
  try {
    ;[ledgers, legacy] = await Promise.all([
      sendingDomain
        ? readMailGatewayLedgers({ orgId }, sendingDomain, gateways, { firestore, nowMs: input.nowMs })
        : Promise.resolve(new Map()),
      readLegacyGatewayStats(firestore, orgId, gateways),
    ])
  } catch (error) {
    console.error('[outreach] gateway ledger lookup failed; reading as unchecked', error)
    return new Map(emails.map((email) => [email, null]))
  }
  const answers = new Map<string, OutreachGatewayStanding | null>()
  for (const email of emails) {
    const entry = intel.get(email) ?? null
    if (!entry) {
      answers.set(email, null)
      continue
    }
    const current = mailGatewayStanding(entry.gateway, ledgers.get(entry.gateway) ?? null, input.nowMs)
    const previous = mailGatewayStanding(entry.gateway, legacy.get(entry.gateway) ?? null, input.nowMs)
    answers.set(email, sumStandings(current, previous))
  }
  return answers
}

/** What a send met at a gateway, as the ledger counts it. */
export type OutreachGatewayOutcome = MailGatewayOutcome

/**
 * Counts an outcome on the mailbox's sending-domain ledger with a gateway.
 * Never throws: the send or the bounce it records has already happened,
 * and a lost count understates a gateway while a thrown one loses the step
 * that called. A mailbox whose sending domain cannot be read counts nothing.
 */
export async function recordOutreachGatewayOutcome(
  firestore: Firestore,
  orgId: string,
  input: {
    sendingDomain: string | null
    gateway: OutreachMailGateway
    outcome: OutreachGatewayOutcome
    count?: number
    atMs: number
    /** A refusal's diagnostic, kept scrubbed of addresses. */
    detail?: string | null
  },
): Promise<void> {
  const sendingDomain = normalizeLedgerSendingDomain(input.sendingDomain)
  if (!sendingDomain) return
  await recordMailGatewayOutcome(
    { orgId },
    {
      sendingDomain,
      gateway: input.gateway,
      outcome: input.outcome,
      count: input.count,
      atMs: input.atMs,
      detail: input.detail ?? null,
    },
    { firestore },
  )
}
