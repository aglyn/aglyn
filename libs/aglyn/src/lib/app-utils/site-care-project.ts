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
  OWNER_APPROVAL_CHANNEL_WORDS,
  readOwnerApprovalRecord,
  type OwnerApprovalRecord,
} from './owner-approval-record'
import {
  SITE_CARE_EXTRA_HOUR_USD,
  SITE_CARE_PROJECT_BRAND_KIT_FROM_USD,
  SITE_CARE_PROJECT_LANDING_PAGE_FROM_USD,
  SITE_CARE_PROJECT_REDESIGN_FROM_USD,
  SITE_CARE_PROJECT_SPLIT_ABOVE_USD,
} from './plan-entitlements'
import { formatSiteCareUsd, SITE_CARE_EXTRA_TIME_TAX_CODE } from './site-care'

/**
 * SITE CARE PROJECTS: THE ARITHMETIC AND THE RECORD (AGL-3970).
 *
 * Site Care covers changes to what a site already has. Work that adds
 * something — a page, a form, a design, a campaign — is a PROJECT, billed as
 * one flat quote from the staff "Charge for work" on the staff organization
 * page, on a one-off Stripe invoice the owner pays from their phone. This
 * module is everything about that which needs no Firestore and no Stripe:
 * the quote, the split, where a project stands, and the sentences the owner
 * reads. The server module (`@aglyn/tenant-data-admin/server/site-care-projects`),
 * the staff card, the owner's Billing card and the reconciliation all read
 * it, so they cannot disagree.
 *
 * ## The rules, from the Decision Log of 2026-10-19
 *
 * - The quote is the estimated hours × `SITE_CARE_EXTRA_HOUR_USD`, the
 *   hours rounded UP to the whole hour, and never below the published
 *   starting price of the project's kind. Staff may raise it, never lower
 *   it. It is one number, given before work starts and fixed once given.
 * - Priced above `SITE_CARE_PROJECT_SPLIT_ABOVE_USD`, it is billed half up
 *   front and half at launch: two invoices from the same record. At or
 *   below, in full up front.
 * - Nothing is invoiced without the owner's recorded yes to THIS quote
 *   (`owner-approval-record`): change the quote and the yes must be
 *   recorded again.
 * - Scope and price are edited, with a reason, only until the first invoice
 *   is sent. After that a wrong invoice is voided, credited or refunded from
 *   the record, and a new price is a new project.
 */

/** The kinds a project can be, each with its published starting price. */
export const SITE_CARE_PROJECT_KINDS = ['landingPage', 'redesign', 'brandKit', 'other'] as const

export type SiteCareProjectKind = (typeof SITE_CARE_PROJECT_KINDS)[number]

/**
 * The floor each kind's quote may not go below. `other` (a form, photos,
 * copy, ads) has no published starting price, so its floor is the hourly
 * rate alone: one hour at least.
 */
export const SITE_CARE_PROJECT_FLOOR_USD: Readonly<Record<SiteCareProjectKind, number>> = {
  landingPage: SITE_CARE_PROJECT_LANDING_PAGE_FROM_USD,
  redesign: SITE_CARE_PROJECT_REDESIGN_FROM_USD,
  brandKit: SITE_CARE_PROJECT_BRAND_KIT_FROM_USD,
  other: 0,
}

/** The kind as a picker labels it. */
export const SITE_CARE_PROJECT_KIND_LABELS: Readonly<Record<SiteCareProjectKind, string>> = {
  landingPage: 'Landing page',
  redesign: 'Redesign',
  brandKit: 'Logo or brand kit',
  other: 'Other project (no starting price)',
}

/** Every project line carries the code every live Aglyn product carries. */
export const SITE_CARE_PROJECT_TAX_CODE = SITE_CARE_EXTRA_TIME_TAX_CODE

/** The longest estimate a quote takes, in hours. */
export const SITE_CARE_PROJECT_MAX_HOURS = 400

/** The highest price a quote takes, in whole dollars. */
export const SITE_CARE_PROJECT_MAX_USD = 50_000

export const SITE_CARE_PROJECT_TITLE_MAX = 120
export const SITE_CARE_PROJECT_SCOPE_LINES_MAX = 20
export const SITE_CARE_PROJECT_SCOPE_LINE_MAX = 200

/**
 * How long the owner has to pay a sent invoice. Stripe requires a due date
 * on an invoice it does not charge automatically; the pay link works from
 * the moment it is sent.
 */
export const SITE_CARE_PROJECT_INVOICE_DAYS_UNTIL_DUE = 14

export type SiteCareProjectSplit = 'full' | 'half'

/** Which invoice of a project: the whole price, or one of its halves. */
export type SiteCareProjectInvoiceKind = 'full' | 'deposit' | 'final'

/**
 * Where one invoice stands, as the platform recorded it. `creating` is
 * written BEFORE the Stripe calls, so a call that succeeded with no row
 * behind it shows as `creating` — which the reconciliation reports and a
 * retry settles under the same idempotency key.
 */
export type SiteCareProjectInvoiceStatus =
  | 'creating'
  | 'failed'
  | 'open'
  | 'paid'
  | 'voided'
  | 'credited'
  | 'refunded'

/** Where the project stands, derived from its record (never typed in). */
export type SiteCareProjectStatus =
  | 'quoted'
  | 'accepted'
  | 'invoiced'
  | 'deposit-paid'
  | 'launched'
  | 'paid'
  | 'refunded'

export const SITE_CARE_PROJECT_STATUS_LABELS: Readonly<Record<SiteCareProjectStatus, string>> = {
  quoted: 'Quoted',
  accepted: 'Accepted, not invoiced',
  invoiced: 'Invoice sent',
  'deposit-paid': 'Deposit paid',
  launched: 'Launched, balance invoiced',
  paid: 'Paid',
  refunded: 'Refunded',
}

export interface SiteCareProjectQuote {
  kind: SiteCareProjectKind
  /** The hours staff estimated, as typed. */
  estimatedHours: number
  /** The estimate rounded up to the whole hour. */
  billedHours: number
  rateUsd: number
  floorUsd: number
  /** `max(billedHours × rate, floor)`: the least the quote may be. */
  computedUsd: number
  /** The flat price: `computedUsd`, or more if staff rounded it up. */
  priceUsd: number
  split: SiteCareProjectSplit
}

export interface SiteCareProjectInvoice {
  /** 1 for the first invoice the project raised; each later one is higher. */
  seq: number
  kind: SiteCareProjectInvoiceKind
  status: SiteCareProjectInvoiceStatus
  /** Before tax, in cents. */
  amountCents: number
  /** The line's description, exactly as it was sent. */
  description: string
  /** The key every Stripe write for this invoice derives from. */
  idempotencyKey: string
  invoiceId: string | null
  invoiceItemId: string | null
  number: string | null
  hostedInvoiceUrl: string | null
  /** The finalized total, tax included, in cents. */
  totalCents: number
  amountPaidCents: number
  creditNoteId: string | null
  refundId: string | null
  error: string | null
  createdAtMs: number
  updatedAtMs: number
  paidAtMs: number | null
}

/** The owner's yes to a quote: the shared record, pinned to the quote it agreed to. */
export type SiteCareProjectAcceptance = OwnerApprovalRecord & {
  /** The quote version the owner said yes to. */
  quoteVersion: number
  priceUsd: number
}

export interface SiteCareProject {
  orgId: string
  title: string
  /** One line per deliverable, plain text. */
  scope: string[]
  quote: SiteCareProjectQuote
  /** 1 for the first quote; each edit is one higher. */
  quoteVersion: number
  acceptance: SiteCareProjectAcceptance | null
  invoices: SiteCareProjectInvoice[]
  invoiceSeq: number
  /** When the first invoice reached the owner; the quote is fixed from then. */
  firstInvoiceSentAtMs: number | null
  launchedAtMs: number | null
  launchedByUid: string | null
  status: SiteCareProjectStatus
  createdAtMs: number
  createdByUid: string | null
  createdByEmail: string | null
  updatedAtMs: number
}

export type SiteCareProjectResult<T> = ({ ok: true } & T) | { ok: false; error: string }

/** A project with a price above the line is billed half and half. */
export function siteCareProjectSplit(priceUsd: number): SiteCareProjectSplit {
  return priceUsd > SITE_CARE_PROJECT_SPLIT_ABOVE_USD ? 'half' : 'full'
}

/** The estimate rounded up to the whole hour, ignoring float dust (2.0000001 is 2). */
export function siteCareProjectBilledHours(estimatedHours: number): number {
  return Math.max(1, Math.ceil(Number(estimatedHours) - 1e-9))
}

/**
 * The quote from what staff typed: hours, a kind, and optionally a price
 * above the computed one. A price below it is refused, never lowered to.
 */
export function siteCareProjectQuote(input: {
  kind: unknown
  estimatedHours: unknown
  priceUsd?: unknown
}): SiteCareProjectResult<{ quote: SiteCareProjectQuote }> {
  const kind = String(input.kind ?? '') as SiteCareProjectKind
  if (!SITE_CARE_PROJECT_KINDS.includes(kind)) return { ok: false, error: 'Choose what kind of project it is.' }
  const estimatedHours = Number(input.estimatedHours)
  if (!Number.isFinite(estimatedHours) || estimatedHours <= 0 || estimatedHours > SITE_CARE_PROJECT_MAX_HOURS) {
    return { ok: false, error: `Enter the estimated hours, more than 0 and at most ${SITE_CARE_PROJECT_MAX_HOURS}.` }
  }
  const billedHours = siteCareProjectBilledHours(estimatedHours)
  const floorUsd = SITE_CARE_PROJECT_FLOOR_USD[kind]
  const computedUsd = Math.max(billedHours * SITE_CARE_EXTRA_HOUR_USD, floorUsd)
  const typed = input.priceUsd
  let priceUsd = computedUsd
  if (typed !== undefined && typed !== null && typed !== '') {
    const price = Number(typed)
    if (!Number.isInteger(price) || price < 1) return { ok: false, error: 'Enter the price as a whole number of dollars.' }
    if (price < computedUsd) {
      return {
        ok: false,
        error: `The price can only be rounded up: it is at least ${formatSiteCareUsd(computedUsd * 100)} for this estimate.`,
      }
    }
    priceUsd = price
  }
  if (priceUsd > SITE_CARE_PROJECT_MAX_USD) {
    return { ok: false, error: `A project is at most ${formatSiteCareUsd(SITE_CARE_PROJECT_MAX_USD * 100)}.` }
  }
  return {
    ok: true,
    quote: {
      kind,
      estimatedHours,
      billedHours,
      rateUsd: SITE_CARE_EXTRA_HOUR_USD,
      floorUsd,
      computedUsd,
      priceUsd,
      split: siteCareProjectSplit(priceUsd),
    },
  }
}

/** The invoices a quote is billed on, in order, with their amounts in cents. */
export function siteCareProjectInvoicePlan(
  quote: Pick<SiteCareProjectQuote, 'priceUsd' | 'split'>,
): Array<{ kind: SiteCareProjectInvoiceKind; amountCents: number }> {
  const cents = Math.round(quote.priceUsd * 100)
  if (quote.split === 'full') return [{ kind: 'full', amountCents: cents }]
  const deposit = Math.ceil(cents / 2)
  return [
    { kind: 'deposit', amountCents: deposit },
    { kind: 'final', amountCents: cents - deposit },
  ]
}

/** The amount of one invoice of a quote, in cents. */
export function siteCareProjectInvoiceAmount(
  quote: Pick<SiteCareProjectQuote, 'priceUsd' | 'split'>,
  kind: SiteCareProjectInvoiceKind,
): number {
  return siteCareProjectInvoicePlan(quote).find((row) => row.kind === kind)?.amountCents ?? 0
}

/** A trimmed title, or an error. */
export function readSiteCareProjectTitle(raw: unknown): SiteCareProjectResult<{ title: string }> {
  const title = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, SITE_CARE_PROJECT_TITLE_MAX) : ''
  return title ? { ok: true, title } : { ok: false, error: 'Give the project a name the owner will recognize.' }
}

/**
 * Scope lines from a list or from text with one deliverable per line: each
 * trimmed, blanks dropped, bullets stripped, at least one.
 */
export function readSiteCareProjectScope(raw: unknown): SiteCareProjectResult<{ scope: string[] }> {
  const rows = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : []
  const scope = rows
    .map((row) =>
      String(row ?? '')
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
        .trim()
        .slice(0, SITE_CARE_PROJECT_SCOPE_LINE_MAX),
    )
    .filter(Boolean)
  if (!scope.length) return { ok: false, error: 'List what the price covers, one deliverable per line.' }
  if (scope.length > SITE_CARE_PROJECT_SCOPE_LINES_MAX) {
    return { ok: false, error: `List at most ${SITE_CARE_PROJECT_SCOPE_LINES_MAX} deliverables.` }
  }
  return { ok: true, scope }
}

const INVOICE_STATUSES: readonly SiteCareProjectInvoiceStatus[] = [
  'creating',
  'failed',
  'open',
  'paid',
  'voided',
  'credited',
  'refunded',
]

function readInvoice(value: unknown): SiteCareProjectInvoice | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<SiteCareProjectInvoice>
  const kind = row.kind === 'deposit' || row.kind === 'final' ? row.kind : row.kind === 'full' ? 'full' : null
  if (!kind) return null
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    seq: Number(row.seq) || 0,
    kind,
    status: INVOICE_STATUSES.includes(row.status as SiteCareProjectInvoiceStatus)
      ? (row.status as SiteCareProjectInvoiceStatus)
      : 'failed',
    amountCents: Number(row.amountCents) || 0,
    description: String(row.description ?? ''),
    idempotencyKey: String(row.idempotencyKey ?? ''),
    invoiceId: text(row.invoiceId),
    invoiceItemId: text(row.invoiceItemId),
    number: text(row.number),
    hostedInvoiceUrl: text(row.hostedInvoiceUrl),
    totalCents: Number(row.totalCents) || 0,
    amountPaidCents: Number(row.amountPaidCents) || 0,
    creditNoteId: text(row.creditNoteId),
    refundId: text(row.refundId),
    error: text(row.error),
    createdAtMs: Number(row.createdAtMs) || 0,
    updatedAtMs: Number(row.updatedAtMs) || 0,
    paidAtMs: Number(row.paidAtMs) || null,
  }
}

/** A stored project read back with every field present, or null when it is not one. */
export function readSiteCareProject(value: unknown): SiteCareProject | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Partial<SiteCareProject>
  const quote = stored.quote as Partial<SiteCareProjectQuote> | undefined
  if (!quote || !SITE_CARE_PROJECT_KINDS.includes(quote.kind as SiteCareProjectKind)) return null
  const priceUsd = Number(quote.priceUsd) || 0
  const acceptanceRecord = readOwnerApprovalRecord(stored.acceptance)
  const acceptance: SiteCareProjectAcceptance | null = acceptanceRecord
    ? {
        ...acceptanceRecord,
        quoteVersion: Number((stored.acceptance as Partial<SiteCareProjectAcceptance>).quoteVersion) || 0,
        priceUsd: Number((stored.acceptance as Partial<SiteCareProjectAcceptance>).priceUsd) || 0,
      }
    : null
  const project: SiteCareProject = {
    orgId: String(stored.orgId ?? ''),
    title: String(stored.title ?? ''),
    scope: Array.isArray(stored.scope) ? stored.scope.map(String) : [],
    quote: {
      kind: quote.kind as SiteCareProjectKind,
      estimatedHours: Number(quote.estimatedHours) || 0,
      billedHours: Number(quote.billedHours) || 0,
      rateUsd: Number(quote.rateUsd) || SITE_CARE_EXTRA_HOUR_USD,
      floorUsd: Number(quote.floorUsd) || 0,
      computedUsd: Number(quote.computedUsd) || 0,
      priceUsd,
      split: quote.split === 'half' ? 'half' : 'full',
    },
    quoteVersion: Number(stored.quoteVersion) || 1,
    acceptance,
    invoices: (Array.isArray(stored.invoices) ? stored.invoices : [])
      .map(readInvoice)
      .filter((row): row is SiteCareProjectInvoice => Boolean(row)),
    invoiceSeq: Number(stored.invoiceSeq) || 0,
    firstInvoiceSentAtMs: Number(stored.firstInvoiceSentAtMs) || null,
    launchedAtMs: Number(stored.launchedAtMs) || null,
    launchedByUid: stored.launchedByUid ?? null,
    status: 'quoted',
    createdAtMs: Number(stored.createdAtMs) || 0,
    createdByUid: stored.createdByUid ?? null,
    createdByEmail: stored.createdByEmail ?? null,
    updatedAtMs: Number(stored.updatedAtMs) || 0,
  }
  project.status = siteCareProjectStatus(project)
  return project
}

/** The newest invoice of a kind, whatever its status. */
export function latestSiteCareProjectInvoice(
  project: Pick<SiteCareProject, 'invoices'>,
  kind: SiteCareProjectInvoiceKind,
): SiteCareProjectInvoice | null {
  return (
    project.invoices
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.seq - a.seq)[0] ?? null
  )
}

/** An invoice that is out, or on its way out: one of a kind at a time. */
function isLive(invoice: SiteCareProjectInvoice | null): boolean {
  return Boolean(invoice) && invoice?.status !== 'voided' && invoice?.status !== 'credited'
}

/** Whether the owner's recorded yes is to the quote as it stands. */
export function siteCareProjectAcceptanceIsCurrent(
  project: Pick<SiteCareProject, 'acceptance' | 'quoteVersion'>,
): boolean {
  return Boolean(project.acceptance) && project.acceptance?.quoteVersion === project.quoteVersion
}

/** Where a project stands, from its acceptance, invoices and launch. */
export function siteCareProjectStatus(
  project: Pick<SiteCareProject, 'acceptance' | 'quoteVersion' | 'invoices' | 'launchedAtMs' | 'quote'>,
): SiteCareProjectStatus {
  const before: SiteCareProjectStatus = siteCareProjectAcceptanceIsCurrent(project) ? 'accepted' : 'quoted'
  const outstanding = (status: SiteCareProjectInvoiceStatus) =>
    status === 'creating' || status === 'failed' || status === 'open'
  if (project.quote.split === 'full') {
    const full = latestSiteCareProjectInvoice(project, 'full')
    if (!isLive(full) || !full) return before
    if (full.status === 'paid') return 'paid'
    if (full.status === 'refunded') return 'refunded'
    return outstanding(full.status) ? 'invoiced' : before
  }
  const final = latestSiteCareProjectInvoice(project, 'final')
  if (final && isLive(final)) {
    if (final.status === 'paid') return 'paid'
    if (final.status === 'refunded') return 'refunded'
    return 'launched'
  }
  const deposit = latestSiteCareProjectInvoice(project, 'deposit')
  if (!deposit || !isLive(deposit)) return before
  if (deposit.status === 'refunded') return 'refunded'
  if (deposit.status === 'paid') return project.launchedAtMs ? 'launched' : 'deposit-paid'
  return 'invoiced'
}

/**
 * Whether scope and price may still change: until the first invoice
 * reaches the owner, and never while one is being made.
 */
export function siteCareProjectQuoteIsEditable(
  project: Pick<SiteCareProject, 'firstInvoiceSentAtMs' | 'invoices'>,
): boolean {
  if (project.firstInvoiceSentAtMs) return false
  return !project.invoices.some((row) => row.status === 'creating' || (row.status === 'failed' && row.invoiceId))
}

/**
 * The invoice the project may raise now, or why it may not. The first is
 * raised on the owner's current yes; the balance of a half-and-half project
 * only once it is launched and its deposit is paid.
 */
export function siteCareProjectNextInvoice(
  project: Pick<SiteCareProject, 'acceptance' | 'quoteVersion' | 'invoices' | 'launchedAtMs' | 'quote'>,
): SiteCareProjectResult<{ kind: SiteCareProjectInvoiceKind; amountCents: number }> {
  if (project.invoices.some((row) => row.status === 'creating' || row.status === 'failed')) {
    return { ok: false, error: 'An invoice is still being made. Retry it before raising another.' }
  }
  const first: SiteCareProjectInvoiceKind = project.quote.split === 'full' ? 'full' : 'deposit'
  const firstInvoice = latestSiteCareProjectInvoice(project, first)
  if (!isLive(firstInvoice)) {
    if (!siteCareProjectAcceptanceIsCurrent(project)) {
      return {
        ok: false,
        error: project.acceptance
          ? 'The quote changed after the owner said yes. Record their yes to this quote first.'
          : 'Record how and when the owner said yes before anything is invoiced.',
      }
    }
    return { ok: true, kind: first, amountCents: siteCareProjectInvoiceAmount(project.quote, first) }
  }
  if (first === 'full') return { ok: false, error: 'This project is billed in full on one invoice, already sent.' }
  if (isLive(latestSiteCareProjectInvoice(project, 'final'))) {
    return { ok: false, error: 'Both halves of this project are already invoiced.' }
  }
  if (firstInvoice?.status !== 'paid') return { ok: false, error: 'The balance is invoiced once the deposit is paid.' }
  if (!project.launchedAtMs) return { ok: false, error: 'The balance is invoiced when the project is marked launched.' }
  return { ok: true, kind: 'final', amountCents: siteCareProjectInvoiceAmount(project.quote, 'final') }
}

/** "deposit", "balance", "invoice": what an invoice is to the owner. */
export function siteCareProjectInvoiceWords(kind: SiteCareProjectInvoiceKind): string {
  return kind === 'deposit' ? 'deposit' : kind === 'final' ? 'balance' : 'invoice'
}

/** How the quote is billed, in one sentence the owner reads. */
export function siteCareProjectSplitSentence(quote: Pick<SiteCareProjectQuote, 'priceUsd' | 'split'>): string {
  const price = formatSiteCareUsd(quote.priceUsd * 100)
  if (quote.split === 'full') return `${price}, paid in full before work starts.`
  const [deposit, final] = siteCareProjectInvoicePlan(quote)
  return `${price}: half (${formatSiteCareUsd(deposit.amountCents)}) before work starts and half (${formatSiteCareUsd(final.amountCents)}) at launch.`
}

/** The Stripe line's description for one invoice of a project. */
export function siteCareProjectInvoiceDescription(
  project: Pick<SiteCareProject, 'title' | 'quote'>,
  kind: SiteCareProjectInvoiceKind,
): string {
  const price = formatSiteCareUsd(project.quote.priceUsd * 100)
  const what =
    kind === 'deposit'
      ? `deposit, half of the ${price} quote`
      : kind === 'final'
        ? `balance at launch, half of the ${price} quote`
        : `the ${price} quote, in full`
  return `${project.title}: ${what}`.slice(0, 480)
}

/** The invoice's memo: what the price covers, one deliverable per line. */
export function siteCareProjectInvoiceMemo(project: Pick<SiteCareProject, 'scope'>): string {
  return ['What this covers:', ...project.scope.map((line) => `- ${line}`)].join('\n').slice(0, 1500)
}

/**
 * The acceptance confirmation's one sentence, in the owner's words: what
 * they agreed to, how and when.
 */
export function siteCareProjectAcceptanceSentence(
  record: Pick<OwnerApprovalRecord, 'channel' | 'approvedAtMs'>,
  project: Pick<SiteCareProject, 'title' | 'quote'>,
  formatDate: (ms: number) => string,
): string {
  return (
    `You accepted our quote for “${project.title}”: ${siteCareProjectSplitSentence(project.quote)} ` +
    `You said yes ${OWNER_APPROVAL_CHANNEL_WORDS[record.channel]} on ${formatDate(record.approvedAtMs)}.`
  )
}

/** What the owner sees for one invoice on Billing. */
export function siteCareProjectInvoiceLine(invoice: SiteCareProjectInvoice): string {
  const amount = formatSiteCareUsd(invoice.amountCents)
  const what = siteCareProjectInvoiceWords(invoice.kind)
  const capital = what.charAt(0).toUpperCase() + what.slice(1)
  switch (invoice.status) {
    case 'paid':
      return `${capital} ${amount}: paid`
    case 'open':
      return `${capital} ${amount}: waiting for payment`
    case 'voided':
      return `${capital} ${amount}: canceled, nothing is owed`
    case 'credited':
      return `${capital} ${amount}: credited, nothing is owed`
    case 'refunded':
      return `${capital} ${amount}: refunded`
    default:
      return `${capital} ${amount}: being prepared`
  }
}
