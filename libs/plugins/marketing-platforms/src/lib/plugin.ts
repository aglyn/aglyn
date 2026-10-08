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
import { MARKETING_PLATFORMS_ENTITLEMENT, MARKETING_PLATFORMS_PLUGIN_ID, MARKETING_PLATFORMS_WIDGET_ID } from './constants'

/** Code-split: the card loads only when a site's setup page is opened. */
const MarketingPlatformsCard = lazy(() => import('./components/marketing-platforms-card.component'))

/**
 * The console surface (AGL-3639): one card on a site's setup page that
 * connects Mailchimp, Klaviyo, Omnisend and — where the deployment has the
 * app — Attentive and Constant Contact (AGL-3696). The card draws nothing until the deployment can
 * hold a connection (`MARKETING_PLATFORMS_TOKEN_KEY` on the console).
 */
export function registerMarketingPlatformsConsole(): void {
  registerConsoleExtension({
    pluginId: MARKETING_PLATFORMS_PLUGIN_ID,
    displayName: 'Email platforms',
    featureFlag: MARKETING_PLATFORMS_ENTITLEMENT,
    widgets: [
      {
        slot: 'hostSettings',
        widgetId: MARKETING_PLATFORMS_WIDGET_ID,
        title: 'Email platforms',
        Component: MarketingPlatformsCard,
      },
    ],
  })
}
