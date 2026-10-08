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
import { ZAPIER_PLUGIN_ID, ZAPIER_WIDGET_ID } from './constants'

const ZapierCard = lazy(() => import('./components/zapier-card.component'))

/**
 * The console half (AGL-3643): the Zapier card on a site's setup page,
 * loaded when that page is opened. It draws nothing until the deployment
 * sets `ZAPIER_APP_URL`, which its route reads.
 */
export function registerZapierConsole(): void {
  registerConsoleExtension({
    pluginId: ZAPIER_PLUGIN_ID,
    displayName: 'Zapier',
    widgets: [
      {
        slot: 'hostSettings',
        widgetId: ZAPIER_WIDGET_ID,
        title: 'Zapier',
        Component: ZapierCard,
      },
    ],
  })
}
