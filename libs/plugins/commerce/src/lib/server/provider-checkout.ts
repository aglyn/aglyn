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

import { createHash, randomBytes } from 'node:crypto'
import {
  hasPluginPaymentProviders,
  listPluginPaymentOptions,
  pluginPaymentProvider,
  type PluginPaymentCheckoutRequest,
  type PluginPaymentLine,
  type PluginPaymentOption,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import type * as CommerceModel from '../model'

/**
 * Commerce's half of a payment provider another plugin brings (AGL-3630):
 * the buyer picks it beside Checkout, the SAME cart handler prices the sale
 * — every line re-priced, stock, discounts and gift cards held, shipping
 * planned, tax decided, the fee ladder applied — and only the last step
 * differs: instead of a Stripe Checkout Session, the priced sale is handed
 * to the provider as amounts, and the buyer is sent to its page.
 *
 * Everything the card webhook needs is carried the way the card path
 * carries it, as the session's `metadata[…]` keys; the provider keeps them
 * and hands them back on settlement, and `provider-settlement.ts` fulfils
 * through the very branch of `billing-webhook.ts` a card checkout uses. So
 * an order paid with PayPal is recorded, emailed, counted against stock and
 * redeemed against its discounts by the same code as one paid by card.
 *
 * Nothing here runs unless the request names a provider (`paymentProvider`
 * on the body) — the card path builds byte-for-byte the session it built
 * before.
 */

/** The checkout kind a storefront cart registers with core's checkout-owner seam. */
export const COMMERCE_CART_CHECKOUT_KIND = 'commerce-cart'

/** How long a provider's options may take to answer before the cart is drawn without them. */
export const PROVIDER_OPTIONS_TIMEOUT_MS = 1_500

/** The buyer's choice of provider, off the request; `null` for a card checkout. */
export function readProviderChoice(body: Record<string, unknown> | null | undefined): { providerId: string } | null {
  const value = body?.['paymentProvider']
  if (value === undefined || value === null || value === '') return null
  const providerId = String(value).trim().toLowerCase()
  return /^[a-z][a-z0-9-]{0,39}$/.test(providerId) ? { providerId } : { providerId: '' }
}

/**
 * The providers a storefront may offer for this sale — none for a store
 * whose tax is calculated by the card processor at its own checkout (no
 * other provider can be handed that amount) or that has not decided its tax.
 */
export async function storefrontPaymentOptions(input: {
  orgId: string
  hostId: string
  /** The store's tax settings, or how to read them — read only when a provider answered. */
  taxSettings: CommerceModel.TaxSettings | undefined | (() => Promise<CommerceModel.TaxSettings | undefined>)
}): Promise<PluginPaymentOption[]> {
  if (!hasPluginPaymentProviders()) return []
  const offered = await listPluginPaymentOptions(
    { orgId: input.orgId, hostId: input.hostId, currency: 'usd', channel: 'online' },
    { timeoutMs: PROVIDER_OPTIONS_TIMEOUT_MS },
  )
  if (!offered.length) return []
  const taxSettings = typeof input.taxSettings === 'function' ? await input.taxSettings() : input.taxSettings
  const mode = taxSettings?.mode
  return mode === 'manual' || mode === 'none' ? offered : []
}

/** What a storefront button draws for each provider: its id and label. */
export interface StorefrontPaymentOptionView {
  providerId: string
  label: string
  methods: string[]
}

export function storefrontPaymentOptionViews(options: readonly PluginPaymentOption[]): StorefrontPaymentOptionView[] {
  return options.map((option) => ({
    providerId: option.providerId,
    label: option.label,
    methods: option.methods.map((method) => method.label),
  }))
}

/** The refusal a buyer reads when a provider they picked is not offered. */
export const PROVIDER_UNAVAILABLE_MESSAGE = 'That way to pay is not available for this store. Check out with a card instead.'

/** The refusal when a store's tax is calculated at the card checkout. */
export const PROVIDER_TAX_MESSAGE =
  'This store calculates tax at card checkout, so other ways to pay are not available. Check out with a card instead.'

/** Nothing is left to charge once discounts and gift cards apply. */
export const PROVIDER_NOTHING_TO_CHARGE_MESSAGE =
  'Your discounts cover this whole order. Check out with the Checkout button instead.'

/**
 * The id this attempt's provider checkout is known by — the order's
 * document id once paid, and the `session_id` the return carries. Derived
 * from the attempt's claim, so a retry of the same attempt names the same
 * checkout and the provider opens it once.
 */
export function providerCheckoutId(providerId: string, claimKey: string | null): string {
  const digest = claimKey
    ? createHash('sha256').update(`provider-checkout:${providerId}:${claimKey}`).digest('hex').slice(0, 32)
    : randomBytes(16).toString('hex')
  return `pay_${providerId.replace(/-/g, '')}_${digest}`
}

/** Whether an id names a provider checkout rather than a card session. */
export function isProviderCheckoutId(value: unknown): value is string {
  return typeof value === 'string' && /^pay_[a-z0-9]{1,40}_[0-9a-f]{32}$/.test(value)
}

/** Every `metadata[key]` the card path set on its param set, as a plain map. */
export function checkoutMetadataOf(params: URLSearchParams): Record<string, string> {
  const metadata: Record<string, string> = {}
  for (const [key, value] of params) {
    const match = /^metadata\[([^\]]+)\]$/.exec(key)
    if (match) metadata[match[1]] = value
  }
  return metadata
}

/**
 * Tax the provider is handed, computed as the card processor would compute
 * the store's own rate: per taxable line, on that line's share of the
 * discount, rounded per line. A tax service's quote is used as quoted.
 */
export function providerTaxCents(input: {
  engineTaxCents: number | null
  manualRatePct: number
  lines: Array<{ netCents: number; taxable: boolean }>
}): number {
  if (input.engineTaxCents !== null) return Math.max(0, Math.round(input.engineTaxCents))
  if (!(input.manualRatePct > 0)) return 0
  return input.lines
    .filter((line) => line.taxable && line.netCents > 0)
    .reduce((sum, line) => sum + Math.round((line.netCents * input.manualRatePct) / 100), 0)
}

/** The priced lines read back off the card param set, so both paths name the same goods. */
export function providerLinesOf(
  params: URLSearchParams,
  physical: (index: number) => boolean,
): PluginPaymentLine[] {
  const lines: PluginPaymentLine[] = []
  for (let index = 0; params.has(`line_items[${index}][quantity]`); index++) {
    lines.push({
      name: String(params.get(`line_items[${index}][price_data][product_data][name]`) ?? 'Item'),
      quantity: Math.max(1, Math.round(Number(params.get(`line_items[${index}][quantity]`)))),
      unitCents: Math.max(0, Math.round(Number(params.get(`line_items[${index}][price_data][unit_amount]`)))),
      ships: physical(index),
    })
  }
  return lines
}

export interface ProviderCartCheckoutInput {
  providerId: string
  checkoutId: string
  orgId: string
  hostId: string
  params: URLSearchParams
  physical: (index: number) => boolean
  discountCents: number
  taxCents: number
  shipping: { options: Array<{ rateId: string; name: string; amountCents: number }>; countries: readonly string[] } | null
  platformFeeCents: number
  merchantName: string
  buyerEmail: string
  returnUrl: string
  cancelUrl: string
  expiresAtMs: number
}

/** The request a provider is handed for a priced cart. Pure, for the spec. */
export function providerCartCheckoutRequest(input: ProviderCartCheckoutInput): PluginPaymentCheckoutRequest {
  const metadata = checkoutMetadataOf(input.params)
  metadata['paymentProvider'] = input.providerId
  return {
    ownerKind: COMMERCE_CART_CHECKOUT_KIND,
    checkoutId: input.checkoutId,
    orgId: input.orgId,
    hostId: input.hostId,
    currency: 'usd',
    channel: 'online',
    lines: providerLinesOf(input.params, input.physical),
    discountCents: input.discountCents,
    taxCents: input.taxCents,
    ...(input.shipping
      ? {
          shipping: {
            options: input.shipping.options.length
              ? input.shipping.options.map((option, index) => ({
                  id: option.rateId || `rate-${index}`,
                  label: option.name || 'Shipping',
                  amountCents: option.amountCents,
                }))
              : // The store priced no shipping: free, and still an address to deliver to.
                [{ id: 'standard', label: 'Shipping', amountCents: 0 }],
            countries: [...input.shipping.countries],
          },
        }
      : {}),
    platformFeeCents: input.platformFeeCents,
    ...(input.merchantName ? { merchantName: input.merchantName } : {}),
    ...(input.buyerEmail ? { buyerEmail: input.buyerEmail } : {}),
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
    metadata,
    expiresAtMs: input.expiresAtMs,
  }
}

/** Opens the provider's checkout; `null` when the provider is gone or refused. */
export async function openProviderCheckout(
  request: PluginPaymentCheckoutRequest,
  providerId: string,
): Promise<{ url: string } | null> {
  const provider = pluginPaymentProvider(providerId)
  if (!provider) return null
  try {
    const started = await provider.createCheckout(request)
    return /^https?:\/\//.test(started.redirectUrl) ? { url: started.redirectUrl } : null
  } catch (error) {
    console.error(`[provider-checkout] ${providerId} refused checkout ${request.checkoutId}`, error)
    return null
  }
}
