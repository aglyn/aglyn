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

// The seam from its own module, not the plugin-manager barrel: boot needs the
// registry and nothing else, and the barrel reaches the client contexts.
import { registerOperatorAlerts } from '@aglyn/aglyn/plugin-manager/operator-alerts'
import {
  registerPluginRecordIndex,
  type PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { BUNDLE_ID } from './constants/bundle-common'
import { COMMERCE_OPERATOR_ALERTS } from './constants/operator-alerts'
import { registerCommerceEventTriggers } from './server/order-event-triggers'

/**
 * The commerce plugin's server declarations: the light registrations core
 * reads at boot, before any surface loads.
 *
 * Its operator alerts (AGL-3377), so Staff → Operator alerts lists them and
 * staff can switch them before the first one is ever raised; and the indexes
 * of its products and categories, so another plugin reads them without
 * reaching for this plugin's collections.
 */
export function registerCommerceServerDeclarations(): void {
  registerOperatorAlerts(COMMERCE_OPERATOR_ALERTS, { pluginId: BUNDLE_ID })
  // Its order and return events (AGL-3611), and each as a workflow trigger.
  registerCommerceEventTriggers()
  // Products and categories, as another plugin reads them (AGL-3080). The
  // readers and the Admin SDK arrive with the first read, not with the boot.
  registerPluginRecordIndex('product', lazyIndex('productRecordIndex'), { pluginId: BUNDLE_ID })
  registerPluginRecordIndex('productCategory', lazyIndex('productCategoryRecordIndex'), {
    pluginId: BUNDLE_ID,
  })
}

type IndexName = 'productRecordIndex' | 'productCategoryRecordIndex'

function lazyIndex(name: IndexName): PluginRecordIndex {
  const load = async () => (await import('./server/product-record-index'))[name]
  return {
    list: async (request) => (await load()).list(request),
    get: async (request) => (await load()).get(request),
  }
}
