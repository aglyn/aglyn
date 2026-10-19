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
import { BUNDLE_ID, DOMAIN_CONNECT_JOB_ID } from '../../constants/bundle-common'

/**
 * One-click DNS's server registrations (AGL-3963), from the console server:
 * the sweep that finishes a session whose owner closed the tab. Each tick it
 * re-checks the open sessions' records, connects a domain whose records now
 * resolve (after asking again that its owner may), and closes a session
 * after 48 hours.
 */
export function registerDomainConnectDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: DOMAIN_CONNECT_JOB_ID,
      label: 'One-click DNS',
      drives:
        'Connects a domain whose DNS provider applied the site’s records after its owner closed the page, once the records resolve, and closes a request after 48 hours. If it stops, those domains stay unconnected until their owner presses Verify & connect.',
      run: async (context) => {
        const [{ readDomainConnectConfig }, { sweepDomainConnectSessions }, { platformDomainConnectEngine }] =
          await Promise.all([import('./config'), import('./engine'), import('./platform')])
        // No key, no one-click DNS: a deployment that never set one has no
        // sessions, so the tick costs it no read.
        if (!readDomainConnectConfig()) return { checked: 0, configured: false }
        return sweepDomainConnectSessions(platformDomainConnectEngine({ recheckOwner: true }), {
          deadlineMs: context.deadlineMs,
        })
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
