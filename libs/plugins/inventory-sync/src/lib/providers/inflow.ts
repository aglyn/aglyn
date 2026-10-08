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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { InventoryLocation } from '../model/inventory-sync'
import { decimalToMinor, minorToDecimal } from '../model/money'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import { nameUuid } from './ids'
import type { InventoryCredential, InventorySystemProvider, SystemProduct, SystemStock } from './provider'

/**
 * INFLOW INVENTORY, the inFlow Cloud API (AGL-3642), on the merchant's OWN
 * account: the company id and an API key from Options → Integrations (the
 * account needs inFlow's API add-on). Every call carries the key as a bearer
 * token and the API version in `Accept`. inFlow allows 60 calls a minute,
 * with bursts to 300, and answers 429 past it.
 *
 * inFlow writes are PUTs of a whole record under an id the caller chooses, and
 * a second PUT under the same id updates the first. Every order, adjustment
 * and product we write takes an id derived from our own reference
 * ({@link nameUuid}), so a retry after a timeout is the same record, never a
 * second one.
 *
 * - Stock is read off each product's summary at a location: `quantityAvailable`
 *   (on hand less reserved) is what the store can sell.
 * - An order is a sales order with `source` naming the platform, recorded
 *   under the customer the merchant chose; a canceled one is quick-canceled.
 */

export const INFLOW_API_BASE = 'https://cloudapi.inflowinventory.com/'

/** The API version every call asks for. */
export const INFLOW_API_VERSION = '2026-09-29'

const PAGE = 100

type InflowCredential = Extract<InventoryCredential, { provider: 'inflow' }>

function asInflow(credential: InventoryCredential): InflowCredential {
  if (credential.provider !== 'inflow') throw new ProviderError('auth', 'This connection is not an inFlow connection')
  return credential
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function createInflowProvider(options: { http: ProviderHttp; base?: string }): InventorySystemProvider {
  const base = options.base ?? INFLOW_API_BASE

  const call = (
    credential: InventoryCredential,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    retry = true,
  ) => {
    const { companyId, apiKey } = asInflow(credential)
    return providerRequest(options.http, {
      provider: 'inFlow',
      method,
      url: `${base}${encodeURIComponent(companyId)}/${path}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: `application/json;version=${INFLOW_API_VERSION}`,
      },
      ...(body === undefined ? {} : { body }),
      retry,
    })
  }

  const query = (params: Record<string, string | number | null | undefined>) =>
    new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ).toString()

  /** Every active product with a SKU, a page at a time. */
  async function* productPages(
    credential: InventoryCredential,
    extra: Record<string, string | null> = {},
    startAfter: string | null = null,
  ): AsyncGenerator<any[]> {
    let after = startAfter
    for (;;) {
      const page = await call(
        credential,
        'GET',
        `products?${query({ count: PAGE, sort: 'productId', after, 'filter[isActive]': 'true', ...extra })}`,
      )
      const list: any[] = Array.isArray(page) ? page : []
      yield list
      if (list.length < PAGE) return
      after = String(list[list.length - 1]?.productId ?? '')
      if (!after) return
    }
  }

  async function customerId(credential: InventoryCredential, name: string): Promise<string | null> {
    const list = await call(credential, 'GET', `customers?${query({ count: 10, 'filter[name]': name })}`)
    const match = (Array.isArray(list) ? list : []).find(
      (entry: any) => String(entry?.name ?? '').trim().toLowerCase() === name.trim().toLowerCase(),
    )
    return match?.customerId ? String(match.customerId) : null
  }

  return {
    id: 'inflow',

    async account(credential) {
      // inFlow has no endpoint that names the company; reading its locations proves the key.
      await call(credential, 'GET', `locations?${query({ count: 1 })}`)
      return { accountName: null }
    },

    async locations(credential): Promise<InventoryLocation[]> {
      const list = await call(credential, 'GET', `locations?${query({ count: PAGE, 'filter[isActive]': 'true' })}`)
      return (Array.isArray(list) ? list : [])
        .filter((entry: any) => entry?.locationId)
        .map((entry: any) => ({ id: String(entry.locationId), name: String(entry.name ?? entry.locationId) }))
    },

    async stock(credential, input): Promise<SystemStock[]> {
      const stock: SystemStock[] = []
      for await (const page of productPages(credential, { include: 'inventoryLines' })) {
        const products = page.filter((product) => product?.productId && String(product?.sku ?? '').trim())
        if (!products.length) continue
        if (input.locationId) {
          const summaries = await call(
            credential,
            'POST',
            'products/summary',
            products.map((product) => ({ productId: product.productId, locationId: input.locationId })),
          )
          const byId = new Map<string, any>(
            (Array.isArray(summaries) ? summaries : []).map((entry: any) => [String(entry?.productId), entry]),
          )
          for (const product of products) {
            const summary = byId.get(String(product.productId))
            stock.push({
              sku: String(product.sku).trim(),
              productId: String(product.productId),
              available: Math.max(0, Math.floor(num(summary?.quantityAvailable))),
              onHand: Math.floor(num(summary?.quantityOnHand)),
            })
          }
        } else {
          // All locations: what each product holds, from its inventory lines.
          for (const product of products) {
            const lines: any[] = Array.isArray(product.inventoryLines) ? product.inventoryLines : []
            const onHand = lines.reduce((sum, line) => sum + num(line?.quantityOnHand), 0)
            stock.push({
              sku: String(product.sku).trim(),
              productId: String(product.productId),
              available: Math.max(0, Math.floor(onHand)),
              onHand: Math.floor(onHand),
            })
          }
        }
        if (stock.length >= input.max) break
      }
      return stock.slice(0, input.max)
    },

    async adjustStock(credential, input) {
      if (!input.changes.length) return
      await call(
        credential,
        'PUT',
        'stock-adjustments',
        {
          stockAdjustmentId: nameUuid(`adjustment:${input.reference}`),
          locationId: input.locationId,
          date: new Date().toISOString(),
          remarks: `${PLATFORM_BRAND_NAME} stock sync ${input.reference}`,
          lines: input.changes.map((change) => ({
            stockAdjustmentLineId: nameUuid(`adjustment:${input.reference}:${change.sku}`),
            productId: change.productId,
            quantity: { standardQuantity: String(change.delta) },
          })),
        },
        false,
      )
    },

    async products(credential, input) {
      const filter = input.sinceMs
        ? { 'filter[lastModifiedDateTime]': JSON.stringify({ fromDate: new Date(input.sinceMs).toISOString().slice(0, 10) }) }
        : {}
      const limit = Math.min(PAGE, Math.max(1, input.limit))
      const page = await call(
        credential,
        'GET',
        `products?${query({ count: limit, sort: 'productId', after: input.cursor, include: 'defaultPrice', 'filter[isActive]': 'true', ...filter })}`,
      )
      const list: any[] = Array.isArray(page) ? page : []
      const products: SystemProduct[] = list
        .filter((product) => product?.productId && String(product?.sku ?? '').trim())
        .map((product) => ({
          id: String(product.productId),
          sku: String(product.sku).trim(),
          name: String(product.name ?? product.sku).trim(),
          description: String(product.description ?? '').trim(),
          priceMinor:
            product.defaultPrice?.priceType === 'FixedMarkup'
              ? null
              : decimalToMinor(product.defaultPrice?.unitPrice, input.currency),
          // inFlow keeps weight in the account's own unit, which the API does not name.
          weightGrams: null,
          barcode: product.barcode ? String(product.barcode) : null,
          version: String(product.timestamp ?? product.lastModifiedDateTime ?? ''),
          active: product.isActive !== false,
        }))
      const last = list[list.length - 1]?.productId
      return { products, nextCursor: list.length === limit && last ? String(last) : null }
    },

    async productIdsBySku(credential, skus) {
      const found = new Map<string, string>()
      for (const sku of skus) {
        const list = await call(credential, 'GET', `products?${query({ count: 10, 'filter[smart]': sku })}`)
        const match = (Array.isArray(list) ? list : []).find((product: any) => String(product?.sku ?? '') === sku)
        if (match?.productId) found.set(sku, String(match.productId))
      }
      return found
    },

    async createProduct(credential, product) {
      const productId = nameUuid(`product:${product.sku}`)
      const answer = await call(
        credential,
        'PUT',
        'products',
        {
          productId,
          name: product.name,
          sku: product.sku,
          description: product.description,
          itemType: 'StockedProduct',
          isActive: true,
          ...(product.barcode ? { barcode: product.barcode } : {}),
        },
        false,
      )
      return { id: String(answer?.productId ?? productId) }
    },

    async customerExists(credential, customer) {
      return (await customerId(credential, customer)) !== null
    },

    async findOrder(credential, reference) {
      try {
        const order = await call(credential, 'GET', `sales-orders/${nameUuid(`order:${reference}`)}`)
        if (!order?.salesOrderId) return null
        return { id: String(order.salesOrderId), number: order.orderNumber ? String(order.orderNumber) : null }
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'not-found') return null
        throw error
      }
    },

    async createOrder(credential, request) {
      const customer = await customerId(credential, request.customer)
      if (!customer) {
        throw new ProviderError('invalid', `inFlow has no customer named “${request.customer}”. Choose one in the connection’s settings.`)
      }
      const salesOrderId = nameUuid(`order:${request.reference}`)
      const address = request.shippingAddress
      const currency = request.currency
      const answer = await call(
        credential,
        'PUT',
        'sales-orders',
        {
          salesOrderId,
          customerId: customer,
          source: PLATFORM_BRAND_NAME,
          orderDate: new Date(request.orderedAtMs).toISOString(),
          ...(request.locationId ? { locationId: request.locationId } : {}),
          poNumber: request.reference,
          isQuote: false,
          isTaxInclusive: false,
          ...(request.buyerName ? { contactName: request.buyerName } : {}),
          ...(request.buyerEmail ? { email: request.buyerEmail } : {}),
          ...(address?.phone ? { phone: address.phone } : {}),
          ...(address
            ? {
                shipToCompanyName: address.name ?? '',
                shippingAddress: {
                  address1: address.line1 ?? '',
                  address2: address.line2 ?? '',
                  city: address.city ?? '',
                  state: address.state ?? '',
                  postalCode: address.postalCode ?? '',
                  country: address.country ?? '',
                },
              }
            : {}),
          orderFreight: minorToDecimal(request.shippingCents, currency),
          orderRemarks: [
            `${PLATFORM_BRAND_NAME} order ${request.displayRef} (${request.reference}).`,
            request.discountCents > 0 ? `Discount ${minorToDecimal(request.discountCents, currency)} ${currency}.` : null,
            request.taxCents > 0 ? `Tax collected by the store ${minorToDecimal(request.taxCents, currency)} ${currency}.` : null,
            `Total paid ${minorToDecimal(request.totalCents, currency)} ${currency}.`,
          ]
            .filter(Boolean)
            .join(' '),
          lines: request.lines.map((line, index) => ({
            salesOrderLineId: nameUuid(`order:${request.reference}:line:${index}`),
            productId: line.productId,
            description: line.name,
            quantity: { standardQuantity: String(line.quantity), uomQuantity: String(line.quantity) },
            unitPrice: minorToDecimal(line.unitAmountCents, currency),
          })),
        },
        false,
      )
      return { id: String(answer?.salesOrderId ?? salesOrderId), number: answer?.orderNumber ? String(answer.orderNumber) : null }
    },

    async cancelOrder(credential, order) {
      try {
        await call(credential, 'POST', `sales-orders/${encodeURIComponent(order.id)}/quick-cancel`, {}, false)
        return 'canceled'
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid') return 'too_late'
        throw error
      }
    },
  }
}
