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
 * Optional lines a buyer may add at checkout, offered by another plugin
 * (AGL-3635).
 *
 * Package protection is the first: a plugin that insures parcels quotes a
 * premium for the basket, the seller shows it as a box the buyer ticks, and
 * the seller charges it as one more line. The seller never learns which
 * insurer answered and the insurer never reads the seller's documents: the
 * offer crosses here, and what was bought is recorded on the sale, which the
 * seller's own events then carry.
 *
 * ## Money
 *
 * Every amount is integer cents in the request's currency. An offer is
 * advisory until the sale: the seller asks again when the buyer pays and
 * charges THAT answer, so a stale price in a drawer is never what is
 * charged. An offer whose amount is not a positive integer, or whose
 * currency differs from the request's, is dropped rather than rounded.
 *
 * ## Nobody home is an empty list
 *
 * A provider that is not configured, not switched on for the site, slow or
 * failing answers nothing, and the seller sells exactly as it did before.
 * {@link quotePluginCheckoutExtras} never throws.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-checkout-extras`); it is not in the
 * barrel.
 */

/** One line of the basket, as a provider prices it. */
export interface PluginCheckoutExtraLine {
  /** The seller's id for the item, when it has one. */
  itemId?: string
  name: string
  sku?: string
  quantity: number
  /** Per unit, integer cents, before discounts. */
  unitCents: number
  /** Whether the line travels in a parcel. */
  ships: boolean
}

/** What a seller asks: the basket a buyer is about to pay for. */
export interface PluginCheckoutExtraRequest {
  hostId: string
  /** ISO-4217, lower case. */
  currency: string
  /** The goods' value, integer cents, before discounts and shipping. */
  itemsCents: number
  lines: PluginCheckoutExtraLine[]
  /** Where the buyer said it goes, when they said. */
  destination?: { country?: string; postalCode?: string }
  /** Aborted when the seller stops waiting; a provider passes it to its fetches. */
  signal?: AbortSignal
}

/** What a provider offers for that basket. */
export interface PluginCheckoutExtraOffer {
  /** Stable within the provider: `package-protection`. Lower-case words and dashes. */
  key: string
  /** What the buyer reads beside the box: `Package protection`. */
  label: string
  /** One sentence under it. */
  description?: string
  /** Integer cents, above zero. */
  amountCents: number
  /** ISO-4217, lower case; must be the request's. */
  currency: string
  /** Whether the box starts ticked. The merchant decides; default unticked. */
  defaultSelected?: boolean
  /** The provider's id for this quote, carried onto the sale (64 characters at most). */
  quoteRef?: string
  /** A page the buyer can read about it, `https:` only. */
  termsUrl?: string
}

export interface PluginCheckoutExtraProvider {
  /** The offer for this basket, or `null`. Throwing reads as `null`. */
  offer(request: PluginCheckoutExtraRequest): Promise<PluginCheckoutExtraOffer | null>
}

/** An offer as the seller sees it: whose it is, and the id it is chosen by. */
export interface QuotedPluginCheckoutExtra extends Required<Pick<PluginCheckoutExtraOffer, 'defaultSelected'>> {
  /** `{pluginId}.{key}`: what a buyer's choice names. */
  id: string
  pluginId: string
  key: string
  label: string
  description?: string
  amountCents: number
  currency: string
  quoteRef?: string
  termsUrl?: string
}

/**
 * What a sale recorded of one extra the buyer took. The seller stores this
 * on the sale and puts it in the events it raises about the sale, so the
 * provider learns what was bought from the seller's own facts.
 */
export interface PluginCheckoutExtraSold {
  id: string
  pluginId: string
  key: string
  label: string
  amountCents: number
  quoteRef?: string
}

/** The most extras one checkout carries. */
export const MAX_CHECKOUT_EXTRAS = 3

const KEY = /^[a-z][a-z0-9-]{1,39}$/
const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/

const PLUGIN_CHECKOUT_EXTRAS = definePluginServiceContract<PluginCheckoutExtraProvider>(
  'core.checkout-extras',
  { multiple: true },
)

/** Joins the providers. Re-registering under the same plugin replaces its own. */
export function registerPluginCheckoutExtra(
  provider: PluginCheckoutExtraProvider,
  options?: { pluginId?: string },
): void {
  const pluginId = getRegisteringPluginId() ?? options?.pluginId
  registerPluginService(PLUGIN_CHECKOUT_EXTRAS, provider, {
    ...(pluginId ? { pluginId } : {}),
  })
}

/** Whether any plugin offers extras: a seller with none skips the question. */
export function hasPluginCheckoutExtras(): boolean {
  return resolvePluginServices(PLUGIN_CHECKOUT_EXTRAS).length > 0
}

function cleanText(value: unknown, max: number): string {
  // Control characters become spaces: an offer's words are drawn on a page.
  return Array.from(String(value ?? ''), (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * An offer held to the contract, or `null`: a positive integer amount in the
 * request's currency, a key and a label, and nothing else a page would render
 * that it should not.
 */
export function normalizePluginCheckoutExtra(
  pluginId: string,
  offer: PluginCheckoutExtraOffer | null | undefined,
  currency: string,
): QuotedPluginCheckoutExtra | null {
  if (!offer || !PLUGIN_ID.test(pluginId)) return null
  const key = String(offer.key ?? '')
  const label = cleanText(offer.label, 60)
  const amountCents = offer.amountCents
  if (!KEY.test(key) || !label) return null
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents <= 0) return null
  if (String(offer.currency ?? '').toLowerCase() !== String(currency ?? '').toLowerCase()) return null
  const description = cleanText(offer.description, 240)
  const quoteRef = cleanText(offer.quoteRef, 64)
  const termsUrl = /^https:\/\/[^\s"'<>]+$/i.test(String(offer.termsUrl ?? '')) ? String(offer.termsUrl) : ''
  return {
    id: `${pluginId}.${key}`,
    pluginId,
    key,
    label,
    ...(description ? { description } : {}),
    amountCents,
    currency: currency.toLowerCase(),
    defaultSelected: offer.defaultSelected === true,
    ...(quoteRef ? { quoteRef } : {}),
    ...(termsUrl ? { termsUrl } : {}),
  }
}

/**
 * Asks every provider at once and keeps what answered within `timeoutMs`,
 * each one held to the contract. Never throws; a provider that throws, is
 * late or answers nonsense is simply absent. At most
 * {@link MAX_CHECKOUT_EXTRAS}, in the providers' resolve order.
 */
export async function quotePluginCheckoutExtras(
  request: Omit<PluginCheckoutExtraRequest, 'signal'>,
  options: { timeoutMs: number },
): Promise<QuotedPluginCheckoutExtra[]> {
  const providers = resolvePluginServices(PLUGIN_CHECKOUT_EXTRAS)
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
          entry.impl.offer({ ...request, signal: controller.signal }).catch((error: unknown): null => {
            console.error(`[checkout-extras] provider "${entry.pluginId}" failed for ${request.hostId}`, error)
            return null
          }),
          deadline,
        ])
        return answer === 'late' ? null : normalizePluginCheckoutExtra(entry.pluginId, answer, request.currency)
      }),
    )
    const seen = new Set<string>()
    return answers
      .filter((answer): answer is QuotedPluginCheckoutExtra => Boolean(answer))
      .filter((answer) => (seen.has(answer.id) ? false : (seen.add(answer.id), true)))
      .slice(0, MAX_CHECKOUT_EXTRAS)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * The buyer's choice, read from a request body: the ids of offers they took,
 * de-duplicated and bounded. Ids only; the amounts are always asked again.
 */
export function readChosenCheckoutExtras(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => /^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{1,39}$/.test(entry))
  return [...new Set(ids)].slice(0, MAX_CHECKOUT_EXTRAS)
}

/** The metadata keys the extras ride under: `extra0`, `extra1`, `extra2`. */
export const CHECKOUT_EXTRA_METADATA_PREFIX = 'extra'

/**
 * The extras a sale carries, packed for a payment processor's metadata: one
 * key per extra (`extra0` …), each `[id, cents, label, quoteRef?]` as JSON,
 * well inside a 500-character value. One key each, so a long quote id can
 * never truncate another extra out of the record.
 */
export function encodeCheckoutExtrasMetadata(
  extras: readonly QuotedPluginCheckoutExtra[],
): Record<string, string> {
  const packed: Record<string, string> = {}
  extras.slice(0, MAX_CHECKOUT_EXTRAS).forEach((extra, index) => {
    const entry: Array<string | number> = [extra.id, extra.amountCents, extra.label.slice(0, 60)]
    if (extra.quoteRef) entry.push(extra.quoteRef.slice(0, 64))
    packed[`${CHECKOUT_EXTRA_METADATA_PREFIX}${index}`] = JSON.stringify(entry)
  })
  return packed
}

/**
 * Reads {@link encodeCheckoutExtrasMetadata} back off the metadata object.
 * Anything unreadable is dropped, never guessed.
 */
export function decodeCheckoutExtrasMetadata(
  metadata: Record<string, unknown> | null | undefined,
): PluginCheckoutExtraSold[] {
  const sold: PluginCheckoutExtraSold[] = []
  for (let index = 0; index < MAX_CHECKOUT_EXTRAS; index += 1) {
    const raw = metadata?.[`${CHECKOUT_EXTRA_METADATA_PREFIX}${index}`]
    if (raw === undefined || raw === null || raw === '') continue
    let entry: unknown
    try {
      entry = JSON.parse(String(raw))
    } catch {
      continue
    }
    if (!Array.isArray(entry)) continue
    const [id, cents, label, quoteRef] = entry
    const match = /^([a-z][a-z0-9-]{0,63})\.([a-z][a-z0-9-]{1,39})$/.exec(String(id ?? ''))
    if (!match || typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents <= 0) continue
    if (sold.some((extra) => extra.id === id)) continue
    const ref = cleanText(quoteRef, 64)
    sold.push({
      id: String(id),
      pluginId: match[1],
      key: match[2],
      label: cleanText(label, 60) || 'Extra',
      amountCents: cents,
      ...(ref ? { quoteRef: ref } : {}),
    })
  }
  return sold
}

/** The cents a sale's extras add up to. */
export function checkoutExtrasCents(extras: ReadonlyArray<{ amountCents: number }> | null | undefined): number {
  return (extras ?? []).reduce(
    (sum, extra) => sum + (Number.isSafeInteger(extra?.amountCents) && extra.amountCents > 0 ? extra.amountCents : 0),
    0,
  )
}
