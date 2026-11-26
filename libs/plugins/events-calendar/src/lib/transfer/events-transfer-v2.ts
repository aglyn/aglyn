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

import type { TransferField } from '@aglyn/aglyn/data-transfer'
import { isValidTimeZone } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  eventCategoryIdsOf,
  eventTicketOf,
  type EventTicket,
} from '../model/event-categories'
import {
  eventRecurrenceOf,
  isEventDayKey,
  type EventRecurrence,
} from '../model/event-recurrence'

/**
 * THE CALENDAR V2 COLUMNS OF AN EVENTS FILE (AGL-4252), offered where the
 * workspace has `release_events_calendar_v2`:
 *
 * - Categories: the site's category names, comma separated. A name the site
 *   has no category for is reported and left off; categories are made on
 *   the Events page.
 * - Repeats: an iCalendar rule (`FREQ=WEEKLY;BYDAY=TH;UNTIL=20270301`), the
 *   form Google Calendar and Apple Calendar export. Daily, weekly and monthly
 *   on the date are read; anything else is refused with a reason.
 * - Skip dates, Time zone, Tickets (`product:ID`, `service:ID`).
 *
 * Pure.
 */

export const EVENT_V2_FIELD_IDS = [
  'categories',
  'repeat',
  'skipDates',
  'timeZone',
  'ticket',
] as const

export const EVENTS_V2_FIELDS: TransferField[] = [
  {
    id: 'categories',
    label: 'Categories',
    group: 'event',
    type: 'text',
    aliases: ['Category', 'Event categories', 'Event Category', 'Tags'],
    description: 'Category names, separated by commas. Add categories on the Events page first.',
  },
  {
    id: 'repeat',
    label: 'Repeats',
    group: 'event',
    type: 'text',
    aliases: ['Recurrence', 'Repeat', 'RRULE', 'Recurrence rule'],
    description:
      'An iCalendar rule, such as FREQ=WEEKLY;BYDAY=TH;UNTIL=20270301. Blank: it does not repeat.',
  },
  {
    id: 'skipDates',
    label: 'Skip dates',
    group: 'event',
    type: 'text',
    aliases: ['Exceptions', 'EXDATE', 'Skipped dates'],
    description: 'Dates the series skips, as YYYY-MM-DD, separated by commas.',
  },
  {
    id: 'timeZone',
    label: 'Time zone',
    group: 'event',
    type: 'text',
    aliases: ['Timezone', 'TZID'],
    description: 'The zone a repeating event keeps its time in, such as America/Chicago.',
  },
  {
    id: 'ticket',
    label: 'Tickets',
    group: 'event',
    type: 'text',
    aliases: ['Ticket', 'Ticket link'],
    description: 'product:ID for a store product, or service:ID for a booking service.',
  },
]

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** A stored rule as a file's Repeats cell. */
export function recurrenceForFile(value: unknown): string | null {
  const rule = eventRecurrenceOf(value)
  if (!rule) return null
  const parts = [`FREQ=${rule.freq.toUpperCase()}`]
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.freq === 'weekly' && rule.weekdays?.length) {
    parts.push(`BYDAY=${rule.weekdays.map((day) => WEEKDAY_CODES[day]).join(',')}`)
  }
  if (rule.untilDayKey) parts.push(`UNTIL=${rule.untilDayKey.replace(/-/g, '')}`)
  else if (rule.count) parts.push(`COUNT=${rule.count}`)
  return parts.join(';')
}

/** A Repeats cell as a rule, `null` for blank, or why it cannot be read. */
export function recurrenceFromFile(
  cell: unknown,
): EventRecurrence | null | { problem: string } {
  const text = typeof cell === 'string' ? cell.trim().replace(/^RRULE:/i, '') : ''
  if (!text) return null
  const parts = new Map<string, string>()
  for (const part of text.split(';')) {
    const [key, value] = part.split('=')
    if (key && value !== undefined) parts.set(key.trim().toUpperCase(), value.trim().toUpperCase())
  }
  const freq = (parts.get('FREQ') ?? '').toLowerCase()
  if (!['daily', 'weekly', 'monthly'].includes(freq)) {
    return { problem: 'Repeats reads daily, weekly or monthly rules (FREQ=DAILY, WEEKLY or MONTHLY).' }
  }
  const weekdays: number[] = []
  for (const code of (parts.get('BYDAY') ?? '').split(',').filter(Boolean)) {
    const day = WEEKDAY_CODES.indexOf(code)
    if (day < 0) return { problem: `Repeats cannot read the day "${code}"; use MO, TU, WE, TH, FR, SA or SU.` }
    weekdays.push(day)
  }
  if (weekdays.length && freq !== 'weekly') {
    return { problem: 'Repeats reads days of the week (BYDAY) on a weekly rule only.' }
  }
  const until = parts.get('UNTIL') ?? ''
  const untilDayKey = until ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : ''
  if (until && !isEventDayKey(untilDayKey)) return { problem: 'Repeats has an UNTIL that is not a date.' }
  const rule = eventRecurrenceOf({
    freq,
    interval: parts.get('INTERVAL') ?? 1,
    weekdays,
    ...(untilDayKey ? { untilDayKey } : {}),
    ...(parts.get('COUNT') ? { count: parts.get('COUNT') } : {}),
  })
  return rule ?? { problem: 'Repeats could not be read.' }
}

const list = (cell: unknown): string[] =>
  typeof cell === 'string'
    ? cell
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : []

/** A stored ticket link as a file's Tickets cell. */
export function ticketForFile(value: unknown): string | null {
  const ticket = eventTicketOf(value)
  return ticket ? `${ticket.kind}:${ticket.id}` : null
}

/** A stored event's v2 columns, with category ids named by `names`. */
export function eventV2FieldValues(
  data: Record<string, unknown>,
  names: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const rule = eventRecurrenceOf(data['recurrence'])
  const categories = eventCategoryIdsOf(data['categoryIds'])
    .map((id) => names.get(id))
    .filter(Boolean)
  return {
    categories: categories.length ? categories.join(', ') : null,
    repeat: recurrenceForFile(rule),
    skipDates: rule?.exceptDayKeys?.length ? rule.exceptDayKeys.join(', ') : null,
    timeZone: typeof data['timeZone'] === 'string' && data['timeZone'] ? data['timeZone'] : null,
    ticket: ticketForFile(data['ticket']),
  }
}

/** What the v2 columns write, or why they cannot be written. */
export interface EventV2WriteFields {
  categoryIds?: string[]
  /** Names the site has no category for: reported, and left off. */
  unknownCategories: string[]
  recurrence?: EventRecurrence | null
  timeZone?: string | null
  ticket?: EventTicket | null
}

/**
 * The v2 columns of a row as the write rule's input. A column the row does
 * not carry is left out (`undefined`), so a file without it keeps what is
 * stored.
 */
export function eventV2WriteFields(
  values: Record<string, unknown>,
  idsByName: ReadonlyMap<string, string>,
): EventV2WriteFields | { problem: string } {
  const out: EventV2WriteFields = { unknownCategories: [] }
  if ('categories' in values) {
    const ids: string[] = []
    for (const name of list(values['categories'])) {
      const id = idsByName.get(name.toLowerCase())
      if (id) ids.push(id)
      else out.unknownCategories.push(name)
    }
    out.categoryIds = ids
  }
  if ('repeat' in values || 'skipDates' in values) {
    const rule = recurrenceFromFile(values['repeat'])
    if (rule && 'problem' in rule) return rule
    const skipped = list(values['skipDates'])
    const bad = skipped.find((day) => !isEventDayKey(day))
    if (bad) return { problem: `Skip dates has "${bad}", which is not a date written YYYY-MM-DD.` }
    out.recurrence = rule ? eventRecurrenceOf({ ...rule, exceptDayKeys: skipped }) : null
  }
  if ('timeZone' in values) {
    const zone = typeof values['timeZone'] === 'string' ? values['timeZone'].trim() : ''
    if (zone && !isValidTimeZone(zone)) return { problem: `Time zone "${zone}" is not a zone, such as America/Chicago.` }
    out.timeZone = zone || null
  }
  if ('ticket' in values) {
    const cell = typeof values['ticket'] === 'string' ? values['ticket'].trim() : ''
    if (!cell) out.ticket = null
    else {
      const [kind, ...rest] = cell.split(':')
      const ticket = eventTicketOf({ kind, id: rest.join(':') })
      if (!ticket) return { problem: 'Tickets is product:ID or service:ID.' }
      out.ticket = ticket
    }
  }
  return out
}
