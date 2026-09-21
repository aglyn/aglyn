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

import type { ConsoleStaffPage } from '@aglyn/aglyn'
import { buildRoute, Route } from './route-links'

/**
 * The staff admin area's tab strip, previously copy-pasted into every
 * admin page (extracted with the Feature flags tab, AGL-230), mirroring
 * `hostNavTabItems`.
 *
 * The pages plugins add to the staff area (AGL-2939) follow the console's
 * own tabs, in registration order, each linking to the generic staff route.
 */
export function adminNavTabItems(
  staffPages: readonly Pick<ConsoleStaffPage, 'id' | 'label'>[] = [],
) {
  return [
    ...consoleAdminNavTabItems(),
    ...staffPages.filter(ownsItsSegment).map((page) => ({
      id: `nav-tab-admin-${page.id}`,
      label: page.label,
      href: buildRoute(Route.ADMIN_STAFF_PAGE, { staffPage: page.id }),
    })),
  ]
}

/** The first segment under `/admin` of every route the console itself serves. */
const CONSOLE_STAFF_SEGMENTS = new Set(
  Object.values(Route)
    .filter((template) => template.startsWith('/admin/'))
    .map((template) => template.split('/')[2] ?? '')
    .filter((segment) => segment && !segment.startsWith('[')),
)

/**
 * A staff page whose id is one of the console's own staff segments gets no
 * tab: the console's static route wins that URL, so the tab would open the
 * console's page under the plugin's label.
 */
function ownsItsSegment(page: Pick<ConsoleStaffPage, 'id'>): boolean {
  if (!CONSOLE_STAFF_SEGMENTS.has(page.id)) return true
  console.error(
    `[console] the staff page "${page.id}" is a console staff route; ` +
      'it gets no tab. Change the plugin\'s staff page id.',
  )
  return false
}

function consoleAdminNavTabItems() {
  return [
    {
      id: 'nav-tab-admin-overview',
      label: 'Overview',
      href: buildRoute(Route.ADMIN_OVERVIEW),
    },
    {
      id: 'nav-tab-admin-orgs',
      label: 'Organizations',
      href: buildRoute(Route.ADMIN_ORGS),
    },
    {
      id: 'nav-tab-admin-users',
      label: 'Users',
      href: buildRoute(Route.ADMIN_USERS),
    },
    {
      id: 'nav-tab-admin-flags',
      label: 'Feature flags',
      href: buildRoute(Route.ADMIN_FLAGS),
    },
    // Beside Feature flags, because it is the same kind of thing: a lever
    // over the whole platform rather than over one workspace (AGL-2486).
    {
      id: 'nav-tab-admin-settings',
      label: 'Platform settings',
      href: buildRoute(Route.ADMIN_SETTINGS),
    },
    {
      id: 'nav-tab-admin-coupons',
      label: 'Coupons',
      href: buildRoute(Route.ADMIN_COUPONS),
    },
    /*
     * Plugin reviews used to sit HERE. It is a plugin staff page since
     * AGL-3080 — the queue triages a collection only the marketplace writes
     * — so it arrives through `staffPages` instead, at the same
     * `/admin/plugin-reviews` URL, and lands with the other plugin tabs.
     */
    {
      id: 'nav-tab-admin-support',
      label: 'Support',
      href: buildRoute(Route.ADMIN_SUPPORT),
    },
    {
      id: 'nav-tab-admin-contact-suppressions',
      label: 'Do not contact',
      href: buildRoute(Route.ADMIN_CONTACT_SUPPRESSIONS),
    },
    {
      id: 'nav-tab-admin-emails',
      label: 'Emails',
      href: buildRoute(Route.ADMIN_EMAILS),
    },
    // Reports sit immediately before the two levers that answer them
    // (AGL-1964). The order is the workflow: read what came in, then decide
    // whether it is one file, one site, or a whole workspace.
    {
      id: 'nav-tab-admin-abuse-reports',
      label: 'Abuse reports',
      href: buildRoute(Route.ADMIN_ABUSE_REPORTS),
    },
    /*
     * Marketplace reports used to sit HERE, beside the abuse queue, because
     * it is the same job on a different surface (AGL-2310). It is a plugin
     * staff page since AGL-3080 — the collection it triages is one only the
     * marketplace writes — so it arrives through `staffPages` below instead,
     * at the same `/admin/marketplace-reports` URL. It lands with the other
     * plugin tabs rather than next to the abuse queue, which is the one
     * thing the move costs.
     */
    {
      id: 'nav-tab-admin-lockdown',
      label: 'Lockdown',
      href: buildRoute(Route.ADMIN_LOCKDOWN),
    },
    {
      id: 'nav-tab-admin-media-quarantine',
      label: 'Disabled files',
      href: buildRoute(Route.ADMIN_MEDIA_QUARANTINE),
    },
    {
      id: 'nav-tab-admin-health',
      label: 'Health',
      href: buildRoute(Route.ADMIN_HEALTH),
    },
    // Directly after Health, because it is the other half of the same job:
    // Health says a scheduled job stopped running, and this is where the
    // operator does something about it (AGL-1949).
    {
      id: 'nav-tab-admin-maintenance',
      label: 'Maintenance',
      href: buildRoute(Route.ADMIN_MAINTENANCE),
    },
    // Directly before Sales tax, because the two read the same
    // `platformRevenue` rows for different questions: this one asks what Aglyn
    // earned, that one asks what is owed to the state (AGL-2486).
    {
      id: 'nav-tab-admin-revenue',
      label: 'Revenue',
      href: buildRoute(Route.ADMIN_REVENUE),
    },
    // Immediately after Revenue: the two are halves of one question, and the
    // margin figure is only readable next to the revenue it is a fraction of.
    {
      id: 'nav-tab-admin-margin-utilization',
      label: 'Margin',
      href: buildRoute(Route.ADMIN_MARGIN_UTILIZATION),
    },
    {
      id: 'nav-tab-admin-tax-return',
      label: 'Sales tax',
      href: buildRoute(Route.ADMIN_TAX_RETURN),
    },
    {
      id: 'nav-tab-admin-audit',
      label: 'Audit log',
      href: buildRoute(Route.ADMIN_AUDIT),
    },
  ]
}

export default adminNavTabItems
