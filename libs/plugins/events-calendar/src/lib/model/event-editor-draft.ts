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

import {
  eventRecurrenceOf,
  isEventDayKey,
  type EventRecurrence,
  type EventRepeatFrequency,
} from './event-recurrence'
import { eventTicketOf, type EventTicketKind } from './event-categories'

/**
 * THE EVENTS PAGE'S REPEAT AND TICKET BOXES, AS TYPED (AGL-4252).
 *
 * What the editor holds while a person fills in "Repeats", "Ends" and
 * "Tickets", and how it becomes the rule and link `eventWrite` stores. Pure,
 * so the editor's spec reads the same round trip the save does.
 */

export interface RepeatDraft {
  freq: 'none' | EventRepeatFrequency
  /** "Every N", as typed. */
  interval: string
  weekdays: number[]
  ends: 'never' | 'on' | 'after'
  untilDayKey: string
  /** "After N times", as typed. */
  count: string
  exceptDayKeys: string[]
}

export interface TicketDraft {
  kind: '' | EventTicketKind
  id: string
  label: string
}

export const EMPTY_REPEAT: RepeatDraft = {
  freq: 'none',
  interval: '1',
  weekdays: [],
  ends: 'never',
  untilDayKey: '',
  count: '',
  exceptDayKeys: [],
}

export const EMPTY_TICKET: TicketDraft = { kind: '', id: '', label: '' }

/** A stored rule as the editor shows it. */
export function repeatDraftOf(value: unknown): RepeatDraft {
  const rule = eventRecurrenceOf(value)
  if (!rule) return { ...EMPTY_REPEAT }
  return {
    freq: rule.freq,
    interval: String(rule.interval ?? 1),
    weekdays: rule.weekdays ?? [],
    ends: rule.untilDayKey ? 'on' : rule.count ? 'after' : 'never',
    untilDayKey: rule.untilDayKey ?? '',
    count: rule.count ? String(rule.count) : '',
    exceptDayKeys: rule.exceptDayKeys ?? [],
  }
}

/** The rule the editor's boxes describe, or `null` for "Does not repeat". */
export function recurrenceOfDraft(draft: RepeatDraft): EventRecurrence | null {
  if (draft.freq === 'none') return null
  return eventRecurrenceOf({
    freq: draft.freq,
    interval: draft.interval,
    ...(draft.freq === 'weekly' ? { weekdays: draft.weekdays } : {}),
    ...(draft.ends === 'on' && isEventDayKey(draft.untilDayKey)
      ? { untilDayKey: draft.untilDayKey }
      : {}),
    ...(draft.ends === 'after' ? { count: draft.count } : {}),
    exceptDayKeys: draft.exceptDayKeys,
  })
}

/** Why the repeat boxes cannot be saved as they are, or `null`. */
export function repeatDraftProblem(
  draft: RepeatDraft,
  startDayKey: string | null,
): string | null {
  if (draft.freq === 'none') return null
  const interval = Number(draft.interval)
  if (!Number.isInteger(interval) || interval < 1 || interval > 52)
    return 'Repeat every 1 to 52.'
  if (draft.ends === 'on') {
    if (!isEventDayKey(draft.untilDayKey)) return 'Choose the day it ends.'
    if (startDayKey && draft.untilDayKey < startDayKey)
      return 'It ends before it starts.'
  }
  if (draft.ends === 'after') {
    const count = Number(draft.count)
    if (!Number.isInteger(count) || count < 1 || count > 500)
      return 'Repeat 1 to 500 times.'
  }
  return null
}

/** A stored ticket link as the editor shows it. */
export function ticketDraftOf(value: unknown): TicketDraft {
  const ticket = eventTicketOf(value)
  return ticket
    ? { kind: ticket.kind, id: ticket.id, label: ticket.label ?? '' }
    : { ...EMPTY_TICKET }
}

/** The link the editor's boxes describe, or `null` for none. */
export function ticketOfDraft(
  draft: TicketDraft,
): ReturnType<typeof eventTicketOf> {
  return draft.kind ? eventTicketOf(draft) : null
}
