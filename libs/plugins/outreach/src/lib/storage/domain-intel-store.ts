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
 * WHAT THE ORGANIZATION KNOWS ABOUT THE DOMAINS IT WRITES TO (AGL-3326).
 *
 * Two documents, both server-written:
 *
 * - `outreachDomainIntel/{domain}` — the domain's MX records and the mail
 *   gateway they name, looked up with the resolver the caller hands in and
 *   trusted for {@link OUTREACH_DOMAIN_INTEL_TTL_MS}; beside them, what this
 *   organization's mail met at the domain;
 * - `outreachGatewayStats/{gateway}` — the same three counts per gateway,
 *   in total and by UTC day, which is the ledger the hold and the
 *   Check-people chip read.
 *
 * A read that could not be made answers `null` for the addresses it
 * covered, which the gates refuse as "we couldn't check" — except that a
 * stale answer outranks no answer: a domain whose MX was known last week
 * and cannot be looked up today is read as it was, because a resolver
 * timing out says nothing about the domain. A domain that resolves to no
 * MX at all is `none`, and the gates block it.
 *
 * The ledger is written in a transaction over both documents so a run that
 * records a block and a run that credits a delivery cannot lose each
 * other's count, and the days map is pruned on every write so it never
 * grows past the window it serves.
 */

import type { OutreachGatewayStanding, OutreachMailGateway } from '../engine/mail-gateway'
import {
  classifyOutreachMailGateway,
  OUTREACH_DOMAIN_INTEL_TTL_MS,
  OUTREACH_GATEWAY_CHIP_DAYS,
  OUTREACH_GATEWAY_WINDOW_DAYS,
  OUTREACH_MAIL_GATEWAYS,
  outreachGatewayDay,
  outreachGatewayWindow,
  pruneOutreachGatewayDays,
} from '../engine/mail-gateway'
import { normalizeOutreachDomain, outreachEmailDomain } from '../engine/do-not-contact-domain'
import type { OutreachDomainIntel, OutreachGatewayStats } from '../model/outreach.types'
import { outreachOrgCollection } from './outreach-records'

type Firestore = FirebaseFirestore.Firestore

/** One MX record as Node's resolver answers it. */
export interface OutreachMxRecord {
  exchange: string
  priority: number
}

/**
 * `dns.promises.resolveMx`, or a stand-in: the platform hands in Node's,
 * the specs hand in a table. Rejects the way Node does — `code`
 * `ENOTFOUND` or `ENODATA` for a domain with no MX — and any other
 * rejection is a resolver that could not answer.
 */
export type OutreachResolveMx = (domain: string) => Promise<ReadonlyArray<OutreachMxRecord>>

/** What a domain-intel read needs beside the store. */
export interface OutreachDomainIntelReadInput {
  resolveMx: OutreachResolveMx
  nowMs: number
}

/** `getAll` takes this many references at most per call. */
const GET_ALL_CHUNK = 300

/** The resolver's codes that mean "this domain has no MX", as opposed to "I could not ask". */
const NO_MX_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'NOTFOUND'])

const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}
const ms = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const gatewayOf = (value: unknown): OutreachMailGateway | null =>
  (OUTREACH_MAIL_GATEWAYS as readonly unknown[]).includes(value) ? (value as OutreachMailGateway) : null

/** A stored domain-intel document in its model shape, or `null` for no document. */
export function readStoredOutreachDomainIntel(
  id: string,
  data: Record<string, unknown> | undefined,
): OutreachDomainIntel | null {
  if (!data) return null
  const gateway = gatewayOf(data['gateway'])
  if (!gateway) return null
  return {
    domain: typeof data['domain'] === 'string' && data['domain'] ? data['domain'] : id,
    mx: Array.isArray(data['mx']) ? data['mx'].filter((entry): entry is string => typeof entry === 'string') : [],
    gateway,
    resolvedAtMs: ms(data['resolvedAtMs']) ?? 0,
    sent: count(data['sent']),
    delivered: count(data['delivered']),
    blocked: count(data['blocked']),
    lastBlockedAtMs: ms(data['lastBlockedAtMs']),
    updatedAtMs: ms(data['updatedAtMs']) ?? 0,
  }
}

/** A stored gateway ledger in its model shape, or `null` for no document. */
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

/**
 * A domain's MX, resolved and classified — see the module note. A domain
 * the resolver says has no MX answers `none`; a resolver that could not
 * answer rejects, and the caller decides what a missing answer means.
 */
export async function resolveOutreachDomainMx(
  resolveMx: OutreachResolveMx,
  domain: string,
): Promise<{ mx: string[]; gateway: OutreachMailGateway }> {
  let records: ReadonlyArray<OutreachMxRecord>
  try {
    records = await resolveMx(domain)
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '').toUpperCase()
    if (NO_MX_CODES.has(code)) return { mx: [], gateway: 'none' }
    throw error
  }
  const mx = [...records]
    .filter((record) => record && typeof record.exchange === 'string')
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
    .map((record) => record.exchange.trim().toLowerCase().replace(/\.$/, ''))
    // RFC 7505's null MX — a lone "." — says the domain takes no mail.
    .filter((exchange) => exchange && exchange !== '.')
  return { mx, gateway: classifyOutreachMailGateway(mx) }
}

const intelCollection = (firestore: Firestore, orgId: string) =>
  outreachOrgCollection(firestore, orgId, 'domainIntel')
const statsCollection = (firestore: Firestore, orgId: string) =>
  outreachOrgCollection(firestore, orgId, 'gatewayStats')

/**
 * The domain intel for every address, keyed by address — fresh from the
 * store, or looked up and stored when missing or older than the TTL. An
 * address with no domain, and one whose domain could not be looked up and
 * was never known, answers `null`.
 */
export async function readOutreachDomainIntel(
  firestore: Firestore,
  orgId: string,
  emails: readonly string[],
  input: OutreachDomainIntelReadInput,
): Promise<Map<string, OutreachDomainIntel | null>> {
  const answers = new Map<string, OutreachDomainIntel | null>()
  const domainOf = new Map<string, string>()
  for (const email of emails) {
    const domain = outreachEmailDomain(email)
    if (domain) domainOf.set(email, domain)
    else answers.set(email, null)
  }
  const domains = [...new Set(domainOf.values())]
  if (!domains.length) return answers
  const collection = intelCollection(firestore, orgId)
  const known = new Map<string, OutreachDomainIntel | null>()
  try {
    for (let start = 0; start < domains.length; start += GET_ALL_CHUNK) {
      const chunk = domains.slice(start, start + GET_ALL_CHUNK)
      const snapshots = await firestore.getAll(...chunk.map((domain) => collection.doc(domain)))
      chunk.forEach((domain, index) => {
        const snapshot = snapshots[index]
        known.set(domain, readStoredOutreachDomainIntel(domain, snapshot?.exists ? snapshot.data() : undefined))
      })
    }
  } catch (error) {
    console.error('[outreach] domain intel lookup failed; reading as unchecked', error)
    for (const email of domainOf.keys()) answers.set(email, null)
    return answers
  }
  await Promise.all(
    domains.map(async (domain) => {
      const stored = known.get(domain) ?? null
      if (stored && stored.resolvedAtMs + OUTREACH_DOMAIN_INTEL_TTL_MS > input.nowMs) return
      let resolved: { mx: string[]; gateway: OutreachMailGateway }
      try {
        resolved = await resolveOutreachDomainMx(input.resolveMx, domain)
      } catch (error) {
        // A resolver that could not answer: the stale answer stands, and a
        // domain never looked up is unchecked.
        console.error(`[outreach] the MX of ${domain} could not be looked up`, error)
        return
      }
      const fresh: OutreachDomainIntel = {
        domain,
        mx: resolved.mx,
        gateway: resolved.gateway,
        resolvedAtMs: input.nowMs,
        sent: stored?.sent ?? 0,
        delivered: stored?.delivered ?? 0,
        blocked: stored?.blocked ?? 0,
        lastBlockedAtMs: stored?.lastBlockedAtMs ?? null,
        updatedAtMs: input.nowMs,
      }
      known.set(domain, fresh)
      try {
        await collection.doc(domain).set(
          { domain, mx: fresh.mx, gateway: fresh.gateway, resolvedAtMs: fresh.resolvedAtMs, updatedAtMs: fresh.updatedAtMs },
          { merge: true },
        )
      } catch (error) {
        // The cache is a convenience; the answer is already in hand.
        console.error(`[outreach] the MX of ${domain} could not be cached`, error)
      }
    }),
  )
  for (const [email, domain] of domainOf) answers.set(email, known.get(domain) ?? null)
  return answers
}

/** The ledger of each gateway named, keyed by gateway; a gateway with no ledger yet answers `null`. */
export async function readOutreachGatewayStats(
  firestore: Firestore,
  orgId: string,
  gateways: readonly OutreachMailGateway[],
): Promise<Map<OutreachMailGateway, OutreachGatewayStats | null>> {
  const answers = new Map<OutreachMailGateway, OutreachGatewayStats | null>()
  const wanted = [...new Set(gateways)]
  if (!wanted.length) return answers
  const collection = statsCollection(firestore, orgId)
  const snapshots = await firestore.getAll(...wanted.map((gateway) => collection.doc(gateway)))
  wanted.forEach((gateway, index) => {
    const snapshot = snapshots[index]
    answers.set(gateway, readStoredOutreachGatewayStats(gateway, snapshot?.exists ? snapshot.data() : undefined))
  })
  return answers
}

/** What the gates and the chip read for one domain: its gateway and that gateway's recent record here. */
export function outreachGatewayStandingOf(
  intel: OutreachDomainIntel,
  stats: OutreachGatewayStats | null,
  nowMs: number,
): OutreachGatewayStanding {
  const week = outreachGatewayWindow(stats?.days, nowMs, OUTREACH_GATEWAY_CHIP_DAYS)
  const month = outreachGatewayWindow(stats?.days, nowMs, OUTREACH_GATEWAY_WINDOW_DAYS)
  return {
    gateway: intel.gateway,
    blocked7: week.blocked,
    delivered7: week.delivered,
    blocked30: month.blocked,
    delivered30: month.delivered,
  }
}

/**
 * The gateway standing of every address, keyed by address: the domain
 * intel read (and refreshed) above, joined to the ledger of each gateway it
 * names. `null` for an address whose domain could not be checked.
 */
export async function readOutreachGatewayStandings(
  firestore: Firestore,
  orgId: string,
  emails: readonly string[],
  input: OutreachDomainIntelReadInput,
): Promise<Map<string, OutreachGatewayStanding | null>> {
  const intel = await readOutreachDomainIntel(firestore, orgId, emails, input)
  const gateways = [...intel.values()]
    .filter((entry): entry is OutreachDomainIntel => entry !== null)
    .map((entry) => entry.gateway)
  let stats: Map<OutreachMailGateway, OutreachGatewayStats | null>
  try {
    stats = await readOutreachGatewayStats(firestore, orgId, gateways)
  } catch (error) {
    console.error('[outreach] gateway ledger lookup failed; reading as unchecked', error)
    return new Map(emails.map((email) => [email, null]))
  }
  const answers = new Map<string, OutreachGatewayStanding | null>()
  for (const email of emails) {
    const entry = intel.get(email) ?? null
    answers.set(email, entry ? outreachGatewayStandingOf(entry, stats.get(entry.gateway) ?? null, input.nowMs) : null)
  }
  return answers
}

/** What a send met at a gateway, as the ledger counts it. */
export type OutreachGatewayOutcome = 'sent' | 'delivered' | 'blocked'

/**
 * Counts an outcome on the domain's intel and on the gateway's ledger — see
 * the module note. Never throws: the send or the bounce it records has
 * already happened, and a lost count understates a gateway while a thrown
 * one loses the step that called.
 */
export async function recordOutreachGatewayOutcome(
  firestore: Firestore,
  orgId: string,
  input: { domain: string; gateway: OutreachMailGateway; outcome: OutreachGatewayOutcome; count?: number; atMs: number },
): Promise<void> {
  const domain = normalizeOutreachDomain(input.domain)
  const by = count(input.count ?? 1)
  if (!domain || !by) return
  const intelRef = intelCollection(firestore, orgId).doc(domain)
  const statsRef = statsCollection(firestore, orgId).doc(input.gateway)
  const day = outreachGatewayDay(input.atMs)
  try {
    await firestore.runTransaction(async (transaction) => {
      const [intelSnapshot, statsSnapshot] = await Promise.all([transaction.get(intelRef), transaction.get(statsRef)])
      const intel = readStoredOutreachDomainIntel(domain, intelSnapshot.exists ? intelSnapshot.data() : undefined)
      const stats = readStoredOutreachGatewayStats(input.gateway, statsSnapshot.exists ? statsSnapshot.data() : undefined)
      const blockedAt = input.outcome === 'blocked' ? input.atMs : null
      const nextIntel: OutreachDomainIntel = {
        domain,
        // A domain never looked up — enrolled before the intel existed —
        // is written with what the bounce said, and looked up on its next read.
        mx: intel?.mx ?? [],
        gateway: intel?.gateway ?? input.gateway,
        resolvedAtMs: intel?.resolvedAtMs ?? 0,
        sent: (intel?.sent ?? 0) + (input.outcome === 'sent' ? by : 0),
        delivered: (intel?.delivered ?? 0) + (input.outcome === 'delivered' ? by : 0),
        blocked: (intel?.blocked ?? 0) + (input.outcome === 'blocked' ? by : 0),
        lastBlockedAtMs: Math.max(intel?.lastBlockedAtMs ?? 0, blockedAt ?? 0) || null,
        updatedAtMs: input.atMs,
      }
      const days = pruneOutreachGatewayDays(stats?.days, input.atMs, OUTREACH_GATEWAY_WINDOW_DAYS)
      const today = days[day] ?? { sent: 0, delivered: 0, blocked: 0 }
      days[day] = { ...today, [input.outcome]: today[input.outcome] + by }
      const nextStats: OutreachGatewayStats = {
        gateway: input.gateway,
        sent: (stats?.sent ?? 0) + (input.outcome === 'sent' ? by : 0),
        delivered: (stats?.delivered ?? 0) + (input.outcome === 'delivered' ? by : 0),
        blocked: (stats?.blocked ?? 0) + (input.outcome === 'blocked' ? by : 0),
        lastBlockedAtMs: Math.max(stats?.lastBlockedAtMs ?? 0, blockedAt ?? 0) || null,
        days,
        updatedAtMs: input.atMs,
      }
      transaction.set(intelRef, nextIntel)
      transaction.set(statsRef, nextStats)
    })
  } catch (error) {
    console.error(`[outreach] the gateway ledger could not count a ${input.outcome} at ${domain}`, error)
  }
}
