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

import { registerPluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import { registerPluginContactSource } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { WAIVERS_CONTACT_SOURCE_DECLARATION, WAIVERS_PLUGIN_ID } from './constants/bundle-common'
import { WAIVERS_PERMISSION_DECLARATIONS } from './constants/permissions'
import { WAIVERS_CONFIG_SCHEMA } from './constants/settings'

let declared = false

/**
 * The plugin's client DECLARATIONS (AGL-4047): its permission keys, which the
 * one permission catalog lists beside the core keys. The servers register
 * them from `declarations.server`; this is the console browser's half, so
 * the role editor and a member's Permissions section offer them before any
 * waivers page has loaded. Light by construction: nothing here reaches
 * Firestore or React.
 *
 * Also its CRM capture door, `waiver` (AGL-4042), so a contact a signature
 * created reads "Waiver signed" in the CRM's lists, chips and reports rather
 * than the raw word. Loaded in the console's browser and on both servers, so
 * every surface that labels a source has it before it renders.
 *
 * And its settings schema (AGL-428): how many years a signed waiver is kept
 * after its signer asks to be erased. The console's generic settings card
 * draws it at workspace and site scope, and the eraser and the retention job
 * read it through `getPluginConfig`, so both need it registered first.
 */
export function registerWaiversDeclarations(): void {
  if (declared) return
  declared = true
  registerPluginPermissions(WAIVERS_PERMISSION_DECLARATIONS)
  registerPluginContactSource(WAIVERS_CONTACT_SOURCE_DECLARATION, { pluginId: WAIVERS_PLUGIN_ID })
  registerPluginConfigSchema(WAIVERS_CONFIG_SCHEMA)
}

registerWaiversDeclarations()
