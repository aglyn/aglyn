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

import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { randomUUID } from 'node:crypto'
import { combineParcels } from './easypost'
import { decimalToCents, providerJson, type ProviderFetch } from './http'
import {
  ShippingProviderError,
  type LabelFormat,
  type ProviderAccount,
  type ProviderLabel,
  type ProviderQuote,
  type ProviderRate,
  type ProviderShipmentInput,
  type ProviderTracking,
  type ProviderVoidStatus,
  type ShippingProvider,
} from './types'

/**
 * SENDCLOUD, ON THE MERCHANT'S OWN ACCOUNT (AGL-3632), API v3.
 *
 * Every call is HTTP Basic with the merchant's own public and secret key, so
 * Sendcloud bills the merchant for each label and Aglyn is never in the
 * money path.
 *
 * - Rates are `POST /shipping-options` with `calculate_quotes`: each option
 *   is a carrier service with a code (`postnl:standard`) and a price.
 *   Sendcloud keeps nothing for a quote, so the quote's id is ours and the
 *   label is announced later from what was quoted (`buyLabel`'s
 *   `shipment`), with the option's code.
 * - Buying is `POST /shipments/announce` (synchronous). Its documents are
 *   links Sendcloud serves only to an authenticated caller, so the plugin
 *   serves the label itself through `labelDocument`.
 * - Voiding is `POST /shipments/{id}/cancel`: 200 cancelled, 202 queued.
 * - Tracking arrives by Sendcloud's webhook, signed with the same secret key
 *   (`webhook-routes.ts`).
 * - Sendcloud validates no addresses here: every check answers `unknown`.
 */

export const SENDCLOUD_API_BASE = 'https://panel.sendcloud.sc/api/v3'

/** The only host a label document is fetched from, with the merchant's key. */
const SENDCLOUD_DOCUMENT_ORIGIN = new URL(SENDCLOUD_API_BASE).origin

export interface SendcloudProviderOptions {
  fetchImpl?: ProviderFetch
}

interface SendcloudOption {
  code?: string
  name?: string
  carrier?: { code?: string; name?: string } | null
  quotes?: Array<{ price?: { total?: { value?: string | number; currency?: string } | null } | null; lead_time?: number | null }> | null
}

interface SendcloudParcel {
  id?: number | string
  tracking_number?: string
  tracking_url?: string
  documents?: Array<{ type?: string; document_type?: string; link?: string }>
}

function sendcloudAddress(address: PluginShippingAddress): Record<string, unknown> {
  return {
    name: address.name || address.company || 'Recipient',
    ...(address.company ? { company_name: address.company } : {}),
    address_line_1: address.line1 ?? '',
    ...(address.line2 ? { address_line_2: address.line2 } : {}),
    postal_code: address.postalCode ?? '',
    city: address.city ?? '',
    country_code: address.country,
    ...(address.state ? { state_province_code: address.state } : {}),
    ...(address.phone ? { phone_number: address.phone } : {}),
    ...(address.email ? { email: address.email } : {}),
  }
}

const weightOf = (grams: number) => ({ value: (Math.max(1, Math.round(grams)) / 1000).toFixed(3), unit: 'kg' })

function parcelOf(input: Omit<ProviderShipmentInput, 'signal'>, withItems: boolean): Record<string, unknown> {
  const parcel = combineParcels(input.parcels)
  return {
    weight: weightOf(parcel.weightGrams),
    dimensions: {
      length: String(parcel.lengthCm),
      width: String(parcel.widthCm),
      height: String(parcel.heightCm),
      unit: 'cm',
    },
    ...(withItems && input.customs?.items.length
      ? {
          parcel_items: input.customs.items.map((item) => ({
            description: item.description.slice(0, 255),
            quantity: item.quantity,
            weight: weightOf(item.weightGrams / Math.max(1, item.quantity)),
            price: {
              value: (Math.round(item.valueCents / Math.max(1, item.quantity)) / 100).toFixed(2),
              currency: input.currency.toUpperCase(),
            },
            ...(item.hsCode ? { hs_code: item.hsCode } : {}),
            origin_country: item.originCountry,
          })),
        }
      : {}),
  }
}

function readOption(option: SendcloudOption, shipmentId: string, currency: string): ProviderRate | null {
  const code = String(option.code ?? '').trim()
  const quote = option.quotes?.find((one) => one?.price?.total?.value !== undefined)
  if (!code || !quote) return null
  const carrier = String(option.carrier?.name ?? option.carrier?.code ?? code.split(':')[0]).trim()
  const name = String(option.name ?? code).trim()
  const hours = Number(quote.lead_time)
  return {
    rateId: code,
    shipmentId,
    serviceKey: code.toLowerCase(),
    carrier,
    service: name,
    label: name,
    amountCents: decimalToCents(quote.price?.total?.value),
    currency: String(quote.price?.total?.currency ?? currency).toLowerCase(),
    ...(Number.isFinite(hours) && hours > 0 ? { estimatedDays: Math.max(1, Math.ceil(hours / 24)) } : {}),
    badges: [],
  }
}

const LABEL_MIME: Readonly<Record<LabelFormat, string>> = {
  pdf_4x6: 'application/pdf',
  pdf_letter: 'application/pdf',
  zpl: 'application/zpl',
}

export function createSendcloudProvider(options: SendcloudProviderOptions = {}): ShippingProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const basic = (account: ProviderAccount): string => {
    if (!account.apiKey || !account.apiSecret) {
      throw new ShippingProviderError('The Sendcloud keys are missing', 500, 'sendcloud')
    }
    return `Basic ${Buffer.from(`${account.apiKey}:${account.apiSecret}`, 'utf8').toString('base64')}`
  }
  const call = <T>(
    account: ProviderAccount,
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
  ) =>
    providerJson<T>({
      providerId: 'sendcloud',
      fetchImpl,
      url: `${SENDCLOUD_API_BASE}${path}`,
      method: init.method ?? 'GET',
      headers: { Authorization: basic(account) },
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    })
  const unsupported = (what: string) =>
    new ShippingProviderError(`Sendcloud does not ${what} here`, 501, 'sendcloud')
  const dataOf = <T,>(body: unknown): T => ((body as { data?: T } | undefined)?.data ?? (body as T))

  return {
    id: 'sendcloud',
    displayName: 'Sendcloud',

    async createAccount() {
      throw unsupported('open accounts')
    },

    async verifyCredentials(account) {
      const body = dataOf<{ user_id?: number | string; integration_id?: number | string }>(
        await call<unknown>(account, '/user/auth/metadata'),
      )
      if (!body?.user_id && !body?.integration_id) {
        throw new ShippingProviderError('Sendcloud did not recognize those keys', 401, 'sendcloud')
      }
      return {
        accountName: body.integration_id ? `Sendcloud integration ${body.integration_id}` : `Sendcloud user ${body.user_id}`,
      }
    },

    async quoteRates(account, input): Promise<ProviderQuote> {
      const shipmentId = `sc_${randomUUID().replace(/-/g, '')}`
      const body = await call<unknown>(account, '/shipping-options', {
        method: 'POST',
        body: {
          from_address: sendcloudAddress(input.from),
          to_address: sendcloudAddress(input.to),
          parcels: [parcelOf(input, false)],
          calculate_quotes: true,
        },
        ...(input.signal ? { signal: input.signal } : {}),
      })
      const options = dataOf<SendcloudOption[] | null>(body) ?? []
      const rates = (Array.isArray(options) ? options : [])
        .map((option) => readOption(option, shipmentId, input.currency))
        .filter((rate): rate is ProviderRate => Boolean(rate))
      const cheapest = rates.length ? Math.min(...rates.map((rate) => rate.amountCents)) : 0
      return {
        shipmentId,
        rates: rates.map((rate) => (rate.amountCents === cheapest ? { ...rate, badges: ['cheapest'] } : rate)),
        messages: rates.length ? [] : ['No carrier on the Sendcloud account serves this shipment.'],
      }
    },

    async buyLabel(account, input): Promise<ProviderLabel> {
      const shipment = input.shipment
      if (!shipment) throw new ShippingProviderError('Sendcloud needs the quoted shipment to announce', 400, 'sendcloud')
      const international = shipment.from.country !== shipment.to.country
      const body = await call<unknown>(account, '/shipments/announce', {
        method: 'POST',
        body: {
          from_address: sendcloudAddress(shipment.from),
          to_address: sendcloudAddress(shipment.to),
          ship_with: { type: 'shipping_option_code', properties: { shipping_option_code: input.rateId } },
          parcels: [parcelOf(shipment, international)],
          order_number: input.reference.slice(-50),
          total_order_price: {
            value: (Math.max(0, Math.round(shipment.valueCents)) / 100).toFixed(2),
            currency: shipment.currency.toUpperCase(),
          },
          ...(international
            ? { customs_information: { invoice_number: input.reference.slice(-40), export_reason: 'commercial_goods' } }
            : {}),
          label_details: { mime_type: LABEL_MIME[input.format] ?? 'application/pdf', dpi: input.format === 'zpl' ? 203 : 72 },
        },
      })
      const data = dataOf<{ id?: string | number; parcels?: SendcloudParcel[] }>(body)
      const parcel = data?.parcels?.[0]
      const sendcloudShipmentId = String(data?.id ?? '')
      if (!sendcloudShipmentId || !parcel) {
        throw new ShippingProviderError('Sendcloud announced no parcel', 502, 'sendcloud')
      }
      const label = (parcel.documents ?? []).find(
        (doc) => doc?.document_type === 'label' || doc?.type === 'label',
      )
      const documentRef = label?.link && label.link.startsWith(`${SENDCLOUD_DOCUMENT_ORIGIN}/`) ? label.link : ''
      if (!documentRef) throw new ShippingProviderError('Sendcloud returned no label', 502, 'sendcloud')
      const [carrierCode] = input.rateId.split(':')
      return {
        providerLabelId: sendcloudShipmentId,
        shipmentId: input.shipmentId,
        trackingNumber: String(parcel.tracking_number ?? ''),
        ...(parcel.tracking_url && /^https:\/\//.test(parcel.tracking_url) ? { trackingUrl: parcel.tracking_url } : {}),
        labelUrl: '',
        documentRef,
        carrier: carrierCode ?? '',
        serviceKey: input.rateId.toLowerCase(),
        serviceLabel: input.rateId,
        // The announce answers no price: the quoted one stands.
        amountCents: 0,
        currency: shipment.currency.toLowerCase(),
      }
    },

    async voidLabel(account, input): Promise<ProviderVoidStatus> {
      try {
        const answer = dataOf<{ status?: string }>(
          await call<unknown>(account, `/shipments/${encodeURIComponent(input.providerLabelId)}/cancel`, {
            method: 'POST',
          }),
        )
        return String(answer?.status ?? '').toLowerCase() === 'cancelled' ? 'refunded' : 'pending'
      } catch (error) {
        if (error instanceof ShippingProviderError && [404, 409, 422].includes(error.status)) return 'rejected'
        throw error
      }
    },

    async getTracking(account, input): Promise<ProviderTracking> {
      const body = dataOf<{
        events?: Array<{ event_at?: string; phase?: string; description?: string }>
        tracking_numbers?: Array<{ tracking_url?: string }>
      }>(await call<unknown>(account, `/parcels/tracking/${encodeURIComponent(input.trackingNumber)}`))
      const events = [...(body?.events ?? [])].sort(
        (a, b) => Date.parse(String(b.event_at ?? '')) - Date.parse(String(a.event_at ?? '')),
      )
      const latest = events[0]
      const phase = String(latest?.phase ?? '').toLowerCase()
      const status =
        phase.includes('deliver') && !phase.includes('out')
          ? 'delivered'
          : phase.includes('out_for_delivery') || phase.includes('out for delivery')
            ? 'out_for_delivery'
            : phase.includes('return')
              ? 'returned'
              : phase.includes('exception') || phase.includes('fail')
                ? 'exception'
                : phase && !phase.includes('announce') && !phase.includes('ready')
                  ? 'in_transit'
                  : 'pre_transit'
      const url = body?.tracking_numbers?.find((one) => one?.tracking_url)?.tracking_url
      return {
        status,
        ...(latest?.description ? { detail: String(latest.description).slice(0, 300) } : {}),
        atMs: Date.parse(String(latest?.event_at ?? '')) || Date.now(),
        ...(url && /^https:\/\//.test(url) ? { trackingUrl: url } : {}),
      }
    },

    async registerTracker() {
      throw unsupported('follow parcels labeled elsewhere')
    },

    async validateAddress() {
      return { verdict: 'unknown', messages: [] }
    },

    async listCarrierAccounts() {
      // Carriers and contracts are switched on in the merchant's Sendcloud panel.
      return []
    },

    async labelDocument(account, input) {
      if (!input.documentRef.startsWith(`${SENDCLOUD_DOCUMENT_ORIGIN}/`)) {
        throw new ShippingProviderError('That is not a Sendcloud document', 400, 'sendcloud')
      }
      let response: Response
      try {
        response = await fetchImpl(input.documentRef, { headers: { Authorization: basic(account) } })
      } catch {
        throw new ShippingProviderError('sendcloud could not be reached', 0, 'sendcloud')
      }
      if (!response.ok) throw new ShippingProviderError('Sendcloud did not serve the label', response.status, 'sendcloud')
      return {
        contentType: response.headers.get('content-type') ?? 'application/pdf',
        body: new Uint8Array(await response.arrayBuffer()),
      }
    },
  }
}
