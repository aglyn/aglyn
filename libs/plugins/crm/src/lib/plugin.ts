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

import * as Aglyn from '@aglyn/aglyn'
import { mdiCardAccountDetailsOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { CRM_CONSOLE_SECTIONS } from './components/crm-console-sections'
import { CrmGlanceCard } from './components/crm-glance-card'
import { BUNDLE_ID } from './constants/bundle-common'
import { withCrmOrgMount } from './hooks/use-crm-org-mount'

/** Code-split: the CRM hub only loads when opened. */
const CrmConsolePage = lazy(
  () => import('./components/crm-console-page'),
)
/** The dashboard glance, split the same way: it loads where the slot mounts it. */
const CrmTasksDueCard = lazy(
  () => import('./components/crm-tasks-due-card'),
)

/**
 * CRM feature plugin (AGL-395, the hub since AGL-2595). Console-only — its
 * records live in Firestore and have no canvas element, so there is no UI
 * bundle. The console half declares the CRM nav + hub through the
 * ConsoleExtension registry (release_contacts gate via the nav tab); the
 * contacts section reads the `contactsPerHost` quota off the shell-passed
 * `org`.
 *
 * The plugin id is `crm` (AGL-2595). It was `contacts` while the surface was
 * one list; the id is persisted in every org's `enabledPlugins` and every
 * host's `disabledPlugins`, so the runtime read the old value as this one
 * until `backfill-plugin-id-crm.mjs` had rewritten the documents, and the
 * alias was retired once that backfill reported nothing left (AGL-2614). The
 * `/contacts` address is a URL, not a stored id, and the nav item keeps
 * redirecting it.
 */
export function registerCrmConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'CRM',
    /*
     * WHO may open the CRM, declared so the shell enforces it.
     *
     * `navTabId` below is a release flag, not authorization: it says whether
     * the surface has shipped, and `FeatureGate` reads it as
     * `released || isStaff`. Nothing above this page decided who among a
     * workspace's members may read it, and the page is a full editor over
     * org-shared people data — names, addresses, order history, notes,
     * consent, and a CSV export of all of it.
     *
     * `data.manage` rather than a key of this plugin's own, because it is
     * the catalog key whose subject is exactly this data. The Firestore
     * rules place contacts in the org-shared data block with datasets and
     * gate writes on `canWriteOrgData()` — owner, admin, editor — which is
     * the population `data.manage` defaults to, so the console gate and the
     * rules agree on the built-in roles by construction. A custom role or a
     * per-member override then narrows the console further, and the rules
     * stay the boundary for the data itself.
     *
     * Minting a `contacts.*` key instead would advertise a control that does
     * not exist. Console contact writes are client-direct against the rules,
     * so a new key would have no server enforcement point to sit on, and a
     * permission a customer can untick that changes nothing is worse than
     * its absence.
     *
     * A SITE COLLABORATOR holding it reaches this page deliberately. They
     * are a real org member document, so this gate is the first thing that
     * has ever asked about them here — and the answer is yes, scoped: the
     * listener filters on `visibleTo`, the rules prove the same predicate
     * per document, and every field the page shows is read through the
     * viewing group's own facet. Refusing them outright would delete a
     * shipped capability rather than close a hole.
     */
    permission: 'data.manage',
    /*
     * Dashboard cards (AGL-2599, AGL-2604): the site dashboard's `hostDashboard`
     * slot composes this extension's permission over each, so a card appears
     * only where the CRM is enabled and only for a reader who may open it —
     * registered here rather than imported by the dashboard so the shell's
     * enablement and entitlement gate decides whether a site that never turned
     * the CRM on sees them, the rule every card on that row follows. The tasks
     * card is a glance at the reader's own overdue and due-today work and
     * renders nothing on a workspace that has never made a task; the glance
     * card is four server-counted figures, each a link into the hub.
     *
     * Both carry `featureFlag: 'crm'` of their own (AGL-2611): the extension
     * declares none, because its contacts list is on every plan, but these
     * two read the tasks and the pipeline a plan without the suite does not
     * have, so the slot leaves them out on such a plan — absent, not upsold,
     * the treatment every gated card gets.
     *
     * The same two cards again on the organization's `orgDashboard` slot
     * (AGL-2636) — the org's sites page — under the same flag, with the same
     * ids: the id names the card, and it is one card totaling the whole
     * organization there instead of one site. The shell hands that slot the
     * org mount as a prop, and `withCrmOrgMount` is what puts the mount's
     * provider around each card, since the sites page cannot import one.
     */
    widgets: [
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
        widgetId: 'crm-tasks-due',
        title: 'Tasks due',
        featureFlag: 'crm',
        Component: CrmTasksDueCard,
      },
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
        widgetId: 'crm-glance',
        title: 'CRM at a glance',
        featureFlag: 'crm',
        Component: CrmGlanceCard,
      },
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.orgDashboard,
        widgetId: 'crm-tasks-due',
        title: 'Tasks due',
        featureFlag: 'crm',
        Component: withCrmOrgMount(CrmTasksDueCard),
      },
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.orgDashboard,
        widgetId: 'crm-glance',
        title: 'CRM at a glance',
        featureFlag: 'crm',
        Component: withCrmOrgMount(CrmGlanceCard),
      },
    ],
    navItems: [
      {
        label: 'CRM',
        href: '/crm',
        // The address the surface had while it was one list. A link kept
        // from then — a bookmark, a docs page, an email — still opens the
        // hub rather than the shell's "not available" notice.
        legacyHrefs: ['/contacts'],
        // Sections as ROUTES (AGL-2595): each is a real URL the shell
        // resolves and gates, so the page mounts the one being read and a
        // bare `/crm` lands on the first. Every section inherits this
        // item's `release_contacts` gate.
        sections: CRM_CONSOLE_SECTIONS,
        navTabId: 'nav-tab-contacts',
        icon: { path: mdiCardAccountDetailsOutline.path },
        header: {
          title: 'CRM',
          icon: { path: mdiCardAccountDetailsOutline.path },
          docsTopic: 'contacts',
        },
        Component: CrmConsolePage,
      },
    ],
  })
}
