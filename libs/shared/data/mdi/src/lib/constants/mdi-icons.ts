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

if (typeof window !== 'undefined') {
  /*import('../../generated/6.5.95/mdi-icons.min.json')*/ Promise.reject<any>(
    'Temporarily disabled',
  )
    .then(({ data }) => {
      if (_isArr(data)) {
        data.forEach((value) => {
          if (
            _isObj(value) &&
            _hasOwnProperty('path', value) &&
            _hasOwnProperty('id', value)
          ) {
            MdiIcons.set(value['id'] as IconId, value as Icon)
          }
        })
      }
    })
    .catch((error) => {
      console.warn('Error loading icons', error)
    })
}

export default MdiIcons
