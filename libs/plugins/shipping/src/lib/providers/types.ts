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

/** A carrier platform the PLATFORM holds an account with, one child per workspace. */
export type PlatformProviderId = 'shippo' | 'easypost'

/**
 * A carrier platform the MERCHANT holds the account with (AGL-3632): the
 * workspace connects its own Easyship or Sendcloud API credentials, labels
 * are billed to it by that platform, and nothing passes through Aglyn's
 * books. See `server/own-accounts.ts`.
 */
export type OwnAccountProviderId = 'easyship' | 'sendcloud'

export type ShippingProviderId = PlatformProviderId | OwnAccountProviderId

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
  /** EasyPost: the child user's production key. Easyship, Sendcloud: the merchant's own key. Shippo: absent. */
  apiKey?: string
  /** Sendcloud: the merchant's API secret, the other half of its Basic credential. */
  apiSecret?: string
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
  /**
   * A public `https` address of the label file. Empty when the provider only
   * serves it to an authenticated caller; then `documentRef` names it for
   * {@link ShippingProvider.labelDocument}, and the plugin serves it itself.
   */
  labelUrl: string
  /** The provider's handle on the label file, when `labelUrl` is empty. */
  documentRef?: string
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

/**
 * The carriers a merchant may connect an account of their own for with the
 * account-holder form: an account number, a contact and a billing address.
 */
export type ContactFormCarrier = 'ups' | 'fedex'

/**
 * A carrier a merchant may connect: one of the contact-form carriers, or a
 * provider's own carrier type (EasyPost's `DhlExpressAccount`) connected
 * with the credential fields the provider names for it.
 */
export type ConnectableCarrier = string

/** One credential a provider asks for to connect a carrier account. */
export interface CarrierCredentialField {
  key: string
  label: string
  /** Typed as a password, and never echoed back. */
  secret: boolean
  /** A yes-or-no field. */
  checkbox?: boolean
}

/** A carrier the merchant can connect on this provider, and how. */
export interface ConnectableCarrierForm {
  carrier: ConnectableCarrier
  label: string
  /**
   * `contact`: account number, account holder and billing address (Shippo's
   * UPS and FedEx). `credentials`: the provider's own fields for the carrier.
   */
  flow: 'contact' | 'credentials'
  fields: CarrierCredentialField[]
}

export interface ConnectCarrierInput {
  carrier: ConnectableCarrier
  accountNumber: string
  /** The `credentials` flow's values, keyed as the form's fields. */
  credentials?: Record<string, string>
  /** A name the merchant reads the account by. */
  description?: string
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
      /**
       * What was quoted, for a provider whose rates are not tied to a
       * shipment it keeps (Sendcloud): the label is announced from this.
       */
      shipment?: Omit<ProviderShipmentInput, 'signal'>
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
  /** The carriers a merchant can connect an account of their own for, and how; absent is Shippo's two. */
  connectableCarriers?(account: ProviderAccount): Promise<ConnectableCarrierForm[]>
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
  /**
   * Checks a merchant's own credentials (AGL-3632) and names the account they
   * open, before they are kept. Only an own-account provider has it.
   */
  verifyCredentials?(account: ProviderAccount): Promise<{ accountName: string }>
  /** The label file a label's `documentRef` names, for a provider that serves it only to its caller. */
  labelDocument?(
    account: ProviderAccount,
    input: { documentRef: string; shipmentId: string },
  ): Promise<{ contentType: string; body: Uint8Array }>
}

/** A provider refused, or could not be reached. `status` is HTTP's, 0 for a network failure. */
export class ShippingProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The platform, or `shipperhq` for the checkout rate-rules service (AGL-3632). */
    readonly providerId: ShippingProviderId | 'shipperhq',
    /** The provider's own words, safe to show a merchant. */
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ShippingProviderError'
  }
}
