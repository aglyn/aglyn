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

/*==========================================
 * HOW THE IMPORT WIZARD AND THE EXPORT DIALOG NAME THE CRM'S RECORDS
 * (AGL-3527) — the client half of each resource, registered from the
 * console registrar, which loads where the wizard is drawn.
 *=========================================*/

import { registerPluginTransferResourceUi } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { CRM_COMPANIES_RESOURCE, CRM_CONTACTS_RESOURCE } from './fields'

/** The wizard's title for each resource. */
export const CRM_TRANSFER_LABELS: Readonly<Record<string, string>> = {
  [CRM_CONTACTS_RESOURCE]: 'Contacts',
  [CRM_COMPANIES_RESOURCE]: 'Companies',
}

/** Registers the client half of every CRM transfer resource. */
export function registerCrmTransferResourceUis(pluginId: string): void {
  for (const [key, label] of Object.entries(CRM_TRANSFER_LABELS)) {
    registerPluginTransferResourceUi(key, { label }, { pluginId })
  }
}
