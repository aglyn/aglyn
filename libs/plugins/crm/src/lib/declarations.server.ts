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

// The contract from its own module, not the plugin-manager barrel: boot needs
// the registry and nothing else, and the barrel reaches the client contexts.
import {
  registerPluginContactCaptureWriter,
  type PluginContactCaptureWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { registerPluginLeadConversionListener } from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { registerPluginPersonMatcher } from '@aglyn/aglyn/plugin-manager/plugin-person-matches'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The CRM as the plugin that keeps people.
 *
 * Light by construction, the way the workflows listener is: the capture
 * itself is imported when the first one arrives, not when the process
 * starts, so a process that never captures anybody pays for this object and
 * nothing else. That matters because this registers in EVERY server process,
 * including ones that will never touch the CRM.
 */
export const crmContactCaptureWriter: PluginContactCaptureWriter = {
  async capture(request) {
    const { captureContactForCrm } = await import('./server/capture-contact')
    return await captureContactForCrm(request)
  },
}

/**
 * The plugin's SERVER declarations: what the server must know at boot, before
 * any door of the CRM has been called.
 *
 * ## Why a declaration and not a `tenantApi` registration
 *
 * The doors that meet a person mostly never load this plugin. A form
 * submission is a core route; an order and a booking are captured inside
 * STRIPE WEBHOOKS. None of them has a reason to load the CRM, and a registry
 * filled by a surface that did not load answers `null` — which
 * `capturePluginContact` defines as "this workspace has no record system", a
 * sentence that would be false and silent. Orders would stop creating
 * contacts with nothing red anywhere, which is the AGL-3025 shape.
 *
 * Running from both apps' generated server-declarations manifest at boot is
 * what makes the answer true in every process. It is also called from the
 * plugin's own API register functions, so a process whose boot did not run it
 * still registers the writer the first time a CRM door loads. Registering
 * twice replaces in place.
 *
 * ⚠️ The registry holds ONE writer: a workspace keeps one set of people. A
 * second plugin's is refused naming both, and the incumbent keeps serving.
 */
export function registerCrmServerDeclarations(): void {
  registerPluginContactCaptureWriter(crmContactCaptureWriter, {
    pluginId: BUNDLE_ID,
  })
  // The CRM's own share of a lead conversion (AGL-3254): the lead's
  // campaigns go onto the contact's facet. Through the seam every door
  // that converts a lead reaches, and deferred like the capture: the
  // module that writes is loaded when the first conversion arrives, and
  // it brings the Admin SDK with it — this file defers the plugin's OWN
  // module only. A library imported statically across the plugin cannot
  // also be lazy-loaded here: `enforce-module-boundaries` refuses every
  // static import of a library the project lazy-loads anywhere.
  registerPluginLeadConversionListener(
    async (request) => {
      const { carryLeadCampaignsOnConversion } =
        await import('./server/lead-campaign-carry')
      return carryLeadCampaignsOnConversion(request)
    },
    { pluginId: BUNDLE_ID },
  )
  // "Did this workspace already know this person?" (AGL-3289), asked by the
  // staff console's acquisition card. Deferred like the rest: the reads load
  // when a staff member first opens a card, not when the process starts.
  registerPluginPersonMatcher(
    async (request) => {
      const { matchCrmPeople } = await import('./server/person-matches')
      return matchCrmPeople(request)
    },
    { pluginId: BUNDLE_ID },
  )
}
