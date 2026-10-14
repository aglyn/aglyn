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

import { registerPluginConsoleCron } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { AD_CONVERSIONS_DELIVERY_JOB_ID, AD_CONVERSIONS_PLUGIN_ID } from './constants'

/**
 * The delivery job (AGL-3694), on the CONSOLE's server only: it opens the
 * sealed access tokens, and only the console holds the key they are sealed
 * under. Every tick sends the conversions that are due.
 */
export function registerAdConversionsConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: AD_CONVERSIONS_DELIVERY_JOB_ID,
      label: 'Ad conversions delivery',
      drives:
        'Sends each site’s purchases and leads to the Meta Conversions API, the TikTok Events API and the Pinterest Conversions API connected on its setup page, for visitors who allowed advertising. If it stops, those server-side events stop arriving and the ad accounts see only what their browser tags report.',
      run: async (context) => {
        const [{ runDeliveryTick }, { platformDeliveryDeps }] = await Promise.all([
          import('./server/delivery'),
          import('./server/platform-deps'),
        ])
        return runDeliveryTick(platformDeliveryDeps(), { deadlineMs: context.deadlineMs })
      },
    },
    { pluginId: AD_CONVERSIONS_PLUGIN_ID },
  )
}
