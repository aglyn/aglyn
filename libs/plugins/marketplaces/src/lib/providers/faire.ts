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

import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  text,
  timeMs,
  type ListingResult,
  type MarketplaceAddress,
  type MarketplaceApp,
  type MarketplaceCredential,
  type MarketplaceFee,
  type MarketplaceOrder,
  type MarketplaceOrderLine,
  type MarketplaceOrderState,
  type MarketplaceProvider,
} from './provider'

/**
 * FAIRE (AGL-3638), the wholesale marketplace, through External API v2 on
 * the brand side, with an OAuth grant.
 *
 * The brand authorizes the app on Faire's consent page, which redirects back
 * with `authorizationCode` and `state`. The token call trades the code for
 * an access token that does not expire, and Faire issues no refresh token:
 * the token works until the brand or the app revokes it. A refused token
 * means connecting again.
 *
 * An OAuth token authorizes but does not authenticate: every call carries
 * the app's own credentials (`X-FAIRE-APP-CREDENTIALS`, base64 of
 * `applicationId:applicationSecret`) beside the brand's token
 * (`X-FAIRE-OAUTH-ACCESS-TOKEN`).
 *
 * - **Listings**: quantities only. Faire's prices are wholesale prices the
 *   brand sets for retailers, not the store's retail price, so
 *   `options.prices` is ignored. Faire's available quantity is its on-hand
 *   count less what its open orders have committed; those orders already
 *   came off the store's shelf when they were imported, so on-hand is set to
 *   the store's quantity plus Faire's committed count, and Faire offers
 *   exactly the store's quantity.
 * - **Orders**: a `NEW` order is accepted (`acknowledgeOrder`) before it
 *   ships. Lines are at wholesale prices; Faire's commission and payout fee
 *   come with the order.
 * - **Shipments**: Faire takes shipments per order, not per line, so the
 *   confirmation's lines are not sent.
 * - **Sandbox**: Faire has no sandbox host; `app.sandbox` changes nothing.
 */

export const FAIRE_API_BASE = 'https://www.faire.com/external-api/v2'
export const FAIRE_TOKEN_URL = 'https://www.faire.com/api/external-api-oauth2/token'
export const FAIRE_AUTHORIZE_URL = 'https://faire.com/oauth2/authorize'

/** The permissions the app asks the brand for. */
export const FAIRE_SCOPES = [
  'READ_BRAND',
  'READ_ORDERS',
  'WRITE_ORDERS',
  'READ_INVENTORIES',
  'WRITE_INVENTORIES',
  'READ_SHIPMENTS',
] as const

const PROVIDER = 'Faire'

/** Orders per page: Faire's maximum. */
const ORDER_PAGE = 50
/** SKUs per inventory read and write; Faire documents no cap, so a page stays small. */
const SKUS_PER_BATCH = 50

/** Faire's carrier values, keyed by the carrier normalized; anything else is sent as the merchant wrote it. */
const FAIRE_CARRIERS: Readonly<Record<string, string>> = {
  ups: 'UPS',
  usps: 'USPS',
  fedex: 'FEDEX',
  dhl: 'DHL_EXPRESS',
  dhlexpress: 'DHL_EXPRESS',
  dhlecommerce: 'DHL_ECOMMERCE',
  canadapost: 'CANADA_POST',
  purolator: 'PUROLATOR',
  canpar: 'CANPAR',
  postnl: 'POSTNL',
  interlinkexpress: 'INTERLINK_EXPRESS',
  gso: 'GSO',
  royalmail: 'ROYAL_MAIL',
  dpd: 'DPD',
  dpduk: 'DPDUK',
  parcelforce: 'PARCELFORCE',
  australiapost: 'AUSTRALIA_POST',
  evri: 'EVRI',
  laposte: 'LA_POSTE',
}

/** ISO 3166-1 alpha-3 → alpha-2 for the countries Faire sells in; Faire's addresses carry alpha-3. */
const ALPHA2: Readonly<Record<string, string>> = {
  USA: 'US', CAN: 'CA', GBR: 'GB', AUS: 'AU', NZL: 'NZ', IRL: 'IE', AUT: 'AT', BEL: 'BE', BGR: 'BG',
  HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR', DEU: 'DE', GRC: 'GR',
  HUN: 'HU', ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL', POL: 'PL', PRT: 'PT',
  ROU: 'RO', SVK: 'SK', SVN: 'SI', ESP: 'ES', SWE: 'SE', NOR: 'NO', CHE: 'CH', ISL: 'IS', MEX: 'MX',
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Faire's carrier value for the merchant's carrier name. */
export function faireCarrier(carrier: string): string {
  return FAIRE_CARRIERS[normalize(carrier)] ?? carrier.trim().slice(0, 255)
}

/** A country as ISO alpha-2, from Faire's alpha-3 code (or an alpha-2 one). */
export function faireCountry(code: unknown): string | null {
  const value = text(code)?.toUpperCase() ?? null
  if (!value) return null
  if (value.length === 2) return value
  return ALPHA2[value] ?? null
}

/** Where an order stands, from Faire's order state. */
export function faireOrderState(state: unknown): MarketplaceOrderState {
  switch (String(state ?? '')) {
    // NEW waits for the brand to accept it, which the engine does before it ships.
    case 'NEW':
    case 'PROCESSING':
      return 'unshipped'
    // PRE_TRANSIT: the brand has added a shipment (a label), not yet scanned by the carrier.
    case 'PRE_TRANSIT':
    case 'IN_TRANSIT':
    case 'DELIVERED':
      return 'shipped'
    case 'CANCELED':
      return 'canceled'
    // PENDING_RETAILER_CONFIRMATION and BACKORDERED wait on stock or the retailer.
    default:
      return 'pending'
  }
}

const minor = (amount: any, cents: unknown): number => {
  const value = Number(amount?.amount_minor ?? cents)
  return Number.isFinite(value) ? Math.round(value) : 0
}

function readAddress(raw: any): MarketplaceAddress | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    name: text(raw.name),
    line1: text(raw.address1),
    line2: text(raw.address2),
    city: text(raw.city),
    state: text(raw.state_code) ?? text(raw.state),
    postalCode: text(raw.postal_code),
    country: faireCountry(raw.country_code),
    phone: text(raw.phone_number),
  }
}

/**
 * The order as the engine reads it. Every amount is wholesale: what the
 * retailer pays Faire for the goods. Shipping and tax are Faire's business
 * with the retailer, so both are 0 here, and the total is the subtotal after
 * the brand's discounts.
 */
export function readFaireOrder(raw: any): MarketplaceOrder {
  const state = faireOrderState(raw?.state)
  const items: any[] = Array.isArray(raw?.items) ? raw.items : []
  const sold = state === 'canceled' ? items : items.filter((item) => String(item?.state ?? '') !== 'CANCELED')
  const payout = raw?.payout_costs ?? null
  const currency = String(
    text(items[0]?.price?.currency) ?? text(payout?.subtotal_after_brand_discounts?.currency) ?? 'USD',
  ).toUpperCase()
  const lines: MarketplaceOrderLine[] = sold
    .filter((item) => text(item?.id))
    .map((item) => ({
      externalLineId: String(item.id),
      sku: text(item?.sku),
      title: [text(item?.product_name), text(item?.variant_name)].filter(Boolean).join(' — ') || 'Faire item',
      quantity: Math.max(0, Math.round(Number(item?.quantity) || 0)),
      unitPriceMinor: minor(item?.price, item?.price_cents),
    }))
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0)
  const discountMinor = payout?.total_brand_discounts ? minor(payout.total_brand_discounts, 0) : 0
  const totalMinor = payout?.subtotal_after_brand_discounts
    ? minor(payout.subtotal_after_brand_discounts, 0)
    : subtotal - discountMinor
  let fees: MarketplaceFee[] | null = null
  if (payout && typeof payout === 'object') {
    fees = [{ label: 'Faire commission', amountMinor: minor(null, payout.commission_cents) }]
    const payoutFee = minor(null, payout.payout_fee_cents)
    if (payoutFee > 0) fees.push({ label: 'Faire payout fee', amountMinor: payoutFee })
  }
  const shipTo = readAddress(raw?.address)
  const placedAtMs = timeMs(raw?.created_at) ?? 0
  const id = String(raw?.id ?? '')
  return {
    externalId: id,
    displayRef: text(raw?.display_id) ?? id.replace(/^bo_/, '').toUpperCase(),
    state,
    fulfilledByMarketplace: false,
    placedAtMs,
    updatedAtMs: timeMs(raw?.updated_at) ?? placedAtMs,
    currency,
    lines,
    shippingMinor: 0,
    taxMinor: 0,
    discountMinor,
    totalMinor,
    fees,
    buyerName: text(raw?.address?.company_name) ?? shipTo?.name ?? null,
    shipTo,
    testMode: false,
  }
}

/** `X-FAIRE-APP-CREDENTIALS`: the app's id and secret, base64. */
export const faireAppCredentials = (app: MarketplaceApp): string =>
  Buffer.from(`${app.clientId}:${app.clientSecret}`, 'utf8').toString('base64')

export function createFaireProvider(deps: { http: ProviderHttp }): MarketplaceProvider {
  const call = (
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    extra: { retry?: boolean } = {},
  ) =>
    providerRequest(deps.http, {
      provider: PROVIDER,
      method,
      url: `${FAIRE_API_BASE}${path}`,
      headers: {
        'X-FAIRE-APP-CREDENTIALS': faireAppCredentials(app),
        'X-FAIRE-OAUTH-ACCESS-TOKEN': credential.accessToken,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      ...extra,
    })

  const getOrder = (app: MarketplaceApp, credential: MarketplaceCredential, id: string) =>
    call(app, credential, 'GET', `/orders/${encodeURIComponent(id)}`)

  const hasTracking = (order: any, trackingNumber: string) =>
    (Array.isArray(order?.shipments) ? order.shipments : []).some(
      (shipment: any) => normalize(String(shipment?.tracking_code ?? '')) === normalize(trackingNumber),
    )

  return {
    id: 'faire',

    authorizeUrl(app, input) {
      const query = new URLSearchParams({ applicationId: app.clientId })
      for (const scope of FAIRE_SCOPES) query.append('scope', scope)
      query.set('state', input.state)
      query.set('redirectUrl', input.redirectUri)
      return `${FAIRE_AUTHORIZE_URL}?${query.toString()}`
    },

    async exchangeCode(app, input) {
      // Faire's redirect names the code `authorizationCode`.
      const code = text(input.params.get('authorizationCode')) ?? input.code
      const answer = await providerRequest(deps.http, {
        provider: PROVIDER,
        method: 'POST',
        url: FAIRE_TOKEN_URL,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: {
          application_token: app.clientId,
          application_secret: app.clientSecret,
          redirect_url: input.redirectUri,
          scope: [...FAIRE_SCOPES],
          grant_type: 'AUTHORIZATION_CODE',
          authorization_code: code,
        },
        retry: false,
      })
      const accessToken = text(answer?.accessToken) ?? text(answer?.access_token)
      if (!accessToken) throw new ProviderError('auth', `${PROVIDER} answered no access token`)
      return { accessToken, refreshToken: null, expiresAtMs: null, refreshExpiresAtMs: null }
    },

    async refresh() {
      // Faire's tokens do not expire and come with no refresh token; one that is refused was revoked.
      throw new ProviderError('auth', `${PROVIDER} issues no refresh token; connect again`)
    },

    async account(app, credential) {
      const profile = await call(app, credential, 'GET', '/brands/profile')
      const brandId = text(profile?.brand_id)
      if (!brandId) throw new ProviderError('auth', `${PROVIDER} gave this connection no brand`)
      return { accountName: text(profile?.name), account: { sellerId: brandId } }
    },

    async syncListings(app, credential, pushes) {
      const results: ListingResult[] = pushes.map((push) => ({ sku: push.sku, outcome: 'not_listed', externalId: null, message: null }))
      // A SKU pushed twice is sent once, with its last push's quantity.
      const latest = new Map<string, number>()
      pushes.forEach((push, index) => push.sku && latest.set(push.sku, index))
      const skus = [...latest.keys()]
      for (let start = 0; start < skus.length; start += SKUS_PER_BATCH) {
        const chunk = skus.slice(start, start + SKUS_PER_BATCH)
        const indexesOf = (sku: string) => pushes.flatMap((push, index) => (push.sku === sku ? [index] : []))
        const query = new URLSearchParams()
        for (const sku of chunk) query.append('skus', sku)
        const levels = (await call(app, credential, 'GET', `/product-inventory/by-skus?${query.toString()}`)) ?? {}
        const known = chunk.filter((sku) => levels && typeof levels === 'object' && sku in levels)
        if (!known.length) continue
        const inventories = known.map((sku) => {
          const committed = Number(levels[sku]?.committed_quantity?.quantity)
          const quantity = Math.max(0, Math.floor(pushes[latest.get(sku)!].quantity))
          return { sku, on_hand_quantity: quantity + (Number.isFinite(committed) && committed > 0 ? committed : 0) }
        })
        try {
          const answer = (await call(app, credential, 'PATCH', '/product-inventory/by-skus', { inventories })) ?? {}
          for (const sku of known) {
            const updated = answer && typeof answer === 'object' && sku in answer
            for (const index of indexesOf(sku)) {
              results[index] = updated
                ? { sku, outcome: 'updated', externalId: null, message: null }
                : { sku, outcome: 'not_listed', externalId: null, message: null }
            }
          }
        } catch (error) {
          if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'not-found')) {
            for (const sku of known) {
              for (const index of indexesOf(sku)) results[index] = { sku, outcome: 'failed', externalId: null, message: error.message }
            }
            continue
          }
          throw error
        }
      }
      return results
    },

    async listOrders(app, credential, query) {
      // A cursor carries the query it was minted for; Faire refuses the filters beside it.
      const params = query.cursor
        ? new URLSearchParams({ limit: String(ORDER_PAGE), cursor: query.cursor })
        : new URLSearchParams({ limit: String(ORDER_PAGE), updated_at_min: new Date(query.sinceMs).toISOString() })
      const answer = await call(app, credential, 'GET', `/orders?${params.toString()}`)
      const orders = (Array.isArray(answer?.orders) ? answer.orders : []).map(readFaireOrder)
      return { orders, nextCursor: orders.length ? text(answer?.cursor) : null }
    },

    async acknowledgeOrder(app, credential, order) {
      try {
        await call(app, credential, 'PUT', `/orders/${encodeURIComponent(order.externalId)}/processing`, {})
      } catch (error) {
        // Accepting an order Faire has already moved past NEW is refused; that is done, not failed.
        if (error instanceof ProviderError && error.kind === 'invalid') {
          const current = await getOrder(app, credential, order.externalId)
          const state = String(current?.state ?? '')
          if (state && state !== 'NEW' && state !== 'CANCELED') return
        }
        throw error
      }
    },

    async confirmShipment(app, credential, confirmation) {
      const id = confirmation.externalOrderId
      const order = await getOrder(app, credential, id)
      if (hasTracking(order, confirmation.trackingNumber)) return 'already'
      const carrier = text(confirmation.carrier)
      if (!carrier) throw new ProviderError('invalid', `${PROVIDER} needs the carrier a shipment went with`)
      try {
        await call(
          app,
          credential,
          'POST',
          `/orders/${encodeURIComponent(id)}/shipments`,
          {
            shipments: [
              {
                order_id: id,
                carrier: faireCarrier(carrier),
                tracking_code: confirmation.trackingNumber,
                shipping_type: 'SHIP_ON_YOUR_OWN',
              },
            ],
          },
          { retry: false },
        )
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid') {
          const after = await getOrder(app, credential, id).catch(() => null)
          if (after && hasTracking(after, confirmation.trackingNumber)) return 'already'
        }
        throw error
      }
      return 'confirmed'
    },
  }
}
