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
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Contacts console page only loads when opened. */
const ContactsConsolePage = lazy(
  () => import('./components/contacts-console-page'),
)

/**
 * Contacts CRM feature plugin (AGL-395). Console-only — contacts and
 * segments live in Firestore and have no canvas element, so there is no UI
 * bundle. The console half declares the Contacts nav + page through the
 * ConsoleExtension registry (release_contacts gate via the nav tab); the
 * page reads the `contactsPerHost` quota off the shell-passed `org`.
 */
export function registerContactsConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Contacts',
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
    navItems: [
      {
        label: 'Contacts',
        href: '/contacts',
        navTabId: 'nav-tab-contacts',
        icon: { path: mdiCardAccountDetailsOutline.path },
        header: {
          title: 'Contacts',
          icon: { path: mdiCardAccountDetailsOutline.path },
          docsTopic: 'contacts',
        },
        Component: ContactsConsolePage,
      },
    ],
  })
}
