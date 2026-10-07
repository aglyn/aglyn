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
  PluginShippingAddress,
  PluginShippingAddressCheck,
  PluginShippingParcel,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import type { PluginTrackingStatus } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'

/**
 * THE PROVIDER CONTRACT (AGL-3612): one carrier platform behind the shapes
 * the rest of this plugin speaks.
 *
 * Every adapter is `fetch` and nothing else — no vendor SDK rides into a
 * server bundle — and every one is reached with the PLATFORM's credential,
 * scoped to one workspace's account on the platform: Shippo by its managed
 * account header, EasyPost by the child user's own key. A workspace never
 * holds a vendor credential of its own, and the platform is billed for every
 * label, which is why `label-billing.ts` exists.
 *
 * Amounts are integer cents, weights grams, lengths centimetres, on both
 * sides of this contract; an adapter converts at its own edge.
 */

export type ShippingProviderId = 'shippo' | 'easypost'

/** How a label is printed. */
export type LabelFormat = 'pdf_4x6' | 'pdf_letter' | 'zpl'

export const LABEL_FORMATS: readonly LabelFormat[] = ['pdf_4x6', 'pdf_letter', 'zpl']

/** Who has to sign for the parcel. */
export type SignatureOption = 'none' | 'standard' | 'adult'

export const SIGNATURE_OPTIONS: readonly SignatureOption[] = ['none', 'standard', 'adult']

/** A workspace's account at the provider, opened (never stored this way). */
export interface ProviderAccount {
  providerId: ShippingProviderId
  /** Shippo: the managed account's object id. EasyPost: the child user's id. */
  accountId: string
  /** EasyPost: the child user's production key. Shippo: absent. */
  apiKey?: string
}

/** A customs line, for a parcel that crosses a border. */
export interface ProviderCustomsItem {
  description: string
  quantity: number
  /** Value of the whole line. */
  valueCents: number
  /** Weight of the whole line. */
  weightGrams: number
  hsCode?: string
  originCountry: string
}

export interface ProviderShipmentInput {
  from: PluginShippingAddress
  to: PluginShippingAddress
  parcels: PluginShippingParcel[]
  currency: string
  /** The goods' value; used for customs and insurance. */
  valueCents: number
  /** Insure for this much; 0 or absent buys no insurance. */
  insuranceCents?: number
  signature?: SignatureOption
  /** A return: the carrier bills on scan, from `from` (the customer) to `to`. */
  isReturn?: boolean
  customs?: {
    items: ProviderCustomsItem[]
    /** Who certifies the declaration. */
    signer: string
  }
  /** The carrier accounts to rate with; absent means every active one. */
  carrierAccounts?: string[]
  signal?: AbortSignal
}

/** What a rate is, relative to the others in its quote. */
export type RateBadge = 'cheapest' | 'fastest' | 'best_value'

export interface ProviderRate {
  /** The provider's id for this rate, valid while its shipment is. */
  rateId: string
  shipmentId: string
  /** `carrier:service`, stable across quotes. */
  serviceKey: string
  carrier: string
  service: string
  label: string
  amountCents: number
  currency: string
  estimatedDays?: number
  badges: RateBadge[]
  carrierAccountId?: string
}

export interface ProviderQuote {
  shipmentId: string
  rates: ProviderRate[]
  /** Why a carrier returned no rate, in its own words. */
  messages: string[]
}

export interface ProviderLabel {
  providerLabelId: string
  shipmentId: string
  trackingNumber: string
  trackingUrl?: string
  labelUrl: string
  commercialInvoiceUrl?: string
  carrier: string
  serviceKey: string
  serviceLabel: string
  /** What the provider charged the platform. */
  amountCents: number
  currency: string
}

/** A refund request's state at the provider. */
export type ProviderVoidStatus = 'pending' | 'refunded' | 'rejected'

export interface ProviderTracking {
  status: PluginTrackingStatus
  detail?: string
  atMs: number
  trackingUrl?: string
}

/** A carrier account connected to the workspace's provider account. */
export interface ProviderCarrierAccount {
  id: string
  carrier: string
  carrierName: string
  /** The carrier's own account number, when it is the merchant's. */
  accountNumber?: string
  active: boolean
  /** `true` for the provider's discounted account, `false` for the merchant's own. */
  platformOwned: boolean
  /** `connected`, or what is still needed. */
  authorization: 'connected' | 'pending' | 'disconnected'
}

/** The carriers a merchant may connect an account of their own for. */
export type ConnectableCarrier = 'ups' | 'fedex'

export interface ConnectCarrierInput {
  carrier: ConnectableCarrier
  accountNumber: string
  /** The account holder, as the carrier knows them. */
  contact: {
    name: string
    company?: string
    email: string
    phone: string
  }
  /** The account's billing address. */
  address: PluginShippingAddress
  /** Where the carrier sends the merchant back after authorizing, when it asks. */
  redirectUri?: string
  /** Echoed on that redirect. */
  state?: string
}

export interface ShippingProvider {
  readonly id: ShippingProviderId
  readonly displayName: string
  /** Opens the workspace's account at the provider. */
  createAccount(input: {
    orgId: string
    name: string
    email: string
    company: string
  }): Promise<ProviderAccount>
  quoteRates(account: ProviderAccount, input: ProviderShipmentInput): Promise<ProviderQuote>
  buyLabel(
    account: ProviderAccount,
    input: {
      shipmentId: string
      rateId: string
      format: LabelFormat
      insuranceCents?: number
      /** Ours, for the provider's records and its webhooks. */
      reference: string
    },
  ): Promise<ProviderLabel>
  voidLabel(
    account: ProviderAccount,
    input: { providerLabelId: string; shipmentId: string },
  ): Promise<ProviderVoidStatus>
  getTracking(
    account: ProviderAccount,
    input: { carrier: string; trackingNumber: string },
  ): Promise<ProviderTracking>
  /** Asks the provider to send tracking webhooks for a parcel shipped any way. */
  registerTracker(
    account: ProviderAccount,
    input: { carrier: string; trackingNumber: string; reference: string },
  ): Promise<void>
  validateAddress(
    account: ProviderAccount,
    address: PluginShippingAddress,
  ): Promise<PluginShippingAddressCheck>
  listCarrierAccounts(account: ProviderAccount): Promise<ProviderCarrierAccount[]>
  /** Connects a carrier account of the merchant's own; absent where the provider cannot. */
  connectCarrierAccount?(
    account: ProviderAccount,
    input: ConnectCarrierInput,
  ): Promise<{ carrierAccount: ProviderCarrierAccount; authorizeUrl?: string }>
  setCarrierAccountActive?(
    account: ProviderAccount,
    carrierAccountId: string,
    active: boolean,
  ): Promise<void>
}

/** A provider refused, or could not be reached. `status` is HTTP's, 0 for a network failure. */
export class ShippingProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerId: ShippingProviderId,
    /** The provider's own words, safe to show a merchant. */
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ShippingProviderError'
  }
}
