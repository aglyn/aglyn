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
 * Data in the native apps' navigation (AGL-3943): the rows this plugin
 * adds to the manifest the shells draw, placed into the core's lists by
 * `order` (`assembleNativeNav`, `generate:native-contracts`). Labels are the
 * console's words, held by `apps/console/specs/native-nav-manifest.spec.ts`.
 *
 * Imports only the core's plain nav module, so the native contracts read it.
 */

export const NATIVE_NAV_ROWS: readonly NativeNavContribution[] = [
  {
    list: 'workspace',
    group: 'workspace',
    row: {
      id: 'data',
      label: 'Data',
      icon: nativeNavIcon('tablecells', 'dataset'),
      screen: 'data.datasets',
      pluginId: 'data',
      order: 100,
      console: nativeNavRef('orgTab', 'nav-tab-data'),
    },
  },
  {
    list: 'site',
    group: 'more',
    row: {
      id: 'data',
      label: 'Data',
      icon: nativeNavIcon('tablecells', 'dataset'),
      screen: 'data.datasets',
      pluginId: 'data',
      order: 60,
      docs: '/content-and-data/datasets/overview',
      console: nativeNavRef('hostPluginTab', '/data'),
    },
  },
]
