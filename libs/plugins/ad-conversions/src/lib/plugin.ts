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
import { AD_CONVERSIONS_PLUGIN_ID, AD_CONVERSIONS_WIDGET_ID } from './constants'

/** Code-split: the card loads only when a site's setup page is opened. */
const AdConversionsCard = lazy(() => import('./components/ad-conversions-card.component'))

/**
 * The console surface (AGL-3694): one card on a site's setup page that
 * connects the Meta Conversions API, the TikTok Events API and the Pinterest
 * Conversions API with the merchant's own access tokens.
 */
export function registerAdConversionsConsole(): void {
  registerConsoleExtension({
    pluginId: AD_CONVERSIONS_PLUGIN_ID,
    displayName: 'Ad conversions',
    widgets: [
      {
        slot: 'hostSettings',
        widgetId: AD_CONVERSIONS_WIDGET_ID,
        title: 'Ad conversions',
        Component: AdConversionsCard,
      },
    ],
  })
}
