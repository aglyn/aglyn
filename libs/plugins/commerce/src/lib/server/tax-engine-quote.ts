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
  pluginTaxEngine,
  quotePluginTaxEngine,
  type PluginTaxAddress,
  type PluginTaxEngineQuote,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { storeTaxAllowsEngine, type OrderTaxEngineStamp } from '../model/commerce-tax-engine'

/**
 * Asks the site's outside tax service for a sale's tax (AGL-3631), through
 * core's `core.tax-engine` contract — commerce never learns which plugin or
 * vendor answers.
 *
 * `{ quote: null, stamp: null }` means no service was involved: the store is
 * not on its own rates, no plugin offers an engine, or the site connected
 * none. The caller prices the sale exactly as it did before.
 *
 * `{ quote: null, stamp: { status: 'fallback' } }` means a connected service
 * was asked and did not answer in time or refused. The caller STILL prices
 * the sale its usual way — a checkout that waited on a vendor or failed with
 * it would lose the sale — and writes the stamp on the order so the merchant
 * sees which sales were taxed at the store's own rates instead.
 */

/** How long the status read may take; the quote holds core's own deadline. */
const STATUS_DEADLINE_MS = 2_000

export interface SaleTaxEngineRequest {
  hostId: string
  settings: { mode?: string; pricesIncludeTax?: boolean } | null | undefined
  channel: 'online' | 'pos' | 'invoice'
  currency?: string
  lines: ReadonlyArray<{
    id: string
    productId?: string
    variantId?: string
    sku?: string
    description?: string
    quantity: number
    /** The line's charged amount, after any discount on it, exclusive of tax. */
    amountCents: number
    exempt?: boolean
  }>
  discountCents?: number
  shippingCents?: number
  shipTo?: PluginTaxAddress | null
  customerEmail?: string | null
}

export interface SaleTaxEngineResult {
  quote: PluginTaxEngineQuote | null
  stamp: OrderTaxEngineStamp | null
}

const NONE: SaleTaxEngineResult = { quote: null, stamp: null }

async function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function quoteSaleTaxWithEngine(
  request: SaleTaxEngineRequest,
): Promise<SaleTaxEngineResult> {
  if (!storeTaxAllowsEngine(request.settings)) return NONE
  const engine = pluginTaxEngine()
  if (!engine || request.lines.length === 0) return NONE
  const status = await withDeadline(
    Promise.resolve().then(() => engine.status(request.hostId)),
    STATUS_DEADLINE_MS,
    { connected: false } as Awaited<ReturnType<typeof engine.status>>,
  )
  if (!status.connected || !status.provider) return NONE
  const provider = status.provider
  const providerLabel = status.providerLabel || provider
  const sandbox = status.sandbox === true
  const outcome = await quotePluginTaxEngine({
    hostId: request.hostId,
    currency: request.currency || 'usd',
    channel: request.channel,
    lines: request.lines,
    ...(request.discountCents ? { discountCents: request.discountCents } : {}),
    ...(request.shippingCents ? { shippingCents: request.shippingCents } : {}),
    shipTo: request.shipTo ?? null,
    customer: { email: request.customerEmail ?? null },
  })
  if ('quote' in outcome) {
    const quote = outcome.quote
    return {
      quote,
      stamp: {
        provider: quote.provider || provider,
        providerLabel: quote.providerLabel || providerLabel,
        status: 'quoted',
        reason: null,
        sandbox: quote.sandbox,
      },
    }
  }
  const failed = outcome as Extract<typeof outcome, { ok: false }>
  console.warn(
    `[commerce] tax service ${provider} did not price a sale on ${request.hostId} (${failed.reason}): ${failed.message}`,
  )
  return {
    quote: null,
    stamp: { provider, providerLabel, status: 'fallback', reason: failed.reason, sandbox },
  }
}
