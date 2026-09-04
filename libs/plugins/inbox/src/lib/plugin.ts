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
import { mdiInboxArrowDown } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { INBOX_CONSOLE_SECTIONS } from './components/inbox-console-sections'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Inbox console page only loads when opened. */
const InboxConsolePage = lazy(() => import('./components/inbox-console-page'))

/** Dashboard glance card, loaded only where the shell renders the slot. */
const InboxGlanceCard = lazy(
  () => import('./components/inbox-glance-card.component'),
)

/**
 * Inbox feature plugin (AGL-395). Console-only — form submissions, site
 * members/leads and campaigns live in Firestore and have no canvas element,
 * so there is no UI bundle. The console half declares the Inbox nav + its
 * three sections through the ConsoleExtension registry (always-on). Depends
 * on the marketing plugin for the borrowed Campaigns section and for the
 * conversion attribution shown inside a submission.
 */
export function registerInboxConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Inbox',
    // The host dashboard's inbox glance. A form submission is the one thing
    // on a site that is waiting for a REPLY, and until this it was two
    // clicks from the page an owner opens first.
    widgets: [
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
        widgetId: 'inbox-glance',
        title: 'Inbox',
        Component: InboxGlanceCard,
      },
    ],
    navItems: [
      {
        label: 'Inbox',
        href: '/inbox',
        // Sections as ROUTES (AGL-2501): each is a real URL the shell
        // resolves and gates, so the page mounts the one being read.
        sections: INBOX_CONSOLE_SECTIONS,
        navTabId: 'nav-tab-inbox',
        icon: { path: mdiInboxArrowDown.path },
        header: {
          title: 'Inbox',
          icon: { path: mdiInboxArrowDown.path },
          docsTopic: 'forms',
        },
        Component: InboxConsolePage,
      },
    ],
  })
}
