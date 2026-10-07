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
 * THE ACCOUNTING PLUGIN'S DOCUMENT MODEL (AGL-3614), shared by the console
 * page and the server. Client-safe: types and constants only.
 *
 * Every collection here sits under `orgs/{orgId}` and is written and read by
 * this plugin's server alone. No Firestore rule names any of them, and the
 * org block has no catch-all, so every client is refused: a connection holds
 * sealed grants to the business's books, and the sync log holds the order
 * snapshots it posts. The console page reads all of it through
 * `accounting/status` and `accounting/log`.
 */

/**
 * The ledgers a workspace can connect. `codat` is the aggregator (AGL-3636)
 * that reaches the rest — QuickBooks Desktop, NetSuite, Sage, FreshBooks,
 * Zoho Books, Wave — and the connection names the software it linked.
 */
export const ACCOUNTING_PROVIDERS = ['quickbooks', 'xero', 'codat'] as const
export type AccountingProviderId = (typeof ACCOUNTING_PROVIDERS)[number]

export function isAccountingProviderId(value: unknown): value is AccountingProviderId {
  return (ACCOUNTING_PROVIDERS as readonly unknown[]).includes(value)
}

/** The name a person reads for a provider. */
export const ACCOUNTING_PROVIDER_LABELS: Readonly<Record<AccountingProviderId, string>> = {
  quickbooks: 'QuickBooks Online',
  xero: 'Xero',
  codat: 'Accounting software',
}

/** A provider as it reads inside a sentence: "Reconnect your accounting software." */
export function accountingProviderName(provider: AccountingProviderId): string {
  return provider === 'codat' ? 'your accounting software' : ACCOUNTING_PROVIDER_LABELS[provider]
}

/** `orgs/{orgId}/accountingConnections/{provider}`: one per provider, one active. */
export const ACCOUNTING_CONNECTIONS_COLLECTION = 'accountingConnections'
/** `orgs/{orgId}/accountingSyncItems/{itemId}`: the sync log and external-id map. */
export const ACCOUNTING_SYNC_ITEMS_COLLECTION = 'accountingSyncItems'
/** `orgs/{orgId}/accountingOAuthStates/{id}`: the pending record a connect's state consumes. */
export const ACCOUNTING_OAUTH_STATES_COLLECTION = 'accountingOAuthStates'

/**
 * How sales reach the ledger.
 *
 * - `per-order` — every paid order is its own sales receipt (QuickBooks) or
 *   invoice and payment (Xero), every refund its own refund receipt or credit
 *   note, and every order's fee its own expense.
 * - `daily-summary` — one journal entry per day and currency that posts the
 *   day's sales, refunds, tax and fees in totals, for a business whose books
 *   do not want a line per order.
 *
 * Payouts are one transfer each in both modes.
 */
export const ACCOUNTING_SYNC_MODES = ['per-order', 'daily-summary'] as const
export type AccountingSyncMode = (typeof ACCOUNTING_SYNC_MODES)[number]

/**
 * The accounts a mapping names, by role.
 *
 * - `income` — where item sales are credited.
 * - `shippingIncome` — where shipping charged is credited; `income` when unset.
 * - `clearing` — the "Stripe clearing" bank account sales are paid into and
 *   payouts leave from. It must be a bank-type account: both ledgers only
 *   take a payment into one.
 * - `feeExpense` — where Aglyn's platform fee on each sale is expensed.
 * - `payoutBank` — the bank account a payout lands in.
 * - `taxLiability` — where collected sales tax is credited by a daily summary
 *   journal. A per-order sale leaves tax to the ledger's own tax codes.
 */
export const ACCOUNTING_ACCOUNT_ROLES = [
  'income',
  'shippingIncome',
  'clearing',
  'feeExpense',
  'payoutBank',
  'taxLiability',
] as const
export type AccountingAccountRole = (typeof ACCOUNTING_ACCOUNT_ROLES)[number]

/**
 * The tax keys every store has: an order that carried sales tax, and one
 * that did not. A sale names a finer key — a manual tax rate's id — when its
 * order carried one, and an unmapped finer key falls back to `taxed`.
 */
export const ACCOUNTING_BASE_TAX_KEYS = ['taxed', 'untaxed'] as const

export interface AccountingMapping {
  accounts: Partial<Record<AccountingAccountRole, string>>
  /** Aglyn tax key → the ledger's tax code (QuickBooks) or tax type (Xero). */
  taxCodes: Record<string, string>
  syncMode: AccountingSyncMode
  /** `YYYY-MM-DD`: sales before it are never posted. `null` = from the day of connecting. */
  startDate: string | null
  /** The IANA zone a day of the daily summary is counted in. */
  timeZone: string
}

export const EMPTY_ACCOUNTING_MAPPING: AccountingMapping = {
  accounts: {},
  taxCodes: {},
  syncMode: 'per-order',
  startDate: null,
  timeZone: 'UTC',
}

/** The roles a mapping must name before anything syncs, by mode. */
export function requiredAccountRoles(mode: AccountingSyncMode): readonly AccountingAccountRole[] {
  return mode === 'daily-summary'
    ? ['income', 'clearing', 'feeExpense', 'payoutBank', 'taxLiability']
    : ['income', 'clearing', 'feeExpense', 'payoutBank']
}

/** The roles a mapping still lacks; empty when it is complete. */
export function missingAccountRoles(mapping: AccountingMapping): AccountingAccountRole[] {
  return requiredAccountRoles(mapping.syncMode).filter((role) => !mapping.accounts[role])
}

/** Where a connection stands. */
export type AccountingConnectionStatus =
  /** Authorized and bound to one company or organization. */
  | 'connected'
  /** A Xero grant that reaches several organizations, waiting for a pick. */
  | 'choose-tenant'
  /** The grant was refused or expired; nothing syncs until someone reconnects. */
  | 'reconnect-required'

/** One account in the ledger's chart, as the mapping form lists it. */
export interface AccountingAccountOption {
  id: string
  /** Xero's account code, which its line items post by; QuickBooks' account number. */
  code: string | null
  name: string
  /** The provider's own type word: `Income`, `Bank`, `REVENUE`, `BANK`, … */
  type: string
  /** The group the form files it under. */
  classification: 'income' | 'expense' | 'bank' | 'liability' | 'other'
  currency: string | null
}

/** One tax code or tax rate the ledger offers. */
export interface AccountingTaxOption {
  id: string
  name: string
  /** Percent, when the provider states one. */
  ratePercent: number | null
}

/** A connection as the console page reads it: no token, ever. */
export interface AccountingConnectionView {
  provider: AccountingProviderId
  status: AccountingConnectionStatus
  tenantId: string | null
  tenantName: string | null
  /** The Xero organizations a grant reaches, while a pick is owed. */
  tenants?: ReadonlyArray<{ id: string; name: string }>
  homeCurrency: string | null
  multiCurrency: boolean
  /** QuickBooks only: the sandbox or production company. */
  environment: 'sandbox' | 'production' | null
  connectedAtMs: number
  connectedByEmail: string | null
  mapping: AccountingMapping
  missingRoles: AccountingAccountRole[]
  lastSyncAtMs: number | null
  lastError: string | null
}

/** What `accounting/status` answers. */
export interface AccountingStatusResponse {
  /** Which providers this deployment has credentials for. */
  providers: Readonly<Record<AccountingProviderId, boolean>>
  connection: AccountingConnectionView | null
  counts: { pending: number; synced: number; needsAttention: number }
  /** Every tax key a synced order has named, for the tax mapping rows. */
  seenTaxKeys: string[]
}

/** What `accounting/options` answers. */
export interface AccountingOptionsResponse {
  accounts: AccountingAccountOption[]
  taxCodes: AccountingTaxOption[]
}

/** The kinds of thing that become a ledger document. */
export const ACCOUNTING_SYNC_KINDS = ['sale', 'refund', 'fee', 'fee-refund', 'payout', 'summary'] as const
export type AccountingSyncKind = (typeof ACCOUNTING_SYNC_KINDS)[number]

export const ACCOUNTING_SYNC_STATUSES = ['pending', 'synced', 'needs_attention', 'skipped'] as const
export type AccountingSyncStatus = (typeof ACCOUNTING_SYNC_STATUSES)[number]

/** One sync log row, as the console page reads it. */
export interface AccountingSyncItemView {
  id: string
  kind: AccountingSyncKind
  /** "Order #1042", "Refund on order #1042", "Payout of $1,204.10". */
  label: string
  externalId: string
  status: AccountingSyncStatus
  attempts: number
  nextAttemptAtMs: number | null
  lastError: string | null
  providerDocId: string | null
  amountCents: number
  currency: string
  occurredAtMs: number
  updatedAtMs: number
}

export interface AccountingLogResponse {
  items: AccountingSyncItemView[]
  /** The `updatedAtMs` to pass as `before` for the next page, or `null` at the end. */
  nextBefore: number | null
}

/** Every refusal reason the routes answer with. */
export type AccountingRefusalReason =
  | 'unauthenticated'
  | 'email-unverified'
  | 'org-required'
  | 'not-a-member'
  | 'not-org-wide'
  | 'permission'
  | 'entitlement'
  | 'invalid-request'
  | 'not-configured'
  | 'not-connected'
  | 'state-invalid'
  | 'state-expired'
  | 'state-replayed'
  | 'state-superseded'
  | 'state-user-mismatch'
  | 'state-org-mismatch'
  | 'provider-error'
  | 'method-not-allowed'
  | 'not-found'

/** What the OAuth callback hands the page in its fragment. */
export type AccountingConnectReturn =
  | { kind: 'code'; code: string; state: string; realmId?: string }
  | { kind: 'error'; reason: 'access_denied' | 'provider_error' | 'expired' }

/** The fragment the callback redirects to, and the parse the page makes of it. */
export function buildAccountingConnectFragment(value: AccountingConnectReturn): string {
  const params = new URLSearchParams()
  if (value.kind === 'code') {
    params.set('accounting', 'code')
    params.set('code', value.code)
    params.set('state', value.state)
    if (value.realmId) params.set('realmId', value.realmId)
  } else {
    params.set('accounting', 'error')
    params.set('reason', value.reason)
  }
  return params.toString()
}

export function parseAccountingConnectFragment(hash: string): AccountingConnectReturn | null {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''))
  const kind = params.get('accounting')
  if (kind === 'code') {
    const code = params.get('code') ?? ''
    const state = params.get('state') ?? ''
    if (!code || !state) return null
    const realmId = params.get('realmId')
    return { kind: 'code', code, state, ...(realmId ? { realmId } : {}) }
  }
  if (kind === 'error') {
    const reason = params.get('reason')
    return {
      kind: 'error',
      reason: reason === 'access_denied' || reason === 'expired' ? reason : 'provider_error',
    }
  }
  return null
}
