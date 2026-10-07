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

import type { PluginShippingAddress, PluginShippingParcel } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { combineParcels } from './easypost'
import { decimalToCents, providerJson, type ProviderFetch } from './http'
import {
  ShippingProviderError,
  type ProviderAccount,
  type ProviderLabel,
  type ProviderQuote,
  type ProviderRate,
  type ProviderShipmentInput,
  type ProviderVoidStatus,
  type RateBadge,
  type ShippingProvider,
} from './types'

/**
 * EASYSHIP, ON THE MERCHANT'S OWN ACCOUNT (AGL-3632), API version 2024-09.
 *
 * Every call carries the merchant's own access token (`Authorization:
 * Bearer`), so Easyship bills the merchant for each label from their own
 * Easyship balance and Aglyn is never in the money path.
 *
 * - A quote is a SHIPMENT: `POST /shipments` with no label returns the
 *   shipment's `easyship_shipment_id` and its `rates`, one per courier
 *   service. The shipment id is the quote's id and the courier service id
 *   is the rate's.
 * - Buying is `POST /shipments/{id}/label` with the chosen courier service:
 *   synchronous, answering the shipment with its trackings and documents.
 *   A document Easyship answers as a link is the label's address; one
 *   answered only as base64 is served by the plugin from `labelDocument`.
 * - Voiding is `POST /shipments/{id}/cancel`.
 * - Easyship reports tracking by webhook (`webhook-routes.ts`), so this
 *   adapter neither polls nor follows parcels it did not label.
 * - Address validation is a billed call at Easyship, so it is never made on
 *   the merchant's behalf here: every check answers `unknown`.
 *
 * Weights are kilograms and lengths centimetres on the wire, which is what
 * `shipping_settings.units` asks for.
 */

export const EASYSHIP_API_BASE = 'https://public-api.easyship.com/2024-09'

export interface EasyshipProviderOptions {
  fetchImpl?: ProviderFetch
  /** The Easyship item category a line with no tariff code ships as. */
  itemCategory?: string
}

interface EasyshipRate {
  courier_service?: { id?: string; name?: string; umbrella_name?: string } | null
  total_charge?: number | string
  currency?: string
  min_delivery_time?: number | null
  max_delivery_time?: number | null
  cost_rank?: number | null
  delivery_time_rank?: number | null
  value_for_money_rank?: number | null
}

interface EasyshipDocument {
  category?: string
  format?: string
  url?: string
  base64_encoded_strings?: string[]
}

interface EasyshipShipment {
  easyship_shipment_id?: string
  rates?: EasyshipRate[]
  courier_service?: { id?: string; name?: string; umbrella_name?: string } | null
  trackings?: Array<{ tracking_number?: string; leg_number?: number }>
  tracking_page_url?: string
  shipping_documents?: EasyshipDocument[]
  label_state?: string
}

function easyshipAddress(address: PluginShippingAddress): Record<string, unknown> {
  return {
    line_1: address.line1 ?? '',
    ...(address.line2 ? { line_2: address.line2 } : {}),
    ...(address.state ? { state: address.state } : {}),
    city: address.city ?? '',
    ...(address.postalCode ? { postal_code: address.postalCode } : {}),
    country_alpha2: address.country,
    contact_name: address.name || address.company || 'Recipient',
    ...(address.company ? { company_name: address.company } : {}),
    ...(address.phone ? { contact_phone: address.phone } : {}),
    ...(address.email ? { contact_email: address.email } : {}),
  }
}

const kilograms = (grams: number) => Math.max(0.01, Math.round(grams) / 1000)

/** A rate's key, stable across quotes: courier and service, slugged. */
export function easyshipServiceKey(courier: string, service: string): string {
  const slug = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  return `${slug(courier) || 'courier'}:${slug(service) || 'service'}`
}

function readRate(rate: EasyshipRate, shipmentId: string): ProviderRate | null {
  const service = rate.courier_service
  const rateId = String(service?.id ?? '')
  const name = String(service?.name ?? '').trim()
  const courier = String(service?.umbrella_name ?? name).trim()
  if (!rateId || !name) return null
  const badges: RateBadge[] = []
  if (rate.cost_rank === 1) badges.push('cheapest')
  if (rate.delivery_time_rank === 1) badges.push('fastest')
  if (rate.value_for_money_rank === 1) badges.push('best_value')
  return {
    rateId,
    shipmentId,
    serviceKey: easyshipServiceKey(courier, name),
    carrier: courier,
    service: name,
    label: name,
    amountCents: decimalToCents(rate.total_charge),
    currency: String(rate.currency ?? 'USD').toLowerCase(),
    ...(typeof rate.max_delivery_time === 'number' && rate.max_delivery_time > 0
      ? { estimatedDays: rate.max_delivery_time }
      : {}),
    badges,
  }
}

/** The label document: a link Easyship answered, or the base64 it answered instead. */
export function easyshipLabelDocument(shipment: EasyshipShipment): EasyshipDocument | null {
  return (shipment.shipping_documents ?? []).find((doc) => String(doc?.category ?? '').toLowerCase() === 'label') ?? null
}

function parcelsFor(input: ProviderShipmentInput, itemCategory: string | undefined): Record<string, unknown>[] {
  // One parcel, as EasyPost rates it: the summed weight in the largest box.
  // A shipment of several boxes is several labels here.
  const parcel: PluginShippingParcel = combineParcels(input.parcels)
  const items = input.customs?.items.length
    ? input.customs.items.map((item) => ({
        description: item.description.slice(0, 200),
        quantity: item.quantity,
        actual_weight: kilograms(item.weightGrams / Math.max(1, item.quantity)),
        declared_currency: input.currency.toUpperCase(),
        declared_customs_value: Math.round(item.valueCents / Math.max(1, item.quantity)) / 100,
        origin_country_alpha2: item.originCountry,
        ...(item.hsCode ? { hs_code: item.hsCode } : itemCategory ? { category: itemCategory } : {}),
      }))
    : [
        {
          description: 'Merchandise',
          quantity: 1,
          actual_weight: kilograms(parcel.weightGrams),
          declared_currency: input.currency.toUpperCase(),
          declared_customs_value: Math.max(0, Math.round(input.valueCents)) / 100,
          ...(itemCategory ? { category: itemCategory } : {}),
        },
      ]
  return [
    {
      box: { length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm },
      total_actual_weight: kilograms(parcel.weightGrams),
      items,
    },
  ]
}

export function createEasyshipProvider(options: EasyshipProviderOptions = {}): ShippingProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const token = (account: ProviderAccount): string => {
    if (!account.apiKey) throw new ShippingProviderError('The Easyship access token is missing', 500, 'easyship')
    return account.apiKey
  }
  const call = <T>(
    account: ProviderAccount,
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
  ) =>
    providerJson<T>({
      providerId: 'easyship',
      fetchImpl,
      url: `${EASYSHIP_API_BASE}${path}`,
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token(account)}` },
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    })
  const shipmentOf = (body: unknown): EasyshipShipment =>
    ((body as { shipment?: EasyshipShipment } | undefined)?.shipment ?? (body as EasyshipShipment) ?? {}) as EasyshipShipment
  const unsupported = (what: string) =>
    new ShippingProviderError(`Easyship does not ${what} here`, 501, 'easyship')

  return {
    id: 'easyship',
    displayName: 'Easyship',

    async createAccount() {
      // The merchant's own account: connected, never opened by Aglyn.
      throw unsupported('open accounts')
    },

    async verifyCredentials(account) {
      const body = await call<{ account?: { name?: string; easyship_company_id?: string } }>(account, '/account')
      const name = String(body?.account?.name ?? '').trim()
      return { accountName: name || String(body?.account?.easyship_company_id ?? 'Easyship account') }
    },

    async quoteRates(account, input): Promise<ProviderQuote> {
      const body = await call<unknown>(account, '/shipments', {
        method: 'POST',
        body: {
          origin_address: easyshipAddress(input.from),
          destination_address: easyshipAddress(input.to),
          ...(input.to.residential !== undefined ? { set_as_residential: input.to.residential } : {}),
          incoterms: 'DDU',
          insurance: input.insuranceCents
            ? { is_insured: true, insured_amount: input.insuranceCents / 100, insured_currency: input.currency.toUpperCase() }
            : { is_insured: false },
          parcels: parcelsFor(input, options.itemCategory),
          shipping_settings: {
            units: { weight: 'kg', dimensions: 'cm' },
            buy_label: false,
          },
        },
        ...(input.signal ? { signal: input.signal } : {}),
      })
      const shipment = shipmentOf(body)
      const shipmentId = String(shipment.easyship_shipment_id ?? '')
      if (!shipmentId) throw new ShippingProviderError('Easyship returned no shipment', 502, 'easyship')
      const rates = (shipment.rates ?? [])
        .map((rate) => readRate(rate, shipmentId))
        .filter((rate): rate is ProviderRate => Boolean(rate))
      return {
        shipmentId,
        rates,
        messages: rates.length ? [] : ['No courier on the Easyship account serves this shipment.'],
      }
    },

    async buyLabel(account, input): Promise<ProviderLabel> {
      const body = await call<unknown>(account, `/shipments/${encodeURIComponent(input.shipmentId)}/label`, {
        method: 'POST',
        body: { courier_service_id: input.rateId },
      })
      const shipment = shipmentOf(body)
      const labelState = String(shipment.label_state ?? '').toLowerCase()
      if (labelState === 'failed') {
        throw new ShippingProviderError('Easyship could not generate the label', 502, 'easyship')
      }
      const tracking = [...(shipment.trackings ?? [])]
        .sort((a, b) => Number(a.leg_number ?? 1) - Number(b.leg_number ?? 1))
        .find((one) => one.tracking_number)
      const rate =
        (shipment.rates ?? []).find((one) => one.courier_service?.id === input.rateId) ?? null
      const service = shipment.courier_service ?? rate?.courier_service ?? null
      const courier = String(service?.umbrella_name ?? service?.name ?? '').trim()
      const document = easyshipLabelDocument(shipment)
      const publicUrl = document?.url && /^https:\/\//.test(document.url) ? document.url : ''
      return {
        providerLabelId: input.shipmentId,
        shipmentId: input.shipmentId,
        trackingNumber: String(tracking?.tracking_number ?? ''),
        ...(shipment.tracking_page_url && /^https:\/\//.test(shipment.tracking_page_url)
          ? { trackingUrl: shipment.tracking_page_url }
          : {}),
        labelUrl: publicUrl,
        ...(publicUrl ? {} : { documentRef: 'label' }),
        carrier: courier,
        serviceKey: easyshipServiceKey(courier, String(service?.name ?? '')),
        serviceLabel: String(service?.name ?? courier),
        amountCents: rate ? decimalToCents(rate.total_charge) : 0,
        currency: String(rate?.currency ?? 'USD').toLowerCase(),
      }
    },

    async voidLabel(account, input): Promise<ProviderVoidStatus> {
      try {
        await call(account, `/shipments/${encodeURIComponent(input.shipmentId)}/cancel`, { method: 'POST' })
        return 'refunded'
      } catch (error) {
        // Easyship refuses a cancel it cannot make (already handed to the
        // courier, already cancelled): that is a rejection, not an outage.
        if (error instanceof ShippingProviderError && error.status >= 400 && error.status < 500 && error.status !== 401) {
          return 'rejected'
        }
        throw error
      }
    },

    async getTracking() {
      throw unsupported('look up tracking on request; it sends tracking by webhook')
    },

    async registerTracker() {
      throw unsupported('follow parcels labelled elsewhere')
    },

    async validateAddress() {
      return { verdict: 'unknown', messages: [] }
    },

    async listCarrierAccounts() {
      // Couriers are chosen in the merchant's Easyship account, not here.
      return []
    },

    async labelDocument(account, input) {
      const shipment = shipmentOf(await call<unknown>(account, `/shipments/${encodeURIComponent(input.shipmentId)}`))
      const document = easyshipLabelDocument(shipment)
      const encoded = document?.base64_encoded_strings?.[0]
      if (encoded) {
        const format = String(document?.format ?? 'pdf').toLowerCase()
        return {
          contentType: format === 'png' ? 'image/png' : format === 'zpl' ? 'application/zpl' : 'application/pdf',
          body: new Uint8Array(Buffer.from(encoded, 'base64')),
        }
      }
      if (document?.url && /^https:\/\//.test(document.url)) {
        const response = await fetchImpl(document.url)
        if (!response.ok) throw new ShippingProviderError('Easyship did not serve the label', response.status, 'easyship')
        return {
          contentType: response.headers.get('content-type') ?? 'application/pdf',
          body: new Uint8Array(await response.arrayBuffer()),
        }
      }
      throw new ShippingProviderError('Easyship has no label for this shipment', 404, 'easyship')
    },
  }
}
