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

import type { PluginShippingService } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import type { ShippingProviderId } from '../providers/types'

/**
 * The services a merchant picks from for checkout (AGL-3612), keyed as each
 * adapter keys a rate: `carrier:service`, lower case, in the provider's own
 * service token. A provider adds services faster than this list, and a rate
 * for a service not listed here is still bought from the order page; this
 * list is only what checkout can be narrowed to.
 */
const SHIPPO_SERVICES: PluginShippingService[] = [
  { serviceKey: 'usps:usps_ground_advantage', carrier: 'USPS', label: 'USPS Ground Advantage' },
  { serviceKey: 'usps:usps_priority', carrier: 'USPS', label: 'USPS Priority Mail' },
  { serviceKey: 'usps:usps_priority_express', carrier: 'USPS', label: 'USPS Priority Mail Express' },
  { serviceKey: 'ups:ups_ground', carrier: 'UPS', label: 'UPS Ground' },
  { serviceKey: 'ups:ups_second_day_air', carrier: 'UPS', label: 'UPS 2nd Day Air' },
  { serviceKey: 'ups:ups_next_day_air', carrier: 'UPS', label: 'UPS Next Day Air' },
  { serviceKey: 'fedex:fedex_ground', carrier: 'FedEx', label: 'FedEx Ground' },
  { serviceKey: 'fedex:fedex_2_day', carrier: 'FedEx', label: 'FedEx 2Day' },
  { serviceKey: 'fedex:fedex_standard_overnight', carrier: 'FedEx', label: 'FedEx Standard Overnight' },
  { serviceKey: 'dhl_express:dhl_express_worldwide', carrier: 'DHL Express', label: 'DHL Express Worldwide' },
]

const EASYPOST_SERVICES: PluginShippingService[] = [
  { serviceKey: 'usps:groundadvantage', carrier: 'USPS', label: 'USPS Ground Advantage' },
  { serviceKey: 'usps:priority', carrier: 'USPS', label: 'USPS Priority Mail' },
  { serviceKey: 'usps:express', carrier: 'USPS', label: 'USPS Priority Mail Express' },
  { serviceKey: 'ups:ground', carrier: 'UPS', label: 'UPS Ground' },
  { serviceKey: 'ups:2nddayair', carrier: 'UPS', label: 'UPS 2nd Day Air' },
  { serviceKey: 'ups:nextdayair', carrier: 'UPS', label: 'UPS Next Day Air' },
  { serviceKey: 'fedex:fedex_ground', carrier: 'FedEx', label: 'FedEx Ground' },
  { serviceKey: 'fedex:fedex_2_day', carrier: 'FedEx', label: 'FedEx 2Day' },
  { serviceKey: 'fedex:standard_overnight', carrier: 'FedEx', label: 'FedEx Standard Overnight' },
  { serviceKey: 'dhlexpress:expressworldwide', carrier: 'DHL Express', label: 'DHL Express Worldwide' },
]

/**
 * The list checkout can be narrowed to. A merchant's own Easyship or
 * Sendcloud account (AGL-3632) offers whatever couriers that account has
 * switched on, so there is no fixed list: every quoted service is offered.
 */
export function serviceCatalog(providerId: ShippingProviderId): PluginShippingService[] {
  if (providerId === 'easypost') return EASYPOST_SERVICES
  if (providerId === 'shippo') return SHIPPO_SERVICES
  return []
}

/**
 * Whether a quoted service passes both narrowings: the site's (what it ships
 * with at all) and the caller's (what this rate offers). Empty means every.
 */
export function serviceAllowed(
  serviceKey: string,
  siteServices: readonly string[],
  callerServices: readonly string[] | undefined,
): boolean {
  const key = serviceKey.toLowerCase()
  if (siteServices.length && !siteServices.includes(key)) return false
  if (callerServices?.length && !callerServices.map((one) => one.toLowerCase()).includes(key)) return false
  return true
}
