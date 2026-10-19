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
  nativeNavHubSection,
  nativeNavIcon,
  nativeNavRef,
  type NativeNavContribution,
  type NativeNavRow,
} from '@aglyn/aglyn/app-utils/native-nav'

/**
 * Marketing in the native apps' navigation (AGL-3943): the rows this plugin
 * adds to the manifest the shells draw, placed into the core's lists by
 * `order` (`assembleNativeNav`, `generate:native-contracts`). Labels are the
 * console's words, held by `apps/console/specs/native-nav-manifest.spec.ts`.
 *
 * Imports only the core's plain nav module, so the native contracts read it.
 */

/**
 * The row at either scope. The workspace's opens the console's org page
 * (`orgNavItems`, `/[orgSlug]/marketing`), the site's the site's hub; both list
 * the same sections under the same ids.
 */
function row(scope: 'org' | 'host', order: number): NativeNavRow {
  return {
    id: 'marketing',
    label: 'Marketing',
    icon: nativeNavIcon('megaphone', 'campaign'),
    screen: 'marketing.overview',
    pluginId: 'marketing',
    order,
    sections: [
      nativeNavHubSection(scope, '/marketing', 'overview', 'Overview', 'marketing.overview'),
      nativeNavHubSection(scope, '/marketing', 'campaigns', 'Campaigns', 'marketing.campaigns'),
      nativeNavHubSection(scope, '/marketing', 'conversions', 'Conversions', 'marketing.conversions'),
      nativeNavHubSection(scope, '/marketing', 'overlays', 'Overlays', 'marketing.overlays'),
      nativeNavHubSection(scope, '/marketing', 'experiments', 'A/B testing', 'marketing.experiments'),
    ],
    docs: '/marketing-and-automation/marketing-overlays/overview',
    console: nativeNavRef(scope === 'org' ? 'orgPluginTab' : 'hostPluginTab', '/marketing'),
  }
}

export const NATIVE_NAV_ROWS: readonly NativeNavContribution[] = [
  { list: 'workspace', group: 'workspace', row: row('org', 50) },
  { list: 'site', group: 'customers', row: row('host', 40) },
]
