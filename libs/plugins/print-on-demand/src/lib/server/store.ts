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
import { needsReseal, openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import type { Firestore } from 'firebase-admin/firestore'
import { POD_COLLECTIONS } from '../constants/bundle-common'
import {
  isPodProvider,
  POD_PROVIDER_LABELS,
  type PodConnectionView,
  type PodLinkedVariant,
  type PodOrderCosts,
  type PodOrderStatus,
  type PodOrderView,
  type PodProductLinkView,
  type PodProviderId,
  type PodSubmitMode,
} from '../model/print-on-demand'
import type { PodCredentials } from '../providers/types'

/**
 * Where print-on-demand's state lives (AGL-3641). THREE TOP-LEVEL
 * collections, each document carrying `orgId` and `hostId`, every one closed
 * to every client by the Firestore rules — staff included — because one
 * holds a merchant's sealed token and the others decide what a service is
 * told to make. Top level so org erasure removes them by `orgId`, and so the
 * host catch-all's client grants never reach them.
 *
 *   podConnections/{hostId}__{provider}                  the token, sealed
 *   podProductLinks/{hostId}__{provider}__{sourceProduct} an imported product
 *   podOrders/{hostId}__{orderId}__{provider}            an order's part at a service
 *
 * No document holds a buyer's address or email: an order is sent with the
 * address read from the order itself at the moment it is sent. Secrets'
 * field names carry `token`: the personal-data export redacts by name first.
 */

let override: unknown = null

export function podDb(): Firestore {
  return (override ?? firebaseAdmin.app().firestore()) as Firestore
}

/** Test seam. */
export function setPodDbForTests(db: unknown): void {
  override = db
}

/** Whether a client-supplied id is one Firestore will take as a document id. */
export function isDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 300 &&
    !value.includes('/') &&
    !/^__.*__$/.test(value) &&
    value !== '.' &&
    value !== '..'
  )
}

/* ------------------------------------------------------------ connections */

export interface StoredPodConnection {
  orgId: string
  hostId: string
  provider: PodProviderId
  storeId: string
  storeName: string
  currency: string
  sealedApiToken: string
  apiTokenKeyId: string
  /** The secret a webhook proves itself with: in its URL, and Printify's signing key. */
  sealedWebhookToken: string
  submitMode: PodSubmitMode
  syncPrices: boolean
  webhooks: 'registered' | 'polling'
  webhookDetail: string | null
  lastError: string | null
  connectedByUid: string
  connectedAtMs: number
  updatedAtMs: number
}

export function connectionId(hostId: string, provider: PodProviderId): string {
  return `${hostId}__${provider}`
}

export function connectionRef(hostId: string, provider: PodProviderId) {
  return podDb().collection(POD_COLLECTIONS.connections).doc(connectionId(hostId, provider))
}

function sealContext(hostId: string, provider: PodProviderId, field: string): string {
  return `${POD_COLLECTIONS.connections}/${connectionId(hostId, provider)}#${field}`
}

/** A secret sealed so a copy pasted into another site's document will not open. */
export function sealConnectionSecrets(
  secrets: { apiToken?: string; webhookToken?: string },
  hostId: string,
  provider: PodProviderId,
  keyring: SecretBoxKeyring,
): Record<string, string> {
  const sealed: Record<string, string> = {}
  if (secrets.apiToken !== undefined) {
    sealed['sealedApiToken'] = sealSecret(secrets.apiToken, keyring.current, { context: sealContext(hostId, provider, 'apiToken') })
    sealed['apiTokenKeyId'] = keyring.current.id
  }
  if (secrets.webhookToken !== undefined) {
    sealed['sealedWebhookToken'] = sealSecret(secrets.webhookToken, keyring.current, {
      context: sealContext(hostId, provider, 'webhookToken'),
    })
  }
  return sealed
}

export function readStoredConnection(data: unknown): StoredPodConnection | null {
  const record = (data ?? null) as Record<string, any> | null
  if (!record || !isPodProvider(record.provider) || typeof record.sealedApiToken !== 'string' || !record.sealedApiToken) return null
  return {
    orgId: String(record.orgId ?? ''),
    hostId: String(record.hostId ?? ''),
    provider: record.provider,
    storeId: String(record.storeId ?? ''),
    storeName: String(record.storeName ?? ''),
    currency: String(record.currency ?? 'USD').toUpperCase(),
    sealedApiToken: record.sealedApiToken,
    apiTokenKeyId: String(record.apiTokenKeyId ?? ''),
    sealedWebhookToken: String(record.sealedWebhookToken ?? ''),
    submitMode: record.submitMode === 'review' ? 'review' : 'automatic',
    syncPrices: record.syncPrices === true,
    webhooks: record.webhooks === 'registered' ? 'registered' : 'polling',
    webhookDetail: record.webhookDetail ? String(record.webhookDetail) : null,
    lastError: record.lastError ? String(record.lastError) : null,
    connectedByUid: String(record.connectedByUid ?? ''),
    connectedAtMs: Number(record.connectedAtMs) || 0,
    updatedAtMs: Number(record.updatedAtMs) || 0,
  }
}

export async function readConnection(hostId: string, provider: PodProviderId): Promise<StoredPodConnection | null> {
  if (!isDocumentId(hostId)) return null
  const snapshot = await connectionRef(hostId, provider).get()
  return snapshot.exists ? readStoredConnection(snapshot.data()) : null
}

export async function readConnections(hostId: string): Promise<StoredPodConnection[]> {
  const found = await Promise.all((['printful', 'printify'] as const).map((provider) => readConnection(hostId, provider)))
  return found.filter((connection): connection is StoredPodConnection => connection !== null)
}

export function connectionView(connection: StoredPodConnection): PodConnectionView {
  return {
    provider: connection.provider,
    providerLabel: POD_PROVIDER_LABELS[connection.provider],
    storeId: connection.storeId,
    storeName: connection.storeName,
    currency: connection.currency,
    submitMode: connection.submitMode,
    syncPrices: connection.syncPrices,
    webhooks: connection.webhooks,
    webhookDetail: connection.webhookDetail,
    lastError: connection.lastError,
    connectedAtMs: connection.connectedAtMs,
    updatedAtMs: connection.updatedAtMs,
  }
}

function openField(connection: StoredPodConnection, keyring: SecretBoxKeyring, field: 'apiToken' | 'webhookToken'): string {
  const sealed = field === 'apiToken' ? connection.sealedApiToken : connection.sealedWebhookToken
  const opened = openSecret(sealed, keyring, { context: sealContext(connection.hostId, connection.provider, field) })
  if (needsReseal(opened, keyring)) {
    connectionRef(connection.hostId, connection.provider)
      .set(sealConnectionSecrets({ [field]: opened.plaintext }, connection.hostId, connection.provider, keyring), { merge: true })
      .catch(() => undefined)
  }
  return opened.plaintext
}

/** Opens the token for one call. Throws `SecretBoxError` when it cannot be opened. */
export function openCredentials(connection: StoredPodConnection, keyring: SecretBoxKeyring): PodCredentials {
  return { token: openField(connection, keyring, 'apiToken'), storeId: connection.storeId || null }
}

/** The webhook secret, or `null` when the connection has none or it cannot be opened. */
export function openWebhookToken(connection: StoredPodConnection, keyring: SecretBoxKeyring): string | null {
  if (!connection.sealedWebhookToken) return null
  try {
    return openField(connection, keyring, 'webhookToken')
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ links */

export interface StoredPodLink {
  orgId: string
  hostId: string
  provider: PodProviderId
  productId: string
  sourceProductId: string
  name: string
  thumbnailUrl: string | null
  costCurrency: string
  variants: PodLinkedVariant[]
  importedByUid: string
  importedAtMs: number
  syncedAtMs: number
  syncDueAtMs: number
  lastError: string | null
}

export function linkId(hostId: string, provider: PodProviderId, sourceProductId: string): string {
  return `${hostId}__${provider}__${sourceProductId}`
}

export function linkRef(id: string) {
  return podDb().collection(POD_COLLECTIONS.links).doc(id)
}

export function readStoredLink(data: unknown): StoredPodLink | null {
  const record = (data ?? null) as Record<string, any> | null
  if (!record || !isPodProvider(record.provider) || !record.productId) return null
  return {
    orgId: String(record.orgId ?? ''),
    hostId: String(record.hostId ?? ''),
    provider: record.provider,
    productId: String(record.productId),
    sourceProductId: String(record.sourceProductId ?? ''),
    name: String(record.name ?? ''),
    thumbnailUrl: record.thumbnailUrl ? String(record.thumbnailUrl) : null,
    costCurrency: String(record.costCurrency ?? 'USD'),
    variants: (Array.isArray(record.variants) ? record.variants : []).map((variant: any) => ({
      variantId: String(variant?.variantId ?? ''),
      sourceVariantId: String(variant?.sourceVariantId ?? ''),
      name: String(variant?.name ?? ''),
      sku: variant?.sku ? String(variant.sku) : null,
      costMinor: Number.isFinite(Number(variant?.costMinor)) && variant?.costMinor !== null ? Number(variant.costMinor) : null,
      retailMinor: Number(variant?.retailMinor) || 0,
      available: variant?.available !== false,
    })),
    importedByUid: String(record.importedByUid ?? ''),
    importedAtMs: Number(record.importedAtMs) || 0,
    syncedAtMs: Number(record.syncedAtMs) || 0,
    syncDueAtMs: Number(record.syncDueAtMs) || 0,
    lastError: record.lastError ? String(record.lastError) : null,
  }
}

export function linkView(id: string, link: StoredPodLink): PodProductLinkView {
  return {
    id,
    provider: link.provider,
    providerLabel: POD_PROVIDER_LABELS[link.provider],
    productId: link.productId,
    sourceProductId: link.sourceProductId,
    name: link.name,
    thumbnailUrl: link.thumbnailUrl,
    costCurrency: link.costCurrency,
    variants: link.variants,
    importedAtMs: link.importedAtMs,
    syncedAtMs: link.syncedAtMs,
    lastError: link.lastError,
  }
}

/** The links for some of a site's products, by product id. */
export async function readLinksForProducts(hostId: string, productIds: readonly string[]): Promise<Map<string, { id: string; link: StoredPodLink }>> {
  const found = new Map<string, { id: string; link: StoredPodLink }>()
  const unique = [...new Set(productIds.filter((id) => isDocumentId(id)))]
  for (let at = 0; at < unique.length; at += 30) {
    const snapshot = await podDb()
      .collection(POD_COLLECTIONS.links)
      .where('hostId', '==', hostId)
      .where('productId', 'in', unique.slice(at, at + 30))
      .get()
    for (const doc of snapshot.docs) {
      const link = readStoredLink(doc.data())
      if (link) found.set(link.productId, { id: doc.id, link })
    }
  }
  return found
}

/* ----------------------------------------------------------------- orders */

/** What the job does next for an order's part at a service. */
export type PodOrderWork = 'submit' | 'poll' | 'cancel' | null

export interface StoredPodOrderLine {
  lineIndex: number
  name: string
  quantity: number
  sourceProductId: string
  sourceVariantId: string
  /** What the buyer paid per unit, in the store's currency. */
  retailMinor: number
  /** The service's price per unit when the order was routed, in the link's currency. */
  costMinor: number | null
}

export interface StoredPodShipment {
  id: string
  carrier: string
  trackingNumber: string
  trackingUrl: string | null
  /** Written onto the store's order as a shipment. */
  recorded: boolean
  /** Why the store's order refused it, when it did. */
  refusal: string | null
  deliveredAtMs: number | null
  deliveredRecorded: boolean
  /** The store's lines it carried, once written. */
  lineIndexes?: number[]
}

export interface StoredPodOrder {
  orgId: string
  hostId: string
  orderId: string
  orderRef: string
  provider: PodProviderId
  storeId: string
  status: PodOrderStatus
  testMode: boolean
  /** The store's key for the order at the service. */
  externalId: string
  sourceOrderId: string | null
  /** `{provider}:{storeId}:{sourceOrderId}`: what a webhook finds the part by. */
  sourceOrderKey: string | null
  rawStatus: string | null
  dashboardUrl: string | null
  lines: StoredPodOrderLine[]
  retailCurrency: string
  costs: PodOrderCosts | null
  shipments: StoredPodShipment[]
  attempts: number
  lastError: string | null
  work: PodOrderWork
  dueAtMs: number
  /** A send in flight holds the part until then, so two doors never send it twice. */
  leaseUntilMs: number
  createdAtMs: number
  updatedAtMs: number
}

export function podOrderId(hostId: string, orderId: string, provider: PodProviderId): string {
  return `${hostId}__${orderId}__${provider}`
}

export function podOrderRef(id: string) {
  return podDb().collection(POD_COLLECTIONS.orders).doc(id)
}

export function readStoredPodOrder(data: unknown): StoredPodOrder | null {
  const record = (data ?? null) as Record<string, any> | null
  if (!record || !isPodProvider(record.provider) || !record.orderId) return null
  return {
    orgId: String(record.orgId ?? ''),
    hostId: String(record.hostId ?? ''),
    orderId: String(record.orderId),
    orderRef: String(record.orderRef ?? record.orderId),
    provider: record.provider,
    storeId: String(record.storeId ?? ''),
    status: String(record.status ?? 'queued') as PodOrderStatus,
    testMode: record.testMode === true,
    externalId: String(record.externalId ?? ''),
    sourceOrderId: record.sourceOrderId ? String(record.sourceOrderId) : null,
    sourceOrderKey: record.sourceOrderKey ? String(record.sourceOrderKey) : null,
    rawStatus: record.rawStatus ? String(record.rawStatus) : null,
    dashboardUrl: record.dashboardUrl ? String(record.dashboardUrl) : null,
    lines: Array.isArray(record.lines) ? (record.lines as StoredPodOrderLine[]) : [],
    retailCurrency: String(record.retailCurrency ?? 'USD'),
    costs: record.costs ? (record.costs as PodOrderCosts) : null,
    shipments: Array.isArray(record.shipments) ? (record.shipments as StoredPodShipment[]) : [],
    attempts: Number(record.attempts) || 0,
    lastError: record.lastError ? String(record.lastError) : null,
    work: (['submit', 'poll', 'cancel'] as const).includes(record.work) ? record.work : null,
    dueAtMs: Number(record.dueAtMs) || 0,
    leaseUntilMs: Number(record.leaseUntilMs) || 0,
    createdAtMs: Number(record.createdAtMs) || 0,
    updatedAtMs: Number(record.updatedAtMs) || 0,
  }
}

/** What the merchant can do with the part now. */
export function podOrderActions(order: StoredPodOrder): PodOrderView['actions'] {
  switch (order.status) {
    case 'queued':
      return order.sourceOrderId ? ['refresh', 'cancel'] : ['retry', 'cancel']
    case 'failed':
      return order.sourceOrderId ? ['refresh', 'cancel'] : ['retry']
    case 'draft':
      return order.testMode ? ['refresh', 'cancel'] : ['confirm', 'refresh', 'cancel']
    case 'submitted':
    case 'on_hold':
      return ['refresh', 'cancel']
    case 'in_production':
    case 'partially_shipped':
      return ['refresh']
    default:
      return []
  }
}

export function podOrderView(id: string, order: StoredPodOrder): PodOrderView {
  return {
    id,
    orderId: order.orderId,
    orderRef: order.orderRef,
    provider: order.provider,
    providerLabel: POD_PROVIDER_LABELS[order.provider],
    status: order.status,
    testMode: order.testMode,
    sourceOrderId: order.sourceOrderId,
    dashboardUrl: order.dashboardUrl,
    lines: order.lines.map((line) => ({
      lineIndex: line.lineIndex,
      name: line.name,
      quantity: line.quantity,
      costMinor: line.costMinor,
    })),
    retailMinor: order.lines.reduce((sum, line) => sum + line.retailMinor * line.quantity, 0),
    retailCurrency: order.retailCurrency,
    costs: order.costs,
    shipments: order.shipments.map((shipment) => ({
      id: shipment.id,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      recorded: shipment.recorded,
      deliveredAtMs: shipment.deliveredAtMs,
    })),
    attempts: order.attempts,
    lastError: order.lastError,
    actions: podOrderActions(order),
    createdAtMs: order.createdAtMs,
    updatedAtMs: order.updatedAtMs,
  }
}
