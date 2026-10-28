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

import { registerPluginEntitlements } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { MARKETING_SITE_PERMISSIONS } from './model/marketing-permissions'

let declared = false

/**
 * The plugin's DECLARATIONS (AGL-4047): "Run email campaigns", which the one
 * permission catalog lists beside the core keys. Loaded eagerly by the
 * console (client and server) and the tenant's server through the generated
 * declarations manifest, so the role editor offers it, a custom role or a
 * per-member override keeps it, and the site's stamp carries it. Light by
 * construction: nothing here reaches a provider, Firestore or React.
 */
export function registerMarketingDeclarations(): void {
  if (declared) return
  declared = true
  registerPluginEntitlements({ pluginId: 'marketing', orgPermissions: MARKETING_SITE_PERMISSIONS })
}

registerMarketingDeclarations()
