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
 * AN EVENT'S CATEGORIES AND ITS TICKET LINK (AGL-4252).
 *
 * Categories are the site owner's own ("MX Training", "Kids Camp"), each
 * with a color the calendar's filter chips and event dots wear, kept at
 * `hosts/{hostId}/eventCategories/{id}`. An event names the ones it belongs
 * to by id (`categoryIds`), so renaming a category renames it everywhere.
 *
 * A ticket link names a record ANOTHER plugin owns, by kind and id: a store
 * product or a bookings service. This plugin never reads that record; the
 * owner answers how a visitor buys or books it through core's
 * `core.site-offers` (`plugin-site-offers.ts`).
 *
 * Pure: no Firestore.
 */

/** The collection a site's event categories live in. */
export const EVENT_CATEGORIES_COLLECTION = 'eventCategories'
/** The most categories one site may have. */
export const EVENT_CATEGORY_MAX = 30
/** The most categories one event may be in. */
export const EVENT_CATEGORIES_PER_EVENT_MAX = 10
/** The longest category name. */
export const EVENT_CATEGORY_NAME_MAX_LENGTH = 40

/**
 * The colors a new category is offered, in order, so the first few read
 * apart from each other on a light or dark page. The owner may pick any.
 */
export const EVENT_CATEGORY_PALETTE = [
  '#1E88E5',
  '#E53935',
  '#43A047',
  '#FB8C00',
  '#8E24AA',
  '#00897B',
  '#F4511E',
  '#3949AB',
  '#C0CA33',
  '#6D4C41',
] as const

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export interface EventCategory {
  $id: string
  name: string
  /** `#RRGGBB`. */
  color: string
  /** Where the chip sits; lower first. */
  order: number
}

/** A color as typed, as stored (`#RRGGBB`, upper case), or `null`. */
export function eventCategoryColorOf(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return HEX_COLOR.test(text) ? text.toUpperCase() : null
}

/** The palette color the `index`th category is offered. */
export function eventCategoryDefaultColor(index: number): string {
  const palette = EVENT_CATEGORY_PALETTE
  return palette[((index % palette.length) + palette.length) % palette.length]
}

/** A stored category, read tolerantly, or `null` when it has no name. */
export function eventCategoryOf(
  id: string,
  data: Record<string, unknown> | undefined,
): EventCategory | null {
  const name = String(data?.['name'] ?? '')
    .trim()
    .slice(0, EVENT_CATEGORY_NAME_MAX_LENGTH)
  if (!id || !name || data?.['deletedAt']) return null
  const order = Number(data?.['order'])
  return {
    $id: id,
    name,
    color:
      eventCategoryColorOf(data?.['color']) ?? eventCategoryDefaultColor(0),
    order: Number.isFinite(order) ? order : 0,
  }
}

/** Categories in chip order: by `order`, then by name. */
export function sortEventCategories<
  T extends Pick<EventCategory, 'order' | 'name'>,
>(categories: readonly T[]): T[] {
  return [...categories].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  )
}

/** Category ids as given, deduplicated, capped, and blank ones dropped. */
export function eventCategoryIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id && id.length <= 200 && !id.includes('/'))
  return [...new Set(ids)].slice(0, EVENT_CATEGORIES_PER_EVENT_MAX)
}

/** The kinds of record a ticket link may name. */
export const EVENT_TICKET_KINDS = ['product', 'service'] as const
export type EventTicketKind = (typeof EVENT_TICKET_KINDS)[number]
/** The longest button label an owner may write. */
export const EVENT_TICKET_LABEL_MAX_LENGTH = 40

export interface EventTicket {
  kind: EventTicketKind
  /** The record's id in the plugin that owns the kind. */
  id: string
  /** The button's words; absent reads "Get tickets" or "Book". */
  label?: string
}

/** A ticket link as given, as stored, or `null` for none. */
export function eventTicketOf(value: unknown): EventTicket | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const kind = String(raw['kind'] ?? '')
    .trim()
    .toLowerCase()
  const id = String(raw['id'] ?? '').trim()
  if (!(EVENT_TICKET_KINDS as readonly string[]).includes(kind)) return null
  if (!id || id.length > 200 || id.includes('/')) return null
  const label = String(raw['label'] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EVENT_TICKET_LABEL_MAX_LENGTH)
  return { kind: kind as EventTicketKind, id, ...(label ? { label } : {}) }
}

/** The words on a ticket button the owner did not label. */
export function eventTicketDefaultLabel(kind: EventTicketKind): string {
  return kind === 'service' ? 'Book' : 'Get tickets'
}
