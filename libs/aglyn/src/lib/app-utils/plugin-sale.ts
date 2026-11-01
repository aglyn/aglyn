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

/**
 * THE CHARGE IS NOT THE PLATFORM'S OWN REVENUE (AGL-4049).
 *
 * A plugin can raise an invoice on a workspace's own billing customer for a
 * sale that is not one of Aglyn's own charges: the card on file pays for it,
 * and the plugin records it in its own ledger, with its own tax row.
 *
 * Everything the platform webhook does for an invoice on a workspace's
 * customer assumes the opposite. It would book the whole sale as Aglyn's
 * revenue beside the plugin's ledger, so the same tax would be filed twice, and
 * it would warn a workspace about a failed attempt the buyer is looking at.
 * This marker is how the plugin says "mine": one metadata field on the invoice
 * and on its PaymentIntent, which Stripe copies onto the charge, so the refund
 * event carries it too. Core names no plugin to read it.
 */
export const PLUGIN_SALE_METADATA_KEY = 'pluginSale'

/** The metadata value that marks a plugin's sale. */
export const PLUGIN_SALE_METADATA_VALUE = 'true'

/** Whether a Stripe object (an invoice, a charge) carries the marker. */
export function isPluginSale(stripeObject: unknown): boolean {
  const metadata = (stripeObject as { metadata?: Record<string, unknown> } | null | undefined)
    ?.metadata
  return metadata?.[PLUGIN_SALE_METADATA_KEY] === PLUGIN_SALE_METADATA_VALUE
}
