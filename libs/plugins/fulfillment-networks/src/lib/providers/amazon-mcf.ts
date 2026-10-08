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

import type { PluginTrackingStatus } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import type { NetworkMarketplace } from '../model/networks'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import type {
  FulfillmentNetworkProvider,
  NetworkCredential,
  NetworkOrder,
  NetworkShipment,
  NetworkStock,
} from './provider'

/**
 * AMAZON MULTI-CHANNEL FULFILLMENT (AGL-3634), through the Selling Partner
 * API with the seller's Login with Amazon grant (`server/oauth.ts`): the
 * Fulfillment Outbound API (2020-07-01) for orders and package tracking, the
 * FBA Inventory API for counts, and the Sellers API for the marketplaces at
 * connect. Calls carry the access token in `x-amz-access-token`; SP-API has
 * not required request signing since October 2023.
 *
 * - Amazon keys a fulfillment order by OUR id (`sellerFulfillmentOrderId`),
 *   so the reference is the id, a lookup is a GET of it, and a second create
 *   of the same id is refused rather than shipped twice.
 * - Each order item carries `line-{index}` as its item id, so a shipment
 *   names the order line it holds without a SKU match.
 * - One Amazon shipment may leave in several packages; each package is one
 *   parcel with its own tracking number, read by package number.
 */

export type AmazonRegion = 'na' | 'eu' | 'fe'

export const AMAZON_API_HOSTS: Readonly<Record<AmazonRegion, { live: string; sandbox: string }>> = {
  na: { live: 'https://sellingpartnerapi-na.amazon.com', sandbox: 'https://sandbox.sellingpartnerapi-na.amazon.com' },
  eu: { live: 'https://sellingpartnerapi-eu.amazon.com', sandbox: 'https://sandbox.sellingpartnerapi-eu.amazon.com' },
  fe: { live: 'https://sellingpartnerapi-fe.amazon.com', sandbox: 'https://sandbox.sellingpartnerapi-fe.amazon.com' },
}

const OUTBOUND = '/fba/outbound/2020-07-01'
const SKUS_PER_LOOKUP = 50

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const timeMs = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** Amazon's package status, in the carrier-neutral word the order records. */
export function amazonTrackingStatus(status: unknown): PluginTrackingStatus | null {
  switch (String(status ?? '')) {
    case 'PICKUP_SCHEDULED':
    case 'PICKUP_ATTEMPTED':
    case 'PICKUP_SUCCESSFUL':
      return 'pre_transit'
    case 'IN_TRANSIT':
    case 'DELAYED':
      return 'in_transit'
    case 'OUT_FOR_DELIVERY':
    case 'AVAILABLE_FOR_PICKUP':
      return 'out_for_delivery'
    case 'DELIVERED':
      return 'delivered'
    case 'UNDELIVERABLE':
    case 'DELIVERY_ATTEMPTED':
    case 'CUSTOMER_ACTION':
    case 'PICKUP_CANCELLED':
      return 'exception'
    case 'RETURNING':
    case 'RETURNED':
    case 'RETURN_REQUEST_ACCEPTED':
    case 'RETURN_RECEIVED_IN_FC':
    case 'REFUND_ISSUED':
      return 'returned'
    default:
      return null
  }
}

const lineOf = (itemId: unknown): number | undefined => {
  const match = /^line-(\d{1,4})$/.exec(String(itemId ?? ''))
  return match ? Number(match[1]) : undefined
}

/** The fulfillment order as the engine reads it. */
export function readAmazonOrder(payload: any): NetworkOrder {
  const order = payload?.fulfillmentOrder ?? {}
  const status = String(order.fulfillmentOrderStatus ?? '')
  const shipments: NetworkShipment[] = []
  for (const shipment of Array.isArray(payload?.fulfillmentShipments) ? payload.fulfillmentShipments : []) {
    if (String(shipment?.fulfillmentShipmentStatus ?? '') !== 'SHIPPED') continue
    const items: any[] = Array.isArray(shipment.fulfillmentShipmentItem) ? shipment.fulfillmentShipmentItem : []
    for (const parcel of Array.isArray(shipment.fulfillmentShipmentPackage) ? shipment.fulfillmentShipmentPackage : []) {
      const packageNumber = String(parcel?.packageNumber ?? '')
      shipments.push({
        id: `${shipment.amazonShipmentId}:${packageNumber}`,
        carrier: text(parcel?.carrierCode),
        trackingNumber: text(parcel?.trackingNumber),
        trackingUrl: null,
        items: items
          .filter((item) => String(item?.packageNumber ?? '') === packageNumber)
          .map((item) => ({
            sku: String(item?.sellerSku ?? ''),
            quantity: Math.max(0, Number(item?.quantity) || 0),
            ...(lineOf(item?.sellerFulfillmentOrderItemId) !== undefined
              ? { lineIndex: lineOf(item?.sellerFulfillmentOrderItemId) }
              : {}),
          }))
          .filter((item) => item.quantity > 0),
        trackingStatus: 'in_transit',
        trackingDetail: null,
        shippedAtMs: timeMs(shipment?.shippingDate),
        packageNumber,
      })
    }
  }
  const refused = status === 'Unfulfillable' || status === 'Invalid'
  return {
    id: String(order.sellerFulfillmentOrderId ?? ''),
    reference: String(order.sellerFulfillmentOrderId ?? ''),
    state:
      status === 'Cancelled'
        ? 'canceled'
        : status === 'Complete' || status === 'CompletePartialled'
          ? 'shipped'
          : refused
            ? 'refused'
            : 'open',
    detail: refused
      ? `Amazon could not fulfill the order (${status}). Check the SKUs’ FBA stock and the address.`
      : null,
    shipments,
  }
}

const notFound = (error: unknown): boolean =>
  error instanceof ProviderError &&
  (error.kind === 'not-found' ||
    (error.kind === 'invalid' && /not found|does not exist|no fulfillment order/i.test(error.message)))

export function createAmazonMcfProvider(options: {
  http: ProviderHttp
  region: AmazonRegion
  sandbox: boolean
}): FulfillmentNetworkProvider {
  const hosts = AMAZON_API_HOSTS[options.region] ?? AMAZON_API_HOSTS.na
  const base = options.sandbox ? hosts.sandbox : hosts.live
  const call = (
    credential: NetworkCredential,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    extra: { retry?: boolean } = {},
  ) =>
    providerRequest(options.http, {
      provider: 'Amazon',
      method,
      url: `${base}${path}`,
      headers: {
        'x-amz-access-token': credential.accessToken,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      ...extra,
    })

  const marketplace = (credential: NetworkCredential): string => {
    if (!credential.marketplaceId) throw new ProviderError('invalid', 'Choose the Amazon marketplace whose inventory ships first')
    return credential.marketplaceId
  }

  const getOrder = async (credential: NetworkCredential, reference: string): Promise<NetworkOrder> => {
    const answer = await call(credential, 'GET', `${OUTBOUND}/fulfillmentOrders/${encodeURIComponent(reference)}`)
    return readAmazonOrder(answer?.payload)
  }

  const summaries = async (credential: NetworkCredential, query: Record<string, string>) => {
    const marketplaceId = marketplace(credential)
    const params = new URLSearchParams({
      details: 'true',
      granularityType: 'Marketplace',
      granularityId: marketplaceId,
      marketplaceIds: marketplaceId,
      ...query,
    })
    const answer = await call(credential, 'GET', `/fba/inventory/v1/summaries?${params.toString()}`)
    const list: any[] = Array.isArray(answer?.payload?.inventorySummaries) ? answer.payload.inventorySummaries : []
    return {
      stock: list
        .map((entry) => ({
          sku: String(entry?.sellerSku ?? ''),
          fulfillable: Math.max(0, Number(entry?.inventoryDetails?.fulfillableQuantity) || 0),
        }))
        .filter((entry) => entry.sku),
      nextToken: text(answer?.pagination?.nextToken),
    }
  }

  return {
    id: 'amazon-mcf',

    async account(credential) {
      const answer = await call(credential, 'GET', '/sellers/v1/marketplaceParticipations')
      const marketplaces: NetworkMarketplace[] = []
      let storeName: string | null = null
      for (const entry of Array.isArray(answer?.payload) ? answer.payload : []) {
        if (entry?.participation?.isParticipating === false) continue
        const id = text(entry?.marketplace?.id)
        if (!id) continue
        storeName = storeName ?? text(entry?.storeName)
        marketplaces.push({
          id,
          name: text(entry?.marketplace?.name) ?? id,
          countryCode: text(entry?.marketplace?.countryCode) ?? '',
        })
      }
      return { accountName: storeName, marketplaces }
    },

    async findOrder(credential, reference) {
      try {
        return await getOrder(credential, reference)
      } catch (error) {
        if (notFound(error)) return null
        throw error
      }
    },

    async createOrder(credential, request) {
      await call(
        credential,
        'POST',
        `${OUTBOUND}/fulfillmentOrders`,
        {
          marketplaceId: marketplace(credential),
          sellerFulfillmentOrderId: request.reference,
          displayableOrderId: request.displayRef.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || request.reference,
          displayableOrderDate: new Date(request.orderedAtMs).toISOString(),
          displayableOrderComment: 'Thank you for your order.',
          shippingSpeedCategory: request.shippingSpeed,
          fulfillmentAction: 'Ship',
          fulfillmentPolicy: 'FillOrKill',
          destinationAddress: {
            name: request.address.name.slice(0, 50),
            addressLine1: request.address.line1.slice(0, 60),
            ...(request.address.line2 ? { addressLine2: request.address.line2.slice(0, 60) } : {}),
            city: request.address.city.slice(0, 50),
            ...(request.address.state ? { stateOrRegion: request.address.state.slice(0, 50) } : {}),
            postalCode: request.address.postalCode.slice(0, 20),
            countryCode: request.address.country,
            ...(request.address.phone ? { phone: request.address.phone.slice(0, 20) } : {}),
          },
          items: request.items.map((item) => ({
            sellerSku: item.sku,
            sellerFulfillmentOrderItemId: `line-${item.lineIndex}`,
            quantity: item.quantity,
            perUnitDeclaredValue: {
              currencyCode: request.currency.toUpperCase(),
              value: (item.unitValueCents / 100).toFixed(2),
            },
          })),
        },
        { retry: false },
      )
      return getOrder(credential, request.reference)
    },

    getOrder: (credential, _id, reference) => getOrder(credential, reference),

    async cancelOrder(credential, _id, reference) {
      try {
        await call(credential, 'PUT', `${OUTBOUND}/fulfillmentOrders/${encodeURIComponent(reference)}/cancel`, undefined, {
          retry: false,
        })
        return 'canceled'
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid') return 'too_late'
        throw error
      }
    },

    async stock(credential, skus) {
      const wanted = [...new Set(skus.filter(Boolean))]
      const found: NetworkStock[] = []
      for (let index = 0; index < wanted.length; index += SKUS_PER_LOOKUP) {
        const chunk = wanted.slice(index, index + SKUS_PER_LOOKUP)
        const { stock } = await summaries(credential, { sellerSkus: chunk.join(',') })
        found.push(...stock.filter((entry) => chunk.includes(entry.sku)))
      }
      return found
    },

    async allStock(credential, max) {
      const found = new Map<string, number>()
      let nextToken: string | null = null
      for (let page = 0; page < 200 && found.size < max; page += 1) {
        const answer = await summaries(credential, nextToken ? { nextToken } : {})
        for (const entry of answer.stock) {
          if (found.size < max || found.has(entry.sku)) found.set(entry.sku, (found.get(entry.sku) ?? 0) + entry.fulfillable)
        }
        nextToken = answer.nextToken
        if (!nextToken) break
      }
      return [...found].map(([sku, fulfillable]) => ({ sku, fulfillable }))
    },

    async tracking(credential, shipment) {
      if (!shipment.packageNumber) return null
      const answer = await call(
        credential,
        'GET',
        `${OUTBOUND}/tracking?${new URLSearchParams({ packageNumber: shipment.packageNumber }).toString()}`,
      )
      const status = amazonTrackingStatus(answer?.payload?.currentStatus)
      return status ? { status, detail: text(answer?.payload?.currentStatusDescription) } : null
    },
  }
}
