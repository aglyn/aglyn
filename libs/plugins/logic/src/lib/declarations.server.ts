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

import { registerPluginDependentsSource } from '@aglyn/aglyn/plugin-manager/plugin-dependents'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The plugin's SERVER declarations: what a server process must know before
 * any surface of the plugin loads.
 *
 * The variables computed from a workflow, which the "Used by" scan asks for
 * when somebody is about to rename or delete one. The reader and the Admin
 * SDK arrive with the first question, not with the boot.
 */
export function registerLogicServerDeclarations(): void {
  registerPluginDependentsSource(
    {
      kinds: ['workflow'],
      find: async (request) =>
        (await import('./server/variable-dependents')).findWorkflowDependents(request),
    },
    { pluginId: BUNDLE_ID },
  )
}
