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

import { registerPluginApiRoute } from '@aglyn/aglyn/server'

/**
 * The SMS plugin's console routes (AGL-3610): Twilio's inbound webhook, at
 * `/api/sms/inbound` on the console. Point the Messaging Service's "Send a
 * webhook" incoming-message URL there. Signed by Twilio, so `machine` — no
 * session, no enablement gate.
 */
export function registerSmsConsoleApi(): void {
  registerPluginApiRoute(
    'sms/inbound',
    {
      web: async (request) =>
        (await import('./server/inbound-route')).smsInboundRoute(request),
    },
    { machine: true },
  )
}
