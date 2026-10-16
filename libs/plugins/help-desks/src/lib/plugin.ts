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
import { lazy } from 'react'
import { HELP_DESKS_ENTITLEMENT, HELP_DESKS_PLUGIN_ID, HELP_DESKS_WIDGET_ID } from './constants'

/** Code-split: the card loads only when a site's setup page is opened. */
const HelpDesksCard = lazy(() => import('./components/help-desks-card.component'))

/**
 * The console surface (AGL-3824): one card on a site's Setup → Integrations
 * that connects Gorgias, Re:amaze, Kustomer, Gladly or Richpanel. The card
 * draws nothing until the deployment can hold a connection
 * (`HELP_DESKS_TOKEN_KEY` on the console).
 */
export function registerHelpDesksConsole(): void {
  registerConsoleExtension({
    pluginId: HELP_DESKS_PLUGIN_ID,
    displayName: 'Help desks',
    featureFlag: HELP_DESKS_ENTITLEMENT,
    widgets: [
      {
        slot: 'hostSettings',
        widgetId: HELP_DESKS_WIDGET_ID,
        title: 'Help desks',
        Component: HelpDesksCard,
      },
    ],
  })
}
