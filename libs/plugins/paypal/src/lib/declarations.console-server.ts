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
import { PAYPAL_EXPIRY_JOB_ID, PAYPAL_PLUGIN_ID } from './constants'

/**
 * The sweep (AGL-3630), on the console's server: every fifteen minutes it
 * gives back what an unpaid PayPal checkout held (stock, a discount's slot,
 * a gift card's balance), finishes a capture whose caller died part-way,
 * and retells a seller that missed a paid checkout.
 */
export function registerPayPalConsoleServerDeclarations(): void {
  registerPluginConsoleCron(
    {
      id: PAYPAL_EXPIRY_JOB_ID,
      label: 'PayPal checkouts',
      drives:
        'Releases the stock, discounts and gift card balances an abandoned PayPal checkout held, and completes a PayPal payment whose confirmation was interrupted. If it stops, abandoned PayPal checkouts hold stock until it expires on its own, and an interrupted payment waits for PayPal to resend it.',
      run: async (context) => {
        const [{ sweepPayPalCheckouts }, { readPayPalConfig }] = await Promise.all([
          import('./server/checkouts'),
          import('./server/config'),
        ])
        const read = readPayPalConfig()
        return sweepPayPalCheckouts(read.configured ? read.config : null, context)
      },
    },
    { pluginId: PAYPAL_PLUGIN_ID },
  )
}
