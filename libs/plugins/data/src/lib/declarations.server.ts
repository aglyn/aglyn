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
import { registerRepeatRowReader } from '@aglyn/aglyn/plugin-manager/repeat-rows'
import { BUNDLE_ID, DATASET_REPEAT_SOURCE_ID } from './constants/bundle-common'

/**
 * The data plugin's server declarations: the light registrations core reads
 * at boot, before any surface loads.
 *
 * A published page that repeats an element over a dataset asks the platform
 * for the rows, and this is who answers — in every process that composes a
 * page, the tenant's and the console's previews alike. The reader, and the
 * Admin SDK with it, loads on the first page that repeats, not at boot.
 * `plugins.config.json` declares the same source (`repeatSource`), so a boot
 * that skipped this is refused rather than rendered as "no rows".
 */
export function registerDataServerDeclarations(): void {
  registerRepeatRowReader(
    DATASET_REPEAT_SOURCE_ID,
    async (request) =>
      (await import('./repeat/dataset-repeat-rows.server')).readPublishedDatasetRows(
        request,
      ),
    { pluginId: BUNDLE_ID },
  )
}
