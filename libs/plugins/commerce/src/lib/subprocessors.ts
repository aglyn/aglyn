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

import type {
  PluginEgressHostDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { SHIPPINGEASY_DEFAULT_BASE_URL } from './model/shippingeasy'
import { TRACKING_CARRIERS } from './model/tracking-url'
import { EPOS_PRINT_NAMESPACE } from './printing/render-epson'

/**
 * Hosts commerce's code names that are no recipient of anything (AGL-3610):
 * the carriers' public tracking pages, which `model/tracking-url.ts` turns a
 * tracking number into a link to. No server here requests them — the link is
 * printed in a buyer email and on the order status page, and only the buyer's
 * own browser opens it, when they click. The Epson ePOS-Print namespace is
 * the same: an identifier inside the XML a receipt printer is handed.
 */
export function commerceSubprocessors(): PluginSubprocessorsAnswer {
  const hosts: PluginEgressHostDeclaration[] = TRACKING_CARRIERS.map(
    (carrier) => ({
      host: new URL(carrier.url('TRACKING')).host,
      disposition: 'no-request',
      reason:
        `${carrier.label}'s public tracking page. Commerce builds a link to it from a ` +
        'shipment’s carrier and tracking number (`libs/plugins/commerce/src/lib/model/tracking-url.ts`) ' +
        'and prints it in the buyer’s shipping email and order status page; no platform server ever requests it.',
      dataReceived:
        'Nothing from the platform. When the buyer clicks the link, their own browser sends the carrier the tracking number in the URL; no customer record, email or order detail goes with it.',
    }),
  )
  hosts.push({
    host: new URL(EPOS_PRINT_NAMESPACE).host,
    disposition: 'no-request',
    reason:
      'The ePOS-Print XML namespace (`libs/plugins/commerce/src/lib/printing/render-epson.ts`) on the print job an Epson receipt printer receives when it polls. A namespace is an identifier that happens to look like a URL; neither the platform nor the printer requests it.',
    dataReceived: 'Nothing. No request is made.',
  })
  hosts.push({
    host: new URL(SHIPPINGEASY_DEFAULT_BASE_URL).host,
    disposition: 'not-a-subprocessor',
    reason:
      'ShippingEasy’s order API (`libs/plugins/commerce/src/lib/server/shippingeasy.ts`, AGL-3633). A site admin ' +
      'connects their OWN ShippingEasy account with its API key, secret and store key, and commerce sends that ' +
      'site’s paid orders into it and cancels canceled ones there. The customer chose and contracts with ' +
      'ShippingEasy; the platform sends nothing to it for a site that has not connected it.',
    dataReceived:
      'For a connected site only: each shippable order’s number, date, totals, ship-to and billing name, ' +
      'address, email and phone, and its items (name, SKU, quantity, price, weight, options), signed with the ' +
      'merchant’s own API key. Nothing from any other site or account.',
  })
  return { hosts }
}
