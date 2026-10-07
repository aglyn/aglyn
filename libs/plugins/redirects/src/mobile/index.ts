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

/**
 * The Redirects plugin's mobile surface (AGL-3620): the sample registration
 * every other plugin's `./mobile` entry follows. Reached only through the
 * generated mobile manifest — never re-exported from `src/index.ts`, so no
 * byte of it reaches a web bundle (check-mobile-isolation holds both ways).
 */

import {
  registerMobileDashboardWidget,
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
} from '@aglyn/mobile-plugin-host'
import { REDIRECTS_LIST_SCREEN } from './screen-ids'

export { REDIRECTS_LIST_SCREEN }

export function registerRedirectsMobile(): void {
  registerMobileScreen({
    pluginId: 'redirects',
    id: REDIRECTS_LIST_SCREEN,
    title: 'Redirects',
    requiresSite: true,
    load: () => import('./redirects-list-screen'),
  })
  registerMobileDashboardWidget({
    pluginId: 'redirects',
    id: 'redirects.summary',
    title: 'Redirects',
    order: 900,
    size: 'half',
    requiresSite: true,
    load: () => import('./redirects-summary-widget'),
  })
  registerMobileQuickAction({
    pluginId: 'redirects',
    id: 'redirects.open',
    title: 'Redirects',
    icon: 'git-branch-outline',
    order: 900,
    requiresSite: true,
    screen: REDIRECTS_LIST_SCREEN,
  })
  // The console's own page for a site's redirects opens natively.
  registerMobileDeepLink({
    pluginId: 'redirects',
    id: 'redirects.page',
    path: '/redirects',
    screen: REDIRECTS_LIST_SCREEN,
  })
}
