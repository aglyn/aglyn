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

// The registry from its own module, not the plugin-manager barrel: boot needs
// the registry and nothing else.
import { registerCustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import {
  listPluginOrgErasers,
  registerPluginOrgEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { BUNDLE_ID } from './constants/bundle-common'
import { RATING_FIELD } from './model/rating-field'

/**
 * The marketplace plugin's server declarations: the light registrations core
 * reads at boot, before any surface loads.
 *
 * The `rating` field type's validator (AGL-434), and the marketplace's share
 * of a workspace erasure.
 *
 * The validator: A dataset field of this type
 * can be written by a path that never loads the marketplace — a visitor's
 * form submission and an automation step, both in the tenant (AGL-2773) — so
 * the validator registers from here, which every app runs at boot, rather
 * than only from the console API surface. Pure data: no React, no Admin SDK.
 */
export function registerMarketplaceServerDeclarations(): void {
  registerCustomFieldType(RATING_FIELD)
  /*
   * The organization's public marketplace identity, erased with it (AGL-1970).
   * Declared REQUIRED in `plugins.config.json`: the profile carries a payout
   * identifier on a world-readable document, so an erasure refuses to run
   * without this eraser rather than report a workspace erased with it
   * standing. From here, which every app and the erasure script run at boot;
   * the Admin SDK arrives with the first erasure, not with the boot.
   */
  if (!listPluginOrgErasers().includes(BUNDLE_ID)) {
    registerPluginOrgEraser(
      async (request) => {
        const { createPublisherIdentityEraser } = await import('./server/publisher-erasure')
        return createPublisherIdentityEraser()(request)
      },
      { pluginId: BUNDLE_ID },
    )
  }
}
