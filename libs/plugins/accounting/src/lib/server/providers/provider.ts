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
 * THE CONTRACT EVERY LEDGER ADAPTER KEEPS (AGL-3614).
 *
 * The sync engine speaks only this. An adapter turns the neutral documents
 * of `model/accounting-transforms.ts` into its API's shapes and back, over
 * plain `fetch` — no vendor SDK — so a spec drives it with a mocked fetch
 * and nothing else.
 *
 * ## Idempotent by two locks
 *
 * Every create carries an idempotency key the provider honors — QuickBooks'
 * `requestid`, Xero's `Idempotency-Key` header — derived from the sync item,
 * so a retry after a timeout that DID land returns the first document rather
 * than a second. And before creating, the engine asks
 * {@link AccountingProvider.findByExternalId} for a document already carrying
 * the external id (QuickBooks' DocNumber, Xero's Reference), which covers a
 * retry that came after the provider forgot the key.
 */

import type {
  AccountingAccountOption,
  AccountingAccountRole,
  AccountingProviderId,
  AccountingTaxOption,
} from '../../model/accounting.types'
import type {
  AccountingCustomerRef,
  AccountingExpenseDoc,
  AccountingJournalDoc,
  AccountingRefundDoc,
  AccountingSaleDoc,
  AccountingTransferDoc,
} from '../../model/accounting-transforms'

/** What a code exchange or a refresh produced. */
export interface AccountingTokenSet {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  accessExpiresAtMs: number
  /** Epoch ms, when the provider states it. */
  refreshExpiresAtMs: number | null
  scopes: string[]
}

/** A company (QuickBooks realm) or organization (Xero tenant) a grant reaches. */
export interface AccountingTenant {
  id: string
  name: string
  /** Xero's connection id, which a disconnect deletes. */
  connectionId?: string
}

/** Everything a tenant-bound call needs. */
export interface AccountingSession {
  accessToken: string
  tenantId: string
}

export interface AccountingCompanyInfo {
  name: string
  homeCurrency: string | null
  multiCurrency: boolean
}

/** A document the ledger holds. */
export interface AccountingDocRef {
  id: string
  /** The provider's entity: `SalesReceipt`, `Invoice`, `BankTransfer`, … */
  type: string
  /** Further documents a create made, Xero's payment for an invoice. */
  related?: ReadonlyArray<{ id: string; type: string }>
}

/** The kinds `findByExternalId` is asked about. */
export type AccountingDocKind = 'sale' | 'refund' | 'fee' | 'fee-refund' | 'payout' | 'summary'

/** Settings an adapter needs beyond the mapping: QuickBooks' sales items. */
export type AccountingProviderExtras = Readonly<Record<string, string>>

export interface AccountingProvider {
  readonly id: AccountingProviderId
  /** Whether the grant should be bound to a tenant picked after the exchange. */
  readonly picksTenantAfterExchange: boolean

  /**
   * The consent address. A confidential client's authorization-code flow:
   * the client secret redeems the code, and the signed, single-use `state`
   * is what binds the redirect to the member who started it. An aggregator
   * (Codat) makes the workspace's record at this step, so it may answer
   * asynchronously and reads the workspace it is for.
   */
  authorizeUrl(input: {
    state: string
    redirectUri: string
    orgId: string
    orgName: string | null
  }): string | Promise<string>
  exchangeCode(input: {
    code: string
    redirectUri: string
    /** QuickBooks hands the company id back beside the code. */
    realmId?: string | null
    /** The workspace finishing the connect, which an aggregator checks its record against. */
    orgId?: string | null
  }): Promise<{ tokens: AccountingTokenSet; tenants: AccountingTenant[] }>
  refresh(refreshToken: string): Promise<AccountingTokenSet>
  /** Revokes the grant. Never throws for a grant that is already gone. */
  revoke(input: { refreshToken: string; accessToken?: string | null; connectionId?: string | null }): Promise<void>

  companyInfo(session: AccountingSession): Promise<AccountingCompanyInfo>
  listAccounts(session: AccountingSession): Promise<AccountingAccountOption[]>
  listTaxRates(session: AccountingSession): Promise<AccountingTaxOption[]>
  /**
   * Whatever the adapter must hold for the mapping to be postable — the
   * QuickBooks items a sale's lines name — found or made, idempotently.
   */
  prepare(
    session: AccountingSession,
    accounts: Partial<Record<AccountingAccountRole, string>>,
    existing: AccountingProviderExtras,
  ): Promise<AccountingProviderExtras>

  upsertCustomer(session: AccountingSession, customer: AccountingCustomerRef): Promise<{ id: string }>
  createSalesReceipt(
    session: AccountingSession,
    doc: AccountingSaleDoc,
    context: AccountingWriteContext,
  ): Promise<AccountingDocRef>
  createRefundReceipt(
    session: AccountingSession,
    doc: AccountingRefundDoc,
    context: AccountingWriteContext,
  ): Promise<AccountingDocRef>
  createExpense(
    session: AccountingSession,
    doc: AccountingExpenseDoc,
    context: AccountingWriteContext,
  ): Promise<AccountingDocRef>
  createDeposit(
    session: AccountingSession,
    doc: AccountingTransferDoc,
    context: AccountingWriteContext,
  ): Promise<AccountingDocRef>
  createJournal(
    session: AccountingSession,
    doc: AccountingJournalDoc,
    context: AccountingWriteContext,
  ): Promise<AccountingDocRef>
  findByExternalId(
    session: AccountingSession,
    kind: AccountingDocKind,
    externalId: string,
  ): Promise<AccountingDocRef | null>
}

/** What every create is handed beside its document. */
export interface AccountingWriteContext {
  /** Stable for one sync item's one document; see the module comment. */
  idempotencyKey: string
  customerId: string | null
  extras: AccountingProviderExtras
  /** The ledger's home currency, so a same-currency document names none. */
  homeCurrency: string | null
}
