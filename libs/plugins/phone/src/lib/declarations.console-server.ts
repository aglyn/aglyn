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

import { listPluginOrgErasers, registerPluginOrgEraser } from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { PHONE_PLUGIN_ID } from './constants/bundle-common'

/**
 * Phone's console-server declarations (AGL-4251): when a workspace is erased,
 * its Twilio subaccount is closed, which releases its numbers and stops every
 * charge on them. The org's own `phone*` documents go with the org; the two
 * top-level indexes are org-keyed collections the erasure sweeps by `orgId`.
 */
export function registerPhoneConsoleServerDeclarations(): void {
  if (listPluginOrgErasers().includes(PHONE_PLUGIN_ID)) return
  registerPluginOrgEraser(
    async (request) => (await import('./server/org-eraser')).erasePhoneOrg(request),
    { pluginId: PHONE_PLUGIN_ID },
  )
}
