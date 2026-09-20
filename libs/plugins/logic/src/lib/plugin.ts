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
import { mdiFunctionVariant } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import HostFunctionsCard from './components/host-functions-card.component'
import HostVariablesCard from './components/host-variables-card.component'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Logic console page only loads when opened. */
const LogicConsolePage = lazy(() => import('./components/logic-console-page'))

/** The dependents dialog, loaded where the Automation page draws its zone. */
const WhereUsedDialog = lazy(
  () => import('./components/where-used-dialog.component'),
)

/**
 * Logic feature plugin (AGL-395). Console-only — variables and no-code
 * functions resolve at render through the tenant compose pipeline, not a
 * canvas element of their own, so there is no UI bundle. The console half
 * declares the Logic nav + page through the ConsoleExtension registry
 * (always-on; the surface is not release-flagged). Its dependents dialog is
 * also drawn in the zone the Automation page hosts for a workflow's usage.
 */
export function registerLogicConsole(): void {
  Aglyn.registerConsoleExtension({
    // Variables/functions cards (AGL-419): the besigner functions
    // drawer renders them through the 'besignerFunctions' slot.
    widgets: [
      {
        slot: 'besignerFunctions',
        widgetId: 'logic-variables',
        Component: HostVariablesCard,
      },
      {
        slot: 'besignerFunctions',
        widgetId: 'logic-functions',
        Component: HostFunctionsCard,
      },
      // Where a WORKFLOW is used: the Automation page runs the scan and hosts
      // the zone; the dialog that lays a scan out is the one a variable and a
      // function open here, so it is drawn by this plugin.
      {
        slot: 'workflowUsage',
        widgetId: 'logic-where-used',
        Component: WhereUsedDialog,
      },
    ],
    pluginId: BUNDLE_ID,
    displayName: 'Logic',
    navItems: [
      {
        label: 'Logic',
        href: '/logic',
        navTabId: 'nav-tab-logic',
        icon: { path: mdiFunctionVariant.path },
        header: {
          title: 'Functions & Variables',
          icon: { path: mdiFunctionVariant.path },
          docsTopic: 'bindings',
        },
        Component: LogicConsolePage,
      },
    ],
  })
}

// Cards consumed directly by the app (the besigner Functions/Variables
// button opens them in a drawer).
export { default as HostVariablesCard } from './components/host-variables-card.component'
export type { HostVariablesCardProps } from './components/host-variables-card.component'
export { default as HostFunctionsCard } from './components/host-functions-card.component'
export type { HostFunctionsCardProps } from './components/host-functions-card.component'

