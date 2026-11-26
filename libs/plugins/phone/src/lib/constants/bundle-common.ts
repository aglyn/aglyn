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

import type { PluginPermission } from '@aglyn/aglyn/plugin-manager/plugin-permissions'

/**
 * The persisted plugin id (AGL-4251): stored in `org.enabledPlugins`, named in
 * `plugins.config.json`, the console URL slug (`/[orgSlug]/business-phone`),
 * and the owner of every `phone/*` API route. Not bare `phone`: that word is
 * a contact field all over core, and a plugin id is a word core may not say.
 */
export const PHONE_PLUGIN_ID = 'business-phone'

/** The release flag the plugin ships behind. OFF by default. */
export const PHONE_RELEASE_FLAG = 'release_phone'

/** The org tab the release flag hides while it is off. */
export const PHONE_NAV_TAB_ID = 'nav-tab-org-phone'

/**
 * The entitlement feature that opens Phone. No plan carries it: the `phone`
 * add-on switches it on, or a staff entitlement override.
 */
export const PHONE_FEATURE = 'phone'

/** The `org.seatAddons` key the $15/mo add-on is stored under. */
export const PHONE_ADDON_KEY = 'phone'

/** Open Phone: read and answer texts, take and place calls. */
export const PHONE_USE_PERMISSION = 'phone.use'

/**
 * Set Phone up: buy, port or release a number, submit the texting
 * registration, and change hours, forwarding and voicemail.
 */
export const PHONE_MANAGE_PERMISSION = 'phone.manage'

/**
 * The plugin's permissions, registered by both halves so the console gate and
 * a route's resolution agree. Using Phone is a front-desk job, so editors hold
 * it by default; setting it up spends money and changes what callers hear, so
 * only owners and admins do.
 */
export const PHONE_PERMISSIONS: readonly PluginPermission[] = [
  {
    key: PHONE_USE_PERMISSION,
    pluginId: PHONE_PLUGIN_ID,
    label: 'Use Phone',
    description: 'Read and answer the business number’s texts, and take and place calls on it.',
    defaults: { admin: true, editor: true, viewer: false },
    groupLabel: 'Phone',
  },
  {
    key: PHONE_MANAGE_PERMISSION,
    pluginId: PHONE_PLUGIN_ID,
    label: 'Set up Phone',
    description:
      'Buy, move or release the business number, register it for texting, and change hours, forwarding and voicemail.',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'Phone',
  },
]
