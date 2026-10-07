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

import type { PluginUsageAxesDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'

/**
 * SHIPPING'S METER (AGL-3612): the label charges the monthly usage sweep
 * invoices (`server/usage-meter.ts`). Labels are passed through at cost, so
 * the meter carries no band and no cost axis — only its id, so the sweep
 * refuses to bill a month the meter is missing from. The id is spelled here
 * rather than imported because the manifest generator loads this module on
 * its own.
 */
export function shippingUsageAxes(): PluginUsageAxesDeclaration {
  return {
    meters: [{ id: 'shipping-labels' }],
  }
}
