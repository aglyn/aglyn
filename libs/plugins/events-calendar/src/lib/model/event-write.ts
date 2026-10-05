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

import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-alt'

/**
 * THE ONE RULE FOR WHAT AN EVENT STORES.
 *
 * `hosts/{hostId}/events/{id}` has two writers that must agree: the Events
 * page's editor and the events import. Both hand what they were given to
 * {@link eventWrite} and store exactly what it answers, so a title is cut,
 * an end time is repaired and a cover description is dropped the same way
 * whichever of them wrote the event.
 *
 * Pure: no Firestore, no clock. Each writer adds its own `updatedAt` /
 * `createdAt` and turns {@link EventWrite.remove} into its SDK's delete
 * sentinel.
 */

/** Longest stored title. */
export const EVENT_TITLE_MAX_LENGTH = 150
/** Longest stored location. */
export const EVENT_LOCATION_MAX_LENGTH = 200
/** Longest stored organizer. */
export const EVENT_ORGANIZER_MAX_LENGTH = 100
/** Longest stored description. */
export const EVENT_DESCRIPTION_MAX_LENGTH = 2000
/** Longest stored cover description: the platform's cap for any `alt`. */
export const EVENT_COVER_ALT_MAX_LENGTH = MEDIA_ALT_MAX_LENGTH
/** How long an event without an end after its start lasts. */
export const EVENT_DEFAULT_DURATION_MS = 60 * 60 * 1000

/** The statuses an editor or a file may set. `deleted` is only ever written by a delete. */
export const EVENT_STATUSES = ['draft', 'published'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/** A status as typed, folded to one an event may hold, or `null` for anything else. */
export function eventStatusOf(value: unknown): EventStatus | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (EVENT_STATUSES as readonly string[]).includes(text)
    ? (text as EventStatus)
    : null
}

/** What a writer was given for one event. Text may be untrimmed; blank means "none". */
export interface EventWriteInput {
  title: string
  /** Epoch milliseconds; required. */
  startsAtMs: number
  /** Epoch milliseconds; absent, zero or not after the start gives the default duration. */
  endsAtMs?: number | null
  location?: string | null
  organizer?: string | null
  description?: string | null
  coverImage?: string | null
  coverImageAlt?: string | null
  status: EventStatus
}

/** The content fields an event document stores. */
export interface EventStoredFields {
  title: string
  startsAtMs: number
  endsAtMs: number
  location?: string
  organizer?: string
  description?: string
  coverImage?: string
  coverImageAlt?: string
  status: EventStatus
}

/** The optional fields a write can take off a stored event. */
export type EventRemovableField =
  'location' | 'organizer' | 'description' | 'coverImage' | 'coverImageAlt'

/** What to store: the fields to write and the stored fields to delete. */
export interface EventWrite {
  fields: EventStoredFields
  remove: EventRemovableField[]
}

export interface EventWriteOptions {
  /**
   * Whether a blank optional field deletes the stored one. The editor leaves
   * it off: it writes a whole event over a `merge`, and a blank box there
   * keeps what was stored. The import turns it on, because it hands over the
   * record as it will be — a blank there is a value it chose to clear.
   */
  clearBlank?: boolean
}

/** Why an event cannot be written as given, or `null` when it can. */
export function eventWriteProblem(
  input: Pick<EventWriteInput, 'title' | 'startsAtMs'>,
): string | null {
  if (!String(input.title ?? '').trim()) return 'An event needs a title.'
  if (!Number.isFinite(input.startsAtMs) || !input.startsAtMs)
    return 'An event needs a start time.'
  return null
}

/** The end an event stores: the one given when it is after the start, else the default duration. */
export function eventEndsAtMs(
  startsAtMs: number,
  endsAtMs: number | null | undefined,
): number {
  return typeof endsAtMs === 'number' &&
    Number.isFinite(endsAtMs) &&
    endsAtMs > startsAtMs
    ? endsAtMs
    : startsAtMs + EVENT_DEFAULT_DURATION_MS
}

function capped(value: string | null | undefined, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

/**
 * The stored form of an event. Throws for input {@link eventWriteProblem}
 * refuses; both writers check it first and say why in their own words.
 *
 * The cover description is tied to the cover: with no cover, or an empty
 * description, it is removed rather than left describing a picture that
 * changed.
 */
export function eventWrite(
  input: EventWriteInput,
  options: EventWriteOptions = {},
): EventWrite {
  const problem = eventWriteProblem(input)
  if (problem) throw new Error(problem)
  const remove: EventRemovableField[] = []
  const fields: EventStoredFields = {
    title: capped(input.title, EVENT_TITLE_MAX_LENGTH),
    startsAtMs: input.startsAtMs,
    endsAtMs: eventEndsAtMs(input.startsAtMs, input.endsAtMs),
    status: input.status,
  }
  const optional: Array<
    [Exclude<EventRemovableField, 'coverImageAlt'>, number]
  > = [
    ['location', EVENT_LOCATION_MAX_LENGTH],
    ['organizer', EVENT_ORGANIZER_MAX_LENGTH],
    ['description', EVENT_DESCRIPTION_MAX_LENGTH],
    ['coverImage', Number.POSITIVE_INFINITY],
  ]
  for (const [key, max] of optional) {
    const value = capped(input[key], max)
    if (value) fields[key] = value
    else if (options.clearBlank) remove.push(key)
  }
  const alt = capped(input.coverImageAlt, EVENT_COVER_ALT_MAX_LENGTH)
  if (fields.coverImage && alt) fields.coverImageAlt = alt
  else remove.push('coverImageAlt')
  return { fields, remove }
}
