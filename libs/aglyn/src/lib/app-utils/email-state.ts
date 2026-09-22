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
 * A RECORD'S EMAIL STATE (AGL-3245).
 *
 * The lists the senders consult — the platform suppression list, a site's
 * suppressions, an organization's do-not-contact list — are keyed by a
 * hash nobody can read. The record a person opens is the lead or the
 * contact, and until now it said nothing: an address that hard-bounced at
 * 10:30 still read as "Sent" at 12:30, and a member reading it would have
 * emailed the person again by hand.
 *
 * So the record carries `emailState`: what the last verdict on its address
 * was, when, from which sender, and in the sender's own words. It is
 * WRITTEN BY THE PLATFORM ONLY — the outreach runtime, the campaign
 * webhook, a member's do-not-contact mark — never by a form, an import or
 * the record's own editor, and the rules hold clients off the field. It
 * is a mirror of the lists, not a list: a send still asks the lists, and
 * the record says what they hold in words a person can act on.
 *
 * Absent means nothing is known. `ok` is a verdict too — a release, a
 * confirmed re-subscription — and it is the one state that never
 * overwrites a refusal on its own: the ranking below decides.
 *==========================================*/

/** Every state, weakest first. */
export const CRM_EMAIL_STATE_STATUSES = [
  /** The address may be emailed: released, or confirmed again. */
  'ok',
  /** Mail to it bounced for good: the mailbox does not exist. */
  'bounced',
  /** The recipient's mail gateway refused the sender on policy or reputation. */
  'blocked',
  /** The unsubscribe link or header was used. */
  'unsubscribed',
  /** A reply called the email spam, or the recipient reported it. */
  'complained',
  /** On the organization's do-not-contact list — a member's or the runtime's entry. */
  'do_not_contact',
] as const

export type CrmEmailStateStatus = (typeof CRM_EMAIL_STATE_STATUSES)[number]

/** Which sender's verdict it is. */
export type CrmEmailStateSource = 'outreach' | 'campaign' | 'member'

/** The field on the lead and the contact. */
export const CRM_EMAIL_STATE_FIELD = 'emailState'

export interface CrmEmailState {
  status: CrmEmailStateStatus
  /** When the verdict was given, epoch ms. */
  atMs: number
  source: CrmEmailStateSource
  /** The sender's own words: the bounce's diagnostic, a member's note. */
  detail: string | null
  /** The sequence enrollment it came from, when one did. */
  enrollmentId?: string
}

/** How a state reads on the chip — typed so a state cannot ship unlabeled. */
export const CRM_EMAIL_STATE_LABELS: Record<CrmEmailStateStatus, string> = {
  ok: 'Email OK',
  bounced: 'Bounced',
  blocked: 'Blocked by their mail gateway',
  unsubscribed: 'Unsubscribed',
  complained: 'Marked as spam',
  do_not_contact: 'Do not contact',
}

/**
 * The rank a later verdict must reach to replace an earlier one. A member's
 * do-not-contact mark stands over every automatic verdict; a complaint
 * over an unsubscribe, which is the person's own act over a server's; a
 * block over a bounce, since the block names the whole domain; and `ok`
 * over nothing — a release is written on purpose, by a path that forces it.
 */
const CRM_EMAIL_STATE_RANK: Record<CrmEmailStateStatus, number> = {
  ok: 0,
  bounced: 1,
  blocked: 2,
  unsubscribed: 3,
  complained: 4,
  do_not_contact: 5,
}

export function isCrmEmailStateStatus(value: unknown): value is CrmEmailStateStatus {
  return typeof value === 'string' && (CRM_EMAIL_STATE_STATUSES as readonly string[]).includes(value)
}

/** The state a record holds, held to its shape, or `null` when it holds none. */
export function readCrmEmailState(record: Record<string, unknown> | null | undefined): CrmEmailState | null {
  const raw = record?.[CRM_EMAIL_STATE_FIELD]
  if (!raw || typeof raw !== 'object') return null
  const state = raw as Record<string, unknown>
  if (!isCrmEmailStateStatus(state['status'])) return null
  const atMs = Number(state['atMs'])
  const source = state['source']
  const enrollmentId = typeof state['enrollmentId'] === 'string' && state['enrollmentId'] ? state['enrollmentId'] : undefined
  return {
    status: state['status'],
    atMs: Number.isFinite(atMs) && atMs > 0 ? atMs : 0,
    source: source === 'outreach' || source === 'campaign' || source === 'member' ? source : 'campaign',
    detail: typeof state['detail'] === 'string' && state['detail'] ? state['detail'] : null,
    ...(enrollmentId ? { enrollmentId } : {}),
  }
}

/** Whether the state means the address must not be emailed by hand. */
export function crmEmailStateForbidsEmail(state: CrmEmailState | null | undefined): boolean {
  return Boolean(state) && state?.status !== 'ok'
}

/**
 * The state a record holds after one more verdict: the incoming one when it
 * ranks at least as high as the current — a fresh bounce replaces an old
 * one, a block replaces a bounce, a member's mark replaces anything — else
 * the current. `force` writes the incoming state whatever stands, which is
 * how a release lands.
 */
export function nextCrmEmailState(
  current: CrmEmailState | null | undefined,
  incoming: CrmEmailState,
  options: { force?: boolean } = {},
): CrmEmailState {
  if (!current || options.force) return incoming
  return CRM_EMAIL_STATE_RANK[incoming.status] >= CRM_EMAIL_STATE_RANK[current.status] ? incoming : current
}

/** When the verdict was given, as the chip's tooltip and the refusal say it. */
export function crmEmailStateWhen(state: Pick<CrmEmailState, 'atMs'>): string {
  if (!state.atMs) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(state.atMs)
  } catch {
    return new Date(state.atMs).toDateString()
  }
}

/**
 * Why the record must not be emailed, in one sentence a disabled button or
 * a refused enrollment can show — or `null` when it may be.
 */
export function crmEmailStateRefusal(state: CrmEmailState | null | undefined): string | null {
  if (!state || !crmEmailStateForbidsEmail(state)) return null
  const when = crmEmailStateWhen(state)
  const since = when ? ` on ${when}` : ''
  const said = state.detail ? ` ${state.detail}` : ''
  switch (state.status) {
    case 'bounced':
      return `Email to this address bounced${since}: the mailbox does not exist.${said}`
    case 'blocked':
      return `Their mail gateway blocked email to this address${since}.${said}`
    case 'unsubscribed':
      return `They unsubscribed${since}.${said}`
    case 'complained':
      return `They marked an email as spam${since}.${said}`
    case 'do_not_contact':
      return `On the do-not-contact list${since}.${said}`
    default:
      return null
  }
}
