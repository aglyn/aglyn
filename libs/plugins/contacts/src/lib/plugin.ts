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
import * as PluginSdk from '@aglyn/aglyn'
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
 * page reads the `contactsPerHost` quota off the shell-passed `tenant`.
 */
export function registerContactsConsole(): void {
  PluginSdk.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Contacts',
    navItems: [
      {
        label: 'Contacts',
        href: '/contacts',
        navTabId: 'nav-tab-contacts',
        icon: { path: mdiCardAccountDetailsOutline.path },
        header: {
          title: 'Contacts',
          icon: { path: mdiCardAccountDetailsOutline.path },
        },
        Component: ContactsConsolePage,
      },
    ],
  })
}
