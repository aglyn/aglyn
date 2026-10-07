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

import type {
  TaxEngineAddress,
  TaxEngineEnvironment,
  TaxEngineProviderId,
  TaxExemptionType,
} from '../model/tax-engines'

/**
 * The vendor contract (AGL-3631). One adapter per vendor, each a thin REST
 * client over `fetch` with no SDK, so every call it makes is a request a spec
 * can intercept and read.
 *
 * Money crosses this boundary as integer cents in both directions; the
 * adapter converts to the vendor's decimal units and back. Every method
 * THROWS a `TaxProviderError` on a refusal or a network failure — the caller
 * decides whether that falls back, retries or is shown.
 */

/** A merchant's own credentials, opened from the sealed store for one call. */
export interface TaxProviderCredentials {
  provider: TaxEngineProviderId
  environment: TaxEngineEnvironment
  /** AvaTax: the account id the license key belongs to. */
  accountId?: string
  /** AvaTax: the company code transactions are filed under. */
  companyCode?: string
  /** AvaTax license key, or TaxJar API token. Never logged. */
  secret: string
}

/** One line of a document, money in cents. */
export interface TaxDocumentLine {
  id: string
  quantity: number
  /** The line's total BEFORE `discountCents`, exclusive of tax. */
  amountCents: number
  /** The part of a basket discount this line carries. */
  discountCents: number
  taxCode?: string
  itemCode?: string
  description?: string
  /** A line the seller marked exempt: sent with the vendor's non-taxable code. */
  exempt?: boolean
}

/** An exemption to apply to the whole document. */
export interface TaxDocumentExemption {
  type: TaxExemptionType
  certificateNumber?: string | null
}

/** A document, quoted or recorded. */
export interface TaxDocument {
  /** The document's code at the vendor: the order id, or a quote's own id. */
  code: string
  /** `YYYY-MM-DD`. */
  date: string
  /** ISO 4217, upper case. */
  currency: string
  /** Who bought: the email, lower case, or a stand-in for an anonymous sale. */
  customerCode: string
  shipFrom: TaxEngineAddress
  shipTo: TaxEngineAddress
  lines: readonly TaxDocumentLine[]
  shippingCents: number
  exemption?: TaxDocumentExemption | null
}

export interface TaxQuoteAnswer {
  taxCents: number
  lines: Array<{ id: string; taxCents: number }>
  shippingTaxCents: number
}

/** A paid sale, recorded with the tax the shopper was actually charged. */
export interface TaxCommitRequest extends TaxDocument {
  collectedTaxCents: number
}

/** A refund of part or all of a recorded sale. */
export interface TaxRefundRequest {
  /** The recorded sale's code. */
  orderCode: string
  /** The refund's own code, stable across retries. */
  refundCode: string
  date: string
  /** Whether this refund leaves nothing of the sale. */
  full: boolean
  /** The share of the sale refunded, in (0, 1]; 1 for a full refund. */
  fraction: number
  /** The recorded sale, for a vendor that files a refund as its own document. */
  sale: TaxCommitRequest
}

export interface TaxProvider {
  id: TaxEngineProviderId
  label: string
  /** Proves the credentials work. Resolves with what the vendor said about the account. */
  testConnection(credentials: TaxProviderCredentials): Promise<{ detail: string }>
  quote(credentials: TaxProviderCredentials, document: TaxDocument): Promise<TaxQuoteAnswer>
  /** Idempotent by `code`: recording the same sale twice leaves one document. */
  commit(credentials: TaxProviderCredentials, request: TaxCommitRequest): Promise<void>
  /** Idempotent by `refundCode`. */
  refund(credentials: TaxProviderCredentials, request: TaxRefundRequest): Promise<void>
  /** Removes a recorded sale. A sale the vendor no longer has is already void. */
  void(credentials: TaxProviderCredentials, sale: TaxCommitRequest): Promise<void>
  validateAddress(
    credentials: TaxProviderCredentials,
    address: TaxEngineAddress,
  ): Promise<{ valid: boolean; normalized: TaxEngineAddress | null; messages: string[] }>
}
