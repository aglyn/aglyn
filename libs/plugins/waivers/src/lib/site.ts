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
import { mdiFileSign } from '@aglyn/shared-data-mdi'
import * as SignWaiver from './components/sign-waiver'
import { WAIVERS_PLUGIN_ID } from './constants/bundle-common'

/**
 * Waivers' canvas half (AGL-4042), `@aglyn/plugins-waivers/site`: the Sign
 * waiver element and nothing else. A published page loads it only where the
 * element is placed, and never loads the console registrar.
 */
export const WAIVERS_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  { component: SignWaiver.default, schema: SignWaiver.schema, presets: SignWaiver.presets },
]

export function registerWaiversPlugin(): void {
  if (Aglyn.plugins.getDependency(WAIVERS_PLUGIN_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
      {
        bundleId: WAIVERS_PLUGIN_ID,
        displayName: 'Waivers',
        description: 'Digital waivers riders and guests sign before they arrive',
        icon: { path: mdiFileSign.path },
        components: WAIVERS_BUNDLE,
      },
      Aglyn.components,
    ),
  )
}
