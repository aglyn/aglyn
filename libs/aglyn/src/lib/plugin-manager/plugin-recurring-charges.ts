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

/*==========================================
 * RECURRING CHARGES A SITE SELLS (AGL-3364).
 *
 * A security lockdown pauses the renewals a locked site sells to its own
 * customers — memberships, subscriptions, anything that bills on a
 * schedule — so a suspected fraudster's storefront stops taking money on
 * cards it may have stolen. The lockdown is core; the records of what a
 * site sells are each plugin's own. This contract is the seam between
 * them: a plugin that sells recurring charges declares a source, and the
 * lockdown asks every source for the subscriptions it holds for the locked
 * sites. Core never reads a plugin's collection, and a marketplace plugin
 * that sells subscriptions joins the same way.
 *
 * A source answers from its OWN stored records (the ids it saved when the
 * sale completed), never from a broad search of the payment provider, and
 * only for subscriptions that can still bill.
 *=========================================*/

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/** One subscription a site sells, as its plugin recorded it. */
export interface RecurringChargeRecord {
  /** The payment provider's subscription id (Stripe `sub_…`). */
  subscriptionId: string
  /** The site that sells it. */
  hostId: string
}

export interface RecurringChargeSource {
  /** Every subscription this plugin sells on `hostIds` that can still bill. */
  listLiveSubscriptions(input: {
    hostIds: readonly string[]
  }): Promise<RecurringChargeRecord[]>
}

export const PLUGIN_RECURRING_CHARGE_SOURCES =
  definePluginServiceContract<RecurringChargeSource>(
    'core.recurring-charge-sources',
    { multiple: true },
  )

/** Declares a plugin's recurring charges to the lockdown. */
export function registerRecurringChargeSource(
  source: RecurringChargeSource,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_RECURRING_CHARGE_SOURCES, source, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Every declared source, with the plugin that declared it. */
export function listRecurringChargeSources(): Array<{
  pluginId: string
  source: RecurringChargeSource
}> {
  return resolvePluginServices(PLUGIN_RECURRING_CHARGE_SOURCES).map(
    (entry) => ({ pluginId: entry.pluginId, source: entry.impl }),
  )
}
