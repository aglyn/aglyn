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
  type ListFilterField,
  listFilterDay,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListFilterClause,
  ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/*
 * THE BILLING HISTORY, ASKED OF STRIPE (AGL-3321).
 *
 * An organization's invoices are not in Firestore: they are Stripe's, read
 * through `/api/billing/invoices`. So this list is the sweep's Stripe
 * exception — its Filters panel and its search are not a Firestore query,
 * but they are still asked of the SOURCE, never matched over the invoices a
 * page happened to load. The page turns its clauses into the parameters
 * below; the route turns those into Stripe's own server-side filters:
 *
 *   - Status and Date: the invoice list's `status` and `created[gte|lt]`,
 *     paged by `starting_after`.
 *   - Invoice number: Stripe's invoice search, `number:'…'`, beside the
 *     same status and date clauses, paged by its `page` token.
 *   - The search box: an invoice ID (`in_…`) is fetched by id; anything else
 *     is an invoice number, asked of the search like the filter.
 *
 * What Stripe cannot answer is not offered: a number is matched whole
 * (Stripe's search has no prefix match on it), a status is one value (its
 * search cannot mix `AND` and `OR`, and the customer clause is an `AND`).
 * The number filter and the search both ask about the number, so the two
 * together keep the filter and refuse the search by name.
 */

/** Stripe's finalized statuses; drafts are never listed. */
export const INVOICE_STATUS_OPTIONS: readonly ListFilterOption[] = [
  { value: 'open', label: 'Open' },
  { value: 'paid', label: 'Paid' },
  { value: 'uncollectible', label: 'Uncollectible' },
  { value: 'void', label: 'Void' },
]

export const INVOICE_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'number', kind: 'text', path: 'number', operators: ['equals'] },
  {
    column: 'created',
    kind: 'date',
    path: 'created',
    presence: 'always',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
  { column: 'status', kind: 'exact', path: 'status', operators: ['equals'] },
]

export const INVOICE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  number: 'Invoice',
  created: 'Date',
  status: 'Status',
}

export const INVOICE_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  status: INVOICE_STATUS_OPTIONS,
}

export const INVOICE_SELECT_FIELDS: readonly string[] = ['status']

/** What the route asks Stripe, as query-string parameters. */
export interface InvoiceQueryParams {
  status?: string
  /** Unix seconds, inclusive. */
  createdGte?: number
  /** Unix seconds, exclusive. */
  createdLt?: number
  /** A whole invoice number. */
  number?: string
  /** A Stripe invoice ID, `in_…`. */
  id?: string
}

export interface InvoiceQueryPlan {
  params: InvoiceQueryParams
  /** Asked for and not sent to Stripe, with why — for `listQueryRefusals`. */
  refused: Array<{ clause: ListFilterClause | 'search'; reason: string }>
  notices: string[]
}

const STATUSES = new Set(INVOICE_STATUS_OPTIONS.map((option) => option.value))

/** A Stripe invoice ID, which the search box fetches by id. */
export const STRIPE_INVOICE_ID = /^in_[A-Za-z0-9]+$/

/** The longest invoice number the route will ask Stripe about. */
const NUMBER_MAX = 64

const seconds = (date: Date) => Math.floor(date.getTime() / 1000)

/**
 * The day a date clause names, as the reader's own midnight to midnight, in
 * Unix seconds — computed where the reader is, so "on Sept 3" means their
 * Sept 3 rather than the server's.
 */
function dayBounds(raw: string): { start: number; end: number } | null {
  const start = listFilterDay(raw)
  if (Number.isNaN(start.getTime())) return null
  const day = new Date(start)
  day.setHours(0, 0, 0, 0)
  const next = new Date(day)
  next.setDate(next.getDate() + 1)
  return { start: seconds(day), end: seconds(next) }
}

/**
 * The clauses and the search words, as the parameters Stripe serves — and
 * what it cannot, by name.
 */
export function planInvoiceQuery(
  clauses: readonly ListFilterClause[],
  search: readonly string[] = [],
): InvoiceQueryPlan {
  const params: InvoiceQueryParams = {}
  const refused: InvoiceQueryPlan['refused'] = []
  const notices: string[] = []

  for (const clause of clauses) {
    const value = (clause.value ?? '').trim()
    if (clause.field === 'status') {
      if (clause.op !== 'equals') {
        refused.push({ clause, reason: 'Stripe filters invoices by one status at a time' })
      } else if (!STATUSES.has(value)) {
        refused.push({ clause, reason: 'pick one of the statuses' })
      } else {
        params.status = value
      }
    } else if (clause.field === 'number') {
      if (clause.op !== 'equals') {
        refused.push({ clause, reason: 'Stripe matches an invoice number whole' })
      } else if (!value || value.length > NUMBER_MAX) {
        refused.push({ clause, reason: 'type the whole invoice number' })
      } else {
        params.number = value
      }
    } else if (clause.field === 'created') {
      const day = dayBounds(value)
      if (!day) {
        refused.push({ clause, reason: 'pick a date' })
        continue
      }
      const bounds: Record<string, InvoiceQueryParams> = {
        is: { createdGte: day.start, createdLt: day.end },
        after: { createdGte: day.end },
        onOrAfter: { createdGte: day.start },
        before: { createdLt: day.start },
        onOrBefore: { createdLt: day.end },
      }
      const bound = bounds[clause.op]
      if (!bound) {
        refused.push({ clause, reason: `${clause.op} is not something Stripe can ask of a date` })
      } else {
        Object.assign(params, bound)
      }
    } else {
      refused.push({ clause, reason: 'this list does not filter by that' })
    }
  }

  const words = search.map((word) => word.trim()).filter(Boolean)
  if (words.length) {
    const word = words[0]
    if (STRIPE_INVOICE_ID.test(word)) {
      params.id = word
    } else if (params.number) {
      refused.push({
        clause: 'search',
        reason: 'the Invoice filter already names a number — clear it to search',
      })
    } else if (word.length > NUMBER_MAX) {
      refused.push({ clause: 'search', reason: 'type a whole invoice number or an invoice ID' })
    } else {
      params.number = word
    }
    if (words.length > 1 && (params.id || params.number === word)) {
      notices.push(`Search looks up one invoice number or ID: showing results for "${word}".`)
    }
    if (params.number === word || params.id === word) {
      notices.push('Search matches a whole invoice number or invoice ID.')
    }
  }
  return { params, refused, notices }
}

/** The plan's parameters as a query string, for the page's fetch. */
export function invoiceQueryString(params: InvoiceQueryParams): string {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== '',
  )
  return entries
    .map(([key, value]) => `&${key}=${encodeURIComponent(String(value))}`)
    .join('')
}

/**
 * The parameters as the route reads them back, each validated — a status
 * Stripe does not have, a bound that is not a number or an id that is not an
 * invoice's is dropped rather than forwarded.
 */
export function readInvoiceQueryParams(
  query: Readonly<Record<string, unknown>>,
): InvoiceQueryParams {
  const text = (key: string) => {
    const value = query[key]
    return typeof value === 'string' ? value.trim() : ''
  }
  const whole = (key: string) => {
    const value = Number(text(key))
    return text(key) && Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }
  const params: InvoiceQueryParams = {}
  if (STATUSES.has(text('status'))) params.status = text('status')
  const gte = whole('createdGte')
  if (gte !== undefined) params.createdGte = gte
  const lt = whole('createdLt')
  if (lt !== undefined) params.createdLt = lt
  const number = text('number')
  if (number && number.length <= NUMBER_MAX) params.number = number
  if (STRIPE_INVOICE_ID.test(text('id'))) params.id = text('id')
  return params
}

/** A value inside a Stripe search query's single quotes. */
const quoted = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/**
 * Stripe's invoice search query for a customer and the plan's number, status
 * and dates — every clause joined by `AND`, the one connective the customer
 * clause allows beside it.
 */
export function stripeInvoiceSearchQuery(
  customerId: string,
  params: InvoiceQueryParams,
): string {
  const clauses = [`customer:${quoted(customerId)}`]
  if (params.number) clauses.push(`number:${quoted(params.number)}`)
  if (params.status) clauses.push(`status:${quoted(params.status)}`)
  if (params.createdGte !== undefined) clauses.push(`created>=${params.createdGte}`)
  if (params.createdLt !== undefined) clauses.push(`created<${params.createdLt}`)
  return clauses.join(' AND ')
}

/** Whether one fetched invoice answers the plan's status and dates. */
export function invoiceAnswers(
  invoice: { status?: string | null; created?: number | null },
  params: InvoiceQueryParams,
): boolean {
  if (params.status && invoice.status !== params.status) return false
  const created = Number(invoice.created ?? NaN)
  if (params.createdGte !== undefined && !(created >= params.createdGte)) return false
  if (params.createdLt !== undefined && !(created < params.createdLt)) return false
  return true
}
