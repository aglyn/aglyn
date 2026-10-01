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

import type { PluginUsageAxesDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import { DATASET_STORAGE_METER_ID } from './constants/bundle-common'

/**
 * THE DATA PLUGIN'S METER (AGL-3080): what the workspace's datasets store,
 * measured in the monthly usage sweep (`server/dataset-storage-meter.ts`).
 * The band and the cost axis it feeds are the platform's data storage — the
 * plugin measures, the plan prices — so the meter is all it declares.
 */
export function dataUsageAxes(): PluginUsageAxesDeclaration {
  return {
    meters: [{ id: DATASET_STORAGE_METER_ID }],
  }
}
