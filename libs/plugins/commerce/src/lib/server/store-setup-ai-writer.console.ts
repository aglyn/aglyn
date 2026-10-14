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

import { registerPluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin, getLockdownVerdict } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import { STORE_SETUP_RESOURCE } from '../model/store-setup-content'
import { createStoreSetupAiWriter } from './store-setup-ai-writer'

/**
 * The `store-settings` writer (AGL-3749) over the console's Admin SDK, with
 * the lockdown verdict every console write door asks: the platform, the
 * workspace, the site and the member, for a write.
 */
export const storeSetupAiWriter = createStoreSetupAiWriter({
  firestore: () => firebaseAdmin.app().firestore() as unknown as FirebaseFirestore.Firestore,
  lockdown: async ({ uid, org, host }) =>
    Boolean(await getLockdownVerdict({ staff: false, uid, org: org as never, host: host as never, intent: 'write' })),
})

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerStoreSetupAiWriter(): void {
  registerPluginResourceDraftWriter(STORE_SETUP_RESOURCE, storeSetupAiWriter, { pluginId: BUNDLE_ID })
}
