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

// The seam from its own module, not the plugin-manager barrel: both apps load
// this at boot, and the barrel reaches the client contexts.
import { registerInteractionStepChecks } from '@aglyn/aglyn/plugin-manager/interaction-step-checks'
import { BUNDLE_ID } from './constants/bundle-common'
import { hostActionStepProblem, SERVER_ACTION_STEP_TYPES } from './model/host-actions'

/**
 * The automation editor's DECLARATIONS: what another surface reads of this
 * plugin before any of its own surfaces load, in both apps and in the
 * console's browser.
 *
 * The checks of the server steps an automation holds (AGL-3080), so a plugin
 * that writes an automation it does not edit — a recipe installed into a
 * site, a drafted automation graded before it is handed over — refuses what
 * this editor would (`validateStoredInteraction`). Light by construction: the
 * checks are pure, and nothing here reaches Firestore or React.
 */
export function registerWorkflowsDeclarations(): void {
  registerInteractionStepChecks(SERVER_ACTION_STEP_TYPES, hostActionStepProblem, { pluginId: BUNDLE_ID })
}
