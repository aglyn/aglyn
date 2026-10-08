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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Money another plugin honors at checkout and at the register (AGL-3640).
 *
 * A rewards balance, store credit and a friend's referral credit are all the
 * same thing to a seller: a code the buyer brings that pays part of the sale
 * from an account the SELLER does not keep. The plugin that keeps the account
 * registers a provider here; the seller asks it, by code, how much the account
 * can give, reserves that much while an online buyer pays, and takes it in the
 * same transaction that writes the sale. The seller never reads the provider's
 * documents and the provider never reads the seller's: the sale records which
 * provider paid what, under the provider's own opaque `reference`, and the
 * seller's order events carry that onward.
 *
 * ## Money
 *
 * Integer cents in the sale's currency, always. A provider answers what it
 * CAN give and the seller never takes more than that.
 *
 *   - Online, the seller {@link PluginCheckoutCreditProvider.hold | holds}
 *     before the payment processor is asked, so a shortfall is a refusal and
 *     not an apology. The hold is keyed by the checkout attempt, so a retry
 *     re-places the same hold rather than a second one, and it lapses on its
 *     own if the checkout is abandoned and nobody releases it.
 *   - When the sale is written, the seller {@link PluginCheckoutCreditProvider.stage | stages}
 *     the account INSIDE its own transaction: the provider reads (and only
 *     reads) what it needs, and the stage's `debit` writes the redemption in
 *     the same commit as the sale. A sale that is not written takes nothing;
 *     a redemption is never written without its sale.
 *   - A refund gives back through {@link PluginCheckoutCreditProvider.restore | restore},
 *     idempotent per key, so a retried refund restores once.
 *
 * ## Nobody home
 *
 * With no provider registered, or none offered on a site, the seller shows no
 * field and sells exactly as it did before. Every reader here that a seller
 * calls on a sale path is safe to call with nothing registered.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-checkout-credits`); it is not in the
 * barrel.
 */

/** Where the sale happens. */
export type CheckoutCreditChannel = 'online' | 'pos'

/**
 * A server transaction as a provider uses it: the Admin SDK's shape, typed
 * structurally so the platform names no database SDK. Every `get` happens
 * before any write, as the database requires.
 */
export interface CheckoutCreditTransaction {
  get(ref: any): Promise<any>
  set(ref: any, data: any, options?: any): unknown
  update(ref: any, data: any): unknown
  create(ref: any, data: any): unknown
}

/** A provider's refusal, in words the buyer or the cashier can read. */
export interface CheckoutCreditRefusal {
  ok: false
  /** 400 for a bad code, 404 for an unknown one, 409 for an empty or busy one. */
  status: number
  error: string
}

/** The account a code names. */
export interface CheckoutCreditAccount {
  ok: true
  /**
   * The provider's own handle on the account, stored on the sale and handed
   * back to it later. Never shown to a buyer and never a bearer secret.
   * {@link CHECKOUT_CREDIT_REFERENCE} holds its shape.
   */
  reference: string
  /** What the buyer and the receipt call it: `Rewards`, `Referral credit`. */
  label: string
  /** The last characters of the code, for the register and the receipt. */
  last4: string
  /** What the account could give right now, integer cents. */
  availableCents: number
  /** One line for the cashier: `1,250 points and $5.00 store credit`. */
  detail?: string
}

/**
 * The account as the seller's transaction read it. The provider builds it in
 * {@link PluginCheckoutCreditProvider.stage}, which reads; its methods only
 * WRITE, through the same transaction, so the redemption commits with the sale
 * or not at all.
 */
export interface CheckoutCreditStage {
  /**
   * What the account may give now, honoring every live hold except the one
   * the stage was opened for (that one is this sale's own).
   */
  availableCents: number
  /**
   * Takes up to `cents` and returns what was taken: never more than
   * `availableCents` plus this sale's own hold. `key` names this redemption
   * (the attempt, or the register payment) and is what a void reverses.
   */
  debit(input: { cents: number; key: string; orderId: string; channel: CheckoutCreditChannel }): number
  /** Gives back exactly what the redemption named by `key` took: a voided register payment. */
  reverse(input: { key: string; orderId: string }): number
}

export interface CheckoutCreditHoldRequest {
  hostId: string
  reference: string
  /** The checkout attempt: the same key re-places the same hold. */
  holdKey: string
  /** The most the sale can take: what is left to pay on the goods. */
  maxCents: number
  /** ISO-4217, lower case. */
  currency: string
  customerEmail: string | null
  nowMs: number
}

export interface PluginCheckoutCreditProvider {
  /** Stable within the plugin: lower-case words and dashes. */
  key: string
  /** What the field and the register's tender button say: `Rewards`. */
  label: string
  /** Whether a code is one this provider issues. Syntax only: no reads. */
  recognizes(code: string): boolean
  /** Whether the site offers it at all: plugin on, program on, plan carries it. */
  offered(input: { hostId: string; channel: CheckoutCreditChannel }): Promise<boolean>
  /**
   * A buyer's code — or, at the register only, a `reference` a staff
   * {@link lookup} returned — to the account it names. `staff` is true only
   * when the seller has authenticated a staff member for this site; a
   * provider honors a bare `reference` only then.
   */
  resolve(input: {
    hostId: string
    code?: string
    reference?: string
    channel: CheckoutCreditChannel
    customerEmail: string | null
    staff: boolean
  }): Promise<CheckoutCreditAccount | CheckoutCreditRefusal>
  /** Reserves up to `maxCents` for one online checkout attempt. */
  hold(input: CheckoutCreditHoldRequest): Promise<{ ok: true; cents: number } | CheckoutCreditRefusal>
  /** Lets a hold go: an abandoned or refused checkout. Never throws. */
  release(input: { hostId: string; reference: string; holdKey: string }): Promise<void>
  /**
   * Reads the account inside the seller's transaction. `null` when it no
   * longer exists. `holdKey` is this sale's own online hold, when it has one.
   */
  stage(input: {
    transaction: CheckoutCreditTransaction
    hostId: string
    reference: string
    orderId: string
    nowMs: number
    holdKey?: string
  }): Promise<CheckoutCreditStage | null>
  /**
   * Gives back up to `cents` of what the sale took from the account, for a
   * refund. Idempotent per `key`; returns the cents given back (0 for a key
   * already restored, or an account that is gone).
   */
  restore(input: { hostId: string; reference: string; orderId: string; cents: number; key: string }): Promise<number>
  /** Staff search at the register by email or code. Optional. */
  lookup?(input: { hostId: string; query: string }): Promise<CheckoutCreditAccount[]>
}

/** A provider as the seller resolves it. */
export interface ResolvedCheckoutCreditProvider {
  /** `{pluginId}.{key}`: what a sale records. */
  providerId: string
  pluginId: string
  provider: PluginCheckoutCreditProvider
}

/**
 * What a sale records of one redemption, on the sale and in the events the
 * seller raises about it, so the provider learns what was taken from the
 * seller's own facts. `appliedAs` says how the seller counted it: online it
 * comes off the goods like a discount, at the register it is one of the
 * sale's payments.
 */
export interface PluginCheckoutCreditSold {
  providerId: string
  pluginId: string
  key: string
  reference: string
  label: string
  last4: string
  amountCents: number
  appliedAs: 'discount' | 'tender'
}

const KEY = /^[a-z][a-z0-9-]{1,39}$/
const PROVIDER_ID = /^([a-z][a-z0-9-]{0,63})\.([a-z][a-z0-9-]{1,39})$/

/** The shape of a provider's `reference`: short, and safe in a document path segment. */
export const CHECKOUT_CREDIT_REFERENCE = /^[A-Za-z0-9:_-]{1,128}$/

const PLUGIN_CHECKOUT_CREDITS = definePluginServiceContract<PluginCheckoutCreditProvider>(
  'core.checkout-credits',
  { multiple: true },
)

/** Joins the providers. A plugin re-registering a key replaces its own. */
export function registerPluginCheckoutCredit(
  provider: PluginCheckoutCreditProvider,
  options?: { pluginId?: string },
): void {
  if (!KEY.test(String(provider?.key ?? ''))) {
    throw new Error(`checkout credit provider key "${provider?.key}" must be lower-case words and dashes`)
  }
  const pluginId = getRegisteringPluginId() ?? options?.pluginId
  registerPluginService(PLUGIN_CHECKOUT_CREDITS, provider, {
    ...(pluginId ? { pluginId } : {}),
    key: provider.key,
  })
}

function resolved(): ResolvedCheckoutCreditProvider[] {
  return resolvePluginServices(PLUGIN_CHECKOUT_CREDITS).map((entry) => ({
    providerId: `${entry.pluginId}.${entry.impl.key}`,
    pluginId: entry.pluginId,
    provider: entry.impl,
  }))
}

/** Whether any plugin registered a provider: a seller with none skips the field. */
export function hasPluginCheckoutCredits(): boolean {
  return resolvePluginServices(PLUGIN_CHECKOUT_CREDITS).length > 0
}

/**
 * A code as typed — any case, spaces and dashes — in the one form providers
 * see: upper case, letters, digits and single dashes, at most 40 characters.
 * Empty when nothing usable was typed.
 */
export function normalizeCheckoutCreditCode(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/** The provider that issues a code, or `null`. The first to recognize it answers. */
export function checkoutCreditProviderForCode(code: string): ResolvedCheckoutCreditProvider | null {
  const normalized = normalizeCheckoutCreditCode(code)
  if (!normalized) return null
  for (const entry of resolved()) {
    try {
      if (entry.provider.recognizes(normalized)) return entry
    } catch (error) {
      console.error(`[checkout-credits] "${entry.providerId}" failed to read a code`, error)
    }
  }
  return null
}

/** One provider by the id a sale recorded, or `null` when it is gone. */
export function checkoutCreditProvider(providerId: string): ResolvedCheckoutCreditProvider | null {
  return resolved().find((entry) => entry.providerId === providerId) ?? null
}

/**
 * The providers a site offers on a channel, for the cart's field and the
 * register's tender. Never throws: a provider that fails is not offered.
 */
export async function offeredCheckoutCredits(input: {
  hostId: string
  channel: CheckoutCreditChannel
}): Promise<Array<{ providerId: string; label: string; lookup: boolean }>> {
  const answers = await Promise.all(
    resolved().map(async (entry) => {
      const offered = await entry.provider.offered(input).catch((error: unknown) => {
        console.error(`[checkout-credits] "${entry.providerId}" offered() failed for ${input.hostId}`, error)
        return false
      })
      return offered
        ? { providerId: entry.providerId, label: entry.provider.label, lookup: typeof entry.provider.lookup === 'function' }
        : null
    }),
  )
  return answers.filter((answer): answer is { providerId: string; label: string; lookup: boolean } => Boolean(answer))
}

/** An account answer held to the contract, or a refusal in its place. */
export function normalizeCheckoutCreditAccount(
  answer: CheckoutCreditAccount | CheckoutCreditRefusal | null | undefined,
): CheckoutCreditAccount | CheckoutCreditRefusal {
  if (!answer || typeof answer !== 'object') {
    return { ok: false, status: 404, error: 'That code is not valid.' }
  }
  if (answer.ok !== true) {
    const status = Number.isInteger(answer.status) && answer.status >= 400 && answer.status < 500 ? answer.status : 409
    return { ok: false, status, error: cleanText(answer.error, 160) || 'That code cannot be used.' }
  }
  if (!CHECKOUT_CREDIT_REFERENCE.test(String(answer.reference ?? ''))) {
    return { ok: false, status: 404, error: 'That code is not valid.' }
  }
  const available = answer.availableCents
  return {
    ok: true,
    reference: answer.reference,
    label: cleanText(answer.label, 40) || 'Store credit',
    last4: cleanText(answer.last4, 4).toUpperCase(),
    availableCents: Number.isSafeInteger(available) && available > 0 ? available : 0,
    ...(answer.detail ? { detail: cleanText(answer.detail, 120) } : {}),
  }
}

/** Cents a provider says it held or took, as whole non-negative cents no larger than `ceiling`. */
export function boundedCreditCents(value: unknown, ceiling: number): number {
  const cents = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
  const max = Number.isSafeInteger(ceiling) && ceiling > 0 ? ceiling : 0
  return Math.min(cents, max)
}

function cleanText(value: unknown, max: number): string {
  return Array.from(String(value ?? ''), (char) =>
    char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char,
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** The metadata key an online redemption rides under on the payment processor. */
export const CHECKOUT_CREDIT_METADATA_KEY = 'credit0'

/** What an online checkout carries to its webhook: the hold to settle. */
export interface CheckoutCreditHeld {
  providerId: string
  reference: string
  holdKey: string
  amountCents: number
  label: string
  last4: string
}

/**
 * The hold an online checkout placed, packed for a payment processor's
 * metadata: one key holding `[providerId, reference, holdKey, cents, label, last4]`
 * as JSON, inside a 500-character value. Never the code itself: metadata is
 * readable on the merchant's dashboard, and a code is a bearer secret.
 */
export function encodeCheckoutCreditMetadata(held: CheckoutCreditHeld): Record<string, string> {
  const entry = [
    held.providerId,
    held.reference,
    held.holdKey.slice(0, 200),
    held.amountCents,
    cleanText(held.label, 40),
    cleanText(held.last4, 4),
  ]
  return { [CHECKOUT_CREDIT_METADATA_KEY]: JSON.stringify(entry) }
}

/** Reads {@link encodeCheckoutCreditMetadata} back. Anything unreadable is `null`, never guessed. */
export function decodeCheckoutCreditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CheckoutCreditHeld | null {
  const raw = metadata?.[CHECKOUT_CREDIT_METADATA_KEY]
  if (raw === undefined || raw === null || raw === '') return null
  let entry: unknown
  try {
    entry = JSON.parse(String(raw))
  } catch {
    return null
  }
  if (!Array.isArray(entry)) return null
  const [providerId, reference, holdKey, cents, label, last4] = entry
  if (!PROVIDER_ID.test(String(providerId ?? ''))) return null
  if (!CHECKOUT_CREDIT_REFERENCE.test(String(reference ?? ''))) return null
  if (typeof holdKey !== 'string' || !holdKey) return null
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents <= 0) return null
  return {
    providerId: String(providerId),
    reference: String(reference),
    holdKey,
    amountCents: cents,
    label: cleanText(label, 40) || 'Store credit',
    last4: cleanText(last4, 4),
  }
}

/** The plugin id and key of a provider id. */
export function splitCheckoutCreditProviderId(providerId: string): { pluginId: string; key: string } | null {
  const match = PROVIDER_ID.exec(String(providerId ?? ''))
  return match ? { pluginId: match[1], key: match[2] } : null
}

/** A recorded redemption, as a seller stores it and its events carry it. */
export function checkoutCreditSold(
  input: Omit<PluginCheckoutCreditSold, 'pluginId' | 'key'>,
): PluginCheckoutCreditSold | null {
  const parts = splitCheckoutCreditProviderId(input.providerId)
  if (!parts || !CHECKOUT_CREDIT_REFERENCE.test(input.reference)) return null
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return null
  return {
    providerId: input.providerId,
    pluginId: parts.pluginId,
    key: parts.key,
    reference: input.reference,
    label: cleanText(input.label, 40) || 'Store credit',
    last4: cleanText(input.last4, 4),
    amountCents: input.amountCents,
    appliedAs: input.appliedAs === 'tender' ? 'tender' : 'discount',
  }
}
