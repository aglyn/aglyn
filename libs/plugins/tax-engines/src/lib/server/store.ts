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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  needsReseal,
  openSecret,
  sealSecret,
  type SecretBoxKeyring,
} from '@aglyn/shared-util-tools/secret-box'
import { createHash } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import {
  isTaxEngineProvider,
  isTaxExemptionType,
  normalizeTaxAddress,
  TAX_ENGINE_PROVIDER_LABELS,
  type TaxEngineAddress,
  type TaxEngineConnectionView,
  type TaxEngineEnvironment,
  type TaxEngineProviderId,
  type TaxEngineTransactionStatus,
  type TaxEngineTransactionView,
  type TaxExemptionType,
  type TaxExemptionView,
} from '../model/tax-engines'
import type { TaxCommitRequest, TaxProviderCredentials } from '../providers/types'

/**
 * Where a tax engine's state lives (AGL-3631). FOUR TOP-LEVEL collections,
 * each document carrying `orgId` and `hostId`, and every one of them closed to
 * every client by the Firestore rules — staff included — because one holds a
 * merchant's sealed credential and the rest are what the engine was told.
 * Top level so org erasure removes them by `orgId` (`orgKeyedCollections`),
 * and so the host catch-all's client grants never reach them.
 *
 *   taxEngineConnections/{hostId}             the connection, secret sealed
 *   taxEngineProductCodes/{hostId}__{product} one product's tax code
 *   taxEngineExemptions/{hostId}__{emailHash} one exempt customer
 *   taxEngineTransactions/{hostId}__{orderId} one order's record at the engine
 *
 * The secret's field names carry `token`: the personal-data export redacts by
 * field name first.
 */

export const TAX_ENGINE_COLLECTIONS = {
  connections: 'taxEngineConnections',
  productCodes: 'taxEngineProductCodes',
  exemptions: 'taxEngineExemptions',
  transactions: 'taxEngineTransactions',
} as const

let override: unknown = null

export function taxEnginesDb(): Firestore {
  return (override ?? firebaseAdmin.app().firestore()) as Firestore
}

/** Test seam. */
export function setTaxEnginesDbForTests(db: unknown): void {
  override = db
}

/** Whether a client-supplied id is one Firestore will take as a document id. */
export function isDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes('/') &&
    !/^__.*__$/.test(value) &&
    value !== '.' &&
    value !== '..'
  )
}

/** A stored connection, secret still sealed. */
export interface StoredTaxEngineConnection {
  orgId: string
  hostId: string
  provider: TaxEngineProviderId
  environment: TaxEngineEnvironment
  accountId: string | null
  companyCode: string | null
  sealedApiToken: string
  apiTokenKeyId: string
  shipFrom: TaxEngineAddress | null
  shipFromValidated: boolean
  defaultTaxCode: string | null
  recordTransactions: boolean
  lastTestOk: boolean
  lastTestAtMs: number | null
  lastError: string | null
  connectedByUid: string
  createdAtMs: number
  updatedAtMs: number
}

export function connectionRef(hostId: string) {
  return taxEnginesDb().collection(TAX_ENGINE_COLLECTIONS.connections).doc(hostId)
}

/** The context a site's secret is sealed under: a copy pasted into another site's document will not open. */
export function apiTokenSealContext(hostId: string): string {
  return `${TAX_ENGINE_COLLECTIONS.connections}/${hostId}#apiToken`
}

export function sealApiToken(
  secret: string,
  hostId: string,
  keyring: SecretBoxKeyring,
): { sealedApiToken: string; apiTokenKeyId: string } {
  return {
    sealedApiToken: sealSecret(secret, keyring.current, { context: apiTokenSealContext(hostId) }),
    apiTokenKeyId: keyring.current.id,
  }
}

/** A stored connection read defensively, or `null` when the document is not one. */
export function readStoredConnection(data: unknown): StoredTaxEngineConnection | null {
  const record = (data ?? null) as Record<string, any> | null
  if (!record || !isTaxEngineProvider(record.provider) || typeof record.sealedApiToken !== 'string' || !record.sealedApiToken) {
    return null
  }
  return {
    orgId: String(record.orgId ?? ''),
    hostId: String(record.hostId ?? ''),
    provider: record.provider,
    environment: record.environment === 'production' ? 'production' : 'sandbox',
    accountId: record.accountId ? String(record.accountId) : null,
    companyCode: record.companyCode ? String(record.companyCode) : null,
    sealedApiToken: record.sealedApiToken,
    apiTokenKeyId: String(record.apiTokenKeyId ?? ''),
    shipFrom: normalizeTaxAddress(record.shipFrom),
    shipFromValidated: record.shipFromValidated === true,
    defaultTaxCode: record.defaultTaxCode ? String(record.defaultTaxCode) : null,
    recordTransactions: record.recordTransactions !== false,
    lastTestOk: record.lastTestOk === true,
    lastTestAtMs: Number.isFinite(Number(record.lastTestAtMs)) ? Number(record.lastTestAtMs) : null,
    lastError: record.lastError ? String(record.lastError) : null,
    connectedByUid: String(record.connectedByUid ?? ''),
    createdAtMs: Number(record.createdAtMs) || 0,
    updatedAtMs: Number(record.updatedAtMs) || 0,
  }
}

export async function readConnection(hostId: string): Promise<StoredTaxEngineConnection | null> {
  if (!isDocumentId(hostId)) return null
  const snapshot = await connectionRef(hostId).get()
  return snapshot.exists ? readStoredConnection(snapshot.data()) : null
}

/** What a member reads: the connection without its secret. */
export function connectionView(connection: StoredTaxEngineConnection): TaxEngineConnectionView {
  return {
    provider: connection.provider,
    providerLabel: TAX_ENGINE_PROVIDER_LABELS[connection.provider],
    environment: connection.environment,
    accountId: connection.accountId,
    companyCode: connection.companyCode,
    shipFrom: connection.shipFrom,
    shipFromValidated: connection.shipFromValidated,
    defaultTaxCode: connection.defaultTaxCode,
    recordTransactions: connection.recordTransactions,
    lastTestOk: connection.lastTestOk,
    lastTestAtMs: connection.lastTestAtMs,
    lastError: connection.lastError,
    updatedAtMs: connection.updatedAtMs,
  }
}

/**
 * Opens a connection's credentials for one call. Throws `SecretBoxError`
 * when the secret cannot be opened (a rotated-away key, a tampered value).
 * A secret sealed under an older key is resealed under the current one, best
 * effort, so a rotation drains itself as merchants sell.
 */
export function openCredentials(
  connection: StoredTaxEngineConnection,
  keyring: SecretBoxKeyring,
): TaxProviderCredentials {
  const opened = openSecret(connection.sealedApiToken, keyring, {
    context: apiTokenSealContext(connection.hostId),
  })
  if (needsReseal(opened, keyring)) {
    connectionRef(connection.hostId)
      .set(sealApiToken(opened.plaintext, connection.hostId, keyring), { merge: true })
      .catch(() => undefined)
  }
  return {
    provider: connection.provider,
    environment: connection.environment,
    ...(connection.accountId ? { accountId: connection.accountId } : {}),
    ...(connection.companyCode ? { companyCode: connection.companyCode } : {}),
    secret: opened.plaintext,
  }
}

/* ---------------------------------------------------------------- products */

export function productCodeId(hostId: string, productId: string): string {
  return `${hostId}__${productId}`
}

export async function readProductTaxCodes(
  hostId: string,
  productIds: readonly string[],
): Promise<Map<string, string>> {
  const codes = new Map<string, string>()
  const unique = [...new Set(productIds.filter((id) => isDocumentId(id)))]
  const collection = taxEnginesDb().collection(TAX_ENGINE_COLLECTIONS.productCodes)
  const snapshots = await Promise.all(unique.map((id) => collection.doc(productCodeId(hostId, id)).get()))
  snapshots.forEach((snapshot, index) => {
    const code = snapshot.exists ? String(snapshot.get('taxCode') ?? '') : ''
    if (code) codes.set(unique[index], code)
  })
  return codes
}

/* -------------------------------------------------------------- exemptions */

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().slice(0, 254)
}

export function exemptionId(hostId: string, email: string): string {
  const hash = createHash('sha256').update(normalizeEmail(email)).digest('base64url').slice(0, 32)
  return `${hostId}__${hash}`
}

export function readExemption(id: string, data: unknown): TaxExemptionView | null {
  const record = (data ?? null) as Record<string, any> | null
  if (!record || !isTaxExemptionType(record.type) || !record.email) return null
  return {
    id,
    email: String(record.email),
    name: record.name ? String(record.name) : null,
    type: record.type as TaxExemptionType,
    certificateNumber: record.certificateNumber ? String(record.certificateNumber) : null,
    regions: Array.isArray(record.regions) ? record.regions.map(String) : [],
    updatedAtMs: Number(record.updatedAtMs) || 0,
  }
}

/** The exemption a customer carries for a destination, or `null`. */
export async function exemptionFor(
  hostId: string,
  email: string | null | undefined,
  region: string | undefined,
): Promise<TaxExemptionView | null> {
  const address = normalizeEmail(email)
  if (!address) return null
  const id = exemptionId(hostId, address)
  const snapshot = await taxEnginesDb().collection(TAX_ENGINE_COLLECTIONS.exemptions).doc(id).get()
  const exemption = snapshot.exists ? readExemption(id, snapshot.data()) : null
  if (!exemption) return null
  if (exemption.regions.length === 0) return exemption
  return region && exemption.regions.includes(region.toUpperCase()) ? exemption : null
}

/* ------------------------------------------------------------ transactions */

export function transactionId(hostId: string, orderId: string): string {
  return `${hostId}__${orderId}`
}

export function transactionRef(hostId: string, orderId: string) {
  return taxEnginesDb().collection(TAX_ENGINE_COLLECTIONS.transactions).doc(transactionId(hostId, orderId))
}

/** One order's record at the engine, as stored. */
export interface StoredTaxEngineTransaction {
  orgId: string
  hostId: string
  orderId: string
  provider: TaxEngineProviderId
  status: TaxEngineTransactionStatus
  /** The document recorded, kept so a refund and a retry need nothing else. */
  sale: TaxCommitRequest
  /** Refunds filed, by refund key, with the cents each moved. */
  refunds: Record<string, { amountCents: number; full: boolean; atMs: number }>
  attempts: number
  /** Why checkout charged the store's own rates instead of the service's: `timeout`, `error`; `null` when it charged the service's. */
  fallbackReason: string | null
  lastError: string | null
  createdAtMs: number
  updatedAtMs: number
}

export function readStoredTransaction(data: unknown): StoredTaxEngineTransaction | null {
  const record = (data ?? null) as Record<string, any> | null
  if (!record || !isTaxEngineProvider(record.provider) || !record.sale) return null
  return {
    orgId: String(record.orgId ?? ''),
    hostId: String(record.hostId ?? ''),
    orderId: String(record.orderId ?? ''),
    provider: record.provider,
    status: (['pending', 'committed', 'failed', 'voided'] as const).includes(record.status)
      ? record.status
      : 'pending',
    sale: record.sale as TaxCommitRequest,
    refunds: (record.refunds ?? {}) as StoredTaxEngineTransaction['refunds'],
    attempts: Number(record.attempts) || 0,
    fallbackReason: record.fallbackReason ? String(record.fallbackReason) : null,
    lastError: record.lastError ? String(record.lastError) : null,
    createdAtMs: Number(record.createdAtMs) || 0,
    updatedAtMs: Number(record.updatedAtMs) || 0,
  }
}

export function transactionView(transaction: StoredTaxEngineTransaction): TaxEngineTransactionView {
  const refunds = Object.values(transaction.refunds)
  return {
    orderId: transaction.orderId,
    provider: transaction.provider,
    providerLabel: TAX_ENGINE_PROVIDER_LABELS[transaction.provider],
    status: transaction.status,
    code: transaction.sale.code,
    taxCents: transaction.sale.collectedTaxCents,
    refundedCents: refunds.reduce((sum, refund) => sum + refund.amountCents, 0),
    refunds: refunds.length,
    fallbackReason: transaction.fallbackReason,
    lastError: transaction.lastError,
    updatedAtMs: transaction.updatedAtMs,
  }
}
