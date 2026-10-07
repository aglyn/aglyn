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
 * THE CODAT ADAPTER (AGL-3636): every accounting system Codat reaches —
 * QuickBooks Desktop, NetSuite, Sage, FreshBooks, Zoho Books, Wave and the
 * rest — behind the same contract as the QuickBooks Online and Xero
 * adapters, over Codat's Platform and Accounting APIs with plain `fetch`.
 *
 * ## The grant is a Codat company, not a token
 *
 * Codat holds the ledger's own credentials. Aglyn holds one API key for the
 * deployment (`CODAT_API_KEY`), and each workspace is one Codat COMPANY:
 *
 * - `authorizeUrl` creates the company, tagged with the workspace's id, and
 *   answers its Codat Link address with the signed `state` appended. The
 *   member picks their accounting software in Link and signs in to it there.
 * - Codat then sends the browser to the redirect address set in the Codat
 *   Portal, which carries `{companyId}` as `code` and the `state` back, so the
 *   accounting callback route handles it exactly as an OAuth redirect.
 * - `exchangeCode` reads the company, refuses one tagged for another
 *   workspace, and answers its linked accounting connections as tenants.
 *
 * The "token set" is therefore the company id in both slots, sealed like any
 * token and never expiring. The connection id is the tenant. `refresh`
 * spends no token: it asks Codat whether the company still has a linked
 * accounting connection and answers `auth` when the merchant's software
 * was unlinked or its credentials lapsed, which is what turns the
 * connection to "reconnect". `revoke` deletes the company, which unlinks
 * every connection and ends the per-company charge.
 *
 * ## Writes are asynchronous
 *
 * A Codat create answers a PUSH OPERATION, `Pending` until the ledger takes
 * it — seconds for a cloud ledger, longer for QuickBooks Desktop, which
 * waits for the merchant's Web Connector. Every push carries Codat's
 * `Idempotency-Key` (a GUID derived from the sync item's key; Codat answers
 * a repeat inside 90 minutes with the first operation) and a 60-minute
 * timeout, and is polled for a short while:
 *
 * - `Success` → the record Codat names in the operation.
 * - `Failed` → `validation`, with the ledger's reasons: the item asks a person.
 * - `TimedOut` → `validation` too: nothing was written, and only a retry
 *   with a fresh key (the Retry button) sends it again.
 * - Still `Pending` → `transient`. The engine's retry posts the same key
 *   inside Codat's 90-minute window, gets the same operation back and polls it.
 *
 * Before any create the engine asks `findByExternalId`, which reads Codat's
 * cache of the ledger for a record already carrying the external id — the
 * `reference` of a direct income or cost, and the bracketed id in a
 * transfer's or journal's description.
 *
 * ## The documents
 *
 * A sale is a direct income paid in full into clearing, a refund a direct
 * cost out of clearing against the income account, a fee a direct cost to
 * the fee expense account, a returned fee a direct income back to it, a
 * payout a transfer, and a daily summary a journal entry (debit positive).
 * Every sale and refund is filed under ONE walk-in customer and every fee
 * under one supplier, both made once by `prepare` and kept in the
 * connection's extras: Codat's cache is refreshed on a schedule, so a
 * customer looked up per buyer could be made twice; the buyer's name and
 * email go in the note instead.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { createHash } from 'node:crypto'
import type { AccountingAccountOption, AccountingAccountRole, AccountingTaxOption } from '../../model/accounting.types'
import { centsToDecimal, normalizeCurrency } from '../../model/accounting-money'
import {
  ACCOUNTING_FEE_PAYEE,
  ACCOUNTING_WALK_IN_CUSTOMER,
  type AccountingCustomerRef,
  type AccountingDocLine,
  type AccountingExpenseDoc,
  type AccountingJournalDoc,
  type AccountingRefundDoc,
  type AccountingSaleDoc,
  type AccountingTaxTreatment,
  type AccountingTransferDoc,
} from '../../model/accounting-transforms'
import {
  AccountingPacer,
  AccountingProviderError,
  accountingRequest,
  defaultSleep,
  type AccountingHttpOptions,
} from './http'
import type {
  AccountingDocKind,
  AccountingDocRef,
  AccountingProvider,
  AccountingProviderExtras,
  AccountingSession,
  AccountingTenant,
  AccountingTokenSet,
  AccountingWriteContext,
} from './provider'

export const CODAT_ENDPOINTS = {
  api: 'https://api.codat.io',
  /** Codat Link, which only the member's browser opens. */
  link: 'https://link.codat.io',
} as const

/** The company tag that binds a Codat company to one workspace. */
export const CODAT_ORG_TAG = 'aglynOrgId'

/** How long Codat may hold a write for a ledger that is offline. */
export const CODAT_PUSH_TIMEOUT_MINUTES = 60

/** Polls of a pending write inside one call, and the wait before each. */
export const CODAT_PUSH_POLL_WAITS_MS = [1000, 2000, 3000, 4000, 5000, 5000, 5000] as const

/** Codat allows ten concurrent requests per company; one run makes one at a time, gently. */
export const CODAT_MIN_INTERVAL_MS = 100

/** The extras keys `prepare` fills. */
export const CODAT_EXTRAS = {
  customerId: 'codatCustomerId',
  supplierId: 'codatSupplierId',
} as const

/** A company or connection id Codat issues: a GUID. */
const CODAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Never expires: Codat has no access token to refresh. */
const NEVER_MS = Number.MAX_SAFE_INTEGER

export interface CodatConfig {
  apiKey: string
}

type CodatRecord = Record<string, unknown>

/** Codat's error body: its validation messages first, then its sentence. */
export function describeCodatError(body: unknown): string | null {
  if (typeof body === 'string') return body.slice(0, 500) || null
  const data = (body ?? {}) as {
    error?: string
    errorMessage?: string
    validation?: { errors?: Array<{ message?: string }> }
  }
  const validation = (data.validation?.errors ?? []).map((error) => error?.message).filter(Boolean)
  if (validation.length) return validation.join(' ').slice(0, 500)
  const text = data.error || data.errorMessage
  return text ? String(text).slice(0, 500) : null
}

/**
 * A GUID for Codat's `Idempotency-Key`, which must be one: the SHA-256 of the
 * engine's key, shaped as a version-5-style UUID. Stable for the same key.
 */
export function codatIdempotencyKey(key: string): string {
  const hex = createHash('sha256').update(`codat\n${key}`).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

/** `query` for Codat's query language: `field=value`, encoded once by URLSearchParams. */
const query = (field: string, operator: '=' | '~', value: string) => `${field}${operator}${value}`

/** What a description carries so a transfer or journal can be found again. */
export const codatTaggedDescription = (memo: string, externalId: string) => `${memo} [${externalId}]`.slice(0, 4000)

function classify(account: CodatRecord): AccountingAccountOption['classification'] {
  if (account['isBankAccount'] === true) return 'bank'
  const type = String(account['type'] ?? '')
  const category = String(account['fullyQualifiedCategory'] ?? '')
  if (type === 'Income') return 'income'
  if (type === 'Expense') return 'expense'
  if (type === 'Liability') return 'liability'
  if (type === 'Asset' && /\.Bank(\.|$)|\.Cash(\.|$)/i.test(category)) return 'bank'
  return 'other'
}

/** A line as Codat takes it: net subtotal, its tax, and the gross total. */
export function codatLine(line: AccountingDocLine, treatment: AccountingTaxTreatment) {
  const tax = treatment === 'none' ? 0 : line.taxCents
  const subTotal = treatment === 'inclusive' ? line.amountCents - tax : line.amountCents
  // A unit price that does not divide evenly posts as one line of the
  // whole, so the subtotal is exact to the cent.
  const even = line.quantity > 0 && subTotal % line.quantity === 0
  const quantity = even ? line.quantity : 1
  const description = even || line.quantity <= 1 ? line.description : `${line.quantity} × ${line.description}`
  return {
    description: description.slice(0, 4000),
    unitAmount: centsToDecimal(even ? subTotal / line.quantity : subTotal),
    quantity,
    subTotal: centsToDecimal(subTotal),
    taxAmount: centsToDecimal(tax),
    totalAmount: centsToDecimal(subTotal + tax),
    accountRef: { id: line.accountId },
    ...(line.taxCodeId && treatment !== 'none' ? { taxRateRef: { id: line.taxCodeId } } : {}),
  }
}

/** The buyer, in the note: every sale is filed under one walk-in customer. */
const buyerNote = (customer: AccountingCustomerRef) =>
  [customer.name, customer.email].filter((part) => part && String(part).trim()).join(' · ')

export function createCodatProvider(config: CodatConfig, options: AccountingHttpOptions = {}): AccountingProvider {
  const pacer = options.pacer ?? new AccountingPacer(CODAT_MIN_INTERVAL_MS)
  const http = { ...options, pacer, describeError: describeCodatError }
  const sleep = options.sleep ?? defaultSleep
  // Codat's header is the Base64 of the key itself.
  const authorization = `Basic ${Buffer.from(config.apiKey, 'utf8').toString('base64')}`

  const call = <T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}) => {
    const { idempotencyKey, ...rest } = init
    return accountingRequest<T>(
      `${CODAT_ENDPOINTS.api}${path}`,
      {
        ...rest,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          ...((rest.headers as Record<string, string> | undefined) ?? {}),
        },
      },
      // One budget per Codat company: the path's company id, or the client's.
      { ...http, pacerKey: /^\/companies\/([^/?]+)/.exec(path)?.[1] ?? 'codat' },
    )
  }

  // Codat's cache of the ledger: `<base>/data/<dataType>`.
  const cached = (base: string, dataType: string) => [base, 'data', dataType].join('/')
  const company = (companyId: string) => `/companies/${encodeURIComponent(companyId)}`
  const connection = (session: AccountingSession) =>
    `${company(session.accessToken)}/connections/${encodeURIComponent(session.tenantId)}`

  /** A cache read that has not been made yet is a wait, not a refusal. */
  const notReadYet = (error: unknown): never => {
    if (error instanceof AccountingProviderError && (error.status === 404 || error.status === 409)) {
      throw new AccountingProviderError(
        'transient',
        'Codat is still reading your books for the first time. Try again in a few minutes.',
        error.status,
      )
    }
    throw error
  }

  async function readCompany(companyId: string): Promise<CodatRecord> {
    if (!CODAT_ID.test(companyId)) {
      throw new AccountingProviderError('validation', 'The connection did not name a Codat company.')
    }
    return (await call<CodatRecord>(company(companyId))) ?? {}
  }

  const linkedAccounting = (record: CodatRecord): CodatRecord[] =>
    (Array.isArray(record['dataConnections']) ? (record['dataConnections'] as CodatRecord[]) : []).filter(
      (entry) => entry?.['sourceType'] === 'Accounting' && entry?.['status'] === 'Linked',
    )

  const tokensFor = (companyId: string): AccountingTokenSet => ({
    accessToken: companyId,
    refreshToken: companyId,
    accessExpiresAtMs: NEVER_MS,
    refreshExpiresAtMs: null,
    scopes: [],
  })

  /** Every page of a cache read, up to `maxPages`. */
  async function readAll(path: string, params: Record<string, string> = {}, maxPages = 10): Promise<CodatRecord[]> {
    const pageSize = 2000
    const rows: CodatRecord[] = []
    for (let page = 1; page <= maxPages; page += 1) {
      const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...params })
      const body = await call<{ results?: CodatRecord[]; totalResults?: number }>(`${path}?${search.toString()}`)
      const results = Array.isArray(body?.results) ? body.results : []
      rows.push(...results.filter((row) => (row?.['metadata'] as { isDeleted?: boolean } | undefined)?.isDeleted !== true))
      if (results.length < pageSize) break
    }
    return rows
  }

  /** The first live record a cache query finds, or `null`; an unread cache finds nothing. */
  async function findOne(path: string, q: string): Promise<CodatRecord | null> {
    try {
      const search = new URLSearchParams({ page: '1', pageSize: '5', query: q })
      const body = await call<{ results?: CodatRecord[] }>(`${path}?${search.toString()}`)
      const results = Array.isArray(body?.results) ? body.results : []
      return results.find((row) => (row?.['metadata'] as { isDeleted?: boolean } | undefined)?.isDeleted !== true) ?? null
    } catch (error) {
      if (error instanceof AccountingProviderError && (error.status === 404 || error.status === 409)) return null
      throw error
    }
  }

  /** A write, followed to its end or for as long as one call may wait. */
  async function push(
    session: AccountingSession,
    dataType: string,
    body: CodatRecord,
    key: string,
  ): Promise<AccountingDocRef> {
    const path = `${connection(session)}/push/${dataType}?timeoutInMinutes=${CODAT_PUSH_TIMEOUT_MINUTES}`
    let operation = await call<CodatRecord>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey: codatIdempotencyKey(key),
    })
    for (const wait of CODAT_PUSH_POLL_WAITS_MS) {
      if (String(operation?.['status'] ?? '') !== 'Pending') break
      const operationKey = String(operation?.['pushOperationKey'] ?? '')
      if (!operationKey) break
      await sleep(wait)
      operation = await call<CodatRecord>(`${company(session.accessToken)}/push/${encodeURIComponent(operationKey)}`)
    }
    return pushOutcome(operation, dataType)
  }

  return {
    id: 'codat',
    picksTenantAfterExchange: true,

    async authorizeUrl({ state, orgId, orgName }) {
      if (!orgId) throw new AccountingProviderError('validation', 'Codat needs the workspace to connect.')
      const created = await call<CodatRecord>('/companies', {
        method: 'POST',
        body: JSON.stringify({
          name: String(orgName || orgId).slice(0, 200),
          description: `${PLATFORM_BRAND_NAME} workspace ${orgId}`,
          tags: { [CODAT_ORG_TAG]: orgId },
        }),
      })
      const id = String(created?.['id'] ?? '')
      const redirect = String(created?.['redirect'] ?? '') || (id ? `${CODAT_ENDPOINTS.link}/company/${id}` : '')
      if (!id || !redirect) throw new AccountingProviderError('transient', 'Codat did not create the connection.')
      const url = new URL(redirect)
      if (url.origin !== CODAT_ENDPOINTS.link) {
        throw new AccountingProviderError('validation', 'Codat answered an unexpected connection address.')
      }
      url.searchParams.set('state', state)
      return url.toString()
    },

    async exchangeCode({ code, orgId }) {
      const record = await readCompany(code)
      const tags = (record['tags'] ?? {}) as Record<string, unknown>
      if (!orgId || tags[CODAT_ORG_TAG] !== orgId) {
        throw new AccountingProviderError('validation', 'That connection belongs to another workspace.')
      }
      const tenants: AccountingTenant[] = linkedAccounting(record).map((entry) => ({
        id: String(entry['id']),
        name: String(entry['platformName'] ?? 'Accounting software'),
        connectionId: String(entry['id']),
      }))
      // Codat reads the books once on link; ask for it now so the account
      // list is ready by the time the mapping form opens.
      await call(cached(company(code), 'all'), { method: 'POST' }).catch(() => undefined)
      return { tokens: tokensFor(code), tenants }
    },

    async refresh(companyId) {
      let record: CodatRecord
      try {
        record = await readCompany(companyId)
      } catch (error) {
        // A refused API key is the deployment's fault, not the merchant's:
        // never mark every workspace for reconnecting over it.
        if (error instanceof AccountingProviderError && error.code === 'auth') {
          throw new AccountingProviderError('transient', 'Codat refused this deployment’s API key.', error.status)
        }
        if (error instanceof AccountingProviderError && error.code === 'not-found') {
          throw new AccountingProviderError('auth', 'The connection to your accounting software was removed.', 404)
        }
        throw error
      }
      if (!linkedAccounting(record).length) {
        throw new AccountingProviderError(
          'auth',
          'Your accounting software is no longer linked. Reconnect it to keep posting.',
          401,
        )
      }
      return tokensFor(companyId)
    },

    async revoke({ refreshToken }) {
      if (!CODAT_ID.test(refreshToken)) return
      try {
        await call(company(refreshToken), { method: 'DELETE' })
      } catch (error) {
        if (error instanceof AccountingProviderError && error.code === 'not-found') return
        throw error
      }
    },

    async companyInfo(session) {
      const [info, link] = await Promise.all([
        call<CodatRecord>(cached(company(session.accessToken), 'info')).catch(notReadYet),
        call<CodatRecord>(connection(session)),
      ])
      const companyName = String(info?.['companyName'] ?? '').trim()
      const platform = String(link?.['platformName'] ?? '').trim()
      const currency = normalizeCurrency(info?.['baseCurrency'])
      return {
        name: [companyName, platform ? `(${platform})` : ''].filter(Boolean).join(' ') || platform,
        homeCurrency: currency || null,
        // Codat states no currency setting; the ledger itself refuses a
        // currency it does not keep, and the item shows its reason.
        multiCurrency: true,
      }
    },

    async listAccounts(session) {
      const rows = await readAll(cached(company(session.accessToken), 'accounts')).catch(notReadYet)
      return rows
        .filter((row) => row['status'] !== 'Archived')
        .map((row) => ({
          id: String(row['id']),
          code: row['nominalCode'] ? String(row['nominalCode']) : null,
          name: String(row['name'] ?? row['id']),
          type: String(row['type'] ?? 'Unknown'),
          classification: classify(row),
          currency: row['currency'] ? normalizeCurrency(row['currency']) : null,
        }))
    },

    async listTaxRates(session) {
      const rows = await readAll(cached(company(session.accessToken), 'taxRates')).catch(notReadYet)
      return rows
        .filter((row) => row['status'] !== 'Archived')
        .map(
          (row): AccountingTaxOption => ({
            id: String(row['id']),
            name: String(row['name'] ?? row['code'] ?? row['id']),
            ratePercent: Number.isFinite(Number(row['effectiveTaxRate'])) ? Number(row['effectiveTaxRate']) : null,
          }),
        )
    },

    async prepare(session, _accounts: Partial<Record<AccountingAccountRole, string>>, existing) {
      const extras: Record<string, string> = {}
      if (!existing[CODAT_EXTRAS.customerId]) {
        const found = await findOne(
          cached(company(session.accessToken), 'customers'),
          query('customerName', '=', ACCOUNTING_WALK_IN_CUSTOMER),
        )
        extras[CODAT_EXTRAS.customerId] = found
          ? String(found['id'])
          : (
              await push(
                session,
                'customers',
                { customerName: ACCOUNTING_WALK_IN_CUSTOMER, status: 'Active' },
                `codat-customer-${session.accessToken}-${session.tenantId}`,
              )
            ).id
      }
      if (!existing[CODAT_EXTRAS.supplierId]) {
        const found = await findOne(
          cached(company(session.accessToken), 'suppliers'),
          query('supplierName', '=', ACCOUNTING_FEE_PAYEE),
        )
        extras[CODAT_EXTRAS.supplierId] = found
          ? String(found['id'])
          : (
              await push(
                session,
                'suppliers',
                { supplierName: ACCOUNTING_FEE_PAYEE, status: 'Active' },
                `codat-supplier-${session.accessToken}-${session.tenantId}`,
              )
            ).id
      }
      return extras
    },

    // Every sale and refund is filed under the walk-in customer `prepare`
    // made; nothing per buyer is written to the books' contacts.
    async upsertCustomer() {
      return { id: '' }
    },

    async createSalesReceipt(session, doc: AccountingSaleDoc, context) {
      return push(session, 'directIncomes', salesBody(doc, contactFor(context, 'customer')), context.idempotencyKey)
    },

    async createRefundReceipt(session, doc: AccountingRefundDoc, context) {
      return push(session, 'directCosts', salesBody(doc, contactFor(context, 'customer')), context.idempotencyKey)
    },

    async createExpense(session, doc: AccountingExpenseDoc, context) {
      const amount = centsToDecimal(doc.amountCents)
      const body = {
        reference: doc.externalId,
        note: doc.memo,
        contactRef: contactFor(context, 'supplier'),
        issueDate: `${doc.date}T00:00:00`,
        currency: normalizeCurrency(doc.currency),
        lineItems: [
          {
            description: doc.memo,
            unitAmount: amount,
            quantity: 1,
            subTotal: amount,
            taxAmount: 0,
            totalAmount: amount,
            accountRef: { id: doc.expenseAccountId },
          },
        ],
        paymentAllocations: [payment(doc.bankAccountId, doc.currency, doc.date, doc.amountCents)],
        subTotal: amount,
        taxAmount: 0,
        totalAmount: amount,
      }
      // A fee is money out of clearing; a returned fee is money back in.
      return push(session, doc.credit ? 'directIncomes' : 'directCosts', body, context.idempotencyKey)
    },

    async createDeposit(session, doc: AccountingTransferDoc, context) {
      const amount = centsToDecimal(doc.amountCents)
      const currency = normalizeCurrency(doc.currency)
      return push(
        session,
        'transfers',
        {
          description: codatTaggedDescription(doc.memo, doc.externalId),
          date: `${doc.date}T00:00:00`,
          from: { accountRef: { id: doc.fromAccountId }, currency, amount },
          to: { accountRef: { id: doc.toAccountId }, currency, amount },
        },
        context.idempotencyKey,
      )
    },

    async createJournal(session, doc: AccountingJournalDoc, context) {
      const currency = normalizeCurrency(doc.currency)
      return push(
        session,
        'journalEntries',
        {
          description: codatTaggedDescription(doc.memo, doc.externalId),
          postedOn: `${doc.date}T00:00:00`,
          journalLines: doc.lines.map((line) => ({
            description: line.description,
            // Codat's journal lines: a debit is positive, a credit negative.
            netAmount: centsToDecimal(line.debitCents - line.creditCents),
            currency,
            accountRef: { id: line.accountId },
          })),
        },
        context.idempotencyKey,
      )
    },

    async findByExternalId(session, kind: AccountingDocKind, externalId) {
      const lookup = FIND_BY_KIND[kind]
      const base = lookup.scope === 'connection' ? connection(session) : company(session.accessToken)
      const found = await findOne(
        cached(base, lookup.dataType),
        lookup.field === 'reference' ? query('reference', '=', externalId) : query('description', '~', `[${externalId}]`),
      )
      return found ? { id: String(found['id']), type: lookup.dataType } : null
    },
  }
}

/** Where each kind of document lives in Codat's cache, and how it is found. */
const FIND_BY_KIND: Readonly<
  Record<AccountingDocKind, { dataType: string; scope: 'company' | 'connection'; field: 'reference' | 'description' }>
> = {
  sale: { dataType: 'directIncomes', scope: 'connection', field: 'reference' },
  refund: { dataType: 'directCosts', scope: 'connection', field: 'reference' },
  fee: { dataType: 'directCosts', scope: 'connection', field: 'reference' },
  'fee-refund': { dataType: 'directIncomes', scope: 'connection', field: 'reference' },
  payout: { dataType: 'transfers', scope: 'connection', field: 'description' },
  summary: { dataType: 'journalEntries', scope: 'company', field: 'description' },
}

function contactFor(context: AccountingWriteContext, who: 'customer' | 'supplier') {
  const id = context.extras[who === 'customer' ? CODAT_EXTRAS.customerId : CODAT_EXTRAS.supplierId]
  if (!id) {
    throw new AccountingProviderError(
      'validation',
      'The accounting settings are not finished. Open Accounting, save the settings again, then retry.',
    )
  }
  return { id, dataType: who === 'customer' ? 'customers' : 'suppliers' }
}

function payment(accountId: string, currency: string, date: string, cents: number) {
  const iso = normalizeCurrency(currency)
  const amount = centsToDecimal(cents)
  return {
    payment: { accountRef: { id: accountId }, currency: iso, paidOnDate: `${date}T00:00:00`, totalAmount: amount },
    allocation: { currency: iso, allocatedOnDate: `${date}T00:00:00`, totalAmount: amount },
  }
}

/** A sale (direct income) or a refund (direct cost), paid through clearing in full. */
function salesBody(
  doc: AccountingSaleDoc | AccountingRefundDoc,
  contactRef: { id: string; dataType: string },
) {
  const lineItems = doc.lines.map((line) => codatLine(line, doc.taxTreatment))
  const subTotalCents = doc.lines.reduce(
    (sum, line) => sum + (doc.taxTreatment === 'inclusive' ? line.amountCents - line.taxCents : line.amountCents),
    0,
  )
  const buyer = buyerNote(doc.customer)
  return {
    reference: doc.externalId,
    note: [doc.memo, buyer].filter(Boolean).join(' — ').slice(0, 4000),
    contactRef,
    issueDate: `${doc.date}T00:00:00`,
    currency: normalizeCurrency(doc.currency),
    lineItems,
    paymentAllocations: [payment(doc.depositAccountId, doc.currency, doc.date, doc.totalCents)],
    subTotal: centsToDecimal(subTotalCents),
    taxAmount: centsToDecimal(doc.taxTreatment === 'none' ? 0 : doc.taxCents),
    totalAmount: centsToDecimal(doc.totalCents),
  }
}

/** A push operation's end, as the engine reads it. */
export function pushOutcome(operation: CodatRecord | null, dataType: string): AccountingDocRef {
  const status = String(operation?.['status'] ?? '')
  if (status === 'Success') {
    const data = (operation?.['data'] ?? {}) as CodatRecord
    const changes = Array.isArray(operation?.['changes']) ? (operation?.['changes'] as CodatRecord[]) : []
    const created = changes.find((change) => change?.['type'] === 'Created') ?? changes[0]
    const id = String(data['id'] ?? (created?.['recordRef'] as CodatRecord | undefined)?.['id'] ?? '')
    if (!id) throw new AccountingProviderError('transient', 'Codat reported the write without the record it made.')
    return { id, type: dataType }
  }
  if (status === 'Pending') {
    throw new AccountingProviderError(
      'transient',
      'Your accounting software has not taken this yet. It is tried again shortly.',
    )
  }
  if (status === 'TimedOut') {
    throw new AccountingProviderError(
      'validation',
      'Your accounting software did not take this within an hour, so nothing was posted. Make sure it is online — for QuickBooks Desktop, that the Web Connector is running — then retry.',
    )
  }
  throw new AccountingProviderError(
    'validation',
    describeCodatError(operation) ?? 'Your accounting software refused this document.',
    Number(operation?.['statusCode']) || 0,
  )
}
