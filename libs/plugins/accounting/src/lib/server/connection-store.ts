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
 * A WORKSPACE'S LEDGER CONNECTION, AND ITS SEALED GRANT (AGL-3614).
 *
 * `orgs/{orgId}/accountingConnections/{provider}` — at most one per
 * provider, and the routes allow one provider at a time. The refresh and
 * access tokens are sealed with `ACCOUNTING_TOKEN_KEY` (secret box,
 * AES-256-GCM), each bound to this document and its purpose as the seal's
 * context, so a value copied into another workspace's document refuses to
 * open there. No Firestore rule names the collection: the console page reads
 * {@link toConnectionView}, which carries no token, through `accounting/status`.
 *
 * ## Rotation, and only one refresher
 *
 * Both providers hand back a new refresh token on a refresh — Xero on every
 * one, Intuit whenever it chooses — and the old one stops working soon
 * after. Two processes refreshing the same grant at once would each spend
 * the old token and one would store a token the provider has already
 * replaced. So a refresh first takes a short LEASE on the document in a
 * transaction; a second refresher that finds the lease held waits for the
 * first's result instead of refreshing again. The new tokens are written the
 * moment they arrive.
 */

import { needsReseal, openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import {
  ACCOUNTING_CONNECTIONS_COLLECTION,
  EMPTY_ACCOUNTING_MAPPING,
  missingAccountRoles,
  type AccountingConnectionStatus,
  type AccountingConnectionView,
  type AccountingMapping,
  type AccountingProviderId,
} from '../model/accounting.types'
import { AccountingProviderError } from './providers/http'
import type {
  AccountingProvider,
  AccountingProviderExtras,
  AccountingSession,
  AccountingTenant,
  AccountingTokenSet,
} from './providers/provider'

/** The stored document. Server-only. */
export interface AccountingConnectionRecord {
  orgId: string
  provider: AccountingProviderId
  status: AccountingConnectionStatus
  tenantId: string | null
  tenantName: string | null
  /** Xero's connection id for the bound organization. */
  connectionId: string | null
  /** The organizations a Xero grant reaches, while a pick is owed. */
  tenants: AccountingTenant[]
  environment: 'sandbox' | 'production' | null
  sealedRefreshToken: string
  sealedAccessToken: string
  accessExpiresAtMs: number
  refreshExpiresAtMs: number | null
  refreshedAtMs: number
  refreshLeaseUntilMs: number
  scopes: string[]
  homeCurrency: string | null
  multiCurrency: boolean
  connectedAtMs: number
  connectedByUid: string
  connectedByEmail: string | null
  mapping: AccountingMapping
  /** What the adapter's `prepare` set up for the mapping. */
  extras: AccountingProviderExtras
  /** The contact a fee is paid to, in a ledger that needs one. */
  feePayeeId: string | null
  /** Every tax key a synced order has named. */
  seenTaxKeys: string[]
  /** The newest payout arrival already queued, epoch ms. */
  payoutCursorMs: number
  /** Calls spent today, for a provider with a daily limit. */
  callDay: string | null
  callCount: number
  lastSyncAtMs: number | null
  lastError: string | null
  updatedAtMs: number
}

export function connectionRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  provider: AccountingProviderId,
): FirebaseFirestore.DocumentReference {
  return firestore.collection('orgs').doc(orgId).collection(ACCOUNTING_CONNECTIONS_COLLECTION).doc(provider)
}

/** The seal's context: this document and this token's purpose. */
export const tokenContext = (orgId: string, provider: AccountingProviderId, purpose: 'refresh' | 'access') =>
  `accounting:${orgId}:${provider}:${purpose}`

export function sealTokens(
  keyring: SecretBoxKeyring,
  orgId: string,
  provider: AccountingProviderId,
  tokens: AccountingTokenSet,
): Pick<AccountingConnectionRecord, 'sealedRefreshToken' | 'sealedAccessToken'> {
  return {
    sealedRefreshToken: sealSecret(tokens.refreshToken, keyring.current, {
      context: tokenContext(orgId, provider, 'refresh'),
    }),
    sealedAccessToken: sealSecret(tokens.accessToken, keyring.current, {
      context: tokenContext(orgId, provider, 'access'),
    }),
  }
}

export function openToken(
  keyring: SecretBoxKeyring,
  record: Pick<AccountingConnectionRecord, 'orgId' | 'provider' | 'sealedRefreshToken' | 'sealedAccessToken'>,
  purpose: 'refresh' | 'access',
): { token: string; reseal: boolean } {
  const opened = openSecret(purpose === 'refresh' ? record.sealedRefreshToken : record.sealedAccessToken, keyring, {
    context: tokenContext(record.orgId, record.provider, purpose),
  })
  return { token: opened.plaintext, reseal: needsReseal(opened, keyring) }
}

/** A stored document read defensively. */
export function readConnection(data: Record<string, unknown> | undefined): AccountingConnectionRecord | null {
  if (!data || typeof data['provider'] !== 'string') return null
  const record = data as unknown as AccountingConnectionRecord
  return {
    ...record,
    tenants: Array.isArray(record.tenants) ? record.tenants : [],
    mapping: { ...EMPTY_ACCOUNTING_MAPPING, ...(record.mapping ?? {}) },
    extras: record.extras ?? {},
    seenTaxKeys: Array.isArray(record.seenTaxKeys) ? record.seenTaxKeys : [],
    payoutCursorMs: Number(record.payoutCursorMs) || 0,
    callCount: Number(record.callCount) || 0,
    refreshLeaseUntilMs: Number(record.refreshLeaseUntilMs) || 0,
  }
}

/** The organization's connection, whichever provider it is with, or `null`. */
export async function loadOrgConnection(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<AccountingConnectionRecord | null> {
  const snapshot = await firestore.collection('orgs').doc(orgId).collection(ACCOUNTING_CONNECTIONS_COLLECTION).limit(2).get()
  const records = snapshot.docs
    .map((doc) => readConnection(doc.data()))
    .filter((record): record is AccountingConnectionRecord => Boolean(record))
  // One provider at a time is the routes' rule; if two ever stand, the
  // newer connection is the one in force.
  records.sort((a, b) => b.connectedAtMs - a.connectedAtMs)
  return records[0] ?? null
}

/** What the console page reads: no token, no lease, no cursor. */
export function toConnectionView(record: AccountingConnectionRecord): AccountingConnectionView {
  return {
    provider: record.provider,
    status: record.status,
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    ...(record.status === 'choose-tenant'
      ? { tenants: record.tenants.map((tenant) => ({ id: tenant.id, name: tenant.name })) }
      : {}),
    homeCurrency: record.homeCurrency,
    multiCurrency: record.multiCurrency,
    environment: record.environment,
    connectedAtMs: record.connectedAtMs,
    connectedByEmail: record.connectedByEmail,
    mapping: record.mapping,
    missingRoles: missingAccountRoles(record.mapping),
    lastSyncAtMs: record.lastSyncAtMs,
    lastError: record.lastError,
  }
}

/** Refresh when the access token has less than this left. */
export const ACCESS_REFRESH_MARGIN_MS = 5 * 60 * 1000

/**
 * Refresh a grant that has not been refreshed for this long even when
 * nothing needed it, so a quiet store's grant never ages out: Xero's refresh
 * token lapses after 60 idle days and Intuit's after 100.
 */
export const PROACTIVE_REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000

const LEASE_MS = 30_000
const LEASE_WAITS = 6
const LEASE_WAIT_MS = 1000

export interface TokenManagerDeps {
  firestore: FirebaseFirestore.Firestore
  keyring: SecretBoxKeyring
  provider: AccountingProvider
  now: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Thrown when a grant can no longer be used and someone has to reconnect. */
export class AccountingReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountingReconnectRequiredError'
  }
}

/** Whether a record's access token should be refreshed before use. */
export function accessTokenStale(record: AccountingConnectionRecord, nowMs: number): boolean {
  return !record.sealedAccessToken || record.accessExpiresAtMs - ACCESS_REFRESH_MARGIN_MS <= nowMs
}

/**
 * A usable session for a connected record: its access token, refreshed
 * first when it is near expiry (or `force`, after a 401), under the lease.
 */
export async function connectionSession(
  deps: TokenManagerDeps,
  record: AccountingConnectionRecord,
  options: { force?: boolean } = {},
): Promise<AccountingSession> {
  if (record.status !== 'connected' || !record.tenantId) {
    throw new AccountingReconnectRequiredError('The ledger connection is not finished.')
  }
  const nowMs = deps.now()
  if (!options.force && !accessTokenStale(record, nowMs)) {
    return { accessToken: openToken(deps.keyring, record, 'access').token, tenantId: record.tenantId }
  }
  const refreshed = await refreshConnection(deps, record)
  return { accessToken: refreshed.accessToken, tenantId: record.tenantId }
}

/**
 * Refreshes a grant under the lease and stores the rotated tokens. Answers
 * the access token now in force — this refresh's, or a concurrent one's.
 */
export async function refreshConnection(
  deps: TokenManagerDeps,
  record: AccountingConnectionRecord,
): Promise<{ accessToken: string; refreshed: boolean }> {
  const ref = connectionRef(deps.firestore, record.orgId, record.provider)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const startedRefreshedAt = record.refreshedAtMs
  for (let wait = 0; wait <= LEASE_WAITS; wait += 1) {
    const claim = await deps.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const current = readConnection(snapshot.exists ? snapshot.data() : undefined)
      if (!current || current.status === 'reconnect-required') return { kind: 'gone' as const, current }
      // Someone else refreshed since we read: use theirs.
      if (current.refreshedAtMs > startedRefreshedAt && !accessTokenStale(current, deps.now())) {
        return { kind: 'fresh' as const, current }
      }
      if (current.refreshLeaseUntilMs > deps.now()) return { kind: 'held' as const, current }
      transaction.update(ref, { refreshLeaseUntilMs: deps.now() + LEASE_MS })
      return { kind: 'ours' as const, current }
    })
    if (claim.kind === 'gone') {
      throw new AccountingReconnectRequiredError(claim.current?.lastError ?? 'Reconnect the ledger.')
    }
    if (claim.kind === 'fresh') {
      return { accessToken: openToken(deps.keyring, claim.current, 'access').token, refreshed: false }
    }
    if (claim.kind === 'held') {
      await sleep(LEASE_WAIT_MS)
      continue
    }
    const current = claim.current
    let tokens: AccountingTokenSet
    try {
      tokens = await deps.provider.refresh(openToken(deps.keyring, current, 'refresh').token)
    } catch (error) {
      if (error instanceof AccountingProviderError && error.code === 'auth') {
        const message = `${error.message}`
        await ref.update({
          status: 'reconnect-required',
          lastError: message,
          refreshLeaseUntilMs: 0,
          updatedAtMs: deps.now(),
        })
        throw new AccountingReconnectRequiredError(message)
      }
      await ref.update({ refreshLeaseUntilMs: 0 })
      throw error
    }
    const nowMs = deps.now()
    await ref.update({
      ...sealTokens(deps.keyring, current.orgId, current.provider, tokens),
      accessExpiresAtMs: tokens.accessExpiresAtMs,
      refreshExpiresAtMs: tokens.refreshExpiresAtMs,
      refreshedAtMs: nowMs,
      refreshLeaseUntilMs: 0,
      updatedAtMs: nowMs,
    })
    return { accessToken: tokens.accessToken, refreshed: true }
  }
  throw new AccountingProviderError('transient', 'Another refresh of this connection is still running.')
}

/** Builds the record for a freshly exchanged grant. */
export function newConnectionRecord(input: {
  keyring: SecretBoxKeyring
  orgId: string
  provider: AccountingProviderId
  tokens: AccountingTokenSet
  tenants: AccountingTenant[]
  environment: 'sandbox' | 'production' | null
  uid: string
  email: string | null
  nowMs: number
  previous: AccountingConnectionRecord | null
}): AccountingConnectionRecord {
  const { tenants, previous } = input
  const single = tenants.length === 1 ? tenants[0] : null
  // Reconnecting the same company keeps its mapping, sync history and cursor.
  const same = previous && single && previous.tenantId === single.id ? previous : null
  return {
    orgId: input.orgId,
    provider: input.provider,
    status: single ? 'connected' : 'choose-tenant',
    tenantId: single?.id ?? null,
    tenantName: single?.name || null,
    connectionId: single?.connectionId ?? null,
    tenants: single ? [] : tenants,
    environment: input.environment,
    ...sealTokens(input.keyring, input.orgId, input.provider, input.tokens),
    accessExpiresAtMs: input.tokens.accessExpiresAtMs,
    refreshExpiresAtMs: input.tokens.refreshExpiresAtMs,
    refreshedAtMs: input.nowMs,
    refreshLeaseUntilMs: 0,
    scopes: input.tokens.scopes,
    homeCurrency: same?.homeCurrency ?? null,
    multiCurrency: same?.multiCurrency ?? false,
    connectedAtMs: input.nowMs,
    connectedByUid: input.uid,
    connectedByEmail: input.email,
    mapping: same?.mapping ?? { ...EMPTY_ACCOUNTING_MAPPING },
    extras: same?.extras ?? {},
    feePayeeId: same?.feePayeeId ?? null,
    seenTaxKeys: same?.seenTaxKeys ?? [],
    payoutCursorMs: same?.payoutCursorMs ?? input.nowMs,
    callDay: same?.callDay ?? null,
    callCount: same?.callCount ?? 0,
    lastSyncAtMs: same?.lastSyncAtMs ?? null,
    lastError: null,
    updatedAtMs: input.nowMs,
  }
}
