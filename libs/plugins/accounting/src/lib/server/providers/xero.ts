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
 * THE XERO ADAPTER (AGL-3614), over the Accounting API with plain `fetch`.
 *
 * - OAuth 2.0 authorization-code flow with the client secret. Xero's
 *   granular scopes are what an app created after 2 March 2026 may request,
 *   so the default set is {@link XERO_SCOPES}; `XERO_SCOPES` overrides it for
 *   an older app still on the broad `accounting.transactions`. Access tokens
 *   last 30 minutes; the refresh token lasts 60 days and ROTATES on every
 *   refresh, so the new one must replace the old at once (`token-manager.ts`).
 * - One grant can reach several Xero organizations. After the exchange,
 *   `GET /connections` lists them; one is bound at once, several wait for
 *   the member to pick (`accounting/connect/tenant`). Every API call names
 *   the organization in the `xero-tenant-id` header, and a disconnect deletes
 *   the connection as well as revoking the grant.
 * - Xero has no sales receipt. A sale is an AUTHORISED sales invoice paid in
 *   full into the clearing account, and a refund an AUTHORISED credit note
 *   refunded out of it. A fee is a spend-money bank transaction from
 *   clearing, a payout a bank transfer, and a daily summary a manual journal.
 * - Creates carry Xero's `Idempotency-Key` header, and every document but a
 *   journal is found again by its number or reference.
 * - 60 calls a minute and 5,000 a day per organization: calls are paced a
 *   second apart, and the engine keeps the daily count.
 */

import type {
  AccountingAccountOption,
  AccountingAccountRole,
  AccountingTaxOption,
} from '../../model/accounting.types'
import { centsToDecimal, decimalToCents, normalizeCurrency } from '../../model/accounting-money'
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
  AccountingTenant,
  AccountingTokenSet,
  AccountingWriteContext,
} from './provider'

export const XERO_ENDPOINTS = {
  authorize: 'https://login.xero.com/identity/connect/authorize',
  token: 'https://identity.xero.com/connect/token',
  revoke: 'https://identity.xero.com/connect/revocation',
  connections: 'https://api.xero.com/connections',
  api: 'https://api.xero.com/api.xro/2.0',
} as const

/**
 * The granular scopes (Xero, 2026): settings for the chart of accounts and
 * tax rates, contacts for customers, and one scope per kind of document the
 * sync writes. `offline_access` is what returns a refresh token.
 */
export const XERO_SCOPES = [
  'offline_access',
  'accounting.settings',
  'accounting.contacts',
  'accounting.invoices',
  'accounting.payments',
  'accounting.banktransactions',
  'accounting.manualjournals',
] as const

/** 60 a minute is one a second. */
export const XERO_MIN_INTERVAL_MS = 1000

/** Xero's daily limit per organization. */
export const XERO_DAILY_CALL_LIMIT = 5000

export interface XeroConfig {
  clientId: string
  clientSecret: string
  /** Space-separated; {@link XERO_SCOPES} when unset. */
  scopes?: string | null
}

/** Xero's error body: validation errors first, then its message. */
export function describeXeroError(body: unknown): string | null {
  const oauth = oauthErrorCode(body)
  if (oauth) return oauth
  const data = body as {
    Message?: string
    Detail?: string
    Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>
  }
  const validation = (data?.Elements ?? [])
    .flatMap((element) => element.ValidationErrors ?? [])
    .map((error) => error.Message)
    .filter(Boolean)
  if (validation.length) return validation.join(' ').slice(0, 500)
  const text = [data?.Message, data?.Detail].filter(Boolean).join(': ')
  return text ? text.slice(0, 500) : typeof body === 'string' ? body.slice(0, 500) : null
}

/** A value inside a Xero `where` string literal. */
export function xeroLiteral(value: string): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

type XeroRecord = Record<string, unknown>

const INCOME_TYPES = new Set(['REVENUE', 'SALES', 'OTHERINCOME'])
const EXPENSE_TYPES = new Set(['EXPENSE', 'DIRECTCOSTS', 'OVERHEADS', 'DEPRECIATN'])
const LIABILITY_TYPES = new Set(['CURRLIAB', 'LIABILITY', 'TERMLIAB', 'PAYGLIABILITY', 'SUPERANNUATIONLIABILITY', 'WAGESPAYABLELIABILITY'])

function classify(type: string, enablePayments: boolean): AccountingAccountOption['classification'] {
  if (type === 'BANK') return 'bank'
  if (INCOME_TYPES.has(type)) return 'income'
  if (EXPENSE_TYPES.has(type)) return 'expense'
  // An account with payments enabled can take a payment like a bank account.
  if (enablePayments) return 'bank'
  if (LIABILITY_TYPES.has(type)) return 'liability'
  return 'other'
}

/** The roles whose accounts a line item posts to by code. */
const CODED_ROLES: readonly AccountingAccountRole[] = ['income', 'shippingIncome', 'feeExpense', 'taxLiability', 'clearing', 'payoutBank']

export function createXeroProvider(config: XeroConfig, options: AccountingHttpOptions = {}): AccountingProvider {
  const pacer = options.pacer ?? new AccountingPacer(XERO_MIN_INTERVAL_MS)
  const http = { ...options, pacer, describeError: describeXeroError }
  const scopes = String(config.scopes ?? '').trim() || XERO_SCOPES.join(' ')
  const now = () => Date.now()

  const headers = (session: AccountingSession, extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${session.accessToken}`,
    'xero-tenant-id': session.tenantId,
    Accept: 'application/json',
    ...extra,
  })

  const get = <T>(session: AccountingSession, path: string, query: Record<string, string> = {}) => {
    const search = new URLSearchParams(query).toString()
    return accountingRequest<T>(
      `${XERO_ENDPOINTS.api}/${path}${search ? `?${search}` : ''}`,
      { method: 'GET', headers: headers(session) },
      { ...http, pacerKey: session.tenantId },
    )
  }

  /** PUT creates in Xero; the key makes a retry of the same create return the first. */
  const put = <T>(session: AccountingSession, path: string, body: unknown, idempotencyKey: string) =>
    accountingRequest<T>(
      `${XERO_ENDPOINTS.api}/${path}`,
      {
        method: 'PUT',
        headers: headers(session, { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.slice(0, 128) }),
        body: JSON.stringify(body),
      },
      { ...http, pacerKey: session.tenantId },
    )

  async function tokenRequest(form: Record<string, string>): Promise<AccountingTokenSet> {
    const startedAt = now()
    let body: unknown
    try {
      body = await accountingRequest<unknown>(
        XERO_ENDPOINTS.token,
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
      if (error instanceof AccountingProviderError && error.code === 'validation' && error.message === 'invalid_grant') {
        throw new AccountingProviderError('auth', 'Xero refused the grant. Reconnect Xero.', error.status)
      }
      throw error
    }
    const tokens = readTokenResponse(body, startedAt)
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAtMs: startedAt + tokens.expiresInS * 1000,
      // Xero states no lifetime; it is 60 days from this refresh.
      refreshExpiresAtMs: startedAt + 60 * 24 * 60 * 60 * 1000,
      scopes: tokens.scope ? tokens.scope.split(/\s+/) : scopes.split(/\s+/),
    }
  }

  async function listConnections(accessToken: string): Promise<AccountingTenant[]> {
    const rows = await accountingRequest<XeroRecord[]>(
      XERO_ENDPOINTS.connections,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      { ...http, pacer: undefined },
    )
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row['tenantType'] === 'ORGANISATION' && typeof row['tenantId'] === 'string')
      .map((row) => ({
        id: String(row['tenantId']),
        name: String(row['tenantName'] ?? ''),
        connectionId: typeof row['id'] === 'string' ? row['id'] : undefined,
      }))
  }

  /** The account reference a line item posts to: by code when it has one, by id otherwise. */
  function accountRef(accountId: string, extras: AccountingProviderExtras) {
    const code = extras[`code:${accountId}`]
    return code ? { AccountCode: code } : { AccountID: accountId }
  }

  const lineAmountTypes = (doc: AccountingSaleDoc | AccountingRefundDoc) =>
    doc.taxTreatment === 'exclusive' ? 'Exclusive' : doc.taxTreatment === 'inclusive' ? 'Inclusive' : 'NoTax'

  function lineItem(line: AccountingDocLine, doc: AccountingSaleDoc | AccountingRefundDoc, extras: AccountingProviderExtras) {
    return {
      Description: line.description,
      Quantity: line.quantity || 1,
      UnitAmount: centsToDecimal(line.unitAmountCents),
      ...accountRef(line.accountId, extras),
      ...(line.taxCodeId ? { TaxType: line.taxCodeId } : {}),
      // The order's own tax, line by line, rather than Xero's recomputation of it.
      ...(doc.taxTreatment === 'none' ? {} : { TaxAmount: centsToDecimal(line.taxCents) }),
    }
  }

  const firstId = (body: unknown, collection: string, idField: string): string => {
    const id = ((body as Record<string, XeroRecord[] | undefined>)?.[collection]?.[0] ?? {})[idField]
    if (typeof id !== 'string' || !id) {
      throw new AccountingProviderError('transient', `Xero did not return the new ${collection}.`)
    }
    return id
  }

  async function findOne(
    session: AccountingSession,
    collection: string,
    query: Record<string, string>,
  ): Promise<XeroRecord | null> {
    const body = await get<Record<string, XeroRecord[] | undefined>>(session, collection, query)
    const rows = (body?.[collection] ?? []).filter((row) => row['Status'] !== 'DELETED' && row['Status'] !== 'VOIDED')
    return rows[0] ?? null
  }

  /** Pays what is still due on an invoice or credit note, into or out of `accountId`. */
  async function settle(
    session: AccountingSession,
    target: { InvoiceID: string } | { CreditNoteID: string },
    input: { amountCents: number; accountId: string; date: string; reference: string; idempotencyKey: string },
  ): Promise<string | null> {
    if (input.amountCents <= 0) return null
    const body = await put(
      session,
      'Payments',
      {
        Payments: [
          {
            ...('InvoiceID' in target ? { Invoice: target } : { CreditNote: target }),
            Account: { AccountID: input.accountId },
            Date: input.date,
            Amount: centsToDecimal(input.amountCents),
            Reference: input.reference,
          },
        ],
      },
      input.idempotencyKey,
    )
    return firstId(body, 'Payments', 'PaymentID')
  }

  async function salesDocument(
    session: AccountingSession,
    doc: AccountingSaleDoc | AccountingRefundDoc,
    context: AccountingWriteContext,
  ): Promise<AccountingDocRef> {
    if (!context.customerId) throw new AccountingProviderError('validation', 'Xero needs a contact for every sale.')
    const sale = doc.kind === 'sale'
    const collection = sale ? 'Invoices' : 'CreditNotes'
    const idField = sale ? 'InvoiceID' : 'CreditNoteID'
    const type = sale ? 'Invoice' : 'CreditNote'
    // A retry after a create that landed but whose payment did not: find it,
    // and pay what is still due rather than making a second one.
    let record = sale
      ? await findOne(session, 'Invoices', { InvoiceNumbers: doc.externalId })
      : await findOne(session, 'CreditNotes', { where: `CreditNoteNumber==${xeroLiteral(doc.externalId)}` })
    if (!record) {
      const body = await put(
        session,
        collection,
        {
          [collection]: [
            {
              Type: sale ? 'ACCREC' : 'ACCRECCREDIT',
              Contact: { ContactID: context.customerId },
              Date: doc.date,
              ...(sale ? { DueDate: doc.date, InvoiceNumber: doc.externalId } : { CreditNoteNumber: doc.externalId }),
              Reference: sale ? doc.memo.slice(0, 255) : doc.saleExternalId,
              CurrencyCode: normalizeCurrency(doc.currency),
              LineAmountTypes: lineAmountTypes(doc),
              Status: 'AUTHORISED',
              LineItems: doc.lines.map((line) => lineItem(line, doc, context.extras)),
            },
          ],
        },
        `${context.idempotencyKey}:doc`,
      )
      record = ((body as Record<string, XeroRecord[] | undefined>)?.[collection] ?? [])[0] ?? null
      if (!record) firstId(body, collection, idField)
    }
    const id = String(record?.[idField] ?? '')
    if (!id) throw new AccountingProviderError('transient', `Xero did not return the new ${type}.`)
    const dueCents =
      record?.[sale ? 'AmountDue' : 'RemainingCredit'] === undefined
        ? doc.totalCents
        : decimalToCents(record[sale ? 'AmountDue' : 'RemainingCredit'])
    const paymentId = await settle(session, sale ? { InvoiceID: id } : { CreditNoteID: id }, {
      amountCents: Math.min(dueCents, doc.totalCents),
      accountId: doc.depositAccountId,
      date: doc.date,
      reference: doc.externalId,
      idempotencyKey: `${context.idempotencyKey}:pay`,
    })
    return { id, type, ...(paymentId ? { related: [{ id: paymentId, type: 'Payment' }] } : {}) }
  }

  return {
    id: 'xero',
    picksTenantAfterExchange: true,

    authorizeUrl({ state, redirectUri }) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: scopes,
        state,
      })
      return `${XERO_ENDPOINTS.authorize}?${params.toString()}`
    },

    async exchangeCode({ code, redirectUri }) {
      const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
      return { tokens, tenants: await listConnections(tokens.accessToken) }
    },

    refresh(refreshToken) {
      return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
    },

    async revoke({ refreshToken, accessToken, connectionId }) {
      const tolerate = (error: unknown) => {
        if (error instanceof AccountingProviderError && !error.retryable) return
        throw error
      }
      if (accessToken && connectionId) {
        await accountingRequest(
          `${XERO_ENDPOINTS.connections}/${encodeURIComponent(connectionId)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
          { ...http, pacer: undefined },
        ).catch(tolerate)
      }
      await accountingRequest(
        XERO_ENDPOINTS.revoke,
        {
          method: 'POST',
          headers: {
            Authorization: basicAuth(config.clientId, config.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formBody({ token: refreshToken }),
        },
        { ...http, pacer: undefined },
      ).catch(tolerate)
    },

    async companyInfo(session) {
      const [organisation, currencies] = await Promise.all([
        get<{ Organisations?: XeroRecord[] }>(session, 'Organisation'),
        get<{ Currencies?: XeroRecord[] }>(session, 'Currencies'),
      ])
      const org = organisation?.Organisations?.[0] ?? {}
      return {
        name: String(org['Name'] ?? ''),
        homeCurrency: typeof org['BaseCurrency'] === 'string' ? normalizeCurrency(org['BaseCurrency']) : null,
        multiCurrency: (currencies?.Currencies ?? []).length > 1,
      }
    },

    async listAccounts(session) {
      const body = await get<{ Accounts?: XeroRecord[] }>(session, 'Accounts', { where: 'Status=="ACTIVE"' })
      return (body?.Accounts ?? [])
        .filter((row) => typeof row['AccountID'] === 'string')
        .map((row) => {
          const type = String(row['Type'] ?? '')
          return {
            id: String(row['AccountID']),
            code: typeof row['Code'] === 'string' && row['Code'] ? row['Code'] : null,
            name: String(row['Name'] ?? ''),
            type,
            classification: classify(type, row['EnablePaymentsToAccount'] === true),
            currency: typeof row['CurrencyCode'] === 'string' ? row['CurrencyCode'] : null,
          }
        })
    },

    async listTaxRates(session) {
      const body = await get<{ TaxRates?: XeroRecord[] }>(session, 'TaxRates', { where: 'Status=="ACTIVE"' })
      return (body?.TaxRates ?? [])
        .filter((row) => typeof row['TaxType'] === 'string')
        .map((row): AccountingTaxOption => {
          const rate = Number(row['EffectiveRate'] ?? row['DisplayTaxRate'])
          return { id: String(row['TaxType']), name: String(row['Name'] ?? row['TaxType']), ratePercent: Number.isFinite(rate) ? rate : null }
        })
    },

    async prepare(session, accounts) {
      // Line items and journal lines post by account code; remember each
      // mapped account's code once, rather than reading the chart per sale.
      const wanted = new Set(CODED_ROLES.map((role) => accounts[role]).filter((id): id is string => Boolean(id)))
      if (!wanted.size) return {}
      const body = await get<{ Accounts?: XeroRecord[] }>(session, 'Accounts')
      const extras: Record<string, string> = {}
      for (const row of body?.Accounts ?? []) {
        const id = String(row['AccountID'] ?? '')
        if (wanted.has(id) && typeof row['Code'] === 'string' && row['Code']) extras[`code:${id}`] = row['Code']
      }
      return extras
    },

    async upsertCustomer(session, customer: AccountingCustomerRef) {
      const byEmail = customer.email
        ? await findOne(session, 'Contacts', { where: `EmailAddress==${xeroLiteral(customer.email)}` })
        : null
      const existing = byEmail ?? (await findOne(session, 'Contacts', { where: `Name==${xeroLiteral(customer.name)}` }))
      if (existing && typeof existing['ContactID'] === 'string') return { id: existing['ContactID'] }
      const body = await put(
        session,
        'Contacts',
        { Contacts: [{ Name: customer.name.slice(0, 255), ...(customer.email ? { EmailAddress: customer.email } : {}) }] },
        `contact:${(customer.email ?? customer.name).toLowerCase()}`,
      )
      return { id: firstId(body, 'Contacts', 'ContactID') }
    },

    createSalesReceipt: salesDocument,
    createRefundReceipt: salesDocument,

    async createExpense(session, doc: AccountingExpenseDoc, context) {
      if (!context.customerId) throw new AccountingProviderError('validation', 'Xero needs a contact for a fee.')
      const body = await put(
        session,
        'BankTransactions',
        {
          BankTransactions: [
            {
              Type: doc.credit ? 'RECEIVE' : 'SPEND',
              Contact: { ContactID: context.customerId },
              BankAccount: { AccountID: doc.bankAccountId },
              Date: doc.date,
              Reference: doc.externalId,
              CurrencyCode: normalizeCurrency(doc.currency),
              LineAmountTypes: 'NoTax',
              LineItems: [
                {
                  Description: doc.memo,
                  Quantity: 1,
                  UnitAmount: centsToDecimal(doc.amountCents),
                  ...accountRef(doc.expenseAccountId, context.extras),
                },
              ],
            },
          ],
        },
        context.idempotencyKey,
      )
      return { id: firstId(body, 'BankTransactions', 'BankTransactionID'), type: 'BankTransaction' }
    },

    async createDeposit(session, doc: AccountingTransferDoc, context) {
      const body = await put(
        session,
        'BankTransfers',
        {
          BankTransfers: [
            {
              FromBankAccount: { AccountID: doc.fromAccountId },
              ToBankAccount: { AccountID: doc.toAccountId },
              Amount: centsToDecimal(doc.amountCents),
              Date: doc.date,
              Reference: doc.externalId,
            },
          ],
        },
        context.idempotencyKey,
      )
      return { id: firstId(body, 'BankTransfers', 'BankTransferID'), type: 'BankTransfer' }
    },

    async createJournal(session, doc: AccountingJournalDoc, context) {
      const body = await put(
        session,
        'ManualJournals',
        {
          ManualJournals: [
            {
              Narration: `${doc.externalId} ${doc.memo}`.slice(0, 4000),
              Date: doc.date,
              Status: 'POSTED',
              LineAmountTypes: 'NoTax',
              JournalLines: doc.lines.map((line) => ({
                // Debits positive, credits negative.
                LineAmount: centsToDecimal(line.debitCents - line.creditCents),
                Description: line.description,
                ...accountRef(line.accountId, context.extras),
              })),
            },
          ],
        },
        context.idempotencyKey,
      )
      return { id: firstId(body, 'ManualJournals', 'ManualJournalID'), type: 'ManualJournal' }
    },

    async findByExternalId(session, kind: AccountingDocKind, externalId) {
      switch (kind) {
        case 'sale': {
          // Settled only: an invoice still owing its payment is finished by
          // the create, which finds it and pays the rest.
          const row = await findOne(session, 'Invoices', { InvoiceNumbers: externalId })
          return row && decimalToCents(row['AmountDue']) === 0 ? { id: String(row['InvoiceID']), type: 'Invoice' } : null
        }
        case 'refund': {
          const row = await findOne(session, 'CreditNotes', { where: `CreditNoteNumber==${xeroLiteral(externalId)}` })
          return row && decimalToCents(row['RemainingCredit']) === 0
            ? { id: String(row['CreditNoteID']), type: 'CreditNote' }
            : null
        }
        case 'fee':
        case 'fee-refund': {
          const row = await findOne(session, 'BankTransactions', { where: `Reference==${xeroLiteral(externalId)}` })
          return row ? { id: String(row['BankTransactionID']), type: 'BankTransaction' } : null
        }
        case 'payout': {
          const row = await findOne(session, 'BankTransfers', { where: `Reference==${xeroLiteral(externalId)}` })
          return row ? { id: String(row['BankTransferID']), type: 'BankTransfer' } : null
        }
        default:
          // A journal's narration is not a filter Xero offers; the
          // idempotency key and the sync log are its locks.
          return null
      }
    },
  }
}
