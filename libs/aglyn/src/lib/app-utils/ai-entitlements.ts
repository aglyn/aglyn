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

import {
  registerPluginEntitlements,
  type PluginEntitlementRegistration,
} from '../plugin-manager/plugin-entitlements'
import { AI_ADDON_CREDITS_PER_MONTH } from './plan-entitlements'

/**
 * The Aglyn AI plugin's billing and access keys, declared through the
 * generic seam (AGL-2940): the `aiAddon` seat add-on, the two feature flags,
 * and the two lockdown levers with their notices and the API paths they
 * gate. The plan tables keep the per-plan defaults for `aiGenerative` and
 * `aiAssist`, and `PLAN_PRICING` keeps the add-on's price, so this names
 * keys and bands and restates no price.
 *
 * `ai-assist` and `ai-generate` are separate levers because the two doors
 * spend at different rates and an incident on one need not stop the other
 * (AGL-2903). Both grant the staff bypass: a provider incident is verified
 * recovered by staff making one real call, not by lifting the lock and
 * watching customers find out.
 */
export const AI_PLUGIN_ENTITLEMENTS: PluginEntitlementRegistration = {
  pluginId: 'ai',
  seatAddons: [
    {
      key: 'aiAddon',
      label: 'AI add-on',
      maxUnits: 1,
      quota: {
        key: 'assistCreditsPerMonth',
        perUnitByPlan: AI_ADDON_CREDITS_PER_MONTH,
      },
      features: ['aiGenerative', 'aiAssist'],
    },
  ],
  features: [
    { key: 'aiAssist', label: 'AI assist' },
    { key: 'aiGenerative', label: 'AI generation' },
  ],
  lockdownFeatures: [
    {
      key: 'ai-assist',
      label: 'AI assist',
      staffBypass: true,
      notice: {
        title: 'AI assist is temporarily unavailable',
        body: 'AI assist is temporarily unavailable. Your content is unaffected — please try again shortly.',
      },
      // Gated even while the route 501s without an API key — the switch
      // predates the key on purpose.
      apiPaths: { exact: ['ai/assist'] },
    },
    {
      key: 'ai-generate',
      label: 'AI generation',
      staffBypass: true,
      notice: {
        title: 'AI generation is temporarily unavailable',
        body: 'Generating sections, pages and automations with AI is temporarily unavailable. Everything already built is unaffected — please try again shortly.',
      },
      apiPaths: { prefixes: ['ai/generate'] },
    },
  ],
}

registerPluginEntitlements(AI_PLUGIN_ENTITLEMENTS)
