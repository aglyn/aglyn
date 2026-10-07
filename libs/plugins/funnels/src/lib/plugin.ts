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

import { CONSOLE_WIDGET_SLOTS, registerConsoleExtension } from '@aglyn/aglyn'
import { registerPluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { FunnelsCard } from './components/funnels-card.component'
import { FUNNEL_INSIGHT_ZONE, FUNNELS_CREATE_ZONE } from './components/funnel-zones'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * Funnels (AGL-3605): the Funnels card on a site's Analytics page, through
 * the `hostAnalytics` zone, and the two zones that card hosts for another
 * plugin's AI controls.
 *
 * Not gated by the shell's plan gate: the card draws its own locked state, so
 * a workspace without the analytics tier is told where funnels come from
 * rather than finding the card missing.
 */
export function registerFunnelsConsole(): void {
  registerPluginZone(
    {
      zone: FUNNELS_CREATE_ZONE,
      label: 'Create a funnel',
      surface: 'console',
      layout: 'bare',
      description:
        'On the Funnels card, beside New funnel and in its empty state: another way to start a funnel. `propose(brief)` asks the funnels plugin for a draft checked against the site and opens the editor on it; a widget here saves nothing.',
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginZone(
    {
      zone: FUNNEL_INSIGHT_ZONE,
      label: 'A funnel’s results',
      surface: 'console',
      layout: 'bare',
      description:
        'Under a funnel’s results on the Funnels card: a control that explains them. Handed the funnel’s name and the range shown, in days.',
    },
    { pluginId: BUNDLE_ID },
  )
  registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Funnels',
    widgets: [
      {
        slot: CONSOLE_WIDGET_SLOTS.hostAnalytics,
        widgetId: 'funnels',
        title: 'Funnels',
        Component: FunnelsCard as never,
      },
    ],
  })
}
