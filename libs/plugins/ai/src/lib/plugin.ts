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

import { registerConsoleExtension } from '@aglyn/aglyn'
import { AiAssistProvider } from './components/ai-assist-provider.component'
import AiCreditsCard from './components/ai-credits-card.component'
import { AssistPanelComponent } from './components/assist-panel.component'
import BillingAssistOverageCard from './components/billing-assist-overage-card.component'
import { AI_PLUGIN_ID } from './constants'
import { registerAiDeclarations } from './declarations'

/**
 * The Aglyn AI plugin's console half (AGL-2939): the assistant dock, the
 * besigner copy assistant's provider, and the billing cards — each mounted
 * through a shell-owned zone (AGL-2940), so no console page imports this
 * plugin.
 *
 * No `featureFlag` on the extension: the plugin's doors are gated one by
 * one — the dock reads the `release_assist` verdict the shell hands it, the
 * generative doors answer 404 behind `release_ai_generative`, the billing
 * cards render only where the plan sells a band — and a flag here would
 * switch off the released doors with the unreleased ones.
 */
export function registerAiConsole(): void {
  registerAiDeclarations()
  registerConsoleExtension({
    pluginId: AI_PLUGIN_ID,
    displayName: 'AI',
    // The besigner copy assistant (AGL-89/419): mounted by the shell around
    // every console page; the designer reads core's `DesignerAssistContext`.
    providers: [AiAssistProvider],
    widgets: [
      {
        slot: 'assistPanel',
        widgetId: 'ai-assist-dock',
        title: 'Assistant',
        Component: AssistPanelComponent,
      },
      {
        slot: 'orgBillingUsage',
        widgetId: 'ai-credits-meter',
        title: 'AI credits',
        Component: AiCreditsCard,
      },
      {
        slot: 'orgBillingUsage',
        widgetId: 'ai-credits-overage',
        title: 'AI credits overage',
        Component: BillingAssistOverageCard,
      },
    ],
  })
}
