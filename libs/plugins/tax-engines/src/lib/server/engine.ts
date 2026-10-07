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
  PluginTaxAddress,
  PluginTaxEngine,
  PluginTaxEngineQuote,
  PluginTaxEngineQuoteRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { randomUUID } from 'node:crypto'
import {
  allocateCents,
  isCompleteShipFrom,
  normalizeTaxAddress,
  TAX_ENGINE_PROVIDER_LABELS,
  taxDocumentDate,
  type TaxEngineAddress,
} from '../model/tax-engines'
import type { TaxDocument, TaxDocumentLine } from '../providers/types'
import { readTaxEnginesKeyring, taxProviderFor } from './config'
import {
  exemptionFor,
  normalizeEmail,
  openCredentials,
  readConnection,
  readProductTaxCodes,
  type StoredTaxEngineConnection,
} from './store'
import { resolveTaxEngineSite } from './site-context'

/**
 * The plugin's answer to core's `core.tax-engine` contract (AGL-3631): a
 * quote from whichever engine the site connected, an address check, and a
 * site's status. Every refusal THROWS, in a sentence the caller may log;
 * `quotePluginTaxEngine` turns a throw into the caller's fallback.
 */

/** A site with no usable connection, and why. */
export class TaxEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxEngineUnavailableError'
  }
}

/** The connection a site's sale may use, with its credentials opened. */
export async function usableConnection(hostId: string) {
  const keyring = readTaxEnginesKeyring()
  if (!keyring) throw new TaxEngineUnavailableError('this deployment has no tax-engine key configured')
  const [connection, site] = await Promise.all([readConnection(hostId), resolveTaxEngineSite(hostId)])
  if (!site) throw new TaxEngineUnavailableError('tax services are switched off for this site, or its plan does not sell')
  if (!connection) throw new TaxEngineUnavailableError('no tax service is connected for this site')
  return { connection, site, credentials: openCredentials(connection, keyring) }
}

/** The site's own address as the engine's origin; refused while incomplete. */
export function shipFromOf(connection: StoredTaxEngineConnection): TaxEngineAddress {
  if (!connection.shipFrom || !isCompleteShipFrom(connection.shipFrom)) {
    throw new TaxEngineUnavailableError(
      'the tax service has no complete ship-from address for this site (street, city, postal code and state)',
    )
  }
  return connection.shipFrom
}

/** Where a sale is taxed: the destination, or the site itself for an in-person sale. */
export function shipToOf(
  shipFrom: TaxEngineAddress,
  channel: string,
  destination: PluginTaxAddress | Record<string, unknown> | null | undefined,
): TaxEngineAddress {
  if (channel === 'pos') return shipFrom
  return normalizeTaxAddress(destination) ?? shipFrom
}

/**
 * The document lines for a basket: each line's tax code resolved (the
 * caller's, then the product's, then the site's default), and a basket
 * discount spread across the lines that are not exempt.
 */
export async function documentLines(
  hostId: string,
  connection: StoredTaxEngineConnection,
  lines: ReadonlyArray<{
    id: string
    productId?: string
    variantId?: string
    sku?: string
    description?: string
    quantity: number
    amountCents: number
    taxCode?: string
    exempt?: boolean
  }>,
  discountCents: number,
): Promise<TaxDocumentLine[]> {
  const codes = await readProductTaxCodes(
    hostId,
    lines.map((line) => String(line.productId ?? '')).filter(Boolean),
  )
  const amounts = lines.map((line) => Math.max(0, Math.round(Number(line.amountCents) || 0)))
  const discounts = allocateCents(
    Math.min(Math.max(0, Math.round(discountCents || 0)), amounts.reduce((a, b) => a + b, 0)),
    lines.map((line, index) => (line.exempt ? 0 : amounts[index])),
  )
  return lines.map((line, index) => {
    const taxCode =
      line.taxCode || (line.productId ? codes.get(line.productId) : undefined) || connection.defaultTaxCode || undefined
    return {
      id: String(line.id),
      quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
      amountCents: amounts[index],
      discountCents: Math.min(amounts[index], discounts[index]),
      ...(taxCode ? { taxCode } : {}),
      ...(line.sku || line.productId ? { itemCode: String(line.sku || line.productId) } : {}),
      ...(line.description ? { description: line.description } : {}),
      ...(line.exempt ? { exempt: true } : {}),
    }
  })
}

export async function quoteTax(request: PluginTaxEngineQuoteRequest): Promise<PluginTaxEngineQuote> {
  const { connection, credentials } = await usableConnection(request.hostId)
  const shipFrom = shipFromOf(connection)
  const shipTo = shipToOf(shipFrom, request.channel, request.shipTo)
  const lines = await documentLines(request.hostId, connection, request.lines, request.discountCents ?? 0)
  const exemption = await exemptionFor(request.hostId, request.customer?.email, shipTo.region)
  const document: TaxDocument = {
    code: `quote-${randomUUID()}`,
    date: taxDocumentDate(Date.now()),
    currency: String(request.currency || 'usd').toUpperCase(),
    customerCode: normalizeEmail(request.customer?.email) || String(request.customer?.id ?? '') || 'guest',
    shipFrom,
    shipTo,
    lines,
    shippingCents: Math.max(0, Math.round(Number(request.shippingCents) || 0)),
    ...(exemption
      ? { exemption: { type: exemption.type, certificateNumber: exemption.certificateNumber } }
      : {}),
  }
  const answer = await taxProviderFor(connection.provider).quote(credentials, document)
  const byId = new Map(answer.lines.map((line) => [String(line.id), line.taxCents]))
  // An exempt line answers zero whatever the engine said: the seller marked it.
  const quoted = lines.map((line) => ({
    id: line.id,
    taxCents: line.exempt ? 0 : Math.max(0, byId.get(line.id) ?? 0),
  }))
  const shippingTaxCents = Math.max(0, answer.shippingTaxCents)
  return {
    provider: connection.provider,
    providerLabel: TAX_ENGINE_PROVIDER_LABELS[connection.provider],
    taxCents: quoted.reduce((sum, line) => sum + line.taxCents, 0) + shippingTaxCents,
    lines: quoted,
    shippingTaxCents,
    sandbox: connection.environment === 'sandbox',
  }
}

export const taxEngine: PluginTaxEngine = {
  async status(hostId) {
    try {
      const { connection } = await usableConnection(hostId)
      return {
        connected: true,
        provider: connection.provider,
        providerLabel: TAX_ENGINE_PROVIDER_LABELS[connection.provider],
        sandbox: connection.environment === 'sandbox',
      }
    } catch {
      return { connected: false }
    }
  },
  quote: quoteTax,
  async validateAddress(hostId, address) {
    const normalized = normalizeTaxAddress(address)
    if (!normalized) return { valid: false, normalized: null, messages: ['Enter a two-letter country code.'] }
    const { connection, credentials } = await usableConnection(hostId)
    return taxProviderFor(connection.provider).validateAddress(credentials, normalized)
  },
}
