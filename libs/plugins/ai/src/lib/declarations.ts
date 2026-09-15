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

// Named modules rather than the `@aglyn/aglyn` barrel: both apps load this
// on the server at boot, and the full barrel carries client-only contexts
// (AGL-405).
import { AI_ADDON_CREDITS_PER_MONTH } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { registerPluginConfigSchema } from '@aglyn/aglyn/plugin-manager/plugin-config'
import {
  registerPluginEntitlements,
  type PluginEntitlementRegistration,
} from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { AI_PLUGIN_ID } from './constants'
import { AI_CONFIG_SCHEMA } from './plugin-config'
// Registers the activity codes at module scope (AGL-2940).
import './activity/ai-activity-actions'

/**
 * The plugin's DECLARATIONS (AGL-2939): what core must know about this
 * plugin before any of its surfaces load — its billing and access keys,
 * its activity codes, its settings schema. Loaded eagerly by both apps
 * through the generated declarations manifest, at boot on the server and
 * with the plugin loader on the client, so a core billing route folds the
 * add-on and the staff lockdown page lists the levers whether or not a
 * request has touched the plugin yet. Light by construction: nothing here
 * reaches a provider, Firestore or React.
 *
 * The plan tables keep the per-plan defaults for `aiGenerative` and
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
  pluginId: AI_PLUGIN_ID,
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
      // Gated even while the route 501s without a provider key — the switch
      // predates the key on purpose.
      apiPaths: { exact: ['ai/assist', 'assist/chat'] },
    },
    {
      key: 'ai-generate',
      label: 'AI generation',
      staffBypass: true,
      notice: {
        title: 'AI generation is temporarily unavailable',
        body: 'Generating sections, pages and automations with AI is temporarily unavailable. Everything already built is unaffected — please try again shortly.',
      },
      // `ai/seo` (AGL-2910) applies a finished audit's drafts; it spends
      // nothing, and it is still a generative door the switch stops.
      apiPaths: { prefixes: ['ai/generate', 'ai/jobs', 'ai/seo'] },
    },
  ],
}

let declared = false

/**
 * Registers everything above. Idempotent: the declarations manifest runs
 * it once per process, and a surface's register fn may call it again.
 */
export function registerAiDeclarations(): void {
  if (declared) return
  declared = true
  registerPluginEntitlements(AI_PLUGIN_ENTITLEMENTS)
  registerPluginConfigSchema(AI_CONFIG_SCHEMA)
}

registerAiDeclarations()
