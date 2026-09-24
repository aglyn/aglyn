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
 * THE MX RECORD PREDICTS THE GATEWAY, AND THE GATEWAY'S HISTORY PREDICTS
 * THE BLOCK (AGL-3326).
 *
 * Two Barracuda gateways refused the same sender three days apart, and each
 * refusal was read only after the email had left: a hard bounce, a paused
 * mailbox, ten first emails still queued. Both domains had Barracuda ESS as
 * their MX, and a third enrolled domain with the same MX was stopped by hand
 * before it sent. So the signal is cheap and it is available BEFORE a send:
 * the domain's MX names the gateway in front of it, and what that gateway
 * has done with this organization's mail lately says what it will do next.
 *
 * ## The kinds
 *
 * A gateway is named by the MX host's suffix. `barracuda`, `proofpoint`
 * and `mimecast` are the security gateways that refuse a SENDER on policy
 * and reputation; `google` and `microsoft` are the two hosted providers,
 * which judge mail one message at a time; `other` is every self-hosted or
 * unrecognized exchange; `none` is a domain with no MX at all, which cannot
 * receive mail and blocks the enrollment outright.
 *
 * ## The ledger and the hold
 *
 * Every send, every delivery and every block is counted per gateway per
 * organization, by UTC day, and a gateway that has REFUSED this
 * organization twice in the last {@link OUTREACH_GATEWAY_WINDOW_DAYS} days
 * without delivering once holds the next send into it: nothing goes into a
 * gateway that has refused us twice unless a member says so. `other` never
 * holds, because it is a bucket of unrelated exchanges rather than one
 * gateway; `none` blocks instead.
 *==========================================*/

export type OutreachMailGateway =
  | 'barracuda'
  | 'proofpoint'
  | 'mimecast'
  | 'google'
  | 'microsoft'
  | 'other'
  | 'none'

export const OUTREACH_MAIL_GATEWAYS: readonly OutreachMailGateway[] = [
  'barracuda',
  'proofpoint',
  'mimecast',
  'google',
  'microsoft',
  'other',
  'none',
]

/** The gateway as the Check-people chip and the enrollment row name it. */
export const OUTREACH_MAIL_GATEWAY_LABELS: Record<OutreachMailGateway, string> = {
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
 * refuse a sender for everyone behind them: the ones the enroll dialog
 * counts as "gateway-fronted".
 */
export const OUTREACH_GATEWAY_FRONTED: readonly OutreachMailGateway[] = ['barracuda', 'proofpoint', 'mimecast']

/** Blocks in the window, with no delivery beside them, that hold the next send. */
export const OUTREACH_GATEWAY_HOLD_BLOCKS = 2

/** The days the hold is judged over. */
export const OUTREACH_GATEWAY_WINDOW_DAYS = 30

/** The days the Check-people chip counts. */
export const OUTREACH_GATEWAY_CHIP_DAYS = 7

/** How long a domain's MX answer is trusted before it is looked up again. */
export const OUTREACH_DOMAIN_INTEL_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** A send with no bounce this long after it counts as delivered. */
export const OUTREACH_GATEWAY_DELIVERED_AFTER_MS = 24 * 60 * 60 * 1000

/** The MX host suffixes each named gateway answers as, lowercase, no trailing dot. */
const GATEWAY_HOST_SUFFIXES: ReadonlyArray<readonly [OutreachMailGateway, readonly string[]]> = [
  ['barracuda', ['.ess.barracudanetworks.com', '.barracudanetworks.com']],
  ['proofpoint', ['.pphosted.com', '.ppe-hosted.com', '.proofpoint.com']],
  ['mimecast', ['.mimecast.com', '.mimecast.co.za', '.mimecast-offshore.com']],
  ['google', ['.google.com', '.googlemail.com', '.gmail.com']],
  ['microsoft', ['.mail.protection.outlook.com', '.outlook.com', '.protection.outlook.com']],
]

/** A host as the suffix table reads it: lowercase, trimmed, no trailing dot. */
function normalizeHost(host: unknown): string {
  return String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

/**
 * The gateway ONE host names, or `null` when it names none of the known
 * ones — a Remote-MTA in a bounce, or one MX exchange.
 */
export function outreachMailGatewayOfHost(host: unknown): OutreachMailGateway | null {
  const name = normalizeHost(host)
  if (!name) return null
  for (const [gateway, suffixes] of GATEWAY_HOST_SUFFIXES) {
    if (suffixes.some((suffix) => name === suffix.slice(1) || name.endsWith(suffix))) return gateway
  }
  return null
}

/**
 * The gateway a domain's MX records name — see the module note. A domain
 * whose exchanges name more than one is read as the first named one in MX
 * order (the list is handed over lowest-priority-first); one that names
 * none is `other`; an empty list is `none`.
 */
export function classifyOutreachMailGateway(mxHosts: readonly string[]): OutreachMailGateway {
  const hosts = mxHosts.map(normalizeHost).filter(Boolean)
  // A lone "." (or an empty exchange) is RFC 7505's null MX: the domain
  // says outright that it takes no mail.
  if (!hosts.length) return 'none'
  for (const host of hosts) {
    const gateway = outreachMailGatewayOfHost(host)
    if (gateway) return gateway
  }
  return 'other'
}

/** Whether the gateway is one of the security gateways that refuse a sender for a whole company. */
export function isOutreachGatewayFronted(gateway: OutreachMailGateway | null | undefined): boolean {
  return gateway !== null && gateway !== undefined && OUTREACH_GATEWAY_FRONTED.includes(gateway)
}

/** The counts one UTC day holds on a gateway's ledger. */
export interface OutreachGatewayDayCounts {
  sent: number
  delivered: number
  blocked: number
}

/** `YYYY-MM-DD` in UTC: the day a ledger entry is filed under. */
export function outreachGatewayDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10)
}

const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

/** The ledger's counts summed over the last `days` UTC days, today included. */
export function outreachGatewayWindow(
  days: Record<string, Partial<OutreachGatewayDayCounts>> | null | undefined,
  nowMs: number,
  windowDays: number,
): OutreachGatewayDayCounts {
  const summed: OutreachGatewayDayCounts = { sent: 0, delivered: 0, blocked: 0 }
  if (!days) return summed
  const oldest = outreachGatewayDay(nowMs - (windowDays - 1) * 86_400_000)
  const newest = outreachGatewayDay(nowMs)
  for (const [day, counts] of Object.entries(days)) {
    if (day < oldest || day > newest) continue
    summed.sent += count(counts?.sent)
    summed.delivered += count(counts?.delivered)
    summed.blocked += count(counts?.blocked)
  }
  return summed
}

/** The ledger's days with everything older than `keepDays` dropped. */
export function pruneOutreachGatewayDays<T>(
  days: Record<string, T> | null | undefined,
  nowMs: number,
  keepDays: number,
): Record<string, T> {
  const oldest = outreachGatewayDay(nowMs - (keepDays - 1) * 86_400_000)
  return Object.fromEntries(Object.entries(days ?? {}).filter(([day]) => day >= oldest))
}

/**
 * What the gates and the enroll dialog know about the gateway in front of
 * one address: which it is, and what it did with this organization's mail
 * over the chip's week and the hold's month.
 */
export interface OutreachGatewayStanding {
  gateway: OutreachMailGateway
  /** Blocks and deliveries in the last {@link OUTREACH_GATEWAY_CHIP_DAYS} days. */
  blocked7: number
  delivered7: number
  /** Blocks and deliveries in the last {@link OUTREACH_GATEWAY_WINDOW_DAYS} days. */
  blocked30: number
  delivered30: number
}

/**
 * Whether the gateway holds the next send — see the module note. A named
 * gateway only: `other` is many exchanges, and `none` blocks instead.
 */
export function outreachGatewayHolds(standing: Pick<OutreachGatewayStanding, 'gateway' | 'blocked30' | 'delivered30'>): boolean {
  if (standing.gateway === 'other' || standing.gateway === 'none') return false
  return count(standing.blocked30) >= OUTREACH_GATEWAY_HOLD_BLOCKS && count(standing.delivered30) === 0
}

/** The sentence the hold is written with, on the enrollment and in the engine's reason. */
export function outreachGatewayHoldReason(gateway: OutreachMailGateway, blocked30: number): string {
  const name = OUTREACH_MAIL_GATEWAY_LABELS[gateway]
  return (
    `${name} refused this sender ${blocked30 === 2 ? 'twice' : `${blocked30} times`} in the last ` +
    `${OUTREACH_GATEWAY_WINDOW_DAYS} days and delivered nothing, so this email is held. ` +
    'Resume the enrollment to send it anyway.'
  )
}

/** The chip's tone: what color the Check-people step gives it. */
export type OutreachGatewayChipTone = 'refused' | 'delivered' | 'neutral' | 'blocked'

export interface OutreachGatewayChip {
  label: string
  tone: OutreachGatewayChipTone
}

/**
 * The Check-people chip for one person, or `null` when there is nothing
 * worth a chip: an unrecognized exchange with no verdict this week. Red for
 * a gateway that refused this week, green for one that delivered, neutral
 * for the hosted providers and the security gateways with no verdict yet,
 * and blocked for a domain with no MX.
 */
export function outreachGatewayChip(standing: OutreachGatewayStanding | null | undefined): OutreachGatewayChip | null {
  if (!standing) return null
  const name = OUTREACH_MAIL_GATEWAY_LABELS[standing.gateway]
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
