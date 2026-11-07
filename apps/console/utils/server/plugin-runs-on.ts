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

import { isFirstPartyPlugin } from '@aglyn/aglyn/plugin-manager/enabled-plugins'

/**
 * WHERE A PLUGIN RUNS ACROSS A WORKSPACE, for the console's route (AGL-4047).
 *
 * The transaction lives in the lib (`@aglyn/tenant-data-admin/server/plugin-runs-on`),
 * because the marketplace's install route writes the same choice for a
 * marketplace plugin installed with "All sites except…". What stays here is
 * what only the console's `/api/orgs/plugin-sites` asks: which plugin ids that
 * door writes.
 */
export {
  pluginRunsOnChoiceFrom,
  writePluginRunsOn,
  type PluginRunsOnWrite,
} from '@aglyn/tenant-data-admin/server/plugin-runs-on'

/** A plugin id this door writes: a built-in plugin. */
export function isRunsOnPluginId(value: unknown): value is string {
  return typeof value === 'string' && isFirstPartyPlugin(value)
}
