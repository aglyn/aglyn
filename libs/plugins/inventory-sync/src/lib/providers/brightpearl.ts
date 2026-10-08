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
import type { InventoryCredential, InventorySystemProvider, SystemOrder, SystemProduct, SystemStock } from './provider'

/**
 * BRIGHTPEARL (AGL-3642), through the developer app this deployment registers
 * (`BRIGHTPEARL_APP_REF`, `BRIGHTPEARL_DEV_REF`): the merchant signs in to
 * their OWN Brightpearl account and grants the app access. Calls go to the
 * account's own datacenter (`api_domain` from the grant) under
 * `/public-api/{account}/`, with the bearer token and both app references.
 * Brightpearl meters 200 calls a minute and answers 503 with
 * `brightpearl-next-throttle-period` past it.
 *
 * - Products are listed by `product-search` (columns, pages of up to 500) and
 *   priced from `product-price`: the first price list in the store's
 *   currency.
 * - Stock is `product-availability` per product id set. Brightpearl's
 *   `onHand` is what is free to sell (in stock less allocated), so it is the
 *   available count; `inStock` is what is physically there.
 * - A count adjusted to the store's is a stock correction at the chosen
 *   warehouse's default location.
 * - An order is a sales order (`orderTypeCode: SO`) whose `reference` is ours
 *   and which `order-search` finds by it; its rows are written next, and a
 *   retry writes only the rows a failed attempt did not.
 * - Products are not made in Brightpearl from the store: its product needs a
 *   brand, a product type and channel choices only the merchant can make.
 *   Orders are not canceled through the API: the merchant cancels in
 *   Brightpearl, and the order says so.
 */

/** Brightpearl's OAuth host. */
export const BRIGHTPEARL_OAUTH_BASE = 'https://oauth.brightpearlapp.com'

const SEARCH_PAGE = 500
/** Product ids per availability or price read. */
const ID_SET = 200

export interface BrightpearlApp {
  appRef: string
  devRef: string
}

type BrightpearlCredential = Extract<InventoryCredential, { provider: 'brightpearl' }>

function asBrightpearl(credential: InventoryCredential): BrightpearlCredential {
  if (credential.provider !== 'brightpearl') throw new ProviderError('auth', 'This connection is not a Brightpearl connection')
  return credential
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** A `*-search` answer as rows keyed by column name. */
export function searchRows(response: any): { rows: Array<Record<string, unknown>>; more: boolean } {
  const columns: string[] = Array.isArray(response?.metaData?.columns)
    ? response.metaData.columns.map((column: any) => String(column?.name ?? ''))
    : []
  const results: unknown[][] = Array.isArray(response?.results) ? response.results : []
  return {
    rows: results.map((row) => Object.fromEntries(columns.map((name, index) => [name, row?.[index]]))),
    more: response?.metaData?.morePagesAvailable === true,
  }
}

const chunks = <T,>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size))
  return out
}

/** A Brightpearl host from a grant: its own subdomain, never somewhere else. */
export function safeApiDomain(value: unknown): string | null {
  const domain = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(brightpearl\.com|brightpearlconnect\.com|brightpearlapp\.com)$/.test(domain)
    ? domain
    : null
}

export function createBrightpearlProvider(options: { http: ProviderHttp; app: BrightpearlApp }): InventorySystemProvider {
  const call = (
    credential: InventoryCredential,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    retry = true,
  ): Promise<any> => {
    const { accountCode, apiDomain, accessToken } = asBrightpearl(credential)
    const domain = safeApiDomain(apiDomain)
    if (!domain) throw new ProviderError('auth', 'The Brightpearl grant named no datacenter. Connect again.')
    return providerRequest(options.http, {
      provider: 'Brightpearl',
      method,
      url: `https://${domain}/public-api/${encodeURIComponent(accountCode)}/${path}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'brightpearl-app-ref': options.app.appRef,
        'brightpearl-dev-ref': options.app.devRef,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body === undefined ? {} : { body }),
      retry,
    }).then((answer) => answer?.response)
  }

  const query = (params: Record<string, string | number | null | undefined>) =>
    new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ).toString()

  /** Every product id with its SKU, from product-search pages. */
  async function productsWithSku(
    credential: InventoryCredential,
    max: number,
  ): Promise<Array<{ productId: string; sku: string }>> {
    const found: Array<{ productId: string; sku: string }> = []
    for (let first = 1; found.length < max; first += SEARCH_PAGE) {
      const answer = await call(
        credential,
        'GET',
        `product-service/product-search?${query({ columns: 'productId,SKU', pageSize: SEARCH_PAGE, firstResult: first })}`,
      )
      const { rows, more } = searchRows(answer)
      for (const row of rows) {
        const sku = String(row['SKU'] ?? '').trim()
        if (row['productId'] !== undefined && sku) found.push({ productId: String(row['productId']), sku })
      }
      if (!more || !rows.length) break
    }
    return found.slice(0, max)
  }

  async function findOrderRaw(credential: InventoryCredential, reference: string) {
    const answer = await call(
      credential,
      'GET',
      `order-service/order-search?${query({ customerRef: reference, columns: 'orderId,customerRef' })}`,
    )
    const match = searchRows(answer).rows.find((row) => String(row['customerRef'] ?? '') === reference)
    if (!match?.['orderId']) return null
    const orderId = String(match['orderId'])
    const orders = await call(credential, 'GET', `order-service/order/${encodeURIComponent(orderId)}`)
    const order = Array.isArray(orders) ? orders[0] : null
    const rows = Object.values((order?.orderRows ?? {}) as Record<string, any>)
    return { id: orderId, rows }
  }

  return {
    id: 'brightpearl',

    async account(credential) {
      await call(credential, 'GET', 'warehouse-service/warehouse')
      return { accountName: asBrightpearl(credential).accountCode }
    },

    async locations(credential): Promise<InventoryLocation[]> {
      const list = await call(credential, 'GET', 'warehouse-service/warehouse')
      return (Array.isArray(list) ? list : [])
        .filter((entry: any) => entry?.id !== undefined)
        .map((entry: any) => ({ id: String(entry.id), name: String(entry.name ?? `Warehouse ${entry.id}`) }))
    },

    async stock(credential, input): Promise<SystemStock[]> {
      const products = await productsWithSku(credential, input.max)
      const stock: SystemStock[] = []
      for (const set of chunks(products, ID_SET)) {
        const answer = await call(
          credential,
          'GET',
          `warehouse-service/product-availability/${set.map((product) => product.productId).join(',')}`,
        )
        for (const product of set) {
          const entry = answer?.[product.productId]
          if (!entry) continue
          const counts = input.locationId ? entry.warehouses?.[input.locationId] : entry.total
          stock.push({
            sku: product.sku,
            productId: product.productId,
            available: Math.max(0, Math.floor(num(counts?.onHand))),
            onHand: Math.floor(num(counts?.inStock)),
          })
        }
      }
      return stock
    },

    async adjustStock(credential, input) {
      if (!input.changes.length) return
      const warehouse = encodeURIComponent(input.locationId)
      const location = await call(credential, 'GET', `warehouse-service/warehouse/${warehouse}/location/default`)
      const locationId = Number(Array.isArray(location) ? location[0] : location)
      if (!Number.isFinite(locationId)) throw new ProviderError('invalid', 'The Brightpearl warehouse has no default location')
      await call(
        credential,
        'POST',
        `warehouse-service/warehouse/${warehouse}/stock-correction`,
        {
          corrections: input.changes.map((change) => ({
            quantity: change.delta,
            productId: Number(change.productId),
            reason: `${PLATFORM_BRAND_NAME} stock sync ${input.reference}`,
            locationId,
            ...(change.delta > 0 ? { cost: { currency: input.currency.toUpperCase(), value: 0 } } : {}),
          })),
        },
        false,
      )
    },

    async products(credential, input) {
      const first = Math.max(1, Number(input.cursor) || 1)
      const size = Math.min(SEARCH_PAGE, Math.max(1, input.limit))
      const answer = await call(
        credential,
        'GET',
        `product-service/product-search?${query({
          columns: 'productId,SKU,productName,updatedOn,productStatus,barcode',
          pageSize: size,
          firstResult: first,
          ...(input.sinceMs ? { updatedOn: `${new Date(input.sinceMs).toISOString()}/` } : {}),
        })}`,
      )
      const { rows, more } = searchRows(answer)
      const listed = rows.filter((row) => row['productId'] !== undefined && String(row['SKU'] ?? '').trim())
      const prices = new Map<string, number | null>()
      for (const set of chunks(listed, ID_SET)) {
        const answerPrices = await call(
          credential,
          'GET',
          `product-service/product-price/${set.map((row) => String(row['productId'])).join(',')}`,
        )
        for (const entry of Array.isArray(answerPrices) ? answerPrices : []) {
          const list = (Array.isArray(entry?.priceLists) ? entry.priceLists : []).find(
            (priceList: any) =>
              String(priceList?.currencyCode ?? '').toUpperCase() === input.currency.toUpperCase() &&
              priceList?.quantityPrice?.['1'] !== undefined,
          )
          prices.set(String(entry?.productId), list ? decimalToMinor(list.quantityPrice['1'], input.currency) : null)
        }
      }
      const products: SystemProduct[] = listed.map((row) => ({
        id: String(row['productId']),
        sku: String(row['SKU']).trim(),
        name: String(row['productName'] ?? row['SKU']).trim(),
        description: '',
        priceMinor: prices.get(String(row['productId'])) ?? null,
        weightGrams: null,
        barcode: row['barcode'] ? String(row['barcode']) : null,
        version: String(row['updatedOn'] ?? ''),
        active: String(row['productStatus'] ?? 'LIVE').toUpperCase() !== 'ARCHIVED',
      }))
      return { products, nextCursor: more && rows.length ? String(first + rows.length) : null }
    },

    async productIdsBySku(credential, skus) {
      const found = new Map<string, string>()
      for (const sku of skus) {
        const answer = await call(
          credential,
          'GET',
          `product-service/product-search?${query({ SKU: sku, columns: 'productId,SKU' })}`,
        )
        const match = searchRows(answer).rows.find((row) => String(row['SKU'] ?? '') === sku)
        if (match?.['productId'] !== undefined) found.set(sku, String(match['productId']))
      }
      return found
    },

    async createProduct() {
      throw new ProviderError(
        'invalid',
        'Brightpearl products are made in Brightpearl: each needs a brand, a product type and channel choices.',
      )
    },

    async customerExists(credential, customer) {
      if (!/^[1-9][0-9]{0,11}$/.test(customer)) return false
      try {
        const answer = await call(credential, 'GET', `contact-service/contact/${customer}`)
        return Array.isArray(answer) ? answer.length > 0 : Boolean(answer)
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'not-found') return false
        throw error
      }
    },

    async findOrder(credential, reference): Promise<SystemOrder | null> {
      const found = await findOrderRaw(credential, reference)
      return found && found.rows.length ? { id: found.id, number: found.id } : null
    },

    async createOrder(credential, request) {
      const currency = request.currency
      let found = await findOrderRaw(credential, request.reference)
      if (!found) {
        const address = request.shippingAddress
        const orderId = await call(
          credential,
          'POST',
          'order-service/order',
          {
            orderTypeCode: 'SO',
            reference: request.reference,
            placedOn: new Date(request.orderedAtMs).toISOString(),
            ...(request.locationId ? { warehouseId: Number(request.locationId) } : {}),
            currency: { orderCurrencyCode: currency.toUpperCase() },
            parties: {
              customer: { contactId: Number(request.customer) },
              ...(address
                ? {
                    delivery: {
                      addressFullName: address.name ?? request.buyerName ?? '',
                      addressLine1: address.line1 ?? '',
                      addressLine2: address.line2 ?? '',
                      addressLine3: address.city ?? '',
                      addressLine4: address.state ?? '',
                      postalCode: address.postalCode ?? '',
                      countryIsoCode: address.country ?? '',
                      ...(address.phone ? { telephone: address.phone } : {}),
                      ...(request.buyerEmail ? { email: request.buyerEmail } : {}),
                    },
                  }
                : {}),
            },
          },
          false,
        )
        if (orderId === undefined || orderId === null) throw new ProviderError('invalid', 'Brightpearl did not say which order it made')
        found = { id: String(orderId), rows: [] }
      }
      // Rows a failed attempt already wrote are not written twice.
      const written = new Set(found.rows.map((row: any) => String(row?.productId ?? row?.productName ?? '')))
      const row = (body: Record<string, unknown>) =>
        call(credential, 'POST', `order-service/order/${encodeURIComponent(found!.id)}/row`, body, false)
      for (const line of request.lines) {
        if (written.has(line.productId)) continue
        await row({
          productId: Number(line.productId),
          quantity: { magnitude: line.quantity },
          rowValue: {
            taxCode: '-',
            rowNet: { value: minorToMajor(line.unitAmountCents * line.quantity, currency) },
            rowTax: { value: 0 },
          },
        })
      }
      const extras: Array<[string, number, number]> = [
        ['Shipping', request.shippingCents, 0],
        ['Sales tax collected by the store', 0, request.taxCents],
        ['Discount', -request.discountCents, 0],
      ]
      for (const [name, net, tax] of extras) {
        if ((net === 0 && tax === 0) || written.has(name)) continue
        await row({
          productName: name,
          quantity: { magnitude: 1 },
          rowValue: { taxCode: '-', rowNet: { value: minorToMajor(net, currency) }, rowTax: { value: minorToMajor(tax, currency) } },
        })
      }
      return { id: found.id, number: found.id }
    },

    async cancelOrder() {
      return 'unsupported'
    },
  }
}
