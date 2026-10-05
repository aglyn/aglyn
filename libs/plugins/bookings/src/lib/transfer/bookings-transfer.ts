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
  TRANSFER_ID_FIELD,
  buildMatchLookup,
  type TransferCatalogInput,
  type TransferField,
} from '@aglyn/aglyn/data-transfer'
import type {
  PluginTransferResource,
  TransferReadOptions,
  TransferReadPage,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { zonedDateTime } from '@aglyn/shared-util-timestamp/zoned-time'
import { FieldPath } from 'firebase-admin/firestore'
import { bookingTimeZone, storedBookingTimeZone } from '../model/booking-time'
import {
  BOOKINGS_TRANSFER_MATCH_KEYS,
  type BookingsTransferFilter,
  parseBookingsTransferFilter,
} from './bookings-transfer-common'

/**
 * BOOKINGS, EXPORTED (the server half of the `bookings` transfer resource).
 *
 * Every booking of one site, `hosts/{hostId}/bookings/{id}`, as rows of the
 * fields a person picks: the service and the slot, the customer, what was
 * paid, and when the platform did what to it.
 *
 * ## Exported, never imported
 *
 * The resource declares `exportOnly`, so it registers no `apply` or
 * `revert` (its `lookup` answers the Aglyn ID only) and the upload route
 * refuses it. There is no safe
 * write path to give it: the only thing that creates a booking is the
 * booking route, which holds the slot, may start a Stripe charge, emails the
 * customer and files the meeting in the CRM — and the hourly reminder job
 * would email any confirmed booking it found a day out. A booking written
 * from a file would be an appointment nobody booked.
 *
 * ## Which bookings a page reads
 *
 * - `ids`: the selection, read by id in the order given; ids that name no
 *   booking are skipped. The cursor is the offset into the list.
 * - `filter`: one of the list's filters (`bookings-transfer-common.ts`), as
 *   one Firestore query:
 *   - none: every booking, by start, `startsAtMs` ascending — the
 *     single-field index;
 *   - upcoming: `endsAtMs >= asOf`, by end ascending — the single-field
 *     index on `endsAtMs` (the range field has to lead the order);
 *   - one service: `serviceId ==`, by start — the declared composite
 *     `serviceId ASC, startsAtMs ASC`;
 *   - one booker: `email ==`, by start — the composite
 *     `email ASC, startsAtMs ASC`, which `bookings-export-indexes.spec.ts`
 *     holds the index file to.
 *   Every order breaks ties by document id, and the cursor is the last row's
 *   order value and id, so a page never repeats or skips a row.
 * - `scopeTokens` narrows nothing here. Bookings are a SITE's records and
 *   carry no `visibleTo`; the export route admits a reader only with
 *   `data.manage` on the site named, so a collaborator who reaches this read
 *   reaches every booking of that site, the way the Bookings page shows them.
 *
 * Times go out as ISO instants in UTC, beside the booking's own zone and
 * the start and end as a wall clock in it. Amounts are dollars (every
 * booking is charged in USD), from the stored cents.
 */

type Firestore = FirebaseFirestore.Firestore
type Query = FirebaseFirestore.Query
type DocumentData = FirebaseFirestore.DocumentData

export interface BookingsTransferDeps {
  firestore(): Firestore
  /** The clock the upcoming filter reads when it names no moment. */
  now?: () => number
}

/** The most rows one page answers when the engine does not say. */
const DEFAULT_PAGE_ROWS = 500
const MAX_PAGE_ROWS = 1000
/** Firestore's bound on an `in` list. */
const IN_LIMIT = 30

/*==========================================
 * THE FIELDS
 *=========================================*/

export const BOOKINGS_TRANSFER_GROUPS = [
  { id: 'booking', label: 'Booking' },
  { id: 'customer', label: 'Customer' },
  { id: 'payment', label: 'Payment' },
  { id: 'system', label: 'System' },
] as const

const readOnly = (field: TransferField): TransferField => ({
  ...field,
  readOnly: true,
})

/** The booking's own stored fields. */
const STANDARD: readonly TransferField[] = (
  [
    {
      id: 'serviceId',
      label: 'Service ID',
      group: 'booking',
      type: 'text',
      description: 'The service that was booked.',
    },
    {
      id: 'serviceName',
      label: 'Service',
      group: 'booking',
      type: 'text',
      aliases: ['service name'],
      description: 'The service’s name when it was booked.',
    },
    {
      id: 'startsAt',
      label: 'Starts (UTC)',
      group: 'booking',
      type: 'datetime',
      aliases: ['start', 'starts at', 'start time'],
    },
    {
      id: 'endsAt',
      label: 'Ends (UTC)',
      group: 'booking',
      type: 'datetime',
      aliases: ['end', 'ends at', 'end time'],
    },
    {
      id: 'timeZone',
      label: 'Time zone',
      group: 'booking',
      type: 'text',
      aliases: ['timezone'],
      description:
        'The zone the slot was offered in. Bookings made before it was stored read it from the service, then the site.',
    },
    {
      id: 'status',
      label: 'Status',
      group: 'booking',
      type: 'text',
      description: 'Awaiting payment, Confirmed or Canceled.',
    },
    {
      id: 'name',
      label: 'Name',
      group: 'customer',
      type: 'text',
      aliases: ['customer', 'customer name'],
    },
    {
      id: 'email',
      label: 'Email',
      group: 'customer',
      type: 'email',
      aliases: ['customer email'],
    },
    { id: 'phone', label: 'Phone', group: 'customer', type: 'phone' },
    {
      id: 'address',
      label: 'Address',
      group: 'customer',
      type: 'longText',
      description:
        'Where the job is, as the customer typed it, when the service asked.',
    },
    {
      id: 'crmRef',
      label: 'CRM record',
      group: 'customer',
      type: 'text',
      description: 'The CRM record the booking link carried, as kind:id.',
    },
    {
      id: 'paidAmount',
      label: 'Amount paid',
      group: 'payment',
      type: 'currency',
      description: 'In US dollars, tax included.',
    },
    {
      id: 'tax',
      label: 'Tax',
      group: 'payment',
      type: 'currency',
      description: 'In US dollars.',
    },
    {
      id: 'fee',
      label: 'Platform fee',
      group: 'payment',
      type: 'currency',
      description: 'The platform’s fee on the charge, in US dollars.',
    },
    {
      id: 'refunded',
      label: 'Refunded',
      group: 'payment',
      type: 'currency',
      description: 'In US dollars.',
    },
    {
      id: 'taxMode',
      label: 'Tax mode',
      group: 'payment',
      type: 'text',
      description: 'How tax was charged on the booking.',
    },
  ] satisfies TransferField[]
).map(readOnly)

/** Computed from the booking and its service when read. */
const DERIVED: readonly TransferField[] = (
  [
    {
      id: 'serviceCurrentName',
      label: 'Service (current name)',
      group: 'booking',
      type: 'text',
      description:
        'The service’s name today; blank when the service no longer exists.',
    },
    {
      id: 'startsLocal',
      label: 'Starts (local time)',
      group: 'booking',
      type: 'text',
      description: 'The start as a clock in the booking’s time zone read it.',
    },
    {
      id: 'endsLocal',
      label: 'Ends (local time)',
      group: 'booking',
      type: 'text',
      description: 'The end as a clock in the booking’s time zone read it.',
    },
    {
      id: 'durationMinutes',
      label: 'Duration (minutes)',
      group: 'booking',
      type: 'integer',
    },
  ] satisfies TransferField[]
).map(readOnly)

/** Written by the platform: Stripe's handles and the booking's history. */
const SYSTEM: readonly TransferField[] = (
  [
    {
      id: 'paymentIntentId',
      label: 'Stripe payment ID',
      group: 'payment',
      type: 'text',
    },
    {
      id: 'checkoutSessionId',
      label: 'Stripe checkout session ID',
      group: 'payment',
      type: 'text',
    },
    {
      id: 'holdExpiresAt',
      label: 'Payment hold expires',
      group: 'payment',
      type: 'datetime',
      description: 'When an unpaid booking’s slot is released.',
    },
    { id: 'createdAt', label: 'Booked', group: 'system', type: 'datetime' },
    {
      id: 'confirmedAt',
      label: 'Payment confirmed',
      group: 'system',
      type: 'datetime',
    },
    {
      id: 'reminderSentAt',
      label: 'Reminder sent',
      group: 'system',
      type: 'datetime',
    },
    {
      id: 'customerErasedAt',
      label: 'Customer erased',
      group: 'system',
      type: 'datetime',
      description: 'When the customer’s details were erased from the booking.',
    },
  ] satisfies TransferField[]
).map(readOnly)

/** The catalog, the same for every site. */
export function bookingsTransferCatalog(): TransferCatalogInput {
  return {
    standard: STANDARD,
    derived: DERIVED,
    system: SYSTEM,
    groups: BOOKINGS_TRANSFER_GROUPS,
  }
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  pendingPayment: 'Awaiting payment',
  confirmed: 'Confirmed',
  canceled: 'Canceled',
}

/*==========================================
 * READING A BOOKING
 *=========================================*/

/** Epoch milliseconds from a stored moment: a number, a Timestamp, a Date or a string. */
function millisOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'object') {
    const stamp = value as {
      toMillis?: () => number
      seconds?: number
      _seconds?: number
      nanoseconds?: number
      _nanoseconds?: number
    }
    if (typeof stamp.toMillis === 'function') return stamp.toMillis()
    const seconds = stamp.seconds ?? stamp._seconds
    if (typeof seconds === 'number')
      return (
        seconds * 1000 +
        Math.floor((stamp.nanoseconds ?? stamp._nanoseconds ?? 0) / 1e6)
      )
  }
  return null
}

function isoOf(value: unknown): string | null {
  const ms = millisOf(value)
  return ms === null ? null : new Date(ms).toISOString()
}

/** Dollars from stored cents; blank when the booking holds none. */
function dollarsOf(cents: unknown): number | null {
  if (cents === null || cents === undefined || cents === '') return null
  const value = Number(cents)
  return Number.isFinite(value) ? Math.round(value) / 100 : null
}

function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text === '' ? null : text
}

const pad = (value: number) => String(value).padStart(2, '0')

/** `2026-04-24 15:00` — the wall clock in `timeZone` at `atMs`. */
function localTextOf(atMs: number | null, timeZone: string): string | null {
  if (atMs === null) return null
  try {
    const at = zonedDateTime(atMs, timeZone)
    return `${at.year}-${pad(at.month)}-${pad(at.day)} ${pad(at.hour)}:${pad(at.minute)}`
  } catch {
    return null
  }
}

/** What a page reads besides the bookings, loaded only when a chosen field needs it. */
interface PageContext {
  serviceOf(serviceId: string): Promise<DocumentData | null>
  zoneOf(booking: DocumentData): Promise<string>
}

function pageContext(
  db: Firestore,
  ctx: TransferResourceContext,
  hostId: string,
): PageContext {
  let services: Promise<Map<string, DocumentData>> | null = null
  let site: Promise<{
    host: DocumentData | null
    org: DocumentData | null
  }> | null = null
  const servicesOfSite = () =>
    (services ??= db
      .collection('hosts')
      .doc(hostId)
      .collection('services')
      .get()
      .then(
        (snapshot) => new Map(snapshot.docs.map((doc) => [doc.id, doc.data()])),
      ))
  const siteZones = () =>
    (site ??= Promise.all([
      db.collection('hosts').doc(hostId).get(),
      db.collection('orgs').doc(ctx.orgId).get(),
    ]).then(([host, org]) => ({
      host: host.data() ?? null,
      org: org.data() ?? null,
    })))
  return {
    serviceOf: async (serviceId) =>
      (await servicesOfSite()).get(serviceId) ?? null,
    async zoneOf(booking) {
      const stored = storedBookingTimeZone(booking)
      if (stored) return stored
      // Written before the zone was stored: the booking route's own chain.
      const [service, zones] = await Promise.all([
        servicesOfSite().then(
          (all) => all.get(String(booking['serviceId'] ?? '')) ?? null,
        ),
        siteZones(),
      ])
      return bookingTimeZone({
        service: service as { timezone?: unknown } | null,
        host: zones.host as { timeZone?: string } | null,
        org: zones.org as { timeZone?: string } | null,
      })
    },
  }
}

const ZONE_FIELDS = new Set(['timeZone', 'startsLocal', 'endsLocal'])

/** One booking as a row holding only `fieldIds`. */
async function bookingRow(
  id: string,
  booking: DocumentData,
  fieldIds: readonly string[],
  page: PageContext,
): Promise<Record<string, unknown>> {
  const startsAtMs = millisOf(booking['startsAtMs'])
  const endsAtMs = millisOf(booking['endsAtMs'])
  const zone = fieldIds.some((fieldId) => ZONE_FIELDS.has(fieldId))
    ? await page.zoneOf(booking)
    : 'UTC'
  const row: Record<string, unknown> = {}
  for (const fieldId of fieldIds) {
    switch (fieldId) {
      case 'id':
        row[fieldId] = id
        break
      case 'serviceId':
      case 'serviceName':
      case 'name':
      case 'phone':
      case 'address':
      case 'crmRef':
      case 'taxMode':
      case 'paymentIntentId':
      case 'checkoutSessionId':
        row[fieldId] = textOf(booking[fieldId])
        break
      case 'email':
        // `null` once the customer was erased.
        row[fieldId] = textOf(booking['email'])
        break
      case 'serviceCurrentName': {
        const service = await page.serviceOf(String(booking['serviceId'] ?? ''))
        row[fieldId] =
          service && !service['deletedAt'] ? textOf(service['name']) : null
        break
      }
      case 'startsAt':
        row[fieldId] = isoOf(startsAtMs)
        break
      case 'endsAt':
        row[fieldId] = isoOf(endsAtMs)
        break
      case 'timeZone':
        row[fieldId] = zone
        break
      case 'startsLocal':
        row[fieldId] = localTextOf(startsAtMs, zone)
        break
      case 'endsLocal':
        row[fieldId] = localTextOf(endsAtMs, zone)
        break
      case 'durationMinutes':
        row[fieldId] =
          startsAtMs !== null && endsAtMs !== null
            ? Math.round((endsAtMs - startsAtMs) / 60_000)
            : null
        break
      case 'status': {
        const status = textOf(booking['status'])
        row[fieldId] = status ? (STATUS_LABELS[status] ?? status) : null
        break
      }
      case 'paidAmount':
        row[fieldId] = dollarsOf(booking['paidAmountCents'])
        break
      case 'tax':
        row[fieldId] = dollarsOf(booking['taxCents'])
        break
      case 'fee':
        row[fieldId] = dollarsOf(booking['feeCents'])
        break
      case 'refunded':
        row[fieldId] = dollarsOf(booking['refundedCents'])
        break
      case 'holdExpiresAt':
        // Only an unpaid booking holds its slot; the stamp is cleared on payment.
        row[fieldId] = isoOf(booking['expiresAtMs'])
        break
      case 'createdAt':
      case 'confirmedAt':
      case 'reminderSentAt':
        row[fieldId] = isoOf(booking[fieldId])
        break
      case 'customerErasedAt':
        row[fieldId] = isoOf(booking['customerErasedAtMs'])
        break
      default:
        row[fieldId] = null
    }
  }
  return row
}

/*==========================================
 * THE QUERIES
 *=========================================*/

/** The query a filter makes, and the field it is ordered by (then by id, the same way). */
interface OrderedQuery {
  query: Query
  orderField: 'startsAtMs' | 'endsAtMs'
}

function filteredQuery(
  bookings: FirebaseFirestore.CollectionReference,
  filter: BookingsTransferFilter | null,
  nowMs: number,
): OrderedQuery {
  if (!filter) return { query: bookings, orderField: 'startsAtMs' }
  switch (filter.kind) {
    case 'upcoming':
      return {
        query: bookings.where('endsAtMs', '>=', filter.asOfMs ?? nowMs),
        orderField: 'endsAtMs',
      }
    case 'email':
      return {
        query: bookings.where('email', '==', filter.email),
        orderField: 'startsAtMs',
      }
    case 'service':
      return {
        query: bookings.where('serviceId', '==', filter.serviceId),
        orderField: 'startsAtMs',
      }
  }
}

interface QueryCursor {
  at: number
  id: string
}

function readQueryCursor(cursor: string | null): QueryCursor | null {
  if (cursor === null) return null
  try {
    const parsed = JSON.parse(cursor) as Partial<QueryCursor>
    if (
      typeof parsed.at === 'number' &&
      typeof parsed.id === 'string' &&
      parsed.id
    ) {
      return { at: parsed.at, id: parsed.id }
    }
  } catch {
    // Falls through to the refusal.
  }
  throw new Error('bookings export: the page cursor could not be read')
}

function hostIdOf(ctx: TransferResourceContext): string {
  const hostId = String(ctx.hostId ?? '').trim()
  if (!hostId || hostId.includes('/'))
    throw new Error('bookings export: a site is required')
  return hostId
}

function pageSizeOf(options: TransferReadOptions | undefined): number {
  const size = Math.floor(Number(options?.pageSize ?? DEFAULT_PAGE_ROWS))
  return Math.max(
    1,
    Math.min(MAX_PAGE_ROWS, Number.isFinite(size) ? size : DEFAULT_PAGE_ROWS),
  )
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size))
  return out
}

/*==========================================
 * THE RESOURCE
 *=========================================*/

/** The `bookings` resource over `deps.firestore()`. Export only: a lookup by id, and no apply or revert. */
export function createBookingsTransferResource(
  deps: BookingsTransferDeps,
): PluginTransferResource {
  const now = deps.now ?? Date.now
  const bookingsOf = (hostId: string) =>
    deps.firestore().collection('hosts').doc(hostId).collection('bookings')

  return {
    fields: () => bookingsTransferCatalog(),
    matchKeys: BOOKINGS_TRANSFER_MATCH_KEYS,

    async count(ctx, options) {
      const hostId = hostIdOf(ctx)
      const bookings = bookingsOf(hostId)
      if (options.ids) {
        // Only the ids that name a booking, so the count is the rows the file holds.
        const ids = [...new Set(options.ids)].filter(
          (id) => id && !id.includes('/'),
        )
        let total = 0
        for (const part of chunks(ids, IN_LIMIT)) {
          const snapshot = await bookings
            .where(FieldPath.documentId(), 'in', part)
            .count()
            .get()
          total += snapshot.data().count
        }
        return total
      }
      const { query } = filteredQuery(
        bookings,
        parseBookingsTransferFilter(options.filter),
        now(),
      )
      return (await query.count().get()).data().count
    },

    async readPage(ctx, cursor, fieldIds, options): Promise<TransferReadPage> {
      const hostId = hostIdOf(ctx)
      const db = deps.firestore()
      const bookings = bookingsOf(hostId)
      const size = pageSizeOf(options)
      const page = pageContext(db, ctx, hostId)

      if (options?.ids) {
        const ids = [...new Set(options.ids)].filter(
          (id) => id && !id.includes('/'),
        )
        const offset = cursor === null ? 0 : Number(cursor)
        if (!Number.isInteger(offset) || offset < 0) {
          throw new Error('bookings export: the page cursor could not be read')
        }
        const slice = ids.slice(offset, offset + size)
        const snapshots = slice.length
          ? await db.getAll(...slice.map((id) => bookings.doc(id)))
          : []
        const rows: Array<Record<string, unknown>> = []
        for (const snapshot of snapshots) {
          if (snapshot.exists)
            rows.push(
              await bookingRow(
                snapshot.id,
                snapshot.data() ?? {},
                fieldIds,
                page,
              ),
            )
        }
        const next = offset + slice.length
        return { rows, next: next < ids.length ? String(next) : null }
      }

      const { query, orderField } = filteredQuery(
        bookings,
        parseBookingsTransferFilter(options?.filter),
        now(),
      )
      let ordered = query
        .orderBy(orderField, 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
      const after = readQueryCursor(cursor)
      if (after) ordered = ordered.startAfter(after.at, after.id)
      // One more than the page, to know without a second read whether another follows.
      const snapshot = await ordered.limit(size + 1).get()
      const docs = snapshot.docs.slice(0, size)
      const rows: Array<Record<string, unknown>> = []
      for (const doc of docs)
        rows.push(await bookingRow(doc.id, doc.data(), fieldIds, page))
      const last = docs[docs.length - 1]
      const next =
        snapshot.docs.length > size && last
          ? JSON.stringify({
              at: Number(last.get(orderField) ?? 0),
              id: last.id,
            } satisfies QueryCursor)
          : null
      return { rows, next }
    },

    /** What a booking holds now, by its Aglyn ID — the one key a resource nothing imports into answers. */
    async lookup(ctx, requests) {
      const hostId = hostIdOf(ctx)
      const db = deps.firestore()
      const bookings = bookingsOf(hostId)
      const byId = requests.filter((request) => request.fieldId === TRANSFER_ID_FIELD)
      const ids = [...new Set(byId.flatMap((request) => request.values))].filter(
        (id) => id && !id.includes('/'),
      )
      const catalog = bookingsTransferCatalog()
      const fieldIds = [
        TRANSFER_ID_FIELD,
        ...[...(catalog.standard ?? []), ...(catalog.system ?? [])].map((field) => field.id),
      ]
      const page = pageContext(db, ctx, hostId)
      const records = new Map<string, Record<string, unknown>>()
      for (const part of chunks(ids, MAX_PAGE_ROWS)) {
        const snapshots = part.length ? await db.getAll(...part.map((id) => bookings.doc(id))) : []
        for (const snapshot of snapshots) {
          if (snapshot.exists) records.set(snapshot.id, await bookingRow(snapshot.id, snapshot.data() ?? {}, fieldIds, page))
        }
      }
      const lookup = buildMatchLookup(
        [...records].map(([id, values]) => ({ id, values })),
        byId,
      )
      return { lookup, records }
    },
  }
}
