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
import { mdiSitemap } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { HostActivityCard } from './components/host-activity-card.component'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Workflows console page only loads when opened. */
const WorkflowsConsolePage = lazy(
  () => import('./components/workflows-console-page'),
)

/**
 * Workflows feature plugin (AGL-395). Console-only — workflows, actions,
 * and webhooks run server-side (event pipelines, `/api/hooks`), not through
 * a canvas element, so there is no UI bundle. The console half declares the
 * Workflows nav + page through the ConsoleExtension registry, gated by the
 * `workflows` entitlement (the Actions/Webhooks tabs run their own per-plan
 * checks off the passed `org`). Depends on `@aglyn/plugins-logic` for the
 * shared where-used tooling.
 */
export function registerWorkflowsConsole(): void {
  Aglyn.registerConsoleExtension({
    // Host activity feed (AGL-419): rendered by the shell's
    // 'hostActivity' widget slot (dashboard + editor view page).
    widgets: [
      {
        slot: 'hostActivity',
        widgetId: 'workflows-host-activity',
        Component: HostActivityCard,
      },
    ],
    pluginId: BUNDLE_ID,
    displayName: 'Workflows',
    featureFlag: 'workflows',
    navItems: [
      {
        label: 'Workflows',
        href: '/workflows',
        // Reuse the existing release-flag nav-tab so staff-preview gating is
        // unchanged now that the tab comes from the plugin (AGL-395).
        navTabId: 'nav-tab-workflows',
        icon: { path: mdiSitemap.path },
        header: { title: 'Workflows', icon: { path: mdiSitemap.path } },
        Component: WorkflowsConsolePage,
      },
    ],
  })
}

// Activity feed consumed directly by the app (dashboard + screen view).
export { default as HostActivityCard } from './components/host-activity-card.component'
export type { HostActivityCardProps } from './components/host-activity-card.component'
