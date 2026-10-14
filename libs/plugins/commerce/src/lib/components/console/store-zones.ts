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
  definePluginZone,
  registerPluginZone,
} from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { BUNDLE_ID } from '../../constants/bundle-common'
import {
  COMMERCE_SETTINGS_PAGE_ZONES,
  type CommerceSettingsSectionId,
} from '../commerce-console-sections'

/**
 * Two more zones the store's console hosts (AGL-3612): `ordersBulk`, beside
 * the orders list's bulk actions, and `commerceSettings`, at the foot of the
 * store's Settings. A shipping plugin's batch labels and its label settings
 * are the first widgets; another plugin restates these props rather than
 * importing this package.
 */

/** What `ordersBulk` hands a widget: the orders ticked in the list. */
export interface ConsoleOrdersBulkZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  /** The ticked orders' ids, in the list's order. */
  selectedOrderIds: readonly string[]
  /** The store's name, for anything printed. */
  storeName: string
}

/** What `commerceSettings` hands a widget: the site. */
export interface ConsoleCommerceSettingsZoneProps {
  hostId: string
  orgId: string | undefined
}

export const ORDERS_BULK_ZONE = definePluginZone<ConsoleOrdersBulkZoneProps>('ordersBulk')

/**
 * The Integrations page's zone (AGL-3713): every store-settings widget named
 * it before the settings were split into pages, and a widget that names no
 * page still does — so it lands on Integrations rather than nowhere.
 */
export const COMMERCE_SETTINGS_ZONE =
  definePluginZone<ConsoleCommerceSettingsZoneProps>('commerceSettings')

/**
 * One zone per settings page (AGL-3713), drawn at the foot of that page: a
 * plugin chooses its page by the zone it names. Same props as
 * `commerceSettings`. Ids from `COMMERCE_SETTINGS_PAGE_ZONES`, the list the
 * rail and the pages read, so a page and its zone cannot disagree.
 */
export const COMMERCE_SETTINGS_PAGE_ZONE_DEFS = (
  Object.keys(COMMERCE_SETTINGS_PAGE_ZONES) as CommerceSettingsSectionId[]
)
  .filter((page) => page !== 'integrations')
  .map((page) => ({
    page,
    zone: definePluginZone<ConsoleCommerceSettingsZoneProps>(
      COMMERCE_SETTINGS_PAGE_ZONES[page],
    ),
  }))

/** The settings page each page zone sits on, by name (AGL-3713). */
const PAGE_NAMES: Readonly<
  Record<Exclude<CommerceSettingsSectionId, 'integrations'>, string>
> = {
  payments: 'Payments',
  checkout: 'Checkout',
  taxes: 'Taxes',
  shipping: 'Shipping & delivery',
  notifications: 'Notifications',
  pos: 'Point of sale',
  channels: 'Sales channels',
}

/** What `commercePromotions` hands a widget: the site (AGL-3640). */
export type ConsoleCommercePromotionsZoneProps = ConsoleCommerceSettingsZoneProps

/**
 * At the foot of the store's Promotions, beside its discounts and gift
 * cards (AGL-3640): a rewards program is the first widget.
 */
export const COMMERCE_PROMOTIONS_ZONE =
  definePluginZone<ConsoleCommercePromotionsZoneProps>('commercePromotions')

/** Declares them, from the console registrar. */
export function registerCommerceStoreZones(): void {
  const owner = { pluginId: BUNDLE_ID }
  registerPluginZone(
    {
      zone: ORDERS_BULK_ZONE,
      label: 'Orders bulk actions',
      surface: 'console',
      layout: 'bare',
      description:
        'Beside the orders list’s bulk actions, while orders are ticked. A widget here acts on the ticked orders through its own routes and writes no order itself.',
    },
    owner,
  )
  registerPluginZone(
    {
      zone: COMMERCE_PROMOTIONS_ZONE,
      label: 'Store promotions',
      surface: 'console',
      description:
        'At the foot of the store’s Promotions, beside its discounts, gift cards and reviews. A widget here keeps its own programs, balances and connections through its own routes; it writes none of the store’s.',
    },
    owner,
  )
  registerPluginZone(
    {
      zone: COMMERCE_SETTINGS_ZONE,
      label: 'Store integrations',
      surface: 'console',
      description:
        'The store’s Integrations settings page, and where a store-settings widget that names no other page lands. A widget here keeps settings of its own beside the store’s; it writes none of the store’s.',
    },
    owner,
  )
  for (const { page, zone } of COMMERCE_SETTINGS_PAGE_ZONE_DEFS) {
    const name = PAGE_NAMES[page as Exclude<CommerceSettingsSectionId, 'integrations'>]
    registerPluginZone(
      {
        zone,
        label: `Store settings: ${name}`,
        surface: 'console',
        description: `At the foot of the store’s ${name} settings page. A widget here keeps settings of its own beside the store’s; it writes none of the store’s.`,
      },
      owner,
    )
  }
}
