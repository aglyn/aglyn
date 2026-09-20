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

import { registerWorkflowsServerDeclarations } from './declarations.server'
import { registerAutomationDraftWriter } from './server-automation-drafts'

/**
 * The workflows plugin's console server surface (AGL-2919).
 *
 * The tenant surface (`registerWorkflowsApi`) serves the inbound webhook a
 * visitor-facing integration calls. This one serves what only the console
 * does: the automation draft writer another plugin reaches through the core's
 * resource-drafts seam, which the AI jobs that write through it — inline at a
 * door and on the beat — find registered in the console process alone
 * (AGL-3026).
 */
export function registerWorkflowsConsoleApi(): void {
  // The console raises host events too — a CRM stage moved, a deal won, a
  // task completed — so the engine's listener is registered here as well as
  // at boot (see `declarations.server.ts`).
  registerWorkflowsServerDeclarations()
  registerAutomationDraftWriter()
}
