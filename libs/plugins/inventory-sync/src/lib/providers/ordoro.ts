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
  SystemAddress,
  SystemOrder,
  SystemProduct,
  SystemStock,
} from './provider'

/**
 * ORDORO (AGL-3823), on the merchant's OWN account: the Client ID and Client
 * Secret of an API key they make under Account Settings → API Keys, sent as
 * HTTP Basic credentials on every call. Ordoro opens its API to accounts on
 * its Premium plan and above, marks the API documentation beta, and allows
 * 500 requests a minute, answering 429 past it.
 *
 * Reference: https://docs.ordoro.com/ (the OpenAPI document the page embeds).
 * Routes under `/v3` take no trailing slash; every other route needs one.
 *
 * - A location is an Ordoro warehouse. Stock is read off each product's
 *   `warehouses` rows: `available` is what can be sold now, and
 *   `physical_on_hand` what is on the shelf.
 * - Counts are written one SKU at a time, as an `adjustment` by the
 *   difference at the chosen warehouse: Ordoro has no adjustment document
 *   that holds several lines under one reference. An adjustment is never
 *   retried in the call; a run that does not finish reads the counts afresh
 *   next time and works the difference out again, so nothing is added twice.
 * - An order is `POST /v3/order` under the sales channel the merchant names,
 *   with our reference as both its `order_id` and its `cart_order_id`. Ordoro
 *   prefixes the order number with the channel's index, and lists orders by
 *   `cart_order_id`, which is how an order is found before it is sent, so a
 *   retry after a timeout adopts the order rather than making a second.
 * - Ordoro keys orders and products by their number and SKU, not their
 *   numeric id, so an order's id here is its order number.
 */

export const ORDORO_API_BASE = 'https://api.ordoro.com/'

/** Ordoro's largest page. */
const PAGE = 100

/** Most pages one listing walks: 100 products a page, well past the run's SKU cap. */
const MAX_PAGES = 200

type OrdoroCredential = Extract<InventoryCredential, { provider: 'ordoro' }>

function asOrdoro(credential: InventoryCredential): OrdoroCredential {
  if (credential.provider !== 'ordoro') throw new ProviderError('auth', 'This connection is not an Ordoro connection')
  return credential
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The basic credentials of one API key. */
export function ordoroAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`
}

/** What a warehouse is called: its own name, else its address's company or name. */
function warehouseName(entry: any): string {
  const named = [entry?.warehouse_name, entry?.address?.company, entry?.address?.name].find(
    (value) => typeof value === 'string' && value.trim(),
  )
  return named ? String(named).trim() : `Warehouse ${entry?.id}`
}

/** A list endpoint's rows: Ordoro names the array after the model, and the product list answers `products`. */
function rows(page: any, key: string): any[] {
  const list = page?.[key] ?? page?.[`${key}s`]
  return Array.isArray(list) ? list : []
}

/** Ordoro's address shape from ours. */
function ordoroAddress(address: SystemAddress | null, fallbackName: string | null, email: string | null) {
  return {
    name: address?.name ?? fallbackName ?? null,
    street1: address?.line1 ?? null,
    street2: address?.line2 ?? null,
    city: address?.city ?? null,
    state: address?.state ?? null,
    zip: address?.postalCode ?? null,
    country: address?.country ?? null,
    phone: address?.phone ?? null,
    email: email ?? null,
  }
}

export function createOrdoroProvider(options: { http: ProviderHttp; base?: string }): InventorySystemProvider {
  const base = options.base ?? ORDORO_API_BASE

  const call = (
    credential: InventoryCredential,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    retry = true,
  ) => {
    const { clientId, clientSecret } = asOrdoro(credential)
    return providerRequest(options.http, {
      provider: 'Ordoro',
      method,
      url: `${base}${path}`,
      headers: {
        Authorization: ordoroAuthorization(clientId, clientSecret),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body === undefined ? {} : { body }),
      retry,
    })
  }

  const query = (params: Record<string, string | number | boolean | null | undefined>) =>
    new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ).toString()

  /**
   * Every active product, a page at a time.
   * https://docs.ordoro.com/#tag/Product/operation/Product_GET
   */
  async function* productPages(credential: InventoryCredential): AsyncGenerator<any[]> {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await call(
        credential,
        'GET',
        `product/?${query({ limit: PAGE, offset: page * PAGE, active: true, sort: 'created' })}`,
      )
      const list = rows(answer, 'product')
      yield list
      const count = Number(answer?.count)
      if (list.length < PAGE || (Number.isFinite(count) && (page + 1) * PAGE >= count)) return
    }
  }

  /**
   * The sales channel orders are recorded under, by its name.
   * https://docs.ordoro.com/#tag/Cart/operation/Cart_GET
   */
  async function salesChannelId(credential: InventoryCredential, name: string): Promise<number | null> {
    const answer = await call(credential, 'GET', `cart/?${query({ limit: PAGE, search: name })}`)
    const wanted = name.trim().toLowerCase()
    const match = rows(answer, 'cart').find(
      (entry: any) => !entry?.archived_date && String(entry?.name ?? '').trim().toLowerCase() === wanted,
    )
    const id = Number(match?.id)
    return Number.isInteger(id) && id > 0 ? id : null
  }

  return {
    id: 'ordoro',

    /** https://docs.ordoro.com/#tag/Company/operation/Company_GET */
    async account(credential) {
      const company = await call(credential, 'GET', 'company/')
      const name = typeof company?.name === 'string' ? company.name.trim() : ''
      return { accountName: name || null }
    },

    /** https://docs.ordoro.com/#tag/Warehouse/operation/Warehouse_GET */
    async locations(credential): Promise<InventoryLocation[]> {
      const found: InventoryLocation[] = []
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await call(credential, 'GET', `warehouse/?${query({ limit: PAGE, offset: page * PAGE, sort: 'name' })}`)
        const list = rows(answer, 'warehouse')
        for (const entry of list) {
          if (entry?.id === undefined || entry?.id === null) continue
          found.push({ id: String(entry.id), name: warehouseName(entry) })
        }
        if (list.length < PAGE) break
      }
      return found
    },

    async stock(credential, input): Promise<SystemStock[]> {
      const stock: SystemStock[] = []
      for await (const page of productPages(credential)) {
        for (const product of page) {
          const sku = String(product?.sku ?? '').trim()
          if (!sku) continue
          const warehouses: any[] = Array.isArray(product.warehouses) ? product.warehouses : []
          const counted = input.locationId
            ? warehouses.filter((row) => String(row?.id) === input.locationId)
            : warehouses
          const available = counted.reduce((sum, row) => sum + num(row?.available), 0)
          const onHand = counted.reduce((sum, row) => sum + num(row?.physical_on_hand ?? row?.on_hand), 0)
          stock.push({
            sku,
            productId: String(product.id ?? sku),
            available: Math.max(0, Math.floor(available)),
            onHand: Math.floor(onHand),
          })
        }
        if (stock.length >= input.max) break
      }
      return stock.slice(0, input.max)
    },

    /**
     * One `adjustment` per SKU at the warehouse.
     * https://docs.ordoro.com/#tag/Product/operation/ProductWarehouseBySkuAndWarehouseId_PUT
     */
    async adjustStock(credential, input) {
      const refused: string[] = []
      for (const change of input.changes) {
        if (!change.delta) continue
        try {
          await call(
            credential,
            'PUT',
            `product/${encodeURIComponent(change.sku)}/warehouse/${encodeURIComponent(input.locationId)}/`,
            { adjustment: change.delta },
            false,
          )
        } catch (error) {
          // A refused key or a rate limit ends the run; a refused SKU is named and the rest go on.
          if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'not-found')) {
            refused.push(change.sku)
            continue
          }
          throw error
        }
      }
      if (refused.length) {
        throw new ProviderError('invalid', `Ordoro would not adjust ${refused.slice(0, 10).join(', ')}${refused.length > 10 ? '…' : ''}`)
      }
    },

    /** https://docs.ordoro.com/#tag/Product/operation/Product_GET */
    async products(credential, input) {
      const limit = Math.min(PAGE, Math.max(1, input.limit))
      const offset = Math.max(0, Math.floor(Number(input.cursor ?? 0)) || 0)
      const answer = await call(
        credential,
        'GET',
        `product/?${query({
          limit,
          offset,
          active: true,
          sort: 'created',
          updated_after: input.sinceMs ? new Date(input.sinceMs).toISOString() : null,
        })}`,
      )
      const list = rows(answer, 'product')
      const products: SystemProduct[] = list
        .filter((product) => product?.id !== undefined && String(product?.sku ?? '').trim())
        .map((product) => ({
          id: String(product.id),
          sku: String(product.sku).trim(),
          name: String(product.name ?? product.sku).trim(),
          // Ordoro keeps no product description its API names as one.
          description: '',
          priceMinor: decimalToMinor(product.price, input.currency),
          // Ordoro's API does not name the unit its product weight is kept in.
          weightGrams: null,
          barcode: product.upc ? String(product.upc) : null,
          version: String(product.updated ?? ''),
          active: !product.archive_date,
        }))
      const count = Number(answer?.count)
      const more = list.length === limit && (!Number.isFinite(count) || offset + limit < count)
      return { products, nextCursor: more ? String(offset + limit) : null }
    },

    /** https://docs.ordoro.com/#tag/Product/operation/ProductBySku_GET */
    async productIdsBySku(credential, skus) {
      const found = new Map<string, string>()
      for (const sku of skus) {
        try {
          const product = await call(credential, 'GET', `product/${encodeURIComponent(sku)}/`)
          if (product?.id !== undefined && String(product?.sku ?? '') === sku) found.set(sku, String(product.id))
        } catch (error) {
          if (error instanceof ProviderError && error.kind === 'not-found') continue
          throw error
        }
      }
      return found
    },

    /** https://docs.ordoro.com/#tag/Product/operation/Product_POST */
    async createProduct(credential, product) {
      const answer = await call(
        credential,
        'POST',
        'product/',
        {
          sku: product.sku,
          name: product.name,
          price: minorToMajor(product.priceMinor, product.currency),
          ...(product.barcode ? { upc: product.barcode } : {}),
        },
        false,
      )
      return { id: String(answer?.id ?? product.sku) }
    },

    async customerExists(credential, customer) {
      return (await salesChannelId(credential, customer)) !== null
    },

    /** https://docs.ordoro.com/#tag/Order/operation/Order_GET */
    async findOrder(credential, reference): Promise<SystemOrder | null> {
      const answer = await call(credential, 'GET', `v3/order?${query({ cart_order_id: reference, status: 'all', limit: 10 })}`)
      const match = rows(answer, 'order').find((order: any) => {
        const number = String(order?.order_number ?? '')
        if (number === reference || number.endsWith(`-${reference}`)) return true
        const lines: any[] = Array.isArray(order?.lines) ? order.lines : []
        return lines.some((line) => String(line?.cart_order_id ?? '') === reference)
      })
      if (!match?.order_number) return null
      return { id: String(match.order_number), number: String(match.order_number) }
    },

    /** https://docs.ordoro.com/#tag/Order/operation/Order_POST */
    async createOrder(credential, request) {
      const channel = await salesChannelId(credential, request.customer)
      if (!channel) {
        throw new ProviderError(
          'invalid',
          `Ordoro has no sales channel named “${request.customer}”. Choose one in the connection’s settings.`,
        )
      }
      const currency = request.currency
      const warehouse = request.locationId ? Number(request.locationId) : null
      const subtotal = request.lines.reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0)
      const address = ordoroAddress(request.shippingAddress, request.buyerName, request.buyerEmail)
      const answer = await call(
        credential,
        'POST',
        'v3/order',
        {
          order_id: request.reference,
          cart: channel,
          cart_order_id: request.reference,
          order_date: new Date(request.orderedAtMs).toISOString(),
          ...(warehouse !== null && Number.isInteger(warehouse) ? { warehouse_id: warehouse } : {}),
          shipping_address: address,
          billing_address: address,
          internal_notes: [
            `${PLATFORM_BRAND_NAME} order ${request.displayRef} (${request.reference}).`,
            `Amounts in ${currency}.`,
          ].join(' '),
          product_amount: minorToMajor(subtotal, currency),
          shipping_amount: minorToMajor(request.shippingCents, currency),
          discount_amount: minorToMajor(request.discountCents, currency),
          tax_amount: minorToMajor(request.taxCents, currency),
          grand_total: minorToMajor(request.totalCents, currency),
          lines: request.lines.map((line, index) => ({
            cart_orderitem_id: `${request.reference}-${index + 1}`,
            quantity: line.quantity,
            item_price: minorToMajor(line.unitAmountCents, currency),
            total_price: minorToMajor(line.unitAmountCents * line.quantity, currency),
            product: { sku: line.sku, name: line.name },
          })),
        },
        false,
      )
      const number = answer?.order_number ? String(answer.order_number) : null
      if (!number) throw new ProviderError('transient', 'Ordoro did not answer the order number')
      return { id: number, number }
    },

    /** https://docs.ordoro.com/#tag/Order/operation/OrderCancelByOrderNumber_POST */
    async cancelOrder(credential, order) {
      try {
        await call(credential, 'POST', `v3/order/${encodeURIComponent(order.id)}/cancel`, {}, false)
        return 'canceled'
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid') return 'too_late'
        throw error
      }
    },
  }
}
