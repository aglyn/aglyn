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
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { shippoTrackingStatus } from '../model/tracking-status'
import {
  centsToDecimal,
  decimalToCents,
  mapPosition,
  providerJson,
  type ProviderFetch,
} from './http'
import {
  ShippingProviderError,
  type ConnectableCarrierForm,
  type ConnectCarrierInput,
  type LabelFormat,
  type ProviderAccount,
  type ProviderCarrierAccount,
  type ProviderQuote,
  type ProviderRate,
  type ProviderShipmentInput,
  type ProviderVoidStatus,
  type RateBadge,
  type ShippingProvider,
} from './types'

/**
 * SHIPPO, THROUGH PLATFORM ACCOUNTS (AGL-3612).
 *
 * Every workspace is a Managed Shippo Account the platform opens for it
 * (`POST /shippo-accounts`) and owns: it has no Shippo login, and every call
 * on its behalf is the platform's token with `SHIPPO-ACCOUNT-ID` naming it
 * (docs.goshippo.com, Platform Accounts → Using your Platform Account). So
 * the token is one environment variable, `SHIPPO_API_TOKEN`, and what this
 * plugin stores per workspace is only the managed account's id.
 *
 * Labels bought on Shippo's own carrier accounts are billed to the PLATFORM's
 * Shippo account; a label bought on a carrier account the merchant connected
 * is billed by that carrier to the merchant (Carrier accounts guide). The
 * label record says which, and only the first is recovered.
 *
 * Request shapes are the API reference's: `/shipments/` with `async: false`,
 * `/transactions` with a rate's object id, `/refunds`, `/tracks/`, and the
 * v2 address validator. Units are sent metric — Shippo accepts `cm` and `g`.
 * API version pinned to `2018-02-08`, the version the reference documents.
 */

export const SHIPPO_API_BASE = 'https://api.goshippo.com'
export const SHIPPO_API_VERSION = '2018-02-08'

/** Shippo's print formats, by ours. */
const SHIPPO_LABEL_FILE_TYPE: Readonly<Record<LabelFormat, string>> = {
  pdf_4x6: 'PDF_4x6',
  pdf_letter: 'PDF',
  zpl: 'ZPLII',
}

const SHIPPO_SIGNATURE = { standard: 'STANDARD', adult: 'ADULT' } as const

/** The parameter names a carrier account's connect asks for, per carrier. */
/** The carriers Shippo connects here: the account-holder form, UPS then signing in at UPS. */
export const SHIPPO_CONNECTABLE_CARRIERS: ConnectableCarrierForm[] = [
  { carrier: 'ups', label: 'UPS', flow: 'contact', fields: [] },
  { carrier: 'fedex', label: 'FedEx', flow: 'contact', fields: [] },
]

function carrierParameters(input: ConnectCarrierInput): Record<string, unknown> {
  const [firstName, ...rest] = input.contact.name.trim().split(/\s+/)
  const lastName = rest.join(' ') || firstName
  const address = input.address
  if (input.carrier === 'ups') {
    return {
      billing_address_street1: address.line1 ?? '',
      billing_address_street2: address.line2 ?? '',
      billing_address_city: address.city ?? '',
      billing_address_state: address.state ?? '',
      billing_address_zip: address.postalCode ?? '',
      billing_address_country_iso2: address.country,
      pickup_address_same_as_billing_address: true,
      company: input.contact.company ?? '',
      email: input.contact.email,
      full_name: input.contact.name,
      phone: input.contact.phone,
      ups_agreements: true,
    }
  }
  return {
    first_name: firstName,
    last_name: lastName,
    phone_number: input.contact.phone,
    from_address_st: address.line1 ?? '',
    from_address_city: address.city ?? '',
    from_address_state: address.state ?? '',
    from_address_zip: address.postalCode ?? '',
    from_address_country_iso2: address.country,
    use_multi_factor_registration: true,
    verification_option: 'EMAIL',
  }
}

function shippoAddress(address: PluginShippingAddress): Record<string, unknown> {
  return {
    name: address.name || address.company || 'Recipient',
    ...(address.company ? { company: address.company } : {}),
    street1: address.line1 ?? '',
    ...(address.line2 ? { street2: address.line2 } : {}),
    city: address.city ?? '',
    state: address.state ?? '',
    zip: address.postalCode ?? '',
    country: address.country,
    ...(address.phone ? { phone: address.phone } : {}),
    ...(address.email ? { email: address.email } : {}),
    ...(address.residential !== undefined ? { is_residential: address.residential } : {}),
  }
}

interface ShippoRate {
  object_id?: string
  amount?: string
  currency?: string
  provider?: string
  servicelevel?: { name?: string; token?: string }
  estimated_days?: number | null
  attributes?: string[]
  carrier_account?: string
}

interface ShippoShipment {
  object_id?: string
  rates?: ShippoRate[]
  messages?: Array<{ source?: string; text?: string }>
}

interface ShippoTransaction {
  object_id?: string
  status?: string
  tracking_number?: string
  tracking_url_provider?: string
  label_url?: string
  commercial_invoice_url?: string | null
  messages?: Array<{ text?: string }>
  rate?: ShippoRate | string
}

const BADGES: Readonly<Record<string, RateBadge>> = {
  CHEAPEST: 'cheapest',
  FASTEST: 'fastest',
  BESTVALUE: 'best_value',
}

function readRate(rate: ShippoRate, shipmentId: string): ProviderRate | null {
  const rateId = String(rate.object_id ?? '')
  const carrier = String(rate.provider ?? '').trim()
  const token = String(rate.servicelevel?.token ?? '').trim()
  if (!rateId || !carrier || !token) return null
  const serviceName = String(rate.servicelevel?.name ?? token).trim()
  return {
    rateId,
    shipmentId,
    serviceKey: `${carrier.toLowerCase()}:${token}`,
    carrier,
    service: token,
    label: serviceName.toLowerCase().startsWith(carrier.toLowerCase())
      ? serviceName
      : `${carrier} ${serviceName}`,
    amountCents: decimalToCents(rate.amount),
    currency: String(rate.currency ?? 'USD').toLowerCase(),
    ...(typeof rate.estimated_days === 'number' ? { estimatedDays: rate.estimated_days } : {}),
    badges: (rate.attributes ?? [])
      .map((attribute) => BADGES[String(attribute).toUpperCase()])
      .filter((badge): badge is RateBadge => Boolean(badge)),
    ...(rate.carrier_account ? { carrierAccountId: rate.carrier_account } : {}),
  }
}

export interface ShippoProviderOptions {
  /** The platform token: `SHIPPO_API_TOKEN`. */
  token: string
  fetchImpl?: ProviderFetch
}

export function createShippoProvider(options: ShippoProviderOptions): ShippingProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = (account?: ProviderAccount): Record<string, string> => ({
    Authorization: `ShippoToken ${options.token}`,
    'SHIPPO-API-VERSION': SHIPPO_API_VERSION,
    ...(account ? { 'SHIPPO-ACCOUNT-ID': account.accountId } : {}),
  })
  const call = <T>(
    account: ProviderAccount | undefined,
    path: string,
    init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; signal?: AbortSignal } = {},
  ) =>
    providerJson<T>({
      providerId: 'shippo',
      fetchImpl,
      url: `${SHIPPO_API_BASE}${path}`,
      method: init.method ?? 'GET',
      headers: headers(account),
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    })

  return {
    id: 'shippo',
    displayName: 'Shippo',

    async createAccount(input) {
      const [first, ...rest] = (input.name || input.company).trim().split(/\s+/)
      const created = await call<{ object_id?: string }>(undefined, '/shippo-accounts', {
        method: 'POST',
        body: {
          email: input.email,
          first_name: first || input.company,
          last_name: rest.join(' ') || first || input.company,
          company_name: input.company,
        },
      })
      if (!created?.object_id) {
        throw new ShippingProviderError('Shippo opened no account', 502, 'shippo')
      }
      return { providerId: 'shippo', accountId: created.object_id }
    },

    async quoteRates(account, input: ProviderShipmentInput): Promise<ProviderQuote> {
      const extra: Record<string, unknown> = {}
      if (input.signature && input.signature !== 'none') {
        extra['signature_confirmation'] = SHIPPO_SIGNATURE[input.signature]
      }
      if (input.insuranceCents && input.insuranceCents > 0) {
        extra['insurance'] = {
          amount: centsToDecimal(input.insuranceCents),
          currency: input.currency.toUpperCase(),
          content: 'Merchandise',
        }
      }
      if (input.isReturn) extra['is_return'] = true
      const shipment = await call<ShippoShipment>(account, '/shipments/', {
        method: 'POST',
        signal: input.signal,
        body: {
          address_from: shippoAddress(input.from),
          address_to: shippoAddress(input.to),
          parcels: input.parcels.map((parcel) => ({
            length: String(parcel.lengthCm ?? 10),
            width: String(parcel.widthCm ?? 10),
            height: String(parcel.heightCm ?? 10),
            distance_unit: 'cm',
            weight: String(Math.max(1, Math.round(parcel.weightGrams))),
            mass_unit: 'g',
          })),
          ...(Object.keys(extra).length ? { extra } : {}),
          ...(input.customs
            ? {
                customs_declaration: {
                  contents_type: input.isReturn ? 'RETURN_MERCHANDISE' : 'MERCHANDISE',
                  non_delivery_option: 'RETURN',
                  certify: true,
                  certify_signer: input.customs.signer,
                  items: input.customs.items.map((item) => ({
                    description: item.description.slice(0, 100),
                    quantity: item.quantity,
                    net_weight: String(Math.max(1, Math.round(item.weightGrams))),
                    mass_unit: 'g',
                    value_amount: centsToDecimal(item.valueCents),
                    value_currency: input.currency.toUpperCase(),
                    origin_country: item.originCountry,
                    ...(item.hsCode ? { tariff_number: item.hsCode } : {}),
                  })),
                },
              }
            : {}),
          ...(input.carrierAccounts?.length ? { carrier_accounts: input.carrierAccounts } : {}),
          async: false,
        },
      })
      const shipmentId = String(shipment?.object_id ?? '')
      return {
        shipmentId,
        rates: (shipment?.rates ?? [])
          .map((rate) => readRate(rate, shipmentId))
          .filter((rate): rate is ProviderRate => Boolean(rate)),
        messages: (shipment?.messages ?? [])
          .map((message) => String(message?.text ?? '').trim())
          .filter(Boolean),
      }
    },

    async buyLabel(account, input) {
      const transaction = await call<ShippoTransaction>(account, '/transactions', {
        method: 'POST',
        body: {
          rate: input.rateId,
          label_file_type: SHIPPO_LABEL_FILE_TYPE[input.format],
          metadata: input.reference.slice(0, 100),
          async: false,
        },
      })
      if (String(transaction?.status ?? '').toUpperCase() !== 'SUCCESS' || !transaction?.label_url) {
        const detail = (transaction?.messages ?? [])
          .map((message) => String(message?.text ?? ''))
          .filter(Boolean)
          .join(' ')
        throw new ShippingProviderError(
          'Shippo could not create the label',
          422,
          'shippo',
          detail || undefined,
        )
      }
      const rate = typeof transaction.rate === 'object' ? transaction.rate : undefined
      const read = rate ? readRate(rate, input.shipmentId) : null
      return {
        providerLabelId: String(transaction.object_id ?? ''),
        shipmentId: input.shipmentId,
        trackingNumber: String(transaction.tracking_number ?? ''),
        ...(transaction.tracking_url_provider
          ? { trackingUrl: transaction.tracking_url_provider }
          : {}),
        labelUrl: transaction.label_url,
        ...(transaction.commercial_invoice_url
          ? { commercialInvoiceUrl: transaction.commercial_invoice_url }
          : {}),
        carrier: read?.carrier ?? '',
        serviceKey: read?.serviceKey ?? '',
        serviceLabel: read?.label ?? '',
        amountCents: read?.amountCents ?? 0,
        currency: read?.currency ?? 'usd',
      }
    },

    async voidLabel(account, input): Promise<ProviderVoidStatus> {
      const refund = await call<{ status?: string }>(account, '/refunds', {
        method: 'POST',
        body: { transaction: input.providerLabelId, async: false },
      })
      switch (String(refund?.status ?? '').toUpperCase()) {
        case 'SUCCESS':
          return 'refunded'
        case 'ERROR':
          return 'rejected'
        default:
          return 'pending'
      }
    },

    async getTracking(account, input) {
      const track = await call<{
        tracking_status?: {
          status?: string
          substatus?: { code?: string } | null
          status_details?: string
          status_date?: string
        }
        tracking_url_provider?: string
      }>(
        account,
        `/tracks/${encodeURIComponent(input.carrier)}/${encodeURIComponent(input.trackingNumber)}`,
      )
      const status = shippoTrackingStatus(
        track?.tracking_status?.status,
        track?.tracking_status?.substatus?.code,
      )
      return {
        status: status ?? 'pre_transit',
        ...(track?.tracking_status?.status_details
          ? { detail: track.tracking_status.status_details }
          : {}),
        atMs: Date.parse(String(track?.tracking_status?.status_date ?? '')) || Date.now(),
        ...(track?.tracking_url_provider ? { trackingUrl: track.tracking_url_provider } : {}),
      }
    },

    async registerTracker(account, input) {
      await call(account, '/tracks/', {
        method: 'POST',
        body: {
          carrier: input.carrier,
          tracking_number: input.trackingNumber,
          metadata: input.reference.slice(0, 100),
        },
      })
    },

    async validateAddress(account, address): Promise<PluginShippingAddressCheck> {
      const query = new URLSearchParams()
      if (address.name) query.set('name', address.name)
      if (address.company) query.set('organization', address.company)
      if (address.line1) query.set('address_line_1', address.line1)
      if (address.line2) query.set('address_line_2', address.line2)
      if (address.city) query.set('city_locality', address.city)
      if (address.state) query.set('state_province', address.state)
      if (address.postalCode) query.set('postal_code', address.postalCode)
      query.set('country_code', address.country)
      const result = await call<{
        recommended_address?: {
          address_line_1?: string | null
          address_line_2?: string | null
          city_locality?: string | null
          state_province?: string | null
          postal_code?: string | null
          country_code?: string | null
        } | null
        analysis?: {
          validation_result?: {
            value?: string
            reasons?: Array<{ description?: string }>
          }
          address_type?: string
        }
        geo?: { latitude?: number | null; longitude?: number | null } | null
      }>(account, `/v2/addresses/validate?${query.toString()}`)
      const value = String(result?.analysis?.validation_result?.value ?? '')
      const messages = (result?.analysis?.validation_result?.reasons ?? [])
        .map((reason) => String(reason?.description ?? '').trim())
        .filter(Boolean)
      const recommended = result?.recommended_address
      const suggested: PluginShippingAddress | undefined = recommended
        ? {
            ...address,
            line1: recommended.address_line_1 ?? address.line1,
            line2: recommended.address_line_2 ?? address.line2,
            city: recommended.city_locality ?? address.city,
            state: recommended.state_province ?? address.state,
            postalCode: recommended.postal_code ?? address.postalCode,
            country: recommended.country_code ?? address.country,
            ...(result?.analysis?.address_type === 'residential'
              ? { residential: true }
              : result?.analysis?.address_type === 'commercial'
                ? { residential: false }
                : {}),
          }
        : undefined
      const differs =
        Boolean(suggested) &&
        (['line1', 'line2', 'city', 'state', 'postalCode'] as const).some(
          (field) =>
            String(suggested?.[field] ?? '').trim().toUpperCase() !==
            String(address[field] ?? '').trim().toUpperCase(),
        )
      if (value === 'invalid') return { verdict: 'invalid', messages }
      // Where Shippo placed it, when the answer carries a position — a local
      // delivery radius zone measures from it (AGL-3624).
      const coordinates = mapPosition(result?.geo?.latitude, result?.geo?.longitude)
      const placed = coordinates ? { coordinates } : {}
      if (value === 'valid' || value === 'partially_valid') {
        return differs && suggested
          ? { verdict: 'corrected', suggested, messages, ...placed }
          : { verdict: value === 'valid' ? 'valid' : 'unknown', messages, ...placed }
      }
      return { verdict: 'unknown', messages }
    },

    async listCarrierAccounts(account): Promise<ProviderCarrierAccount[]> {
      const page = await call<{
        results?: Array<{
          object_id?: string
          carrier?: string
          carrier_name?: string
          account_id?: string
          active?: boolean
          is_shippo_account?: boolean
          object_info?: { authentication?: { status?: string } }
        }>
      }>(account, '/carrier_accounts?results=100')
      return (page?.results ?? [])
        .filter((row) => row?.object_id && row?.carrier)
        .map((row) => {
          const auth = String(row.object_info?.authentication?.status ?? 'connected')
          return {
            id: String(row.object_id),
            carrier: String(row.carrier),
            carrierName: String(row.carrier_name ?? row.carrier).trim(),
            ...(row.is_shippo_account ? {} : row.account_id ? { accountNumber: String(row.account_id) } : {}),
            active: row.active !== false,
            platformOwned: row.is_shippo_account === true,
            authorization:
              auth === 'authorization_pending'
                ? 'pending'
                : auth === 'disconnected'
                  ? 'disconnected'
                  : 'connected',
          }
        })
    },

    async connectableCarriers(): Promise<ConnectableCarrierForm[]> {
      return SHIPPO_CONNECTABLE_CARRIERS
    },

    async connectCarrierAccount(account, input) {
      if (input.carrier !== 'ups' && input.carrier !== 'fedex') {
        throw new ShippingProviderError('Shippo connects UPS and FedEx accounts here', 400, 'shippo')
      }
      const created = await call<{ object_id?: string; carrier?: string; carrier_name?: string; active?: boolean }>(
        account,
        '/carrier_accounts/',
        {
          method: 'POST',
          body: {
            carrier: input.carrier,
            account_id: input.accountNumber,
            parameters: carrierParameters(input),
            active: true,
          },
        },
      )
      const id = String(created?.object_id ?? '')
      if (!id) throw new ShippingProviderError('Shippo connected no account', 502, 'shippo')
      const carrierAccount: ProviderCarrierAccount = {
        id,
        carrier: input.carrier,
        carrierName: String(created?.carrier_name ?? input.carrier.toUpperCase()),
        accountNumber: input.accountNumber,
        active: created?.active !== false,
        platformOwned: false,
        authorization: input.carrier === 'ups' ? 'pending' : 'connected',
      }
      // UPS authorizes by OAuth (Carrier authorization using OAuth): the
      // initiate address answers with a redirect to the carrier's sign-in,
      // and it takes the platform's token, so the browser cannot open it
      // itself. The Location it answers is what the merchant opens.
      if (input.carrier === 'ups' && input.redirectUri) {
        const query = new URLSearchParams({ redirect_uri: input.redirectUri })
        if (input.state) query.set('state', input.state)
        const response = await fetchImpl(
          `${SHIPPO_API_BASE}/carrier_accounts/${encodeURIComponent(id)}/signin/initiate?${query.toString()}`,
          { method: 'GET', headers: headers(account), redirect: 'manual' },
        )
        const location = response.headers.get('location')
        if (location) return { carrierAccount, authorizeUrl: location }
      }
      return { carrierAccount }
    },

    async setCarrierAccountActive(account, carrierAccountId, active) {
      await call(account, `/carrier_accounts/${encodeURIComponent(carrierAccountId)}`, {
        method: 'PUT',
        body: { active },
      })
    },
  }
}
