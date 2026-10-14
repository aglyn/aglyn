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

import type { ConsoleNavSection } from '@aglyn/aglyn'

export type CommerceConsoleSectionId =
  | 'catalog'
  | 'orders'
  | 'returns'
  | 'promotions'
  | 'reservations'
  | 'analytics'
  | CommerceSettingsSectionId

/**
 * The store's settings, one page each (AGL-3713). They were one section,
 * `settings`, and one long column: payments, taxes, shipping, the register
 * and every other plugin's cards, one after another.
 */
export type CommerceSettingsSectionId =
  | 'payments'
  | 'checkout'
  | 'taxes'
  | 'shipping'
  | 'notifications'
  | 'pos'
  | 'channels'
  | 'integrations'

/** The words above the settings pages in the rail (AGL-3713). */
export const COMMERCE_SETTINGS_GROUP = 'Settings'

/**
 * The zone each settings page draws at its foot, keyed by page (AGL-3713).
 *
 * One zone per page, so a plugin chooses its page by the zone it names and
 * nothing else: a contributor restates the id, never imports this package.
 * `commerceSettings` — the zone every store-settings widget named before the
 * split — is the Integrations page's, so a widget that names no page lands
 * there rather than nowhere.
 */
export const COMMERCE_SETTINGS_PAGE_ZONES: Readonly<
  Record<CommerceSettingsSectionId, string>
> = {
  payments: 'commerceSettingsPayments',
  checkout: 'commerceSettingsCheckout',
  taxes: 'commerceSettingsTaxes',
  shipping: 'commerceSettingsShipping',
  notifications: 'commerceSettingsNotifications',
  pos: 'commerceSettingsPos',
  channels: 'commerceSettingsChannels',
  integrations: 'commerceSettings',
}

/** Under the "Settings" subheader (AGL-3713). */
const SETTINGS = COMMERCE_SETTINGS_GROUP

/**
 * The commerce console's sections, in rail order (AGL-2501).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back. A second copy is how a section comes
 * to be routable under one id and drawn under another.
 *
 * Ids appear in links people keep — treat them as persisted, and rename a
 * LABEL rather than an id. An id that has to go is mapped in
 * {@link COMMERCE_RETIRED_SECTIONS} to the section that replaced it.
 *
 * No `navTabId` on any of them: every section here ships with the surface, so
 * they inherit the Products nav item's gate. A section that ships later
 * declares its own, which ANDs with the parent's rather than replacing it.
 *
 * The store's own work first, then its settings under a divider and a
 * "Settings" subheader (AGL-3713).
 */
export const COMMERCE_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'orders', label: 'Orders' },
  { id: 'returns', label: 'Returns' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'payments', label: 'Payments', group: SETTINGS },
  { id: 'checkout', label: 'Checkout', group: SETTINGS },
  { id: 'taxes', label: 'Taxes', group: SETTINGS },
  { id: 'shipping', label: 'Shipping & delivery', group: SETTINGS },
  { id: 'notifications', label: 'Notifications', group: SETTINGS },
  { id: 'pos', label: 'Point of sale', group: SETTINGS },
  // Nothing but other plugins' cards, so each is left out of the rail while
  // none of them has anything to draw (`onlyWithZones`).
  {
    id: 'channels',
    label: 'Sales channels',
    group: SETTINGS,
    onlyWithZones: [COMMERCE_SETTINGS_PAGE_ZONES.channels],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    group: SETTINGS,
    onlyWithZones: [COMMERCE_SETTINGS_PAGE_ZONES.integrations],
  },
]

/**
 * Section ids the console no longer has, and where each one's links go
 * (AGL-3713). `/products/settings` was every setting on one page; it opens
 * Payments, the first of the pages it was split into.
 */
export const COMMERCE_RETIRED_SECTIONS: Readonly<Record<string, string>> = {
  settings: 'payments',
}

/*
 * Rail ORDER decides where `/products` lands: the shell redirects a bare hub
 * URL to the first section in this list the reader may open (AGL-2501). There
 * is deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */
