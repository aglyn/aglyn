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
import { decimalToMinor, minorToMajor } from '../model/money'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import type {
  InventoryCredential,
  InventorySystemProvider,
  SystemOrder,
  SystemOrderRequest,
  SystemProduct,
  SystemStock,
} from './provider'

/**
 * CIN7 CORE (formerly DEAR Inventory), API v2 (AGL-3642), on the merchant's
 * OWN account: an Account ID and an application key they make under
 * Integrations → API, sent as `api-auth-accountid` and
 * `api-auth-applicationkey` on every call. Cin7 Core allows 60 calls a minute
 * per account and answers 429 past it.
 *
 * - Stock is `ref/productavailability`, one row per product, location, bin
 *   and batch; a SKU's count is the sum of its rows at the chosen location.
 *   A location is named by its name, which is what availability rows and
 *   stock-adjustment lines carry.
 * - An order is a sale (`POST sale`) whose order lines are written next
 *   (`POST sale/order`, authorised). The sale carries our reference as its
 *   `CustomerReference`, which `saleList` searches, so a sale whose lines did
 *   not land is found and finished rather than made twice.
 * - A canceled order is voided (`DELETE sale?Void=true`); Cin7 Core refuses
 *   once it has shipped.
 */

export const CIN7_CORE_API_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2/'

const PAGE_LIMIT = 1000
const PRODUCT_PAGE_LIMIT = 100

type Cin7Credential = Extract<InventoryCredential, { provider: 'cin7-core' }>

function asCin7(credential: InventoryCredential): Cin7Credential {
  if (credential.provider !== 'cin7-core') throw new ProviderError('auth', 'This connection is not a Cin7 Core connection')
  return credential
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** A weight in Cin7 Core's units, in grams; `null` when it has none. */
export function cin7WeightGrams(weight: unknown, units: unknown): number | null {
  const value = num(weight)
  if (!(value > 0)) return null
  const unit = String(units ?? 'g').toLowerCase()
  const factor = unit === 'kg' ? 1000 : unit === 'lb' || unit === 'lbs' ? 453.592 : unit === 'oz' ? 28.3495 : 1
  return Math.round(value * factor)
}

export function createCin7CoreProvider(options: { http: ProviderHttp; base?: string }): InventorySystemProvider {
  const base = options.base ?? CIN7_CORE_API_BASE

  const call = (
    credential: InventoryCredential,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    retry = true,
  ) => {
    const { accountId, apiKey } = asCin7(credential)
    return providerRequest(options.http, {
      provider: 'Cin7 Core',
      method,
      url: `${base}${path}`,
      headers: {
        'api-auth-accountid': accountId,
        'api-auth-applicationkey': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
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

  async function findSale(credential: InventoryCredential, reference: string): Promise<(SystemOrder & { incomplete: boolean }) | null> {
    const answer = await call(credential, 'GET', `saleList?${query({ Page: 1, Limit: 25, Search: reference })}`)
    const sales: any[] = Array.isArray(answer?.SaleList) ? answer.SaleList : []
    const found = sales.find((sale) => String(sale?.CustomerReference ?? '') === reference)
    if (!found?.SaleID) return null
    const orderStatus = String(found.OrderStatus ?? '').toUpperCase()
    return {
      id: String(found.SaleID),
      number: found.OrderNumber ? String(found.OrderNumber) : null,
      // A sale whose order was never written reads NOT AVAILABLE.
      incomplete: !orderStatus || orderStatus === 'NOT AVAILABLE',
    }
  }

  async function writeOrderLines(credential: InventoryCredential, saleId: string, request: SystemOrderRequest): Promise<void> {
    const currency = request.currency
    const taxRule = request.taxRule ? { TaxRule: request.taxRule } : {}
    const charge = (description: string, cents: number) => ({
      Description: description,
      Quantity: 1,
      Price: minorToMajor(cents, currency),
      Discount: 0,
      Tax: 0,
      ...taxRule,
      Total: minorToMajor(cents, currency),
    })
    const charges = [
      ...(request.shippingCents > 0 ? [charge('Shipping', request.shippingCents)] : []),
      ...(request.taxCents > 0 ? [charge('Sales tax collected by the store', request.taxCents)] : []),
      ...(request.discountCents > 0 ? [charge('Discount', -request.discountCents)] : []),
    ]
    await call(
      credential,
      'POST',
      'sale/order',
      {
        SaleID: saleId,
        Status: 'AUTHORISED',
        Memo: `${PLATFORM_BRAND_NAME} order ${request.displayRef}`,
        Lines: request.lines.map((line) => ({
          ProductID: line.productId,
          SKU: line.sku,
          Name: line.name,
          Quantity: line.quantity,
          Price: minorToMajor(line.unitAmountCents, currency),
          Discount: 0,
          Tax: 0,
          ...taxRule,
          Total: minorToMajor(line.unitAmountCents * line.quantity, currency),
        })),
        AdditionalCharges: charges,
      },
      false,
    )
  }

  const provider: InventorySystemProvider & {
    findSale: typeof findSale
  } = {
    id: 'cin7-core',
    findSale,

    async account(credential) {
      const answer = await call(credential, 'GET', 'me')
      const name = String(answer?.Company ?? answer?.Name ?? '').trim()
      return { accountName: name || null }
    },

    async locations(credential): Promise<InventoryLocation[]> {
      const answer = await call(credential, 'GET', `ref/location?${query({ Page: 1, Limit: PAGE_LIMIT })}`)
      const list: any[] = Array.isArray(answer?.LocationList) ? answer.LocationList : []
      return list
        .filter((entry) => entry?.Name && entry?.IsDeprecated !== true)
        .map((entry) => ({ id: String(entry.Name), name: String(entry.Name) }))
    },

    async stock(credential, input): Promise<SystemStock[]> {
      const bySku = new Map<string, SystemStock>()
      for (let page = 1; ; page += 1) {
        const answer = await call(
          credential,
          'GET',
          `ref/productavailability?${query({ Page: page, Limit: PAGE_LIMIT, Location: input.locationId })}`,
        )
        const rows: any[] = Array.isArray(answer?.ProductAvailabilityList) ? answer.ProductAvailabilityList : []
        for (const row of rows) {
          const sku = String(row?.SKU ?? '').trim()
          if (!sku) continue
          if (input.locationId && String(row?.Location ?? '') !== input.locationId) continue
          const entry = bySku.get(sku) ?? { sku, productId: String(row?.ID ?? ''), available: 0, onHand: 0 }
          entry.available += num(row?.Available)
          entry.onHand += num(row?.OnHand)
          bySku.set(sku, entry)
        }
        const total = num(answer?.Total)
        if (!rows.length || page * PAGE_LIMIT >= total || bySku.size >= input.max) break
      }
      return [...bySku.values()].slice(0, input.max).map((entry) => ({
        ...entry,
        available: Math.max(0, Math.floor(entry.available)),
        onHand: Math.floor(entry.onHand),
      }))
    },

    async adjustStock(credential, input) {
      if (!input.changes.length) return
      const existing = input.changes.filter((change) => change.onHand > 0)
      const fresh = input.changes.filter((change) => change.onHand <= 0 && change.delta > 0)
      await call(
        credential,
        'POST',
        'stockadjustment',
        {
          EffectiveDate: new Date().toISOString(),
          Status: 'COMPLETED',
          Reference: input.reference,
          // A line for stock the location already holds states the new count.
          ExistingStockLines: existing.map((change) => ({
            ProductID: change.productId,
            SKU: change.sku,
            Location: input.locationId,
            Quantity: Math.max(0, change.onHand + change.delta),
          })),
          // Stock where the location holds none is received as new stock.
          NewStockLines: fresh.map((change) => ({
            ProductID: change.productId,
            SKU: change.sku,
            Location: input.locationId,
            Quantity: change.delta,
            UnitCost: 0,
          })),
        },
        false,
      )
    },

    async products(credential, input) {
      const page = Math.max(1, Number(input.cursor) || 1)
      const limit = Math.min(PRODUCT_PAGE_LIMIT, Math.max(1, input.limit))
      const answer = await call(
        credential,
        'GET',
        `product?${query({
          Page: page,
          Limit: limit,
          IncludeDeprecated: 'false',
          ModifiedSince: input.sinceMs ? new Date(input.sinceMs).toISOString() : null,
        })}`,
      )
      const list: any[] = Array.isArray(answer?.Products) ? answer.Products : []
      const products: SystemProduct[] = list
        .filter((product) => product?.ID && String(product?.SKU ?? '').trim())
        .map((product) => ({
          id: String(product.ID),
          sku: String(product.SKU).trim(),
          name: String(product.Name ?? product.SKU).trim(),
          description: String(product.Description ?? '').trim(),
          priceMinor: decimalToMinor(product.PriceTier1, input.currency),
          weightGrams: cin7WeightGrams(product.Weight, product.WeightUnits),
          barcode: product.Barcode ? String(product.Barcode) : null,
          version: String(product.LastModifiedOn ?? ''),
          active: String(product.Status ?? 'Active') === 'Active',
        }))
      const total = num(answer?.Total)
      return { products, nextCursor: list.length && page * limit < total ? String(page + 1) : null }
    },

    async productIdsBySku(credential, skus) {
      const found = new Map<string, string>()
      for (const sku of skus) {
        const answer = await call(credential, 'GET', `product?${query({ Page: 1, Limit: 5, Sku: sku })}`)
        const match = (Array.isArray(answer?.Products) ? answer.Products : []).find(
          (product: any) => String(product?.SKU ?? '') === sku,
        )
        if (match?.ID) found.set(sku, String(match.ID))
      }
      return found
    },

    async createProduct(credential, product) {
      const answer = await call(
        credential,
        'POST',
        'product',
        {
          SKU: product.sku,
          Name: product.name,
          Description: product.description,
          Type: 'Stock',
          CostingMethod: 'FIFO',
          UOM: 'Item',
          Status: 'Active',
          PriceTier1: minorToMajor(product.priceMinor, product.currency),
          ...(product.weightGrams ? { Weight: product.weightGrams, WeightUnits: 'g' } : {}),
          ...(product.barcode ? { Barcode: product.barcode } : {}),
        },
        false,
      )
      const id = answer?.ID ?? answer?.Products?.[0]?.ID
      if (!id) throw new ProviderError('invalid', 'Cin7 Core did not say which product it made')
      return { id: String(id) }
    },

    async customerExists(credential, customer) {
      const answer = await call(credential, 'GET', `customer?${query({ Page: 1, Limit: 10, Name: customer })}`)
      const list: any[] = Array.isArray(answer?.CustomerList) ? answer.CustomerList : []
      return list.some((entry) => String(entry?.Name ?? '').trim().toLowerCase() === customer.trim().toLowerCase())
    },

    async findOrder(credential, reference) {
      const found = await findSale(credential, reference)
      return found && !found.incomplete ? { id: found.id, number: found.number } : null
    },

    async createOrder(credential, request) {
      // A sale made by an attempt whose lines failed is finished, not made again.
      let sale = await findSale(credential, request.reference)
      if (!sale) {
        const address = request.shippingAddress
        const answer = await call(
          credential,
          'POST',
          'sale',
          {
            Customer: request.customer,
            CustomerReference: request.reference,
            ...(request.locationId ? { Location: request.locationId } : {}),
            SaleOrderDate: new Date(request.orderedAtMs).toISOString(),
            SkipQuote: true,
            ...(request.taxRule ? { TaxRule: request.taxRule } : {}),
            ...(request.buyerName ? { Contact: request.buyerName } : {}),
            ...(request.buyerEmail ? { Email: request.buyerEmail } : {}),
            ...(address?.phone ? { Phone: address.phone } : {}),
            Note: `${PLATFORM_BRAND_NAME} order ${request.displayRef}`,
            ...(address
              ? {
                  ShippingAddress: {
                    DisplayAddressLine1: address.name ?? '',
                    Line1: address.line1 ?? '',
                    Line2: address.line2 ?? '',
                    City: address.city ?? '',
                    State: address.state ?? '',
                    Postcode: address.postalCode ?? '',
                    Country: address.country ?? '',
                    ShipToOther: true,
                  },
                }
              : {}),
          },
          false,
        )
        const id = answer?.ID ?? answer?.SaleID
        if (!id) throw new ProviderError('invalid', 'Cin7 Core did not say which sale it made')
        sale = { id: String(id), number: answer?.Order?.SaleOrderNumber ? String(answer.Order.SaleOrderNumber) : null, incomplete: true }
      }
      if (sale.incomplete) await writeOrderLines(credential, sale.id, request)
      return { id: sale.id, number: sale.number }
    },

    async cancelOrder(credential, order) {
      try {
        await call(credential, 'DELETE', `sale?${query({ ID: order.id, Void: 'true' })}`, undefined, false)
        return 'canceled'
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid') return 'too_late'
        if (error instanceof ProviderError && error.kind === 'not-found') return 'canceled'
        throw error
      }
    },
  }
  return provider
}
