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
import { registerPluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import {
  INBOX_CAMPAIGNS_ZONE,
  INBOX_RECORD_ATTRIBUTION_ZONE,
} from './components/inbox-attribution-zone'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Inbox console page only loads when opened. */
const InboxConsolePage = lazy(() => import('./components/inbox-console-page'))

/**
 * Code-split: the submissions table loads when a form page asks for it. The
 * zone hands `hostId` and `formId`, which is what the table's own props are.
 */
const FormSubmissionsReader = lazy(
  () => import('./components/submissions-card.component'),
)

/** Dashboard glance card, loaded only where the shell renders the slot. */
const InboxGlanceCard = lazy(
  () => import('./components/inbox-glance-card.component'),
)

/**
 * Inbox feature plugin (AGL-395). Console-only — form submissions, site
 * members/leads and campaigns live in Firestore and have no canvas element,
 * so there is no UI bundle. The console half declares the Inbox nav + its
 * three sections through the ConsoleExtension registry (always-on). The
 * Campaigns section and the attribution shown inside a submission are zones
 * this plugin hosts; the plugin that owns campaigns draws in them.
 */
export function registerInboxConsole(): void {
  registerPluginZone(
    {
      zone: INBOX_RECORD_ATTRIBUTION_ZONE,
      label: 'Where a lead or a submission came from',
      surface: 'console',
      description:
        'In a lead’s “Where this came from” dialog and under an open submission. A widget here says which campaign or link brought it; it is handed the site, what the record is and its id, and it writes nothing.',
    },
    // Named, because a spec calls this registrar without the loader.
    { pluginId: BUNDLE_ID },
  )
  registerPluginZone(
    {
      zone: INBOX_CAMPAIGNS_ZONE,
      label: 'The Inbox’s Campaigns section',
      surface: 'console',
      description:
        'The body of the Inbox’s Campaigns tab. A widget here lists the site’s campaigns; it is handed the site and nothing else.',
    },
    { pluginId: BUNDLE_ID },
  )
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
      // One form's submissions, on the form's own page. The forms plugin
      // hosts the zone and hands it the site and the form; the reader is this
      // plugin's table, narrowed to that form, so the form page gets the same
      // ordered, paged walk the Inbox uses without importing it.
      {
        slot: 'formSubmissions',
        widgetId: 'inbox-form-submissions',
        title: 'Submissions',
        Component: FormSubmissionsReader,
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
