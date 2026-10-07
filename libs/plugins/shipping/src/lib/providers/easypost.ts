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
import { easypostTrackingStatus } from '../model/tracking-status'
import {
  centsToDecimal,
  cmToInches,
  decimalToCents,
  gramsToOunces,
  providerJson,
  type ProviderFetch,
} from './http'
import {
  ShippingProviderError,
  type CarrierCredentialField,
  type ConnectableCarrierForm,
  type LabelFormat,
  type ProviderAccount,
  type ProviderCarrierAccount,
  type ProviderLabel,
  type ProviderQuote,
  type ProviderRate,
  type ProviderVoidStatus,
  type ShippingProvider,
} from './types'

/**
 * EASYPOST, THROUGH CHILD USERS (AGL-3612): the secondary provider.
 *
 * Each workspace is a child User of the platform's EasyPost account
 * (`POST /users`, Child Users guide), and "all child Users roll their billing
 * up to their parent User", so labels bill the platform as Shippo's do. A
 * child acts with its OWN key, returned once in the create response's
 * `api_keys` — which is why that key is stored sealed and never shown.
 *
 * EasyPost prices one parcel per shipment and speaks inches and ounces. A
 * shipment of several parcels is rated as one parcel of their summed weight
 * and largest dimensions, which is the conservative reading: never lighter
 * or smaller than what is in the box. Rates carry no cheapest/fastest
 * attribute here, so the badges are worked out from the rates themselves.
 */

export const EASYPOST_API_BASE = 'https://api.easypost.com/v2'

const LABEL_FILE_FORMAT: Readonly<Record<LabelFormat, string>> = {
  pdf_4x6: 'PDF',
  pdf_letter: 'PDF',
  zpl: 'ZPL',
}

function easypostAddress(address: PluginShippingAddress): Record<string, unknown> {
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
    ...(address.residential !== undefined ? { residential: address.residential } : {}),
  }
}

/** Several parcels as the one EasyPost rates: summed weight, largest sides. */
export function combineParcels(parcels: PluginShippingParcel[]): PluginShippingParcel {
  const largest = (field: 'lengthCm' | 'widthCm' | 'heightCm') =>
    parcels.reduce((most, parcel) => Math.max(most, Number(parcel[field] ?? 0)), 0)
  return {
    weightGrams: parcels.reduce((sum, parcel) => sum + Math.max(0, parcel.weightGrams), 0),
    lengthCm: largest('lengthCm') || 10,
    widthCm: largest('widthCm') || 10,
    heightCm: largest('heightCm') || 10,
  }
}

interface EasypostRate {
  id?: string
  carrier?: string
  service?: string
  rate?: string
  currency?: string
  delivery_days?: number | null
  carrier_account_id?: string
}

interface EasypostShipment {
  id?: string
  rates?: EasypostRate[]
  messages?: Array<{ carrier?: string; message?: string }>
  tracking_code?: string
  tracker?: { public_url?: string } | null
  postage_label?: { label_url?: string; label_pdf_url?: string; label_zpl_url?: string } | null
  selected_rate?: EasypostRate | null
  forms?: Array<{ form_type?: string; form_url?: string }>
}

function readRate(rate: EasypostRate, shipmentId: string): ProviderRate | null {
  const rateId = String(rate.id ?? '')
  const carrier = String(rate.carrier ?? '').trim()
  const service = String(rate.service ?? '').trim()
  if (!rateId || !carrier || !service) return null
  return {
    rateId,
    shipmentId,
    serviceKey: `${carrier.toLowerCase()}:${service.toLowerCase()}`,
    carrier,
    service,
    label: `${carrier} ${service.replace(/([a-z])([A-Z])/g, '$1 $2')}`,
    amountCents: decimalToCents(rate.rate),
    currency: String(rate.currency ?? 'USD').toLowerCase(),
    ...(typeof rate.delivery_days === 'number' ? { estimatedDays: rate.delivery_days } : {}),
    badges: [],
    ...(rate.carrier_account_id ? { carrierAccountId: rate.carrier_account_id } : {}),
  }
}

/** Cheapest and fastest, worked out from the rates when the provider does not say. */
export function badgeRates(rates: ProviderRate[]): ProviderRate[] {
  if (!rates.length) return rates
  const cheapest = Math.min(...rates.map((rate) => rate.amountCents))
  const timed = rates.filter((rate) => typeof rate.estimatedDays === 'number')
  const fastest = timed.length ? Math.min(...timed.map((rate) => rate.estimatedDays as number)) : null
  return rates.map((rate) => ({
    ...rate,
    badges: [
      ...rate.badges,
      ...(rate.amountCents === cheapest && !rate.badges.includes('cheapest') ? (['cheapest'] as const) : []),
      ...(fastest !== null && rate.estimatedDays === fastest && !rate.badges.includes('fastest')
        ? (['fastest'] as const)
        : []),
    ],
  }))
}

export interface EasypostProviderOptions {
  /** The platform's key: `EASYPOST_API_KEY`. */
  apiKey: string
  fetchImpl?: ProviderFetch
}

export function createEasypostProvider(options: EasypostProviderOptions): ShippingProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const basic = (key: string) =>
    `Basic ${Buffer.from(`${key}:`, 'utf8').toString('base64')}`
  const childKey = (account: ProviderAccount): string => {
    if (!account.apiKey) {
      throw new ShippingProviderError('This workspace’s EasyPost key is missing', 500, 'easypost')
    }
    return account.apiKey
  }
  const call = <T>(
    key: string,
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
  ) =>
    providerJson<T>({
      providerId: 'easypost',
      fetchImpl,
      url: `${EASYPOST_API_BASE}${path}`,
      method: init.method ?? 'GET',
      headers: { Authorization: basic(key) },
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    })

  /** The test key mints test children; a production key, production ones. */
  const platformMode = options.apiKey.startsWith('EZTK') ? 'test' : 'production'

  return {
    id: 'easypost',
    displayName: 'EasyPost',

    async createAccount(input) {
      const user = await call<{
        id?: string
        api_keys?: Array<{ key?: string; mode?: string; active?: boolean }>
      }>(options.apiKey, '/users', {
        method: 'POST',
        body: { user: { name: (input.company || input.name).slice(0, 100) } },
      })
      const key = (user?.api_keys ?? []).find(
        (candidate) => candidate?.mode === platformMode && candidate.active !== false && candidate.key,
      )?.key
      if (!user?.id || !key) {
        throw new ShippingProviderError('EasyPost opened no account', 502, 'easypost')
      }
      return { providerId: 'easypost', accountId: user.id, apiKey: key }
    },

    async quoteRates(account, input): Promise<ProviderQuote> {
      const parcel = combineParcels(input.parcels)
      const optionsBody: Record<string, unknown> = {}
      if (input.signature === 'standard') optionsBody['delivery_confirmation'] = 'SIGNATURE'
      if (input.signature === 'adult') optionsBody['delivery_confirmation'] = 'ADULT_SIGNATURE'
      const shipment = await call<EasypostShipment>(childKey(account), '/shipments', {
        method: 'POST',
        signal: input.signal,
        body: {
          shipment: {
            from_address: easypostAddress(input.from),
            to_address: easypostAddress(input.to),
            parcel: {
              length: cmToInches(parcel.lengthCm ?? 10),
              width: cmToInches(parcel.widthCm ?? 10),
              height: cmToInches(parcel.heightCm ?? 10),
              weight: gramsToOunces(parcel.weightGrams),
            },
            ...(Object.keys(optionsBody).length ? { options: optionsBody } : {}),
            ...(input.isReturn ? { is_return: true } : {}),
            ...(input.customs
              ? {
                  customs_info: {
                    contents_type: input.isReturn ? 'returned_goods' : 'merchandise',
                    customs_certify: true,
                    customs_signer: input.customs.signer,
                    non_delivery_option: 'return',
                    customs_items: input.customs.items.map((item) => ({
                      description: item.description.slice(0, 100),
                      quantity: item.quantity,
                      value: Number(centsToDecimal(item.valueCents)),
                      weight: gramsToOunces(item.weightGrams),
                      origin_country: item.originCountry,
                      ...(item.hsCode ? { hs_tariff_number: item.hsCode } : {}),
                    })),
                  },
                }
              : {}),
            ...(input.carrierAccounts?.length ? { carrier_accounts: input.carrierAccounts } : {}),
          },
        },
      })
      const shipmentId = String(shipment?.id ?? '')
      return {
        shipmentId,
        rates: badgeRates(
          (shipment?.rates ?? [])
            .map((rate) => readRate(rate, shipmentId))
            .filter((rate): rate is ProviderRate => Boolean(rate)),
        ),
        messages: (shipment?.messages ?? [])
          .map((message) => String(message?.message ?? '').trim())
          .filter(Boolean),
      }
    },

    async buyLabel(account, input): Promise<ProviderLabel> {
      const key = childKey(account)
      let shipment = await call<EasypostShipment>(
        key,
        `/shipments/${encodeURIComponent(input.shipmentId)}/buy`,
        {
          method: 'POST',
          body: {
            rate: { id: input.rateId },
            ...(input.insuranceCents && input.insuranceCents > 0
              ? { insurance: centsToDecimal(input.insuranceCents) }
              : {}),
          },
        },
      )
      // A label is bought as PNG; the file the merchant prints is converted
      // from it (`GET /shipments/:id/label?file_format=`).
      const fileFormat = LABEL_FILE_FORMAT[input.format]
      const converted = await call<EasypostShipment>(
        key,
        `/shipments/${encodeURIComponent(input.shipmentId)}/label?file_format=${fileFormat}`,
      ).catch(() => null)
      if (converted?.postage_label) shipment = { ...shipment, postage_label: converted.postage_label }
      const labelUrl =
        (fileFormat === 'ZPL'
          ? shipment?.postage_label?.label_zpl_url
          : shipment?.postage_label?.label_pdf_url) ?? shipment?.postage_label?.label_url
      if (!labelUrl || !shipment?.tracking_code) {
        throw new ShippingProviderError('EasyPost could not create the label', 422, 'easypost')
      }
      const rate = shipment.selected_rate ? readRate(shipment.selected_rate, input.shipmentId) : null
      const invoice = (shipment.forms ?? []).find((form) => form?.form_type === 'commercial_invoice')
      return {
        providerLabelId: input.shipmentId,
        shipmentId: input.shipmentId,
        trackingNumber: shipment.tracking_code,
        ...(shipment.tracker?.public_url ? { trackingUrl: shipment.tracker.public_url } : {}),
        labelUrl,
        ...(invoice?.form_url ? { commercialInvoiceUrl: invoice.form_url } : {}),
        carrier: rate?.carrier ?? '',
        serviceKey: rate?.serviceKey ?? '',
        serviceLabel: rate?.label ?? '',
        amountCents: rate?.amountCents ?? 0,
        currency: rate?.currency ?? 'usd',
      }
    },

    async voidLabel(account, input): Promise<ProviderVoidStatus> {
      const refunded = await call<{ refund_status?: string }>(
        childKey(account),
        `/shipments/${encodeURIComponent(input.shipmentId)}/refund`,
        { method: 'POST', body: {} },
      )
      switch (String(refunded?.refund_status ?? '')) {
        case 'refunded':
          return 'refunded'
        case 'rejected':
        case 'not_applicable':
          return 'rejected'
        default:
          return 'pending'
      }
    },

    async getTracking(account, input) {
      const tracker = await call<{
        status?: string
        status_detail?: string
        updated_at?: string
        public_url?: string
      }>(childKey(account), '/trackers', {
        method: 'POST',
        body: { tracker: { tracking_code: input.trackingNumber, carrier: input.carrier } },
      })
      return {
        status: easypostTrackingStatus(tracker?.status) ?? 'pre_transit',
        ...(tracker?.status_detail ? { detail: tracker.status_detail } : {}),
        atMs: Date.parse(String(tracker?.updated_at ?? '')) || Date.now(),
        ...(tracker?.public_url ? { trackingUrl: tracker.public_url } : {}),
      }
    },

    async registerTracker(account, input) {
      await call(childKey(account), '/trackers', {
        method: 'POST',
        body: { tracker: { tracking_code: input.trackingNumber, carrier: input.carrier } },
      })
    },

    async validateAddress(account, address): Promise<PluginShippingAddressCheck> {
      const result = await call<{
        street1?: string
        street2?: string | null
        city?: string
        state?: string
        zip?: string
        country?: string
        residential?: boolean | null
        verifications?: {
          delivery?: { success?: boolean; errors?: Array<{ message?: string }> }
        }
      }>(childKey(account), '/addresses', {
        method: 'POST',
        body: { address: easypostAddress(address), verify: ['delivery'] },
      })
      const delivery = result?.verifications?.delivery
      const messages = (delivery?.errors ?? [])
        .map((error) => String(error?.message ?? '').trim())
        .filter(Boolean)
      if (!delivery) return { verdict: 'unknown', messages }
      if (!delivery.success) return { verdict: 'invalid', messages }
      const suggested: PluginShippingAddress = {
        ...address,
        line1: result?.street1 ?? address.line1,
        line2: result?.street2 ?? address.line2,
        city: result?.city ?? address.city,
        state: result?.state ?? address.state,
        postalCode: result?.zip ?? address.postalCode,
        country: result?.country ?? address.country,
        ...(typeof result?.residential === 'boolean' ? { residential: result.residential } : {}),
      }
      const differs = (['line1', 'line2', 'city', 'state', 'postalCode'] as const).some(
        (field) =>
          String(suggested[field] ?? '').trim().toUpperCase() !==
          String(address[field] ?? '').trim().toUpperCase(),
      )
      return differs ? { verdict: 'corrected', suggested, messages } : { verdict: 'valid', messages }
    },

    async listCarrierAccounts(account): Promise<ProviderCarrierAccount[]> {
      const rows = await call<
        Array<{
          id?: string
          type?: string
          readable?: string
          description?: string
          billing_type?: string
        }>
      >(childKey(account), '/carrier_accounts')
      return (Array.isArray(rows) ? rows : [])
        .filter((row) => row?.id && row?.type)
        .map((row) => ({
          id: String(row.id),
          carrier: String(row.type).replace(/Account$/, '').toLowerCase(),
          carrierName: String(row.readable ?? row.type),
          active: true,
          platformOwned: row.billing_type === 'easypost' || row.billing_type === 'carrier_default' || !row.description,
          authorization: 'connected' as const,
        }))
    },

    /**
     * The carriers a child can bring its own account for (AGL-3632), read off
     * EasyPost's `GET /carrier_types`: each type names the credential fields
     * it takes. A type with `custom_workflow` (UPS, FedEx and the like, which
     * register through their own flows) is left out, and so is a field
     * EasyPost marks `fake` or `readonly`, which it never wants typed.
     */
    async connectableCarriers(account): Promise<ConnectableCarrierForm[]> {
      const rows = await call<EasypostCarrierType[]>(childKey(account), '/carrier_types')
      return readCarrierTypes(rows)
    },

    async connectCarrierAccount(account, input) {
      const credentials = Object.fromEntries(
        Object.entries(input.credentials ?? {})
          .map(([key, value]) => [key, String(value ?? '').trim()] as const)
          .filter(([key, value]) => /^[a-z0-9_]{1,60}$/.test(key) && value),
      )
      const created = await call<{ id?: string; type?: string; readable?: string; description?: string }>(
        childKey(account),
        '/carrier_accounts',
        {
          method: 'POST',
          body: {
            carrier_account: {
              type: input.carrier,
              description: (input.description || `${input.carrier.replace(/Account$/, '')} (own account)`).slice(0, 100),
              credentials,
            },
          },
        },
      )
      const id = String(created?.id ?? '')
      if (!id) throw new ShippingProviderError('EasyPost connected no account', 502, 'easypost')
      const accountNumber = credentials['account_number'] || input.accountNumber
      return {
        carrierAccount: {
          id,
          carrier: String(created?.type ?? input.carrier).replace(/Account$/, '').toLowerCase(),
          carrierName: String(created?.readable ?? input.carrier),
          ...(accountNumber ? { accountNumber } : {}),
          active: true,
          platformOwned: false,
          authorization: 'connected',
        },
      }
    },
  }
}

/** One row of EasyPost's `GET /carrier_types`. */
export interface EasypostCarrierType {
  type?: string
  readable?: string
  fields?: {
    credentials?: Record<string, { visibility?: string; label?: string } | undefined>
    custom_workflow?: boolean
  } | null
}

/** EasyPost's carrier types as connect forms: only the ones a form can connect. */
export function readCarrierTypes(rows: unknown): ConnectableCarrierForm[] {
  const forms: ConnectableCarrierForm[] = []
  for (const row of Array.isArray(rows) ? (rows as EasypostCarrierType[]) : []) {
    const type = String(row?.type ?? '')
    const credentials = row?.fields?.credentials
    if (!/^[A-Za-z0-9]{2,60}Account$/.test(type) || row?.fields?.custom_workflow === true || !credentials) continue
    const fields: CarrierCredentialField[] = []
    for (const [key, spec] of Object.entries(credentials)) {
      const visibility = String(spec?.visibility ?? 'visible')
      if (!/^[a-z0-9_]{1,60}$/.test(key) || visibility === 'fake' || visibility === 'readonly') continue
      fields.push({
        key,
        label: String(spec?.label ?? key).slice(0, 80),
        secret: visibility === 'password' || visibility === 'masked',
        ...(visibility === 'checkbox' ? { checkbox: true } : {}),
      })
    }
    if (!fields.length) continue
    forms.push({ carrier: type, label: String(row.readable ?? type).slice(0, 80), flow: 'credentials', fields })
  }
  return forms.sort((a, b) => a.label.localeCompare(b.label))
}
