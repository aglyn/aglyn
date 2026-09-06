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
 * The daily CRM digest (AGL-2619): what one member is owed this morning,
 * computed from the tasks and leads a scheduled route has read.
 *
 * "Overdue" and "due today" are read off the clock at read time by design
 * (AGL-2599) — nothing stamps them — which is why nothing ever told anybody.
 * The digest is the one reader that runs on a schedule: once a day it
 * counts, per org and per member, the open tasks whose due date has passed
 * or falls today and the leads nobody has worked, and says so once, in the
 * console and by mail. Every judgment here is pure so the route that sends
 * and the spec that proves it read the same arithmetic.
 *
 * ## Whose day
 *
 * A task's "today" on screen is the READER's calendar day, from their own
 * clock. A server has no reader, so the digest reads the day in ONE zone —
 * {@link CRM_DIGEST_DEFAULT_TIME_ZONE}, the zone the schedule was chosen for
 * (08:00 there) — taken as a parameter so an org-level setting can supply
 * its own the day one exists. The idempotence key is the UTC day
 * ({@link utcDayKey}), which is a fact about the run and not about anybody's
 * morning.
 */

import { type CrmLeadFields, type CrmTask, crmLeadStatus } from './crm'

/**
 * The zone the digest's "today" is read in when nothing else names one.
 *
 * The schedule fires at 13:00 UTC, which is 08:00 here, so the window this
 * zone draws is the morning the mail arrives in for the people the product
 * is built with. A member elsewhere reads a window that is at most a few
 * hours off their own, which is what a morning summary can tolerate and a
 * "due at 9:00" reminder could not — that reminder is the assignment
 * notification's job, not this one's.
 */
export const CRM_DIGEST_DEFAULT_TIME_ZONE = 'America/Chicago'

/** How long a `new` lead may sit untouched before the digest names it. */
export const CRM_DIGEST_LEAD_AGE_MS = 2 * 24 * 60 * 60 * 1000

/**
 * The most due tasks one org's sweep reads.
 *
 * One query per org, ordered soonest-due first, so an org with more than this
 * many overdue-or-today tasks digests the oldest five hundred and reports the
 * window as full rather than reading without bound. Five hundred is an org
 * whose problem is not that nobody reminded them.
 */
export const CRM_DIGEST_TASK_CEILING = 500

/**
 * The most old leads one site's sweep reads.
 *
 * The same shape the Leads section uses, for the same reason it gives: a
 * lead the capture door wrote carries no `status` field, and Firestore
 * cannot select on a field's absence, so "unworked" is a filter over a
 * loaded window rather than a query. The window is the newest old leads by
 * first sighting, which is where the ones still worth a call are.
 */
export const CRM_DIGEST_LEAD_WINDOW = 200

/** How many items one section of the email lists before "and N more". */
export const CRM_DIGEST_LIST_MAX = 10

/*==========================================
 * CALENDAR DAYS IN A NAMED ZONE
 *
 * `Intl` is the only zone database a serverless function has, and it only
 * FORMATS. So a day boundary is found by formatting the instant into the
 * zone's calendar fields, building the UTC instant those fields would be,
 * and shifting by the zone's offset — read twice, because the offset at the
 * instant asked about and the offset at the midnight found can differ on
 * the day a clock change falls, and the second read settles it.
 *=========================================*/

interface ZoneParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zoneParts(ms: number, timeZone: string): ZoneParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

/** The zone's offset from UTC at `ms`, in milliseconds, positive east. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** The instant a calendar date begins in `timeZone`. */
function startOfZoneDate(
  year: number,
  monthIndex: number,
  day: number,
  nearMs: number,
  timeZone: string,
): number {
  const midnightAsUtc = Date.UTC(year, monthIndex, day)
  const guess = midnightAsUtc - zoneOffsetMs(nearMs, timeZone)
  return midnightAsUtc - zoneOffsetMs(guess, timeZone)
}

/** Midnight at the start of the calendar day `ms` falls in, in `timeZone`. */
export function startOfDayInZone(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone)
  return startOfZoneDate(parts.year, parts.month - 1, parts.day, ms, timeZone)
}

/**
 * Midnight at the start of the NEXT calendar day in `timeZone` — built from
 * the calendar rather than by adding 24 hours, for the reason the tasks
 * section gives: a day a clock change falls in is 23 or 25 hours long.
 */
export function startOfNextDayInZone(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone)
  return startOfZoneDate(parts.year, parts.month - 1, parts.day + 1, ms, timeZone)
}

/** `YYYY-MM-DD` of the UTC day `ms` falls in — the digest's idempotence key. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** The half-open window `[start of today, start of tomorrow)` in a zone. */
export interface CrmDigestWindow {
  startMs: number
  endMs: number
}

export function crmDigestWindow(nowMs: number, timeZone: string): CrmDigestWindow {
  return {
    startMs: startOfDayInZone(nowMs, timeZone),
    endMs: startOfNextDayInZone(nowMs, timeZone),
  }
}

/*==========================================
 * WHAT A DIGEST IS MADE OF
 *=========================================*/

/** A due task as the digest carries it: the fields a line and a link need. */
export interface CrmDigestTask
  extends Pick<CrmTask, 'title' | 'kind' | 'contactId' | 'companyId' | 'dealId'> {
  id: string
  dueAtMs: number
  assigneeUid: string
  /** The site the task was created on — where its link opens. */
  hostId: string
}

/** An unworked lead as the digest carries it. */
export interface CrmDigestLead {
  id: string
  hostId: string
  email: string
  name?: string
  ownerUid?: string
  firstSeenAtMs: number
}

export interface CrmDigestCounts {
  overdue: number
  today: number
  leads: number
}

/** One member's morning. */
export interface CrmMemberDigest {
  overdue: CrmDigestTask[]
  today: CrmDigestTask[]
  leads: CrmDigestLead[]
}

/**
 * Where a due task stands against the digest's window. Only tasks due
 * BEFORE the window's end are read at all, so `later` names a task the
 * query should not have returned and the bucketing refuses to count.
 */
export function crmDigestTaskState(
  dueAtMs: number,
  window: CrmDigestWindow,
): 'overdue' | 'today' | 'later' {
  if (dueAtMs < window.startMs) return 'overdue'
  if (dueAtMs < window.endMs) return 'today'
  return 'later'
}

/**
 * Whether a lead is one the digest should name: still `new` — which an
 * absent status reads as, because the capture door stamps none — and first
 * seen at least {@link CRM_DIGEST_LEAD_AGE_MS} ago.
 */
export function isUnworkedLead(
  lead: Pick<CrmLeadFields, 'status'> & { firstSeenAtMs?: unknown },
  nowMs: number,
  ageMs: number = CRM_DIGEST_LEAD_AGE_MS,
): boolean {
  if (crmLeadStatus(lead) !== 'new') return false
  const firstSeen = Number(lead.firstSeenAtMs)
  return Number.isFinite(firstSeen) && firstSeen > 0 && firstSeen <= nowMs - ageMs
}

/**
 * Whether a lead is THIS member's to work: theirs by owner, or nobody's on
 * a site they reach. An owned lead is one person's; an unowned one is on
 * everybody's list until somebody takes it, which is what the digest is for.
 */
export function leadIsForMember(
  lead: Pick<CrmDigestLead, 'ownerUid' | 'hostId'>,
  member: { uid: string; reachesHost: (hostId: string) => boolean },
): boolean {
  if (lead.ownerUid) return lead.ownerUid === member.uid
  return member.reachesHost(lead.hostId)
}

/**
 * Whether the org's plan carries the CRM suite (AGL-2611's `features.crm`).
 *
 * Read by key rather than through the typed flag map so this module does not
 * depend on the key existing: the flag lands with the suite's gate, and a
 * plan that has not declared it is a plan that does not include it — a
 * digest about a surface the plan cannot open would be a reminder to pay.
 */
export function crmDigestEntitled(
  features: Record<string, boolean | undefined> | null | undefined,
): boolean {
  return features?.['crm'] === true
}

/**
 * Every member's digest, from what the org's sweep read.
 *
 * A task goes to its assignee and to nobody else — an unassigned task is a
 * deliberate choice in the drawer, and an assignee no longer on the roster
 * is a task nobody owes. A lead goes to its owner, or to every member who
 * reaches the site when it has none. Members with nothing owed are simply
 * absent from the result, which is what makes "per member with open work"
 * cost nothing for everyone else.
 */
export function buildMemberDigests(input: {
  tasks: readonly CrmDigestTask[]
  leads: readonly CrmDigestLead[]
  members: ReadonlyArray<{ uid: string; reachesHost: (hostId: string) => boolean }>
  window: CrmDigestWindow
}): Map<string, CrmMemberDigest> {
  const { tasks, leads, members, window } = input
  const digests = new Map<string, CrmMemberDigest>()
  const digestFor = (uid: string): CrmMemberDigest => {
    let digest = digests.get(uid)
    if (!digest) {
      digest = { overdue: [], today: [], leads: [] }
      digests.set(uid, digest)
    }
    return digest
  }
  const roster = new Map(members.map((member) => [member.uid, member]))
  for (const task of tasks) {
    if (!task.assigneeUid || !roster.has(task.assigneeUid)) continue
    const state = crmDigestTaskState(task.dueAtMs, window)
    if (state === 'later') continue
    digestFor(task.assigneeUid)[state].push(task)
  }
  for (const lead of leads) {
    for (const member of members) {
      if (leadIsForMember(lead, member)) digestFor(member.uid).leads.push(lead)
    }
  }
  for (const digest of digests.values()) {
    digest.overdue.sort((a, b) => a.dueAtMs - b.dueAtMs)
    digest.today.sort((a, b) => a.dueAtMs - b.dueAtMs)
    digest.leads.sort((a, b) => a.firstSeenAtMs - b.firstSeenAtMs)
  }
  return digests
}

export function crmDigestCounts(digest: CrmMemberDigest): CrmDigestCounts {
  return {
    overdue: digest.overdue.length,
    today: digest.today.length,
    leads: digest.leads.length,
  }
}

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * The one line the notification is: "3 tasks due today, 2 overdue, 4
 * unworked leads". Segments that are zero are left out rather than read as
 * "0 overdue" — the line is what is owed, and nothing owed is no segment.
 */
export function composeCrmDigestSummary(counts: CrmDigestCounts): string {
  const segments: string[] = []
  if (counts.today > 0) segments.push(`${plural(counts.today, 'task')} due today`)
  if (counts.overdue > 0) {
    segments.push(
      counts.today > 0 ? `${counts.overdue} overdue` : `${plural(counts.overdue, 'task')} overdue`,
    )
  }
  if (counts.leads > 0) segments.push(`${plural(counts.leads, 'unworked lead')}`)
  return segments.join(', ')
}

export function composeCrmDigestSubject(counts: CrmDigestCounts): string {
  return `Your CRM today: ${composeCrmDigestSummary(counts)}`
}

/** What the digest email needs from the route besides the digest itself. */
export interface CrmDigestEmailInput {
  digest: CrmMemberDigest
  nowMs: number
  timeZone: string
  /** The product name the mail reads as — the org's brand when white-labeled. */
  productName: string
  /** The Tasks section, on the site the member's first task belongs to. */
  tasksUrl: string
  /** The Leads section of a site, for the sites that have unworked leads. */
  leadsUrl: (hostId: string) => string
  /** Account settings → Notifications, where the digest can be switched off. */
  settingsUrl: string
  /** A site's name for a lead line; the id when the site is unknown. */
  hostName: (hostId: string) => string
  /** The brand's support line, already prefixed, or empty. */
  supportLine?: string
}

function whenInZone(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dateInZone(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  })
}

function section(heading: string, lines: string[]): string[] {
  const shown = lines.slice(0, CRM_DIGEST_LIST_MAX)
  const rest = lines.length - shown.length
  return [
    `${heading} (${lines.length})`,
    ...shown.map((line) => `- ${line}`),
    ...(rest > 0 ? [`  and ${rest} more`] : []),
    '',
  ]
}

/**
 * The plain-text email. Text rather than a designed template because the
 * body is a list, and `sendEmail` synthesizes the HTML part that makes its
 * links live. Overdue first — it is the section a reader acts on — then
 * today, then the leads, each capped and counted, and the links last.
 */
export function composeCrmDigestEmailText(input: CrmDigestEmailInput): string {
  const { digest, nowMs, timeZone, productName } = input
  const counts = crmDigestCounts(digest)
  const day = new Date(nowMs).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  const lines: string[] = [
    `Here is your ${productName} CRM for ${day}: ${composeCrmDigestSummary(counts)}.`,
    '',
  ]
  const taskLine = (task: CrmDigestTask) =>
    `${task.title} · ${whenInZone(task.dueAtMs, timeZone)}`
  if (digest.overdue.length) {
    lines.push(...section('Overdue', digest.overdue.map(taskLine)))
  }
  if (digest.today.length) {
    lines.push(...section('Due today', digest.today.map(taskLine)))
  }
  if (digest.leads.length) {
    lines.push(
      ...section(
        'Unworked leads',
        digest.leads.map((lead) => {
          const who = lead.name ? `${lead.name} <${lead.email}>` : lead.email
          return `${who} · ${input.hostName(lead.hostId)} · first seen ${dateInZone(
            lead.firstSeenAtMs,
            timeZone,
          )}`
        }),
      ),
    )
  }
  if (counts.overdue + counts.today > 0) lines.push(`Open your tasks: ${input.tasksUrl}`)
  const leadHosts = [...new Set(digest.leads.map((lead) => lead.hostId))].slice(0, 3)
  for (const hostId of leadHosts) {
    lines.push(`Leads on ${input.hostName(hostId)}: ${input.leadsUrl(hostId)}`)
  }
  lines.push(
    '',
    'You get this each morning because the Daily CRM digest is on in your ' +
      `notification settings: ${input.settingsUrl}`,
  )
  return lines.join('\n') + (input.supportLine ?? '')
}
