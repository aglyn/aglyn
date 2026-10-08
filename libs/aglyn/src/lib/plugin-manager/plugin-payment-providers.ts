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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Payment providers a plugin adds BESIDE the merchant's card account
 * (AGL-3630).
 *
 * The merchant's card account is core's own (`payment-provider.ts` in the
 * tenant data library): compiled in, never absent, and every storefront,
 * calendar and register charges into it. This seam is the other kind — a
 * wallet or a pay-later service the buyer may CHOOSE instead, which a plugin
 * brings and which may well be absent. Absence is an ordinary answer here:
 * the seller offers the card account alone, exactly as before anyone
 * registered.
 *
 * ## Two sides, and neither imports the other
 *
 * - A **provider** registers {@link PluginPaymentProvider} under its id. It
 *   onboards merchants with the vendor, opens a checkout for an amount it is
 *   handed, takes the buyer's approval, moves the money, refunds it, and
 *   hears the vendor's webhooks.
 * - A **checkout owner** — the plugin that sells — registers
 *   {@link PluginPaymentCheckoutOwner} under a kind it names
 *   (`'<plugin>-cart'`). It prices the sale, asks the provider to open a
 *   checkout, and is called back: before money moves (to refuse an address
 *   it does not ship to, or a checkout it has since closed), once it has
 *   moved (to fulfil), when a checkout lapses unpaid (to give back what it
 *   reserved), and when the vendor reports a refund or a dispute.
 *
 * ## Money
 *
 * Every amount is integer minor units of `currency` (ISO-4217, lower case).
 * {@link pluginPaymentCheckoutTotals} is the one arithmetic both sides use,
 * and {@link pluginPaymentCheckoutProblem} refuses a request whose parts are
 * not whole, not non-negative, or do not add up — before any vendor is
 * asked. A provider never prices anything: what the buyer owes is the
 * owner's answer, and what the provider charges is that answer.
 *
 * ## Idempotency
 *
 * `checkoutId` is the owner's stable id for ONE attempt. A provider uses it
 * as the vendor's idempotency key, so a retried request opens the same
 * checkout rather than a second; and the owner's settlement is keyed on it,
 * so a capture reported twice — by the browser and by the webhook — fulfils
 * once.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-payment-providers`); it is not in the
 * barrel.
 */

/** One way to pay a provider offers — its wallet, a second wallet it fronts. */
export interface PluginPaymentMethod {
  /** Stable, lower-kebab. */
  id: string
  /** What a buyer reads on the button. */
  label: string
}

/** Where a sale is taken. */
export type PluginPaymentChannel = 'online' | 'in-person'

export interface PluginPaymentAvailabilityRequest {
  /**
   * The site's workspace, when the caller has resolved it; empty when it has
   * not, and the provider resolves it from `hostId` itself — so a seller can
   * ask cheaply on every cart view and a provider that is not configured
   * answers without a read.
   */
  orgId: string
  hostId: string
  /** ISO-4217, lower case. */
  currency: string
  channel: PluginPaymentChannel
  signal?: AbortSignal
}

/** A provider that can take this sale, and how it presents itself. */
export interface PluginPaymentOption {
  providerId: string
  /** The provider's own name, for a button and a receipt line. */
  label: string
  /** At least one; the first is the provider's own. */
  methods: PluginPaymentMethod[]
  /** Whether the merchant's account takes real money. */
  livemode: boolean
}

/** One line the buyer is charged for, priced by the owner. */
export interface PluginPaymentLine {
  name: string
  quantity: number
  /** Per unit, before any discount or tax. */
  unitCents: number
  sku?: string
  /** Whether it is posted to the buyer: a provider may ask for an address. */
  ships: boolean
}

/** A delivery choice, priced by the owner. */
export interface PluginPaymentShippingOption {
  id: string
  label: string
  amountCents: number
}

export interface PluginPaymentShipping {
  /** At least one when present. The first is selected until the buyer changes it. */
  options: PluginPaymentShippingOption[]
  /** ISO-3166 alpha-2 countries the owner delivers to. */
  countries: string[]
}

/** What an owner asks a provider to open. */
export interface PluginPaymentCheckoutRequest {
  /** The owner kind registered with {@link registerPluginPaymentCheckoutOwner}. */
  ownerKind: string
  /** The owner's id for this attempt; stable across a retry. */
  checkoutId: string
  orgId: string
  hostId: string
  /** ISO-4217, lower case. */
  currency: string
  channel: PluginPaymentChannel
  lines: PluginPaymentLine[]
  /** Every reduction on the lines, as one amount. */
  discountCents: number
  /** Tax on top of the lines; 0 when prices include it. */
  taxCents: number
  /** Absent when nothing is posted. */
  shipping?: PluginPaymentShipping
  /** The platform's share of the sale, taken by the provider at capture. */
  platformFeeCents: number
  /** The site's name, as the buyer sees it on the provider's page. */
  merchantName?: string
  buyerEmail?: string
  /** Where the buyer lands once paid, and when they give up. Absolute URLs. */
  returnUrl: string
  cancelUrl: string
  /**
   * Opaque to the provider: kept with the checkout and handed back on every
   * callback. String values, at most {@link PLUGIN_PAYMENT_METADATA_LIMITS}.
   */
  metadata: Record<string, string>
  /** After this the owner treats the checkout as abandoned. */
  expiresAtMs: number
}

/** What a provider answers when it opened the checkout. */
export interface PluginPaymentCheckoutStarted {
  providerId: string
  /** The vendor's id for the checkout. */
  providerCheckoutId: string
  /** Where the buyer approves the payment. Absolute URL. */
  redirectUrl: string
  livemode: boolean
}

/** A postal address as a provider read it off the buyer's approval. */
export interface PluginPaymentAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  /** ISO-3166 alpha-2. */
  country?: string
}

/** The buyer as the provider knows them. */
export interface PluginPaymentPayer {
  email?: string
  name?: string
}

/** A checkout as it is handed back to its owner. */
export interface PluginPaymentCheckoutRef {
  providerId: string
  /** The provider's own name, for the owner's timeline and notices. */
  providerLabel: string
  providerCheckoutId: string
  ownerKind: string
  checkoutId: string
  orgId: string
  hostId: string
  currency: string
  metadata: Record<string, string>
}

/** The buyer approved; nothing has moved yet. */
export interface PluginPaymentApproval extends PluginPaymentCheckoutRef {
  totalCents: number
  /** The delivery option the buyer settled on, when the checkout posts. */
  shippingOptionId?: string
  shippingAddress?: PluginPaymentAddress
  payer: PluginPaymentPayer
}

/** The money moved. */
export interface PluginPaymentSettlement extends PluginPaymentApproval {
  /** The vendor's id for the payment — what a refund names. */
  paymentId: string
  /** What was charged, in the checkout's currency. */
  amountCents: number
  /** What each part came to, after the buyer's choices. */
  breakdown: PluginPaymentTotals
  platformFeeCents: number
  livemode: boolean
  settledAtMs: number
}

/** A change the vendor reports about a settled payment. */
export interface PluginPaymentEvent extends PluginPaymentCheckoutRef {
  paymentId: string
  /**
   * `refunded`: the vendor's refunded total for the payment is now
   * `refundedCents`, whoever asked for it. `reversed`: the money was taken
   * back (a chargeback lost). `disputed` and `dispute-closed`: the buyer
   * opened, or the vendor closed, a dispute over `amountCents`. `denied`:
   * a capture the vendor first held as pending was refused.
   */
  kind: 'refunded' | 'reversed' | 'disputed' | 'dispute-closed' | 'denied'
  refundedCents?: number
  amountCents?: number
  /** The vendor's id for the event, so an owner can key it. */
  eventId: string
  detail?: string
  atMs: number
}

export type PluginPaymentApprovalAnswer = { ok: true } | { ok: false; reason: string }

export interface PluginPaymentCheckoutOwner {
  /**
   * Before money moves: may this checkout still be paid as approved? A
   * refusal leaves the payment uncaptured, and `reason` is shown to the
   * buyer. Read-only — nothing is reserved or released here.
   */
  approve(approval: PluginPaymentApproval): Promise<PluginPaymentApprovalAnswer>
  /**
   * The money moved. Idempotent on `checkoutId`: called by the buyer's
   * return and again by the vendor's webhook, it fulfils once. A throw is
   * retried by the provider (the webhook redelivers).
   */
  settle(settlement: PluginPaymentSettlement): Promise<void>
  /** The checkout lapsed unpaid: give back what it held. Idempotent. */
  expire(checkout: PluginPaymentCheckoutRef): Promise<void>
  /** A refund, reversal or dispute the vendor reported. Idempotent on `eventId`. */
  onPaymentEvent?(event: PluginPaymentEvent): Promise<void>
}

export interface PluginPaymentRefundRequest {
  orgId: string
  hostId: string
  /** {@link PluginPaymentSettlement.paymentId}. */
  paymentId: string
  amountCents: number
  currency: string
  /** Stable for one refund attempt; the vendor's idempotency key. */
  idempotencyKey: string
  /** Shown to the buyer by vendors that show one. */
  note?: string
}

export type PluginPaymentRefundResult =
  | { ok: true; refundId: string; status: 'completed' | 'pending' }
  | { ok: false; status: number; error: string }

export interface PluginPaymentProvider {
  /** Whether this provider can take this sale now, and as what; `null` when it cannot. */
  available(request: PluginPaymentAvailabilityRequest): Promise<PluginPaymentOption | null>
  /** Opens the checkout. Throws when the vendor refused; nothing is held then. */
  createCheckout(request: PluginPaymentCheckoutRequest): Promise<PluginPaymentCheckoutStarted>
  /** Refunds part or all of a settled payment. */
  refund(request: PluginPaymentRefundRequest): Promise<PluginPaymentRefundResult>
}

/** What a checkout's metadata may carry. */
export const PLUGIN_PAYMENT_METADATA_LIMITS = { keys: 50, keyLength: 40, valueLength: 500 } as const

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,39}$/
const OWNER_KIND = /^[a-z][a-z0-9-]{0,63}$/
const CHECKOUT_ID = /^[A-Za-z0-9_-]{8,120}$/
const CURRENCY = /^[a-z]{3}$/
const COUNTRY = /^[A-Z]{2}$/

const PLUGIN_PAYMENT_PROVIDERS = definePluginServiceContract<PluginPaymentProvider>(
  'core.payment-providers',
  { multiple: true },
)

const PLUGIN_PAYMENT_CHECKOUT_OWNERS = definePluginServiceContract<PluginPaymentCheckoutOwner>(
  'core.payment-checkout-owners',
  { multiple: true },
)

/**
 * Registers a provider under its id. A second plugin claiming the same id
 * is refused naming both; the incumbent keeps serving.
 */
export function registerPluginPaymentProvider(
  providerId: string,
  provider: PluginPaymentProvider,
  options?: { pluginId?: string },
): void {
  const key = providerId.trim()
  if (!PROVIDER_ID.test(key)) throw new Error(`payment provider id "${providerId}" is not lower-kebab`)
  claimKey(PLUGIN_PAYMENT_PROVIDERS, key, options?.pluginId, 'payment provider')
  registerPluginService(PLUGIN_PAYMENT_PROVIDERS, provider, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

/** Registers the plugin that sells through a checkout kind. One owner per kind. */
export function registerPluginPaymentCheckoutOwner(
  ownerKind: string,
  owner: PluginPaymentCheckoutOwner,
  options?: { pluginId?: string },
): void {
  const key = ownerKind.trim()
  if (!OWNER_KIND.test(key)) throw new Error(`checkout owner kind "${ownerKind}" is not lower-kebab`)
  claimKey(PLUGIN_PAYMENT_CHECKOUT_OWNERS, key, options?.pluginId, 'checkout owner')
  registerPluginService(PLUGIN_PAYMENT_CHECKOUT_OWNERS, owner, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

function claimKey(
  contract: typeof PLUGIN_PAYMENT_PROVIDERS | typeof PLUGIN_PAYMENT_CHECKOUT_OWNERS,
  key: string,
  pluginId: string | undefined,
  what: string,
): void {
  const incumbent = (resolvePluginServices(contract as never) as Array<{ key?: string; pluginId: string }>).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(`${what} "${key}" is already registered by "${incumbent.pluginId}"; refused "${pluginId}"`)
  }
}

/** The provider registered under an id, or `null`. */
export function pluginPaymentProvider(providerId: string): PluginPaymentProvider | null {
  const key = String(providerId ?? '').trim()
  return resolvePluginServices(PLUGIN_PAYMENT_PROVIDERS).find((entry) => entry.key === key)?.impl ?? null
}

/** Whether any plugin registered a provider. Cheap; reads no vendor. */
export function hasPluginPaymentProviders(): boolean {
  return resolvePluginServices(PLUGIN_PAYMENT_PROVIDERS).length > 0
}

/** The owner registered for a checkout kind, or `null`. */
export function pluginPaymentCheckoutOwner(ownerKind: string): PluginPaymentCheckoutOwner | null {
  const key = String(ownerKind ?? '').trim()
  return resolvePluginServices(PLUGIN_PAYMENT_CHECKOUT_OWNERS).find((entry) => entry.key === key)?.impl ?? null
}

/**
 * The providers that can take this sale, asked together and given up on
 * after `timeoutMs`. Never throws: a provider that failed, answered late or
 * answered something malformed is simply not offered, and with none the
 * answer is `[]` — the seller's card account alone, as before.
 */
export async function listPluginPaymentOptions(
  request: Omit<PluginPaymentAvailabilityRequest, 'signal'>,
  options: { timeoutMs: number },
): Promise<PluginPaymentOption[]> {
  const providers = resolvePluginServices(PLUGIN_PAYMENT_PROVIDERS)
  if (!providers.length) return []
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve('late')
    }, Math.max(0, options.timeoutMs))
  })
  try {
    const answers = await Promise.all(
      providers.map(async (entry) => {
        const answer = await Promise.race([
          entry.impl.available({ ...request, signal: controller.signal }).catch((error: unknown): null => {
            console.error(`[payment-providers] "${entry.key}" availability failed for ${request.hostId}`, error)
            return null
          }),
          deadline,
        ])
        return answer === 'late' ? null : normalizePluginPaymentOption(String(entry.key ?? ''), answer)
      }),
    )
    return answers.filter((answer): answer is PluginPaymentOption => answer !== null)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function cleanLabel(value: unknown, max: number): string {
  return Array.from(String(value ?? ''), (char) =>
    char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char,
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** A provider's answer as a seller may draw it, or `null` when it is not one. */
export function normalizePluginPaymentOption(
  providerId: string,
  answer: PluginPaymentOption | null | undefined,
): PluginPaymentOption | null {
  if (!answer || !PROVIDER_ID.test(providerId)) return null
  // The registry key is the id; an answer naming another provider is not trusted.
  if (answer.providerId && answer.providerId !== providerId) return null
  const label = cleanLabel(answer.label, 40)
  const methods = (Array.isArray(answer.methods) ? answer.methods : [])
    .map((method) => ({ id: String(method?.id ?? ''), label: cleanLabel(method?.label, 40) }))
    .filter((method) => PROVIDER_ID.test(method.id) && method.label)
    .slice(0, 4)
  if (!label || !methods.length) return null
  return { providerId, label, methods, livemode: answer.livemode === true }
}

/** What a checkout's parts come to. */
export interface PluginPaymentTotals {
  itemsCents: number
  discountCents: number
  taxCents: number
  shippingCents: number
  totalCents: number
}

/**
 * The checkout's totals with one delivery option chosen — the first when
 * `shippingOptionId` is absent or names none. The ONE arithmetic owner and
 * provider share, so the amount a vendor is asked for and the amount an
 * owner records cannot be computed two ways.
 */
export function pluginPaymentCheckoutTotals(
  request: Pick<PluginPaymentCheckoutRequest, 'lines' | 'discountCents' | 'taxCents'> & {
    shipping?: PluginPaymentShipping
  },
  shippingOptionId?: string,
): PluginPaymentTotals {
  const itemsCents = request.lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0)
  const options = request.shipping?.options ?? []
  const chosen = options.find((option) => option.id === shippingOptionId) ?? options[0]
  const shippingCents = chosen ? chosen.amountCents : 0
  return {
    itemsCents,
    discountCents: request.discountCents,
    taxCents: request.taxCents,
    shippingCents,
    totalCents: itemsCents - request.discountCents + request.taxCents + shippingCents,
  }
}

const isWholeCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * Why a checkout request may not be sent to a vendor, or `null` when it may.
 * Run by a provider before its first call, so a malformed amount is refused
 * with nothing opened.
 */
export function pluginPaymentCheckoutProblem(request: PluginPaymentCheckoutRequest): string | null {
  if (!OWNER_KIND.test(String(request.ownerKind ?? ''))) return 'ownerKind is not lower-kebab'
  if (!CHECKOUT_ID.test(String(request.checkoutId ?? ''))) return 'checkoutId is not an id'
  if (!request.orgId || !request.hostId) return 'orgId and hostId are required'
  if (!CURRENCY.test(String(request.currency ?? ''))) return 'currency is not a lower-case ISO-4217 code'
  if (!Array.isArray(request.lines) || request.lines.length === 0) return 'a checkout needs a line'
  if (request.lines.length > 100) return 'a checkout carries at most 100 lines'
  for (const line of request.lines) {
    if (!cleanLabel(line?.name, 127)) return 'every line needs a name'
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return 'every quantity is a whole number above 0'
    if (!isWholeCents(line.unitCents)) return 'every unit price is whole non-negative cents'
  }
  if (!isWholeCents(request.discountCents)) return 'discountCents is whole non-negative cents'
  if (!isWholeCents(request.taxCents)) return 'taxCents is whole non-negative cents'
  if (!isWholeCents(request.platformFeeCents)) return 'platformFeeCents is whole non-negative cents'
  if (request.shipping) {
    const { options, countries } = request.shipping
    if (!Array.isArray(options) || options.length === 0) return 'shipping needs an option'
    if (options.length > 10) return 'shipping carries at most 10 options'
    const ids = new Set<string>()
    for (const option of options) {
      if (!option?.id || ids.has(option.id)) return 'every shipping option needs its own id'
      ids.add(option.id)
      if (!cleanLabel(option.label, 127)) return 'every shipping option needs a label'
      if (!isWholeCents(option.amountCents)) return 'every shipping amount is whole non-negative cents'
    }
    if (!Array.isArray(countries) || countries.length === 0 || !countries.every((code) => COUNTRY.test(code))) {
      return 'shipping names the countries it delivers to'
    }
  }
  const items = pluginPaymentCheckoutTotals(request).itemsCents
  if (request.discountCents > items) return 'the discount is more than the lines'
  // Every option must leave something to charge, and the fee inside it.
  const options = request.shipping?.options ?? [undefined]
  for (const option of options) {
    const total = pluginPaymentCheckoutTotals(request, option?.id).totalCents
    if (total <= 0) return 'there is nothing to charge'
    if (request.platformFeeCents > total) return 'the platform fee is more than the charge'
  }
  if (!/^https:\/\//.test(String(request.returnUrl ?? '')) && !/^http:\/\/localhost[:/]/.test(String(request.returnUrl ?? ''))) {
    return 'returnUrl is not an absolute https URL'
  }
  if (!/^https:\/\//.test(String(request.cancelUrl ?? '')) && !/^http:\/\/localhost[:/]/.test(String(request.cancelUrl ?? ''))) {
    return 'cancelUrl is not an absolute https URL'
  }
  const entries = Object.entries(request.metadata ?? {})
  if (entries.length > PLUGIN_PAYMENT_METADATA_LIMITS.keys) return 'metadata carries too many keys'
  for (const [key, value] of entries) {
    if (!key || key.length > PLUGIN_PAYMENT_METADATA_LIMITS.keyLength) return `metadata key "${key}" is too long`
    if (typeof value !== 'string' || value.length > PLUGIN_PAYMENT_METADATA_LIMITS.valueLength) {
      return `metadata value for "${key}" is not a short string`
    }
  }
  if (!Number.isFinite(request.expiresAtMs) || request.expiresAtMs <= 0) return 'expiresAtMs is required'
  return null
}
