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
 * THE QUICKBOOKS ONLINE ADAPTER (AGL-3614), over the Accounting API's REST
 * endpoints with plain `fetch`.
 *
 * - OAuth 2.0 at Intuit's App Center, scope `com.intuit.quickbooks.accounting`.
 *   The redirect back carries `realmId`, the company the grant is for. Access
 *   tokens last an hour; the refresh token is good for 100 days from its last
 *   use and Intuit may hand back a NEW one on any refresh, which the caller
 *   must store in place of the old (`token-manager.ts`).
 * - The API's sandbox and production hosts are chosen by
 *   `INTUIT_ENVIRONMENT`; a sandbox app's keys only open sandbox companies.
 * - Every call pins `minorversion` to {@link QUICKBOOKS_MINOR_VERSION}: since
 *   August 2025 Intuit answers anything older as 75, so 75 is the floor and
 *   the version the shapes below were written against.
 * - Creates carry `requestid`, Intuit's idempotency key, and a sale or refund
 *   is also found again by its `DocNumber`.
 * - 500 requests a minute per company, ten at once: the sync posts one item
 *   at a time and paces calls at {@link QUICKBOOKS_MIN_INTERVAL_MS}.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type {
  AccountingAccountOption,
  AccountingAccountRole,
  AccountingTaxOption,
} from '../../model/accounting.types'
import { centsToDecimal, normalizeCurrency } from '../../model/accounting-money'
import type {
  AccountingCustomerRef,
  AccountingDocLine,
  AccountingExpenseDoc,
  AccountingJournalDoc,
  AccountingRefundDoc,
  AccountingSaleDoc,
  AccountingTransferDoc,
} from '../../model/accounting-transforms'
import {
  AccountingPacer,
  AccountingProviderError,
  accountingRequest,
  basicAuth,
  formBody,
  oauthErrorCode,
  readTokenResponse,
  type AccountingHttpOptions,
} from './http'
import type {
  AccountingDocKind,
  AccountingDocRef,
  AccountingProvider,
  AccountingProviderExtras,
  AccountingSession,
  AccountingTokenSet,
  AccountingWriteContext,
} from './provider'

export const QUICKBOOKS_ENDPOINTS = {
  authorize: 'https://appcenter.intuit.com/connect/oauth2',
  token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revoke: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
  sandboxApi: 'https://sandbox-quickbooks.api.intuit.com',
  productionApi: 'https://quickbooks.api.intuit.com',
} as const

export const QUICKBOOKS_SCOPE = 'com.intuit.quickbooks.accounting'

/** The Accounting API minor version every request pins. */
export const QUICKBOOKS_MINOR_VERSION = 75

/** 500 a minute per company is one every 120 ms; a little under, for headroom. */
export const QUICKBOOKS_MIN_INTERVAL_MS = 150

/** The service items a sale's lines name, made once per company. */
export const QUICKBOOKS_SALE_ITEM_NAME = `${PLATFORM_BRAND_NAME} sales`
export const QUICKBOOKS_SHIPPING_ITEM_NAME = `${PLATFORM_BRAND_NAME} shipping`

export type QuickBooksEnvironment = 'sandbox' | 'production'

export interface QuickBooksConfig {
  clientId: string
  clientSecret: string
  environment: QuickBooksEnvironment
}

/** Intuit's error body: `{ Fault: { Error: [{ Message, Detail, code }] } }`, or an OAuth error. */
export function describeQuickBooksError(body: unknown): string | null {
  const oauth = oauthErrorCode(body)
  if (oauth) return oauth
  const fault = (body as { Fault?: { Error?: Array<{ Message?: string; Detail?: string; code?: string }> } })?.Fault
  const first = fault?.Error?.[0]
  if (!first) return null
  return [first.Message, first.Detail].filter(Boolean).join(': ').slice(0, 500) || null
}

/** A value inside a QuickBooks query string literal. */
export function quickBooksLiteral(value: string): string {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

type QboRecord = Record<string, unknown>

const ref = (value: string) => ({ value })

function classify(account: QboRecord): AccountingAccountOption['classification'] {
  const type = String(account['AccountType'] ?? '')
  if (type === 'Bank') return 'bank'
  const classification = String(account['Classification'] ?? '')
  if (classification === 'Revenue') return 'income'
  if (classification === 'Expense') return 'expense'
  if (classification === 'Liability') return 'liability'
  return 'other'
}

export function createQuickBooksProvider(
  config: QuickBooksConfig,
  options: AccountingHttpOptions = {},
): AccountingProvider {
  const pacer = options.pacer ?? new AccountingPacer(QUICKBOOKS_MIN_INTERVAL_MS)
  const http = { ...options, pacer, describeError: describeQuickBooksError }
  const apiBase = config.environment === 'production' ? QUICKBOOKS_ENDPOINTS.productionApi : QUICKBOOKS_ENDPOINTS.sandboxApi
  const now = () => Date.now()

  const companyUrl = (session: AccountingSession, path: string, query: Record<string, string> = {}) => {
    const params = new URLSearchParams({ ...query, minorversion: String(QUICKBOOKS_MINOR_VERSION) })
    return `${apiBase}/v3/company/${encodeURIComponent(session.tenantId)}/${path}?${params.toString()}`
  }

  const get = <T>(session: AccountingSession, path: string, query: Record<string, string> = {}) =>
    accountingRequest<T>(
      companyUrl(session, path, query),
      { method: 'GET', headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' } },
      { ...http, pacerKey: session.tenantId },
    )

  const post = <T>(session: AccountingSession, entity: string, body: unknown, requestId?: string) =>
    accountingRequest<T>(
      companyUrl(session, entity, requestId ? { requestid: requestId.slice(0, 50) } : {}),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      { ...http, pacerKey: session.tenantId },
    )

  async function query<T extends QboRecord>(session: AccountingSession, entity: string, statement: string): Promise<T[]> {
    const body = await get<{ QueryResponse?: Record<string, unknown> }>(session, 'query', { query: statement })
    const rows = body?.QueryResponse?.[entity]
    return Array.isArray(rows) ? (rows as T[]) : []
  }

  async function tokenRequest(form: Record<string, string>): Promise<AccountingTokenSet> {
    const startedAt = now()
    let body: unknown
    try {
      body = await accountingRequest<unknown>(
        QUICKBOOKS_ENDPOINTS.token,
        {
          method: 'POST',
          headers: {
            Authorization: basicAuth(config.clientId, config.clientSecret),
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formBody(form),
        },
        { ...http, pacer: undefined },
      )
    } catch (error) {
      // A refused grant is `invalid_grant` on a 400: the grant is gone, not the request malformed.
      if (error instanceof AccountingProviderError && error.code === 'validation' && error.message === 'invalid_grant') {
        throw new AccountingProviderError('auth', 'QuickBooks refused the grant. Reconnect QuickBooks.', error.status)
      }
      throw error
    }
    const tokens = readTokenResponse(body, startedAt)
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAtMs: startedAt + tokens.expiresInS * 1000,
      refreshExpiresAtMs: tokens.refreshExpiresInS ? startedAt + tokens.refreshExpiresInS * 1000 : null,
      scopes: tokens.scope ? tokens.scope.split(/\s+/) : [QUICKBOOKS_SCOPE],
    }
  }

  /** A sales line, or the discount line, as QuickBooks spells it. */
  function salesLine(line: AccountingDocLine, doc: AccountingSaleDoc | AccountingRefundDoc, extras: AccountingProviderExtras) {
    if (line.kind === 'discount') {
      return {
        DetailType: 'DiscountLineDetail',
        Amount: centsToDecimal(-line.amountCents),
        Description: line.description,
        DiscountLineDetail: { PercentBased: false },
      }
    }
    const itemId = line.kind === 'shipping' ? extras['shippingItemId'] : extras['saleItemId']
    if (!itemId) {
      throw new AccountingProviderError('validation', 'Save the Accounting settings again to set up the QuickBooks items.')
    }
    // Tax-inclusive lines carry their net amount, with the gross beside it.
    const net = doc.taxTreatment === 'inclusive' ? line.amountCents - line.taxCents : line.amountCents
    const quantity = line.quantity || 1
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: centsToDecimal(net),
      Description: line.description,
      SalesItemLineDetail: {
        ItemRef: ref(itemId),
        Qty: quantity,
        UnitPrice: Math.round((net / quantity) * 1e4) / 1e6,
        ...(line.taxCodeId ? { TaxCodeRef: ref(line.taxCodeId) } : {}),
        ...(doc.taxTreatment === 'inclusive' ? { TaxInclusiveAmt: centsToDecimal(line.amountCents) } : {}),
      },
    }
  }

  function currencyRef(currency: string, context: AccountingWriteContext) {
    const home = context.homeCurrency ? normalizeCurrency(context.homeCurrency) : null
    return home && normalizeCurrency(currency) !== home ? { CurrencyRef: ref(normalizeCurrency(currency)) } : {}
  }

  function salesBody(doc: AccountingSaleDoc | AccountingRefundDoc, context: AccountingWriteContext) {
    return {
      DocNumber: doc.externalId,
      TxnDate: doc.date,
      PrivateNote: doc.memo,
      ...(context.customerId ? { CustomerRef: ref(context.customerId) } : {}),
      ...currencyRef(doc.currency, context),
      GlobalTaxCalculation:
        doc.taxTreatment === 'exclusive' ? 'TaxExcluded' : doc.taxTreatment === 'inclusive' ? 'TaxInclusive' : 'NotApplicable',
      DepositToAccountRef: ref(doc.depositAccountId),
      Line: doc.lines.map((line) => salesLine(line, doc, context.extras)),
      ...(doc.taxCents > 0 ? { TxnTaxDetail: { TotalTax: centsToDecimal(doc.taxCents) } } : {}),
    }
  }

  const created = (body: unknown, entity: string): AccountingDocRef => {
    const id = (body as Record<string, QboRecord | undefined>)?.[entity]?.['Id']
    if (typeof id !== 'string' || !id) {
      throw new AccountingProviderError('transient', `QuickBooks did not return the new ${entity}.`)
    }
    return { id, type: entity }
  }

  /** Finds the named service item, or makes it, posting to `incomeAccountId`. */
  async function ensureItem(session: AccountingSession, name: string, incomeAccountId: string): Promise<string> {
    const [existing] = await query<QboRecord>(
      session,
      'Item',
      `select * from Item where Name = ${quickBooksLiteral(name)}`,
    )
    if (existing && typeof existing['Id'] === 'string') {
      const current = (existing['IncomeAccountRef'] as { value?: string } | undefined)?.value
      if (current !== incomeAccountId || existing['Active'] === false) {
        await post(session, 'item', {
          Id: existing['Id'],
          SyncToken: existing['SyncToken'],
          sparse: true,
          Active: true,
          IncomeAccountRef: ref(incomeAccountId),
        })
      }
      return existing['Id']
    }
    return created(
      await post(session, 'item', { Name: name, Type: 'Service', IncomeAccountRef: ref(incomeAccountId) }),
      'Item',
    ).id
  }

  return {
    id: 'quickbooks',
    picksTenantAfterExchange: false,

    authorizeUrl({ state, redirectUri }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        scope: QUICKBOOKS_SCOPE,
        redirect_uri: redirectUri,
        state,
      })
      return `${QUICKBOOKS_ENDPOINTS.authorize}?${params.toString()}`
    },

    async exchangeCode({ code, redirectUri, realmId }) {
      if (!realmId) throw new AccountingProviderError('validation', 'QuickBooks did not say which company was connected.')
      const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
      return { tokens, tenants: [{ id: realmId, name: '' }] }
    },

    refresh(refreshToken) {
      return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
    },

    async revoke({ refreshToken }) {
      try {
        await accountingRequest(
          QUICKBOOKS_ENDPOINTS.revoke,
          {
            method: 'POST',
            headers: {
              Authorization: basicAuth(config.clientId, config.clientSecret),
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: refreshToken }),
          },
          { ...http, pacer: undefined },
        )
      } catch (error) {
        // A token Intuit no longer knows is already revoked.
        if (error instanceof AccountingProviderError && !error.retryable) return
        throw error
      }
    },

    async companyInfo(session) {
      const [info, preferences] = await Promise.all([
        get<{ CompanyInfo?: QboRecord }>(session, `companyinfo/${encodeURIComponent(session.tenantId)}`),
        get<{ Preferences?: { CurrencyPrefs?: { HomeCurrency?: { value?: string }; MultiCurrencyEnabled?: boolean } } }>(
          session,
          'preferences',
        ),
      ])
      const prefs = preferences?.Preferences?.CurrencyPrefs
      return {
        name: String(info?.CompanyInfo?.['CompanyName'] ?? ''),
        homeCurrency: prefs?.HomeCurrency?.value ? normalizeCurrency(prefs.HomeCurrency.value) : null,
        multiCurrency: prefs?.MultiCurrencyEnabled === true,
      }
    },

    async listAccounts(session) {
      const rows = await query<QboRecord>(session, 'Account', 'select * from Account where Active = true MAXRESULTS 1000')
      return rows
        .filter((row) => typeof row['Id'] === 'string')
        .map((row) => ({
          id: String(row['Id']),
          code: typeof row['AcctNum'] === 'string' ? row['AcctNum'] : null,
          name: String(row['FullyQualifiedName'] ?? row['Name'] ?? ''),
          type: String(row['AccountType'] ?? ''),
          classification: classify(row),
          currency: (row['CurrencyRef'] as { value?: string } | undefined)?.value ?? null,
        }))
    },

    async listTaxRates(session) {
      const rows = await query<QboRecord>(session, 'TaxCode', 'select * from TaxCode where Active = true MAXRESULTS 1000')
      return rows
        .filter((row) => typeof row['Id'] === 'string')
        .map((row): AccountingTaxOption => ({ id: String(row['Id']), name: String(row['Name'] ?? row['Id']), ratePercent: null }))
    },

    async prepare(session, accounts: Partial<Record<AccountingAccountRole, string>>) {
      const income = accounts.income
      if (!income) return {}
      const shipping = accounts.shippingIncome ?? income
      const saleItemId = await ensureItem(session, QUICKBOOKS_SALE_ITEM_NAME, income)
      const shippingItemId = await ensureItem(session, QUICKBOOKS_SHIPPING_ITEM_NAME, shipping)
      return { saleItemId, shippingItemId }
    },

    async upsertCustomer(session, customer: AccountingCustomerRef) {
      // DisplayName is unique in a company, so it is the key: the address
      // when there is one, the name otherwise.
      const displayName = (customer.email ?? customer.name).slice(0, 100)
      const find = async () =>
        (await query<QboRecord>(session, 'Customer', `select Id from Customer where DisplayName = ${quickBooksLiteral(displayName)}`))[0]
      const existing = await find()
      if (existing && typeof existing['Id'] === 'string') return { id: existing['Id'] }
      try {
        const body = await post(session, 'customer', {
          DisplayName: displayName,
          ...(customer.name && customer.name !== displayName ? { CompanyName: customer.name.slice(0, 100) } : {}),
          ...(customer.email ? { PrimaryEmailAddr: { Address: customer.email } } : {}),
        })
        return { id: created(body, 'Customer').id }
      } catch (error) {
        // Another write made it in between: the name is taken, so it exists now.
        const again = await find()
        if (again && typeof again['Id'] === 'string') return { id: again['Id'] }
        throw error
      }
    },

    async createSalesReceipt(session, doc, context) {
      return created(await post(session, 'salesreceipt', salesBody(doc, context), context.idempotencyKey), 'SalesReceipt')
    },

    async createRefundReceipt(session, doc, context) {
      return created(await post(session, 'refundreceipt', salesBody(doc, context), context.idempotencyKey), 'RefundReceipt')
    },

    async createExpense(session, doc: AccountingExpenseDoc, context) {
      const body = {
        PaymentType: 'Cash',
        AccountRef: ref(doc.bankAccountId),
        TxnDate: doc.date,
        DocNumber: doc.externalId,
        PrivateNote: doc.memo,
        Credit: doc.credit,
        ...currencyRef(doc.currency, context),
        Line: [
          {
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: centsToDecimal(doc.amountCents),
            Description: doc.memo,
            AccountBasedExpenseLineDetail: { AccountRef: ref(doc.expenseAccountId) },
          },
        ],
      }
      return created(await post(session, 'purchase', body, context.idempotencyKey), 'Purchase')
    },

    async createDeposit(session, doc: AccountingTransferDoc, context) {
      const body = {
        FromAccountRef: ref(doc.fromAccountId),
        ToAccountRef: ref(doc.toAccountId),
        Amount: centsToDecimal(doc.amountCents),
        TxnDate: doc.date,
        PrivateNote: `${doc.externalId} ${doc.memo}`.slice(0, 4000),
      }
      return created(await post(session, 'transfer', body, context.idempotencyKey), 'Transfer')
    },

    async createJournal(session, doc: AccountingJournalDoc, context) {
      const body = {
        DocNumber: doc.externalId,
        TxnDate: doc.date,
        PrivateNote: doc.memo,
        ...currencyRef(doc.currency, context),
        Line: doc.lines.map((line) => ({
          DetailType: 'JournalEntryLineDetail',
          Amount: centsToDecimal(line.debitCents || line.creditCents),
          Description: line.description,
          JournalEntryLineDetail: {
            PostingType: line.debitCents ? 'Debit' : 'Credit',
            AccountRef: ref(line.accountId),
          },
        })),
      }
      return created(await post(session, 'journalentry', body, context.idempotencyKey), 'JournalEntry')
    },

    async findByExternalId(session, kind: AccountingDocKind, externalId) {
      const entity: Record<AccountingDocKind, string | null> = {
        sale: 'SalesReceipt',
        refund: 'RefundReceipt',
        fee: 'Purchase',
        'fee-refund': 'Purchase',
        summary: 'JournalEntry',
        // A transfer has no document number; the request id and the sync
        // log are its locks.
        payout: null,
      }
      const name = entity[kind]
      if (!name) return null
      const [row] = await query<QboRecord>(
        session,
        name,
        `select Id from ${name} where DocNumber = ${quickBooksLiteral(externalId)}`,
      )
      return row && typeof row['Id'] === 'string' ? { id: row['Id'], type: name } : null
    },
  }
}
