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
  nativeNavIcon,
  nativeNavRef,
  type NativeNavContribution,
} from '@aglyn/aglyn/app-utils/native-nav'

/**
 * Domains in the native apps' navigation (AGL-4040): the workspace's Domains
 * page, a row of the workspace list as the console's `orgNavItems` entry is a
 * workspace tab. Its spec screen lists every domain the workspace holds and
 * opens a page per name; buying, transfers, contacts and DNS records follow.
 *
 * Imports only the core's plain nav module, so the native contracts read it.
 */
export const NATIVE_NAV_ROWS: readonly NativeNavContribution[] = [
  {
    list: 'workspace',
    group: 'workspace',
    row: {
      id: 'domains',
      label: 'Domains',
      icon: nativeNavIcon('network', 'dns'),
      screen: 'domains.list',
      pluginId: 'domains',
      order: 75,
      docs: '/building-sites/custom-domains/manage-domains',
      console: nativeNavRef('orgPluginTab', '/domains'),
    },
  },
]
