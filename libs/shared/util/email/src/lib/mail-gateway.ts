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
 * THE MX RECORD PREDICTS THE GATEWAY, AND THE GATEWAY'S HISTORY WITH A
 * SENDING DOMAIN PREDICTS THE BLOCK (AGL-3326, AGL-3328).
 *
 * A security gateway refuses a SENDER, not an address: a Barracuda that
 * refused `aglyn.io` on reputation refuses it for every company behind a
 * Barracuda, and the next address there bounces the same way. So the signal
 * is cheap and it is available BEFORE a send: the recipient domain's MX
 * names the gateway in front of it, and what that gateway did with this
 * sending domain's mail lately says what it will do next.
 *
 * Pure, for the reason every module in this library is: the barrel reaches
 * the browser, so the DNS lookup and the ledger's store are handed in by
 * the server layer that owns them.
 *
 * ## The kinds
 *
 * A gateway is named by the MX host's suffix. `barracuda`, `proofpoint`
 * and `mimecast` are the security gateways that refuse a sender on policy
 * and reputation; `google` and `microsoft` are the two hosted providers,
 * which judge mail one message at a time; `other` is every self-hosted or
 * unrecognized exchange; `none` is a domain that takes no mail at all.
 *
 * ## The ledger and the hold
 *
 * Every send, every delivery and every refusal is counted per SENDING DOMAIN
 * per gateway, by UTC day. A gateway that REFUSED a sending domain twice in
 * the last {@link MAIL_GATEWAY_WINDOW_DAYS} days without delivering once
 * holds the next bulk send from that domain into it. `other` never holds,
 * because it is a bucket of unrelated exchanges rather than one gateway;
 * `none` refuses instead. Which sends a hold may touch is the caller's
 * question — see `email-deliverability.ts`: mail the recipient asked for is
 * never held.
 *==========================================*/

export type MailGateway =
  | 'barracuda'
  | 'proofpoint'
  | 'mimecast'
  | 'google'
  | 'microsoft'
  | 'other'
  | 'none'

export const MAIL_GATEWAYS: readonly MailGateway[] = [
  'barracuda',
  'proofpoint',
  'mimecast',
  'google',
  'microsoft',
  'other',
  'none',
]

/** The gateway as a chip, a table row or a sentence names it. */
export const MAIL_GATEWAY_LABELS: Record<MailGateway, string> = {
  barracuda: 'Barracuda',
  proofpoint: 'Proofpoint',
  mimecast: 'Mimecast',
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  other: 'Other mail gateway',
  none: 'No MX record',
}

/**
 * The security gateways that stand in front of a whole company's mail and
 * refuse a sender for everyone behind them.
 */
export const MAIL_GATEWAYS_FRONTED: readonly MailGateway[] = ['barracuda', 'proofpoint', 'mimecast']

/** Refusals in the window, with no delivery beside them, that hold the next bulk send. */
export const MAIL_GATEWAY_HOLD_BLOCKS = 2

/** The days the hold is judged over. */
export const MAIL_GATEWAY_WINDOW_DAYS = 30

/** The days a gateway chip counts. */
export const MAIL_GATEWAY_CHIP_DAYS = 7

/** How long a domain's MX answer is trusted before it is looked up again. */
export const MAIL_DOMAIN_INTEL_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * How long an answer that the domain takes NO mail is trusted: a day, so a
 * domain whose owner is still setting up its mail is looked at again soon.
 */
export const MAIL_DOMAIN_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000

/** A send with no bounce this long after it counts as delivered, where no delivery event is reported. */
export const MAIL_GATEWAY_DELIVERED_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * The deliveries one ledger counts per UTC day at most.
 *
 * The hold asks whether a gateway delivered ANYTHING in the window, and the
 * chip reads a week of counts; neither needs the ten-thousandth delivery of
 * a campaign to Gmail, and a ledger document written once per delivery
 * event would be the hottest document in the database. A day that reached
 * the cap reads "at least".
 */
export const MAIL_GATEWAY_DAILY_DELIVERY_CAP = 50

/** The MX host suffixes each named gateway answers as, lowercase, no trailing dot. */
const GATEWAY_HOST_SUFFIXES: ReadonlyArray<readonly [MailGateway, readonly string[]]> = [
  ['barracuda', ['.ess.barracudanetworks.com', '.barracudanetworks.com']],
  ['proofpoint', ['.pphosted.com', '.ppe-hosted.com', '.proofpoint.com']],
  ['mimecast', ['.mimecast.com', '.mimecast.co.za', '.mimecast-offshore.com']],
  ['google', ['.google.com', '.googlemail.com', '.gmail.com']],
  ['microsoft', ['.mail.protection.outlook.com', '.outlook.com', '.protection.outlook.com']],
]

/** A host as the suffix table reads it: lowercase, trimmed, no trailing dot. */
export function normalizeMailHost(host: unknown): string {
  return String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

/** Whether a value names one of the gateways. */
export function isMailGateway(value: unknown): value is MailGateway {
  return (MAIL_GATEWAYS as readonly unknown[]).includes(value)
}

/**
 * The gateway ONE host names, or `null` when it names none of the known
 * ones — a Remote-MTA in a bounce, or one MX exchange.
 */
export function mailGatewayOfHost(host: unknown): MailGateway | null {
  const name = normalizeMailHost(host)
  if (!name) return null
  for (const [gateway, suffixes] of GATEWAY_HOST_SUFFIXES) {
    if (suffixes.some((suffix) => name === suffix.slice(1) || name.endsWith(suffix))) return gateway
  }
  return null
}

/**
 * The gateway a domain's MX records name. A domain whose exchanges name more
 * than one is read as the first named one in MX order (the list is handed
 * over lowest-preference-first); one that names none is `other`; an empty
 * list, or RFC 7505's lone ".", is `none`.
 */
export function classifyMailGateway(mxHosts: readonly string[]): MailGateway {
  const hosts = mxHosts.map(normalizeMailHost).filter(Boolean)
  if (!hosts.length) return 'none'
  for (const host of hosts) {
    const gateway = mailGatewayOfHost(host)
    if (gateway) return gateway
  }
  return 'other'
}

/** Whether the gateway is one of the security gateways that refuse a sender for a whole company. */
export function isMailGatewayFronted(gateway: MailGateway | null | undefined): boolean {
  return gateway !== null && gateway !== undefined && MAIL_GATEWAYS_FRONTED.includes(gateway)
}

/** The counts one UTC day holds on a gateway's ledger. */
export interface MailGatewayDayCounts {
  sent: number
  delivered: number
  blocked: number
}

/** What a send met at a gateway, as the ledger counts it. */
export type MailGatewayOutcome = keyof MailGatewayDayCounts

/** `YYYY-MM-DD` in UTC: the day a ledger entry is filed under. */
export function mailGatewayDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10)
}

const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

/** The ledger's counts summed over the last `windowDays` UTC days, today included. */
export function mailGatewayWindow(
  days: Record<string, Partial<MailGatewayDayCounts>> | null | undefined,
  nowMs: number,
  windowDays: number,
): MailGatewayDayCounts {
  const summed: MailGatewayDayCounts = { sent: 0, delivered: 0, blocked: 0 }
  if (!days) return summed
  const oldest = mailGatewayDay(nowMs - (windowDays - 1) * 86_400_000)
  const newest = mailGatewayDay(nowMs)
  for (const [day, counts] of Object.entries(days)) {
    if (day < oldest || day > newest) continue
    summed.sent += count(counts?.sent)
    summed.delivered += count(counts?.delivered)
    summed.blocked += count(counts?.blocked)
  }
  return summed
}

/** The ledger's days with everything older than `keepDays` dropped. */
export function pruneMailGatewayDays<T>(
  days: Record<string, T> | null | undefined,
  nowMs: number,
  keepDays: number,
): Record<string, T> {
  const oldest = mailGatewayDay(nowMs - (keepDays - 1) * 86_400_000)
  return Object.fromEntries(Object.entries(days ?? {}).filter(([day]) => day >= oldest))
}

/*==========================================
 * THE LEDGER, keyed SENDING DOMAIN × GATEWAY.
 *==========================================*/

/**
 * One sending domain's record with one gateway: totals, and the same counts
 * by UTC day for the windows the hold and the chip read. Stored by the
 * server layer under {@link mailGatewayLedgerKey}.
 */
export interface MailGatewayLedger {
  /** The domain the mail left from — the `From:` domain, or a mailbox's. */
  sendingDomain: string
  gateway: MailGateway
  sent: number
  delivered: number
  blocked: number
  lastBlockedAtMs: number | null
  /** The last refusal's diagnostic, scrubbed of addresses, for the staff table. */
  lastBlockedDetail: string | null
  /** `YYYY-MM-DD` (UTC) → that day's counts, the last thirty days kept. */
  days: Record<string, MailGatewayDayCounts>
  updatedAtMs: number
}

/** A sending domain as the ledger spells it: lowercase, no trailing dot, `null` for none. */
export function normalizeLedgerSendingDomain(value: unknown): string | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
  const domain = (raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : raw).replace(/[>\s]+$/, '').replace(/\.$/, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null
}

/**
 * The document id a ledger is stored under: `aglyn.io~barracuda`. A `~`
 * because a domain never holds one and a Firestore id may.
 */
export function mailGatewayLedgerKey(sendingDomain: string, gateway: MailGateway): string {
  return `${sendingDomain}~${gateway}`
}

/** A stored ledger in its model shape, or `null` for no document or an unreadable one. */
export function readStoredMailGatewayLedger(
  id: string,
  data: Record<string, unknown> | null | undefined,
): MailGatewayLedger | null {
  if (!data) return null
  const [idDomain, idGateway] = String(id ?? '').split('~')
  const gateway = isMailGateway(data['gateway']) ? data['gateway'] : isMailGateway(idGateway) ? idGateway : null
  const sendingDomain = normalizeLedgerSendingDomain(data['sendingDomain'] ?? idDomain)
  if (!gateway || !sendingDomain) return null
  const days: MailGatewayLedger['days'] = {}
  const raw = data['days']
  if (raw && typeof raw === 'object') {
    for (const [day, counts] of Object.entries(raw as Record<string, unknown>)) {
      const entry = (counts && typeof counts === 'object' ? counts : {}) as Record<string, unknown>
      days[day] = { sent: count(entry['sent']), delivered: count(entry['delivered']), blocked: count(entry['blocked']) }
    }
  }
  const ms = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    sendingDomain,
    gateway,
    sent: count(data['sent']),
    delivered: count(data['delivered']),
    blocked: count(data['blocked']),
    lastBlockedAtMs: ms(data['lastBlockedAtMs']),
    lastBlockedDetail: typeof data['lastBlockedDetail'] === 'string' ? data['lastBlockedDetail'] : null,
    days,
    updatedAtMs: ms(data['updatedAtMs']) ?? 0,
  }
}

/**
 * The ledger after one more outcome — the pure half of the write, which the
 * store runs inside its transaction. Deliveries stop counting for the day at
 * {@link MAIL_GATEWAY_DAILY_DELIVERY_CAP}; answers `null` when the write
 * would change nothing, so the store can skip it.
 */
export function applyMailGatewayOutcome(
  ledger: MailGatewayLedger | null,
  input: {
    sendingDomain: string
    gateway: MailGateway
    outcome: MailGatewayOutcome
    count?: number
    atMs: number
    detail?: string | null
  },
): MailGatewayLedger | null {
  const day = mailGatewayDay(input.atMs)
  const days = pruneMailGatewayDays(ledger?.days, input.atMs, MAIL_GATEWAY_WINDOW_DAYS)
  const today = days[day] ?? { sent: 0, delivered: 0, blocked: 0 }
  let by = count(input.count ?? 1)
  if (input.outcome === 'delivered') by = Math.min(by, Math.max(0, MAIL_GATEWAY_DAILY_DELIVERY_CAP - today.delivered))
  if (!by) return null
  days[day] = { ...today, [input.outcome]: today[input.outcome] + by }
  const blocked = input.outcome === 'blocked'
  return {
    sendingDomain: input.sendingDomain,
    gateway: input.gateway,
    sent: (ledger?.sent ?? 0) + (input.outcome === 'sent' ? by : 0),
    delivered: (ledger?.delivered ?? 0) + (input.outcome === 'delivered' ? by : 0),
    blocked: (ledger?.blocked ?? 0) + (blocked ? by : 0),
    lastBlockedAtMs: blocked ? Math.max(ledger?.lastBlockedAtMs ?? 0, input.atMs) : (ledger?.lastBlockedAtMs ?? null),
    lastBlockedDetail: blocked
      ? String(input.detail ?? '').trim().slice(0, 300) || (ledger?.lastBlockedDetail ?? null)
      : (ledger?.lastBlockedDetail ?? null),
    days,
    updatedAtMs: input.atMs,
  }
}

/**
 * What a surface knows about the gateway in front of one address: which it
 * is, and what it did with this sending domain's mail over the chip's week
 * and the hold's month.
 */
export interface MailGatewayStanding {
  gateway: MailGateway
  /** Refusals and deliveries in the last {@link MAIL_GATEWAY_CHIP_DAYS} days. */
  blocked7: number
  delivered7: number
  /** Refusals and deliveries in the last {@link MAIL_GATEWAY_WINDOW_DAYS} days. */
  blocked30: number
  delivered30: number
}

/** A gateway's standing with a sending domain, read off its ledger (or none yet). */
export function mailGatewayStanding(
  gateway: MailGateway,
  ledger: Pick<MailGatewayLedger, 'days'> | null | undefined,
  nowMs: number,
): MailGatewayStanding {
  const week = mailGatewayWindow(ledger?.days, nowMs, MAIL_GATEWAY_CHIP_DAYS)
  const month = mailGatewayWindow(ledger?.days, nowMs, MAIL_GATEWAY_WINDOW_DAYS)
  return {
    gateway,
    blocked7: week.blocked,
    delivered7: week.delivered,
    blocked30: month.blocked,
    delivered30: month.delivered,
  }
}

/**
 * Whether the gateway holds the next bulk send — see the module note. A
 * named gateway only: `other` is many exchanges, and `none` refuses instead.
 */
export function mailGatewayHolds(standing: Pick<MailGatewayStanding, 'gateway' | 'blocked30' | 'delivered30'>): boolean {
  if (standing.gateway === 'other' || standing.gateway === 'none') return false
  return count(standing.blocked30) >= MAIL_GATEWAY_HOLD_BLOCKS && count(standing.delivered30) === 0
}

/** Why a gateway holds, in one sentence a surface or a send record can carry. */
export function mailGatewayHoldSentence(gateway: MailGateway, blocked30: number): string {
  const name = MAIL_GATEWAY_LABELS[gateway]
  return (
    `${name} refused this sender ${blocked30 === 2 ? 'twice' : `${blocked30} times`} in the last ` +
    `${MAIL_GATEWAY_WINDOW_DAYS} days and delivered nothing`
  )
}

/** The chip's tone: what color a surface gives it. */
export type MailGatewayChipTone = 'refused' | 'delivered' | 'neutral' | 'blocked'

export interface MailGatewayChip {
  label: string
  tone: MailGatewayChipTone
}

/**
 * The chip for one address, or `null` when there is nothing worth a chip: an
 * unrecognized exchange with no verdict this week. Red for a gateway that
 * refused this week, green for one that delivered, neutral for the hosted
 * providers and the security gateways with no verdict yet, and blocked for a
 * domain with no MX.
 */
export function mailGatewayChip(standing: MailGatewayStanding | null | undefined): MailGatewayChip | null {
  if (!standing) return null
  const name = MAIL_GATEWAY_LABELS[standing.gateway]
  if (standing.gateway === 'none') return { label: 'No MX record — cannot receive mail', tone: 'blocked' }
  const blocked = count(standing.blocked7)
  const delivered = count(standing.delivered7)
  const settled = blocked + delivered
  if (blocked > 0) {
    return {
      label: `${name} · ${blocked} of ${settled} ${settled === 1 ? 'send' : 'sends'} refused this week`,
      tone: 'refused',
    }
  }
  if (delivered > 0) {
    return { label: `${name} · ${delivered} of ${settled} delivered this week`, tone: 'delivered' }
  }
  if (standing.gateway === 'other') return null
  return { label: name, tone: 'neutral' }
}
