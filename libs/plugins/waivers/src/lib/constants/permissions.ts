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
import { WAIVERS_PERMISSIONS, WAIVERS_PLUGIN_ID } from './bundle-common'

/**
 * The two things a member may be trusted with here (AGL-4042), declared once
 * and registered from the console and the servers alike. Both are on for a
 * site's admins and editors and off for viewers by default; a custom role
 * turns either off, so the window's staff can take signatures without
 * rewriting the waiver.
 */
export const WAIVERS_PERMISSION_DECLARATIONS: readonly PluginPermission[] = [
  {
    key: WAIVERS_PERMISSIONS.manage,
    pluginId: WAIVERS_PLUGIN_ID,
    label: 'Manage waivers',
    description: 'Write, publish and retire waivers, and void a signature.',
    defaults: { admin: true, editor: true, viewer: false },
  },
  {
    key: WAIVERS_PERMISSIONS.collect,
    pluginId: WAIVERS_PLUGIN_ID,
    label: 'Collect waivers',
    description: 'See who signed, take signatures at the window and record paper waivers.',
    defaults: { admin: true, editor: true, viewer: false },
  },
]
