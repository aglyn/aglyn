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
import { mdiImageFilterCenterFocus } from '@aglyn/shared-data-mdi'
import LightboxElement, {
  lightboxPresets,
  lightboxSchema,
} from './components/lightbox'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The Lightbox plugin's canvas half (AGL-3717): one element, a container an
 * author fills with any elements and opens from any button, link or picture.
 * The picture lightboxes — the Image's and the Image List's gallery — belong
 * to those elements in the MUI bundle; all of them open the same shared shell.
 */
export const LIGHTBOX_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  {
    component: LightboxElement,
    schema: lightboxSchema,
    presets: lightboxPresets,
  },
]

export function registerLightboxPlugin(): void {
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Lightbox',
        description: 'A lightbox you fill with any elements and open from anything',
        icon: { path: mdiImageFilterCenterFocus.path },
        components: LIGHTBOX_BUNDLE,
      },
      Aglyn.components,
    ),
  )
}
