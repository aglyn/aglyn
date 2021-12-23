/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {_hasProperty, _isObj} from '@aglyn/shared-util-guards'
import type {Icon, IconId} from './types/icon'


declare function require(moduleNames: string[], onLoad: (...args: any[]) => void): void

export const MdiIcons: Map<IconId, Icon> = new Map<IconId, Icon>()

if (typeof window !== 'undefined') {
  require(['../../generated/6.5.95/mdi-icons.min.json'], ({data}) => {
    Array.isArray(data) && data.forEach((value) => {
      if (_isObj(value) && _hasProperty('path', value) && _hasProperty('id', value)) {
        MdiIcons.set(value.id as IconId, value as Icon)
      }
    })
  })
}
