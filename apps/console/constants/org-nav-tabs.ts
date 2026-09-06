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

import { buildRoute, Route } from './route-links'

/**
 * The organization area's tab strip (AGL-236): org-scoped surfaces that
 * need no host context, mirroring hostNavTabItems/adminNavTabItems.
 */
export function orgNavTabItems(orgSlug: string) {
  return [
    {
      id: 'nav-tab-org-sites',
      label: 'Sites',
      href: buildRoute(Route.HOST_LIST, { orgSlug }),
    },
    {
      id: 'nav-tab-org-team',
      label: 'Team',
      href: buildRoute(Route.MANAGE_TEAM, { orgSlug }),
    },
    {
      id: 'nav-tab-org-media',
      label: 'Media',
      href: buildRoute(Route.ORG_MEDIA, { orgSlug }),
    },
    // Shares the host Data tab id so the release_data_store flag
    // gating in DashboardLayout applies here too.
    {
      id: 'nav-tab-data',
      label: 'Data',
      href: buildRoute(Route.ORG_DATA, { orgSlug }),
    },
    /*
     * The organization-level CRM (AGL-2630), beside Data because it is the
     * org's other shared collection of records. The same hub the site tab
     * opens — contacts, leads, companies, deals, tasks, reports, fields,
     * settings — mounted over every site at once, which is why the label is
     * the hub's and not the first section's.
     *
     * It carries the HOST tab's id on purpose, the way Data does: `release_
     * contacts` names `nav-tab-contacts`, so sharing the id is what puts both
     * halves of the CRM behind one flag. Two ids would let the org half ship
     * to customers while the site half stayed hidden — a tab leading to a
     * page whose per-site counterpart does not exist yet.
     *
     * Linked straight at the landing section rather than at the bare hub,
     * for the reason the site strip links its plugin tabs that way: the bare
     * address redirects, and the redirect can only be a client one. Contacts
     * is the section on every plan, so it is the one the tab can name without
     * a plan verdict. `resolveActiveTab` compares the first segment under the
     * org, so the tab reads as active on every section of the hub.
     *
     * The strip itself is not rendered at all for a scoped collaborator
     * (`useSecondaryNav`), and the page refuses them independently — the tab
     * is a signpost, never a gate.
     */
    {
      id: 'nav-tab-contacts',
      label: 'CRM',
      href: `${buildRoute(Route.ORG_CRM, { orgSlug })}/contacts`,
    },
    // Plugins is its own section again (AGL-1011). It was folded into
    // Marketplace by AGL-797, which conflated shopping for code with
    // administering the code you already run — and left the installation
    // detail page under `/plugins/…` with no tab owning it, so the whole
    // nav went unhighlighted there. Marketplace is now purely the market.
    {
      id: 'nav-tab-org-plugins',
      label: 'Plugins',
      href: buildRoute(Route.ORG_PLUGINS, { orgSlug }),
    },
    {
      id: 'nav-tab-org-marketplace',
      label: 'Marketplace',
      href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
    },
    {
      id: 'nav-tab-org-billing',
      label: 'Billing',
      href: buildRoute(Route.MANAGE_BILLING, { orgSlug }),
    },
    {
      id: 'nav-tab-org-support',
      label: 'Support',
      href: buildRoute(Route.MANAGE_SUPPORT, { orgSlug }),
    },
    {
      id: 'nav-tab-org-settings',
      label: 'Settings',
      href: buildRoute(Route.ORG_SETTINGS, { orgSlug }),
    },
  ]
}

export default orgNavTabItems
