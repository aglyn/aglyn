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
  registerPluginSmsMessaging,
  type PluginSmsMessaging,
} from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { registerPluginUsageMeter } from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { SMS_PLUGIN_ID, SMS_USAGE_METER_ID } from './constants'
import { createTwilioSmsProvider } from './twilio-provider'

/**
 * Registers the platform's text-message service and its usage meter at boot,
 * in both apps (`serverDeclarations`) — the console's billing webhook and
 * order routes and the tenant's routes all resolve the same contract.
 *
 * Light on purpose: `isConfigured()` reads three env variables and nothing
 * else, and the stores behind `send()` load with the first text.
 */
export function registerSmsServerDeclarations(): void {
  const provider = createTwilioSmsProvider()
  let platform: Promise<PluginSmsMessaging> | null = null
  registerPluginSmsMessaging(
    {
      isConfigured: () => provider.isConfigured(),
      send: async (request) => {
        platform ??= import('./sms-platform.server').then((module) =>
          module.createPlatformSmsMessaging(provider),
        )
        return (await platform).send(request)
      },
    },
    { pluginId: SMS_PLUGIN_ID },
  )
  registerPluginUsageMeter({
    pluginId: SMS_PLUGIN_ID,
    id: SMS_USAGE_METER_ID,
    measure: async (context) =>
      (await import('./sms-platform.server')).measurePlatformSmsUsage(context),
  })
}
