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

// The seam from its own module, not the plugin-manager barrel: both apps load
// this at boot, and the barrel reaches the client contexts.
import { registerInteractionRecipes } from '@aglyn/aglyn/plugin-manager/interaction-recipes'
import { BUNDLE_ID } from './constants/bundle-common'
import { CRM_ACTION_RECIPES } from './model/crm-recipes'

/**
 * The CRM's DECLARATIONS: what another surface reads of this plugin before any
 * of its own surfaces load, in both apps and in the console's browser.
 *
 * Its recipes (AGL-2626), so the automation editor's Recipes menu offers
 * "Welcome a new lead" on a site whose CRM pages were never opened, and the
 * automation it builds names the recipe it began as. Light by construction:
 * the recipes are definitions, and nothing here reaches Firestore or React.
 */
export function registerCrmDeclarations(): void {
  registerInteractionRecipes(CRM_ACTION_RECIPES, { pluginId: BUNDLE_ID })
}
