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
import { mdiEmailFastOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { registerPluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { FORM_SUBMISSIONS_ZONE } from './components/form-zones'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Forms console surface only loads when opened. */
const FormsConsolePage = lazy(() => import('./components/forms-console-page'))

/**
 * Console half: the Forms catalog and one form's own surface, served by the
 * shell's generic plugin route.
 *
 * `ownsSubtree` because a form's detail URL names a document id rather than a
 * declared section. Safe to call at console app load — the page is lazy.
 */
export function registerFormsConsole(): void {
  registerPluginZone(
    {
      zone: FORM_SUBMISSIONS_ZONE,
      label: 'One form’s submissions',
      surface: 'console',
      description:
        'On one form’s page, behind the reader’s ask. A widget here reads the submissions to that form alone; it is handed the site and the form and nothing else.',
    },
    // Named, because a spec calls this registrar without the loader.
    { pluginId: BUNDLE_ID },
  )
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Forms',
    navItems: [
      {
        label: 'Forms',
        href: '/forms',
        // The tab id the console has always keyed this surface's active state
        // on. It carries no release flag: forms is on for every workspace, and
        // a site that switches it off loses this tab with the rest.
        navTabId: 'nav-tab-forms',
        icon: { path: mdiEmailFastOutline.path },
        ownsSubtree: true,
        header: {
          title: 'Forms',
          icon: { path: mdiEmailFastOutline.path },
          docsTopic: 'forms',
        },
        Component: FormsConsolePage,
      },
    ],
  })
}

export * from './site'
