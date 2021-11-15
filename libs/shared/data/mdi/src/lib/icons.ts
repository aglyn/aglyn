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

import { Conditional } from '@aglyn/shared-data-types'
import { _hasProperty, _isArr } from '@aglyn/shared-util-guards'
import json from '../../generated/icons.min.json'
import { Normal } from '../types'


export type IconsJson = typeof json
export type IconId = Normal.KeysFromList<IconsJson['iconIds']> | keyof IconsJson['byIconId']
export type IconData = Normal.Values<IconsJson['byIconId']>
export type IconsNormalized = {
  iconIds: Normal.KeyList<IconId>
  byIconId: Normal.Lookup<IconData, IconId>
}

/**
 * Default icon path data for fallback
 *
 * __Real Identifier:__ `help-rhombus`
 *
 * @type {string}
 */
const DEFAULT_ICON = 'M12 2C11.5 2 11 2.19 10.59 2.59L2.59 10.59C1.8 11.37 1.8 12.63 2.59 13.41L10.59 21.41C11.37 22.2 12.63 22.2 13.41 21.41L21.41 13.41C22.2 12.63 22.2 11.37 21.41 10.59L13.41 2.59C13 2.19 12.5 2 12 2M12 6.95C14.7 7.06 15.87 9.78 14.28 11.81C13.86 12.31 13.19 12.64 12.85 13.07C12.5 13.5 12.5 14 12.5 14.5H11C11 13.65 11 12.94 11.35 12.44C11.68 11.94 12.35 11.64 12.77 11.31C14 10.18 13.68 8.59 12 8.46C11.18 8.46 10.5 9.13 10.5 9.97H9C9 8.3 10.35 6.95 12 6.95M11 15.5H12.5V17H11V15.5Z'
export const icons: IconsNormalized = json
export const DEFAULT_PATH = icons.byIconId['help-rhombus']?.path ?? DEFAULT_ICON
export const defaultIconFailover: IconData = {
  name: 'Not found',
  path: DEFAULT_PATH,
  alias: {},
}

function getIconData<K extends IconId, U extends unknown>(
  iconId: K,
  failover: U = defaultIconFailover as U
): IconData | U {
  if (!iconId) {
    console.warn('No icon id provided, falling back.')
    return failover
  }
  let data = icons.byIconId[iconId]
  if (!data) {
    for (const iconId of icons.iconIds) {
      // Search aliases
      if (_hasProperty(iconId, icons.byIconId[iconId]?.alias ?? {})) {
        data = icons.byIconId[iconId]
        break
      }
    }
    if (!data) {
      console.error(`No icon exists with id(${iconId}), falling back`)
      return failover
    }
  }
  return data
}

type IconAndFail<K extends IconId, U extends unknown> = [iconId: K, failover?: U]

export function getIcon<K extends IconId, U extends unknown>(
  iconId: K,
  failoverDefault?: U
): IconData | U

export function getIcon<K extends IconId, U extends unknown>(
  iconIds: (K | IconAndFail<K, U>)[],
  failoverDefault?: U
): (IconData | U)[]

export function getIcon<K extends IconId, U extends unknown>(
  iconIds: K | ((K | IconAndFail<K, U>)[]),
  failoverDefault: U = defaultIconFailover as U
): Conditional<typeof iconIds, any[], (IconData | U)[], IconData | U> {
  const items: (IconAndFail<K, U> | K)[] = _isArr(iconIds) ? iconIds : [iconIds, failoverDefault]
  const mapped = items.map((itemOrId: IconAndFail<K, U> | K) => {
    const [id, failover = failoverDefault] = _isArr(itemOrId)
      ? itemOrId
      : [itemOrId, failoverDefault]
    return getIconData(id, failover)
  })
  return _isArr(iconIds) ? mapped : mapped[0]
}

export function getIconPathData<K extends IconId, U extends unknown>(
  iconId: K,
  failoverDefault?: U
): IconData['path'] | U

export function getIconPathData<K extends IconId, U extends unknown>(
  iconIds: (K | IconAndFail<K, U>)[],
  failoverDefault?: U
): (IconData['path'] | U)[]

export function getIconPathData<K extends IconId, U extends unknown>(
  iconIds: (K | IconAndFail<K, U>)[] | K,
  failoverDefault: U = defaultIconFailover as U
): Conditional<typeof iconIds, any[], (IconData['path'] | U)[], IconData['path'] | U> {
  const result = getIcon(iconIds, failoverDefault)
  return _isArr(result)
    ? (getIcon(iconIds, failoverDefault) as (IconData | U)[]).map(data => _hasProperty('path', data) ? data.path : data)
    : [getIcon(iconIds, failoverDefault) as (IconData | U)].map(data => _hasProperty('path', data) ? data.path : data)[0]
}
