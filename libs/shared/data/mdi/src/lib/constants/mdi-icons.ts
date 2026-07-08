/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { _hasOwnProperty, _isArr, _isObj } from '@aglyn/shared-util-tools'
import type { Icon, IconId } from '../types'

export const MdiIcons = new Map<IconId, Icon>()

let loadPromise: Promise<Map<IconId, Icon>> | null = null

/**
 * Loads the generated MDI catalog (~2.9 MB, bundler-split chunk) into
 * `MdiIcons` on first call and caches the promise (AGL-189). Deliberately
 * NOT run at module init — only icon-picker surfaces call this, so app
 * bundles and first paint never pay for the catalog. A failed load resets
 * the cache so a later open can retry; the map (possibly empty) is always
 * resolved, matching the old fail-open behavior.
 */
export function loadMdiIcons(): Promise<Map<IconId, Icon>> {
  if (!loadPromise) {
    loadPromise = import('../../../generated/6.5.95/mdi-icons.min.json')
      .then((module) => {
        const data = (module as any).default?.data ?? (module as any).data
        if (_isArr(data)) {
          data.forEach((value: unknown) => {
            if (
              _isObj(value) &&
              _hasOwnProperty('path', value) &&
              _hasOwnProperty('id', value)
            ) {
              MdiIcons.set(value['id'] as IconId, value as Icon)
            }
          })
        }
        return MdiIcons
      })
      .catch((error) => {
        loadPromise = null
        console.warn('Error loading icons', error)
        return MdiIcons
      })
  }
  return loadPromise
}

export default MdiIcons
