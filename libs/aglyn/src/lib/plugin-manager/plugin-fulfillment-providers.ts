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
 * Outside parties that fulfill a seller's lines (AGL-3634): a fulfillment
 * network that picks and packs from its own warehouses, a print-on-demand or
 * dropship supplier that makes and sends the goods itself.
 *
 * Each one takes some of a record's lines away from the merchant's own
 * packing table. Whoever else ships that record — a label buyer, another
 * provider, the merchant by hand — must know which units are already spoken
 * for, or the customer gets two parcels and the merchant pays twice. The
 * provider plugins never import one another and never import the seller, so
 * each registers a {@link PluginFulfillmentProvider} here and answers one
 * question: which units of this record do you hold that have not shipped?
 *
 * A HOLD IS ONLY WHAT HAS NOT SHIPPED. Once the provider ships, it writes the
 * shipment onto the record through `core.shipment-records`, the record's own
 * unshipped count drops, and the hold drops with it. A canceled or failed
 * hand-off is no hold: the units are the merchant's again.
 *
 * A provider that cannot answer is reported by name in `unanswered` rather
 * than read as holding nothing, so a caller deciding whether to ship can say
 * why it is waiting instead of shipping a parcel that may already be on its
 * way from somewhere else.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers`); it is not in
 * the barrel.
 */

/** Units of one line a provider has taken and not yet shipped. */
export interface PluginFulfillmentHold {
  /** The provider's id, unique across plugins: `shipbob`, `printful`. */
  providerId: string
  /** What a person calls it. */
  providerLabel: string
  /** The line's position on the record, as `core.shipment-records` names it. */
  lineIndex: number
  /** Units of the line the provider holds that have not shipped. */
  quantity: number
  /**
   * `pending` — taken and not yet accepted by the provider (queued, or being
   * sent); `accepted` — the provider has it and is fulfilling it.
   */
  state: 'pending' | 'accepted'
  /** The provider's own reference for the hand-off, for a person to look it up there. */
  reference?: string
}

export interface PluginFulfillmentProvider {
  /** Stable and unique across plugins; a plugin may register several. */
  id: string
  label: string
  /** The units of one record this provider holds; empty when none. */
  holds(hostId: string, recordId: string): Promise<PluginFulfillmentHold[]>
}

const PLUGIN_FULFILLMENT_PROVIDERS = definePluginServiceContract<PluginFulfillmentProvider>(
  'core.fulfillment-providers',
  { multiple: true },
)

/**
 * Registers a provider. A plugin registers each of its providers under the
 * provider's id, and registering the same id again replaces it.
 */
export function registerPluginFulfillmentProvider(
  provider: PluginFulfillmentProvider,
  options?: { pluginId?: string },
): void {
  const id = String(provider?.id ?? '').trim()
  if (!id) throw new Error('a fulfillment provider needs an id')
  const pluginId = getRegisteringPluginId() ?? options?.pluginId
  registerPluginService(PLUGIN_FULFILLMENT_PROVIDERS, provider, {
    key: id,
    ...(pluginId ? { pluginId } : {}),
  })
}

/** Every registered provider, with the plugin that registered it. */
export function listPluginFulfillmentProviders(): Array<{ pluginId: string; id: string; label: string }> {
  return resolvePluginServices(PLUGIN_FULFILLMENT_PROVIDERS).map((entry) => ({
    pluginId: entry.pluginId,
    id: entry.impl.id,
    label: entry.impl.label,
  }))
}

/** What every provider holds of one record. */
export interface PluginFulfillmentHolds {
  holds: PluginFulfillmentHold[]
  /** Providers that threw: they may hold units nobody can see. */
  unanswered: Array<{ providerId: string; providerLabel: string }>
}

/**
 * Asks every provider — or every provider but those of `exceptPluginId`, so
 * a provider deciding what it may take does not count itself — what it holds
 * of one record. Each is isolated: one that throws is logged and named in
 * `unanswered`, and the rest still answer. A hold of no units is dropped.
 */
export async function pluginFulfillmentHolds(
  hostId: string,
  recordId: string,
  options?: { exceptPluginId?: string },
): Promise<PluginFulfillmentHolds> {
  const result: PluginFulfillmentHolds = { holds: [], unanswered: [] }
  const entries = resolvePluginServices(PLUGIN_FULFILLMENT_PROVIDERS).filter(
    (entry) => !options?.exceptPluginId || entry.pluginId !== options.exceptPluginId,
  )
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const holds = await entry.impl.holds(hostId, recordId)
        for (const hold of holds ?? []) {
          const quantity = Math.floor(Number(hold?.quantity))
          const lineIndex = Math.floor(Number(hold?.lineIndex))
          if (!(quantity > 0) || !(lineIndex >= 0)) continue
          result.holds.push({ ...hold, quantity, lineIndex })
        }
      } catch (error) {
        console.error(
          `[fulfillment-providers] "${entry.impl.id}" of "${entry.pluginId}" failed for ${hostId}/${recordId}`,
          error,
        )
        result.unanswered.push({ providerId: entry.impl.id, providerLabel: entry.impl.label })
      }
    }),
  )
  return result
}

/** Units held per line, summed across providers. */
export function heldQuantitiesByLine(holds: readonly PluginFulfillmentHold[]): Map<number, number> {
  const held = new Map<number, number>()
  for (const hold of holds) held.set(hold.lineIndex, (held.get(hold.lineIndex) ?? 0) + hold.quantity)
  return held
}
