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
import {
  centsToUnits,
  normalizeTaxAddress,
  unitsToCents,
  type TaxEngineAddress,
  type TaxExemptionType,
} from '../model/tax-engines'
import {
  basicAuthorization,
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
 * Avalara AvaTax, REST v2 (AGL-3631), with the merchant's own account id and
 * license key over HTTP Basic.
 *
 * - A QUOTE is a `SalesOrder`: AvaTax calculates it and keeps nothing.
 * - A paid sale is recorded with `createoradjust` as a committed
 *   `SalesInvoice` whose code is the order id, so recording it twice adjusts
 *   the one document rather than filing a second. The tax is the shopper's
 *   charged figure, sent as a `TaxAmount` override: the return is filed on
 *   what was collected, and AvaTax keeps its own calculation beside it for
 *   the merchant to compare.
 * - A refund is AvaTax's RefundTransaction — `Full`, or `Percentage` for a
 *   partial one — under a code of its own, looked up first so a retry finds
 *   the refund it already filed.
 * - A void is `DocVoided`; a document AvaTax has locked into a filed return
 *   cannot be voided, and is refunded in full instead.
 */

const BASE_URLS = {
  sandbox: 'https://sandbox-rest.avatax.com',
  production: 'https://rest.avatax.com',
} as const

/** The company a code-less account files under, as AvaTax names it. */
export const AVALARA_DEFAULT_COMPANY_CODE = 'DEFAULT'

/** AvaTax's code for shipping by common carrier. */
export const AVALARA_SHIPPING_TAX_CODE = 'FR020100'

/** AvaTax's code for a non-taxable line. */
export const AVALARA_NONTAXABLE_TAX_CODE = 'NT'

/** AvaTax's tangible-personal-property code, for a line with no code at all. */
export const AVALARA_GENERAL_TAX_CODE = 'P0000000'

/** AvaTax's entity use codes for the exemption kinds this plugin records. */
export const AVALARA_ENTITY_USE_CODES: Readonly<Record<TaxExemptionType, string>> = {
  wholesale: 'G',
  government: 'B',
  nonprofit: 'E',
  education: 'M',
  religious: 'F',
  other: 'L',
}

/** Names the integration to Avalara, in the deployment's own brand. */
const CLIENT_HEADER = `${PLATFORM_BRAND_NAME}; 1.0; REST; v2; tax-engines`

/** AvaTax documents codes are capped at 50 characters. */
function documentCode(code: string): string {
  return String(code).slice(0, 50)
}

function companyCodeOf(credentials: TaxProviderCredentials): string {
  return String(credentials.companyCode || AVALARA_DEFAULT_COMPANY_CODE)
}

function avalaraAddress(address: TaxEngineAddress) {
  return {
    ...(address.line1 ? { line1: address.line1 } : {}),
    ...(address.line2 ? { line2: address.line2 } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.region ? { region: address.region } : {}),
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    country: address.country,
  }
}

function refusal(response: ProviderResponse, fallback: string): TaxProviderError {
  const error = response.body?.error ?? {}
  const detail = Array.isArray(error.details) ? error.details[0] : null
  const message = String(detail?.message ?? error.message ?? response.body?.message ?? fallback)
  return new TaxProviderError(
    `Avalara: ${message}`.slice(0, 300),
    response.status,
    String(error.code ?? detail?.code ?? '') || null,
  )
}

/** The transaction model a quote and a recorded sale share. */
function transactionModel(
  credentials: TaxProviderCredentials,
  document: TaxDocument,
  type: 'SalesOrder' | 'SalesInvoice',
) {
  const lines = document.lines.map((line) => ({
    number: String(line.id).slice(0, 50),
    quantity: Math.max(1, Math.round(line.quantity)),
    // The NET line: AvaTax taxes what the shopper pays for the line, which is
    // what the line carried after its share of any basket discount.
    amount: centsToUnits(Math.max(0, line.amountCents - line.discountCents)),
    taxCode: line.exempt
      ? AVALARA_NONTAXABLE_TAX_CODE
      : line.taxCode || AVALARA_GENERAL_TAX_CODE,
    ...(line.itemCode ? { itemCode: String(line.itemCode).slice(0, 50) } : {}),
    ...(line.description ? { description: String(line.description).slice(0, 255) } : {}),
  }))
  if (document.shippingCents > 0) {
    lines.push({
      number: 'shipping',
      quantity: 1,
      amount: centsToUnits(document.shippingCents),
      taxCode: AVALARA_SHIPPING_TAX_CODE,
      description: 'Shipping',
    })
  }
  return {
    type,
    code: documentCode(document.code),
    companyCode: companyCodeOf(credentials),
    date: document.date,
    customerCode: String(document.customerCode).slice(0, 50),
    currencyCode: document.currency.toUpperCase(),
    addresses: {
      shipFrom: avalaraAddress(document.shipFrom),
      shipTo: avalaraAddress(document.shipTo),
    },
    lines,
    ...(document.exemption
      ? {
          entityUseCode: AVALARA_ENTITY_USE_CODES[document.exemption.type],
          ...(document.exemption.certificateNumber
            ? { exemptionNo: String(document.exemption.certificateNumber).slice(0, 25) }
            : {}),
        }
      : {}),
  }
}

export function createAvalaraProvider(fetchImpl: ProviderFetch): TaxProvider {
  const call = (
    credentials: TaxProviderCredentials,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ) =>
    sendProviderRequest(fetchImpl, {
      method,
      url: `${BASE_URLS[credentials.environment]}${path}`,
      headers: {
        Authorization: basicAuthorization(String(credentials.accountId ?? ''), credentials.secret),
        'X-Avalara-Client': CLIENT_HEADER,
      },
      body,
    })

  const transactionPath = (credentials: TaxProviderCredentials, code: string) =>
    `/api/v2/companies/${encodeURIComponent(companyCodeOf(credentials))}/transactions/${encodeURIComponent(
      documentCode(code),
    )}`

  const refund = async (credentials: TaxProviderCredentials, request: TaxRefundRequest) => {
    const refundCode = documentCode(request.refundCode)
    const existing = await call(credentials, 'GET', transactionPath(credentials, refundCode))
    if (existing.status === 200) return
    if (existing.status !== 404) throw refusal(existing, 'the refund could not be looked up')
    const fraction = Math.min(1, Math.max(0, request.fraction))
    const response = await call(credentials, 'POST', `${transactionPath(credentials, request.orderCode)}/refund`, {
      refundTransactionCode: refundCode,
      refundDate: request.date,
      refundType: request.full || fraction >= 1 ? 'Full' : 'Percentage',
      ...(request.full || fraction >= 1
        ? {}
        : { refundPercentage: Math.round(fraction * 1_000_000) / 10_000 }),
      referenceCode: documentCode(request.orderCode),
    })
    if (response.status >= 200 && response.status < 300) return
    throw refusal(response, 'the refund was refused')
  }

  return {
    id: 'avalara',
    label: 'Avalara AvaTax',

    async testConnection(credentials) {
      const ping = await call(credentials, 'GET', '/api/v2/utilities/ping')
      if (ping.status !== 200) throw refusal(ping, 'the account could not be reached')
      if (ping.body?.authenticated !== true) {
        throw new TaxProviderError(
          'Avalara did not accept that account id and license key.',
          401,
          'AuthenticationException',
        )
      }
      const companyCode = companyCodeOf(credentials)
      const companies = await call(
        credentials,
        'GET',
        `/api/v2/companies?$filter=${encodeURIComponent(`companyCode eq '${companyCode.replace(/'/g, "''")}'`)}`,
      )
      if (companies.status !== 200) throw refusal(companies, 'the company could not be read')
      const found = Array.isArray(companies.body?.value) ? companies.body.value[0] : null
      if (!found) {
        throw new TaxProviderError(
          `Avalara has no company with the code ${companyCode} on this account.`,
          404,
          'CompanyNotFound',
        )
      }
      return { detail: `Connected to ${String(found.name ?? companyCode)} (${companyCode})` }
    },

    async quote(credentials, document) {
      const response = await call(credentials, 'POST', '/api/v2/transactions/create', {
        ...transactionModel(credentials, document, 'SalesOrder'),
        commit: false,
      })
      if (response.status !== 200 && response.status !== 201) {
        throw refusal(response, 'the quote was refused')
      }
      const lines: Array<{ id: string; taxCents: number }> = []
      let shippingTaxCents = 0
      for (const line of Array.isArray(response.body?.lines) ? response.body.lines : []) {
        const taxCents = unitsToCents(line?.tax ?? line?.taxCalculated ?? 0)
        if (String(line?.lineNumber) === 'shipping') shippingTaxCents += taxCents
        else lines.push({ id: String(line?.lineNumber ?? ''), taxCents })
      }
      return {
        taxCents: unitsToCents(response.body?.totalTax ?? 0),
        lines,
        shippingTaxCents,
      }
    },

    async commit(credentials, request: TaxCommitRequest) {
      const response = await call(credentials, 'POST', '/api/v2/transactions/createoradjust', {
        createTransactionModel: {
          ...transactionModel(credentials, request, 'SalesInvoice'),
          commit: true,
          taxOverride: {
            type: 'TaxAmount',
            taxAmount: centsToUnits(request.collectedTaxCents),
            reason: 'Tax collected at checkout',
          },
        },
      })
      if (response.status === 200 || response.status === 201) return
      throw refusal(response, 'the sale could not be recorded')
    },

    refund,

    async void(credentials, sale) {
      const response = await call(credentials, 'POST', `${transactionPath(credentials, sale.code)}/void`, {
        code: 'DocVoided',
      })
      if (response.status === 200 || response.status === 404) return
      const code = String(response.body?.error?.code ?? '')
      if (/Locked|Reported|Filed/i.test(code)) {
        // In a filed return: it cannot be removed, only reversed.
        await refund(credentials, {
          orderCode: sale.code,
          refundCode: `${documentCode(sale.code).slice(0, 44)}-VOID`,
          date: sale.date,
          full: true,
          fraction: 1,
          sale,
        })
        return
      }
      throw refusal(response, 'the sale could not be voided')
    },

    async validateAddress(credentials, address) {
      const response = await call(credentials, 'POST', '/api/v2/addresses/resolve', avalaraAddress(address))
      if (response.status !== 200) throw refusal(response, 'the address could not be checked')
      const messages: string[] = (Array.isArray(response.body?.messages) ? response.body.messages : [])
        .map((message: any) => String(message?.summary ?? message?.details ?? ''))
        .filter(Boolean)
      const errors = (Array.isArray(response.body?.messages) ? response.body.messages : []).some(
        (message: any) => String(message?.severity ?? '').toLowerCase() === 'error',
      )
      const first = Array.isArray(response.body?.validatedAddresses)
        ? response.body.validatedAddresses[0]
        : null
      const normalized = first ? normalizeTaxAddress(first) : null
      const unknown = String(first?.addressType ?? '') === 'UnknownAddressType'
      return { valid: Boolean(normalized) && !errors && !unknown, normalized, messages }
    },
  }
}
