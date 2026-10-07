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
 * Stock counts kept somewhere else (AGL-3634).
 *
 * When a warehouse that is not the merchant's — a fulfillment network, a
 * supplier — holds the goods, its count is the true one, and the store's own
 * count should say what it says. The plugin that reads that count must not
 * write the seller's products itself, so the seller registers
 * {@link PluginStockLevels} and applies each count under its own rules: the
 * ledger row that explains the change, the sold-out flag, the low-stock
 * alert, back-in-stock email.
 *
 * Counts are matched by SKU, the one identifier a warehouse and a store
 * share. A count the seller cannot apply says why, per SKU, so the plugin
 * that sent it can show the merchant: no product has that SKU, the product
 * does not track stock, or it counts stock per location (where one number
 * would erase the others).
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-stock-levels`); it is not in the
 * barrel.
 */

/** One SKU's count: the units that can be sold now. */
export interface PluginStockLevel {
  sku: string
  quantity: number
}

export type PluginStockLevelOutcome =
  /** The count changed to `after`. */
  | 'updated'
  /** The count already said this. */
  | 'unchanged'
  /** No live product of the store has this SKU. */
  | 'unknown_sku'
  /** The product does not track stock, so there is no count to set. */
  | 'untracked'
  /** The product counts stock per location; one number would erase the others. */
  | 'per_location'
  /** The count was not a whole number of zero or more. */
  | 'invalid'
  /** The write did not land; the next sync tries again. */
  | 'failed'

export interface PluginStockLevelResult {
  sku: string
  outcome: PluginStockLevelOutcome
  /** The count before, when the seller read one. */
  before?: number
  /** The count after, when the seller wrote one. */
  after?: number
}

export interface PluginStockLevelRequest {
  hostId: string
  levels: readonly PluginStockLevel[]
  /** Who counted: shown beside the change in the store's stock history, e.g. `ShipBob`. */
  source: string
}

export interface PluginStockLevels {
  /** Sets each SKU's count; one result per SKU asked, in order. */
  setAvailable(request: PluginStockLevelRequest): Promise<PluginStockLevelResult[]>
}

const PLUGIN_STOCK_LEVELS = definePluginServiceContract<PluginStockLevels>('core.stock-levels', {
  multiple: false,
})

/** Registers the seller. A second plugin is refused naming both. */
export function registerPluginStockLevels(levels: PluginStockLevels, options?: { pluginId?: string }): void {
  registerPluginService(PLUGIN_STOCK_LEVELS, levels, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The seller, or `null` when no plugin registered one. */
export function pluginStockLevels(): PluginStockLevels | null {
  return resolvePluginServices(PLUGIN_STOCK_LEVELS)[0]?.impl ?? null
}
