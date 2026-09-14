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
  registerConsoleExtension,
  registerPluginPermissions,
} from '@aglyn/aglyn'
import { mdiEmailFastOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { OUTREACH_CONSOLE_SECTIONS } from './components/outreach-console-sections'
import {
  OUTREACH_PERMISSIONS,
  OUTREACH_PLUGIN_ID,
  OUTREACH_USE_PERMISSION,
} from './constants/bundle-common'

/** Code-split: the hub only loads when opened. */
const OutreachConsolePage = lazy(
  () => import('./components/outreach-console-page'),
)

/**
 * Outreach's console half (AGL-2974), named in `plugins.config.json` as
 * `console`. Console and console API only, like the CRM: a sequence has no
 * canvas element, so there is no site bundle and no tenant half.
 *
 * ONE ORGANIZATION-LEVEL SURFACE. Outreach is a rep's work across every site
 * the organization sells for, sent from that rep's own mailbox, so it lives
 * beside the organization's other tabs rather than under a site. It is
 * declared in `orgNavItems`, which the console serves at
 * `/[orgSlug]/outreach/<section>` through its generic org route.
 *
 * THREE GATES, each answered by the shell, never by this page:
 *
 * - the RELEASE flag `release_outreach`, reached through the nav item's
 *   `navTabId` — off by default, so only staff preview it;
 * - the ENTITLEMENT `features.outreach`, which no plan carries, so an
 *   organization has it only through its per-org override;
 * - the PERMISSION `outreach.use`, which owners and admins hold by default.
 *
 * The org tab strip hides the tab unless all three hold. A deep link is
 * answered by the route with the refusal that applies, and the words for the
 * entitlement one are this extension's own: the shell's derived sentence
 * calls a feature no plan carries "a paid add-on", which Outreach is not.
 */
export function registerOutreachConsole(): void {
  registerPluginPermissions(OUTREACH_PERMISSIONS)
  registerConsoleExtension({
    pluginId: OUTREACH_PLUGIN_ID,
    displayName: 'Outreach',
    permission: OUTREACH_USE_PERMISSION,
    featureFlag: 'outreach',
    upgradeNotice: {
      message: "Outreach isn't available to this workspace yet.",
    },
    orgNavItems: [
      {
        label: 'Outreach',
        href: '/outreach',
        sections: OUTREACH_CONSOLE_SECTIONS,
        // The release flag's tab id: `release_outreach` names it, and the org
        // strip hides the tab from customers while the flag is off.
        navTabId: 'nav-tab-org-outreach',
        icon: { path: mdiEmailFastOutline.path },
        header: {
          title: 'Outreach',
          icon: { path: mdiEmailFastOutline.path },
          docsTopic: 'outreach',
        },
        Component: OutreachConsolePage,
      },
    ],
  })
}
