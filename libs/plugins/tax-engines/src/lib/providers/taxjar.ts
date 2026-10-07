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

import {
  allocateCents,
  centsToUnits,
  normalizeTaxAddress,
  unitsToCents,
  type TaxEngineAddress,
  type TaxExemptionType,
} from '../model/tax-engines'
import {
  sendProviderRequest,
  TaxProviderError,
  type ProviderFetch,
  type ProviderResponse,
} from './http'
import type {
  TaxCommitRequest,
  TaxDocument,
  TaxProvider,
  TaxProviderCredentials,
  TaxRefundRequest,
} from './types'

/**
 * TaxJar, API v2 (AGL-3631), with the merchant's own API token as a bearer
 * token. Pinned to API version 2022-01-24, under which a refund's amounts are
 * NEGATIVE — the version is sent on every call so a change of TaxJar's default
 * cannot flip the sign of a merchant's refunds.
 *
 * - A QUOTE is `POST /v2/taxes`; TaxJar keeps nothing.
 * - A paid sale is an order transaction whose id is the order id. Creating
 *   one TaxJar already holds answers 422, and is then updated in place, so
 *   recording twice leaves one transaction carrying the latest figures.
 * - A refund is a refund transaction under its own id, referencing the
 *   order, looked up first so a retry finds the one it already filed.
 * - A void deletes the order transaction.
 */

const BASE_URLS = {
  sandbox: 'https://api.sandbox.taxjar.com',
  production: 'https://api.taxjar.com',
} as const

export const TAXJAR_API_VERSION = '2022-01-24'

/** TaxJar's product tax code for a fully exempt line. */
export const TAXJAR_EXEMPT_TAX_CODE = '99999'

/** TaxJar's exemption kinds; it names fewer than AvaTax and folds the rest into `other`. */
export const TAXJAR_EXEMPTION_TYPES: Readonly<Record<TaxExemptionType, string>> = {
  wholesale: 'wholesale',
  government: 'government',
  nonprofit: 'other',
  education: 'other',
  religious: 'other',
  other: 'other',
}

function addressFields(prefix: 'from' | 'to', address: TaxEngineAddress) {
  return {
    [`${prefix}_country`]: address.country,
    ...(address.postalCode ? { [`${prefix}_zip`]: address.postalCode } : {}),
    ...(address.region ? { [`${prefix}_state`]: address.region } : {}),
    ...(address.city ? { [`${prefix}_city`]: address.city } : {}),
    ...(address.line1 ? { [`${prefix}_street`]: address.line1 } : {}),
  }
}

function refusal(response: ProviderResponse, fallback: string): TaxProviderError {
  const detail = String(response.body?.detail ?? response.body?.message ?? fallback)
  return new TaxProviderError(
    `TaxJar: ${detail}`.slice(0, 300),
    response.status,
    String(response.body?.error ?? '') || null,
  )
}

const netCents = (line: { amountCents: number; discountCents: number }) =>
  Math.max(0, line.amountCents - line.discountCents)

/** A line's unit price in dollars; TaxJar multiplies it back by the quantity. */
function unitPrice(line: { amountCents: number; quantity: number }) {
  const quantity = Math.max(1, Math.round(line.quantity))
  return Math.round((line.amountCents / quantity) * 100) / 10_000
}

function lineItems(document: TaxDocument, salesTaxCents?: readonly number[]) {
  return document.lines.map((line, index) => ({
    id: String(line.id).slice(0, 50),
    quantity: Math.max(1, Math.round(line.quantity)),
    ...(line.itemCode ? { product_identifier: String(line.itemCode).slice(0, 50) } : {}),
    ...(line.description ? { description: String(line.description).slice(0, 255) } : {}),
    ...(line.exempt
      ? { product_tax_code: TAXJAR_EXEMPT_TAX_CODE }
      : line.taxCode
        ? { product_tax_code: line.taxCode }
        : {}),
    unit_price: unitPrice(line),
    discount: centsToUnits(line.discountCents),
    ...(salesTaxCents ? { sales_tax: centsToUnits(salesTaxCents[index] ?? 0) } : {}),
  }))
}

function exemptionField(document: TaxDocument) {
  return document.exemption
    ? { exemption_type: TAXJAR_EXEMPTION_TYPES[document.exemption.type] }
    : {}
}

/** Goods after discounts, the figure TaxJar calls `amount` before shipping. */
function goodsCents(document: TaxDocument): number {
  return document.lines.reduce((sum, line) => sum + netCents(line), 0)
}

/** The order transaction body for a recorded sale. */
function orderBody(request: TaxCommitRequest) {
  const taxable = request.lines.map((line) => (line.exempt ? 0 : netCents(line)))
  return {
    transaction_id: String(request.code).slice(0, 255),
    transaction_date: request.date,
    ...addressFields('from', request.shipFrom),
    ...addressFields('to', request.shipTo),
    amount: centsToUnits(goodsCents(request) + request.shippingCents),
    shipping: centsToUnits(request.shippingCents),
    sales_tax: centsToUnits(request.collectedTaxCents),
    ...exemptionField(request),
    line_items: lineItems(request, allocateCents(request.collectedTaxCents, taxable)),
  }
}

export function createTaxJarProvider(fetchImpl: ProviderFetch): TaxProvider {
  const call = (
    credentials: TaxProviderCredentials,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ) =>
    sendProviderRequest(fetchImpl, {
      method,
      url: `${BASE_URLS[credentials.environment]}${path}`,
      headers: {
        Authorization: `Bearer ${credentials.secret}`,
        'x-api-version': TAXJAR_API_VERSION,
      },
      body,
    })

  return {
    id: 'taxjar',
    label: 'TaxJar',

    async testConnection(credentials) {
      const response = await call(credentials, 'GET', '/v2/nexus/regions')
      if (response.status !== 200) throw refusal(response, 'the account could not be reached')
      const regions = Array.isArray(response.body?.regions) ? response.body.regions : []
      return {
        detail:
          regions.length === 0
            ? 'Connected. TaxJar lists no nexus states on this account yet, so it will quote no tax until you add them.'
            : `Connected, with nexus in ${regions
                .map((region: any) => String(region?.region_code ?? region?.region ?? ''))
                .filter(Boolean)
                .slice(0, 12)
                .join(', ')}`,
      }
    },

    async quote(credentials, document) {
      const response = await call(credentials, 'POST', '/v2/taxes', {
        ...addressFields('from', document.shipFrom),
        ...addressFields('to', document.shipTo),
        amount: centsToUnits(goodsCents(document)),
        shipping: centsToUnits(document.shippingCents),
        ...exemptionField(document),
        line_items: lineItems(document),
      })
      if (response.status !== 200) throw refusal(response, 'the quote was refused')
      const tax = response.body?.tax ?? {}
      const breakdown = tax.breakdown ?? {}
      const byId = new Map<string, number>()
      for (const item of Array.isArray(breakdown.line_items) ? breakdown.line_items : []) {
        byId.set(String(item?.id ?? ''), unitsToCents(item?.tax_collectable ?? 0))
      }
      return {
        taxCents: unitsToCents(tax.amount_to_collect ?? 0),
        lines: document.lines.map((line) => ({
          id: line.id,
          taxCents: byId.get(String(line.id).slice(0, 50)) ?? 0,
        })),
        shippingTaxCents: unitsToCents(breakdown.shipping?.tax_collectable ?? 0),
      }
    },

    async commit(credentials, request) {
      const body = orderBody(request)
      const created = await call(credentials, 'POST', '/v2/transactions/orders', body)
      if (created.status === 200 || created.status === 201) return
      if (created.status !== 422) throw refusal(created, 'the sale could not be recorded')
      // Already recorded: update it in place, which is what makes a retry safe.
      const updated = await call(
        credentials,
        'PUT',
        `/v2/transactions/orders/${encodeURIComponent(body.transaction_id)}`,
        body,
      )
      if (updated.status === 200) return
      throw refusal(updated, 'the sale could not be recorded')
    },

    async refund(credentials, request: TaxRefundRequest) {
      const refundId = String(request.refundCode).slice(0, 255)
      const existing = await call(
        credentials,
        'GET',
        `/v2/transactions/refunds/${encodeURIComponent(refundId)}`,
      )
      if (existing.status === 200) return
      if (existing.status !== 404) throw refusal(existing, 'the refund could not be looked up')
      const fraction = request.full ? 1 : Math.min(1, Math.max(0, request.fraction))
      const sale = request.sale
      const share = (cents: number) => Math.round(cents * fraction)
      const goods = share(goodsCents(sale))
      const shipping = share(sale.shippingCents)
      const response = await call(credentials, 'POST', '/v2/transactions/refunds', {
        transaction_id: refundId,
        transaction_reference_id: String(request.orderCode).slice(0, 255),
        transaction_date: request.date,
        ...addressFields('from', sale.shipFrom),
        ...addressFields('to', sale.shipTo),
        // Negative under API version 2022-01-24.
        amount: -centsToUnits(goods + shipping),
        shipping: -centsToUnits(shipping),
        sales_tax: -centsToUnits(share(sale.collectedTaxCents)),
        ...exemptionField(sale),
      })
      if (response.status === 200 || response.status === 201) return
      throw refusal(response, 'the refund was refused')
    },

    async void(credentials, sale) {
      const response = await call(
        credentials,
        'DELETE',
        `/v2/transactions/orders/${encodeURIComponent(String(sale.code).slice(0, 255))}`,
      )
      if (response.status === 200 || response.status === 404) return
      throw refusal(response, 'the sale could not be voided')
    },

    async validateAddress(credentials, address) {
      const response = await call(credentials, 'POST', '/v2/addresses/validate', {
        country: address.country,
        ...(address.region ? { state: address.region } : {}),
        ...(address.postalCode ? { zip: address.postalCode } : {}),
        ...(address.city ? { city: address.city } : {}),
        ...(address.line1 ? { street: address.line1 } : {}),
      })
      if (response.status === 404) {
        return { valid: false, normalized: null, messages: ['TaxJar found no address matching this one.'] }
      }
      if (response.status === 403) {
        throw new TaxProviderError(
          'TaxJar: address validation is not included in this TaxJar plan.',
          403,
          'Forbidden',
        )
      }
      if (response.status !== 200) throw refusal(response, 'the address could not be checked')
      const first = Array.isArray(response.body?.addresses) ? response.body.addresses[0] : null
      const normalized = first
        ? normalizeTaxAddress({
            line1: first.street,
            city: first.city,
            region: first.state,
            postalCode: first.zip,
            country: first.country,
          })
        : null
      return { valid: Boolean(normalized), normalized, messages: [] }
    },
  }
}
