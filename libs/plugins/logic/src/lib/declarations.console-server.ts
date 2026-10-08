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

// The seams' own modules, not the `@aglyn/aglyn/server` barrel: boot needs
// two registries, not the whole server surface.
import {
  registerPluginResourceDraftWriter,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { BUNDLE_ID } from './constants/bundle-common'
import {
  checkFunctionDraftContent,
  checkVariableDraftContent,
  FUNCTION_DRAFT_RESOURCE,
  VARIABLE_DRAFT_RESOURCE,
} from './server/logic-draft-content'
import { registerVariableAiCapability } from './server/variable-ai-capability'

/**
 * A writer whose store half loads with its first call: `check` is pure and
 * answers from the light content module, and `refusal`, `read` and `write`
 * bring the writer module and the Admin SDK with them.
 */
function lazyWriter(
  check: PluginResourceDraftWriter['check'],
  load: () => Promise<PluginResourceDraftWriter>,
): PluginResourceDraftWriter {
  return {
    check,
    refusal: async (context) => (await load()).refusal(context),
    read: async (context) => (await load()).read(context),
    write: async (request) => (await load()).write(request),
  }
}

/**
 * The logic plugin's CONSOLE-ONLY server declarations (AGL-3616), named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime registers none of it: only the console
 * runs AI jobs (AGL-3026), and a pre-authorized writer has no business in
 * the process that serves the public internet.
 *
 *  - The `variable` and `function` draft writers on the core's resource-drafts
 *    seam (`server/logic-drafts.ts`): what an AI build — or any plugin making
 *    a site's logic from a brief — writes a variable or a function through,
 *    under this plugin's rules.
 *  - The `variable` operation an AI build plans (`server/variable-ai-capability.ts`),
 *    which the `variable` writer executes. A function is the AI plugin's own
 *    operation, because writing one takes a model; its `logic` step writes it
 *    through the `function` writer registered here.
 *
 * Registering again replaces this plugin's own.
 */
export function registerLogicConsoleServerDeclarations(): void {
  registerPluginResourceDraftWriter(
    VARIABLE_DRAFT_RESOURCE,
    lazyWriter(
      (content) => checkVariableDraftContent(content),
      async () => (await import('./server/logic-drafts')).variableDraftWriter,
    ),
    { pluginId: BUNDLE_ID },
  )
  registerPluginResourceDraftWriter(
    FUNCTION_DRAFT_RESOURCE,
    lazyWriter(
      (content) => checkFunctionDraftContent(content),
      async () => (await import('./server/logic-drafts')).functionDraftWriter,
    ),
    { pluginId: BUNDLE_ID },
  )
  registerVariableAiCapability()
}
