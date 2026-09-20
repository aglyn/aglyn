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

// The registry from its own module, not the runtime barrel: boot needs the
// registry and nothing else, and the barrel reaches the data layer.
import {
  type HostEventListener,
  registerHostEventListener,
} from '@aglyn/tenant-runtime/host-event-listeners'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The automation engine, as the runtime hears it.
 *
 * Light by construction: the engine is imported when the first event
 * arrives, not when the process starts, so a process that never sees an
 * event pays for this object and nothing else.
 */
export const workflowsHostEventListener: HostEventListener = {
  async onEvent(hostId, event, payload) {
    const { runEventAutomations } = await import('./engine/run-event-automations')
    return await runEventAutomations(hostId, event, payload)
  },
  async onDispatch(hostId, automationId, event, payload) {
    const { runSingleAction } = await import('./engine/run-event-actions')
    return await runSingleAction(hostId, automationId, event, payload)
  },
}

/**
 * The plugin's SERVER declarations: what the server must know at boot,
 * before any door of the plugin has been called.
 *
 * The engine's host-event listener, because the doors that raise the events
 * mostly never load this plugin. A form submission and a page view are core
 * routes; a contact captured by a Stripe webhook is a core capture door. Each
 * calls `emitHostEvent`, and the listener has to be registered before the
 * first of them arrives — which is what running this from both apps'
 * `instrumentation.ts` gives.
 *
 * Also called from the plugin's own API register functions, so a process
 * whose boot did not run it still registers the listener the first time a
 * plugin door loads. Registering twice replaces in place.
 */
export function registerWorkflowsServerDeclarations(): void {
  registerHostEventListener(BUNDLE_ID, workflowsHostEventListener)
}
