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
import { _hasProperty, _isArr, _isObj } from '@aglyn/shared-util-guards'
import json from '../../generated/icons.min.json'
import { Normal } from '../types'


export type IconsJson = typeof json
export type IconId = Normal.KeysFromList<IconsJson['iconIds']> | keyof IconsJson['byIconId']
export type IconData = Normal.Values<IconsJson['byIconId']> & {id?: IconId}
export type IconsNormalized = {
  iconIds: Normal.KeyList<IconId>
  byIconId: Normal.Lookup<IconData, IconId>
}

const DEFAULT_PATH = 'M12 2C11.5 2 11 2.19 10.59 2.59L2.59 10.59C1.8 11.37 1.8 12.63 2.59 13.41L10.59 21.41C11.37 22.2 12.63 22.2 13.41 21.41L21.41 13.41C22.2 12.63 22.2 11.37 21.41 10.59L13.41 2.59C13 2.19 12.5 2 12 2M12 6.95C14.7 7.06 15.87 9.78 14.28 11.81C13.86 12.31 13.19 12.64 12.85 13.07C12.5 13.5 12.5 14 12.5 14.5H11C11 13.65 11 12.94 11.35 12.44C11.68 11.94 12.35 11.64 12.77 11.31C14 10.18 13.68 8.59 12 8.46C11.18 8.46 10.5 9.13 10.5 9.97H9C9 8.3 10.35 6.95 12 6.95M11 15.5H12.5V17H11V15.5Z'

export const icons: IconsNormalized = json
export const defaultIcon = icons.byIconId['help-rhombus']
export const defaultIconFailover: IconData = {
  ...defaultIcon,
  path: defaultIcon?.path || DEFAULT_PATH
}


export type IconAndFail<K extends IconId, U> = [iconId: K, failover?: U]
export type IconOrFail<U> = IconData | U
export type IconPathOrFail<U> = IconData['path'] | U

export interface GetIconDataOptions<U = IconData> {
  searchAliases?: boolean
  failoverIcon?: U
}

function getIconData<U>(
  iconId: IconId,
  options?: GetIconDataOptions<U>,
): IconOrFail<U> {
  const {searchAliases, failoverIcon} = {...options}
  const failover = failoverIcon ?? defaultIconFailover
  if (!iconId) {
    console.info('No icon id provided, falling back.')
    return failover
  }
  let data = icons.byIconId[iconId]
  if (!data) {
    if (searchAliases) {
      for (const iconId of icons.iconIds) {
        // Search aliases
        if (_hasProperty(iconId, icons.byIconId[iconId]?.alias ?? {})) {
          data = icons.byIconId[iconId]
          break
        }
      }
    }
    if (!data) {
      console.info(`No icon exists with id '${iconId}', falling back`)
      return failover
    }
  }
  return data
}

/**
 * Single icon ID
 * @param iconId - icon id or aliases if searching aliases
 * @param options - opts
 */
export function getIcon<U>(
  iconId: IconId,
  options?: GetIconDataOptions<U>,
): IconOrFail<U>

/**
 * Multiple icon IDs
 * @param iconIds - icon id or aliases if searching aliases
 * @param options - opts
 */
export function getIcon<U>(
  iconIds: (IconId | IconAndFail<IconId, U>)[],
  options?: GetIconDataOptions<U>,
): IconOrFail<U>[]

/**
 * Multiple icon IDs
 * @param iconIds - icon id or aliases if searching aliases
 * @param options - opts
 */
export function getIcon<U>(
  iconIds: IconId | ((IconId | IconAndFail<IconId, U>)[]),
  options?: GetIconDataOptions<U>,
): Conditional<typeof iconIds, any[], IconOrFail<U>[], IconOrFail<U>> {

  const items: (IconAndFail<IconId, U> | IconId)[] = _isArr(iconIds) ? iconIds : [iconIds]
  const mapped = items.map((itemOrId: IconAndFail<IconId, U> | IconId) => {
    const [id, failoverInner] = _isArr(itemOrId) ? itemOrId : [itemOrId]
    return getIconData(id, {...options, failoverIcon: failoverInner})
  })
  return _isArr(iconIds) ? mapped : mapped[0]
}


/**
 * Single icon ID
 * @param iconId - icon id or aliases if searching aliases
 * @param options - opts
 */
export function getIconPathData<U>(
  iconId: IconId,
  options?: GetIconDataOptions<U>,
): IconPathOrFail<U>

/**
 * Multiple icon IDs
 * @param iconIds - icon id or aliases if searching aliases
 * @param options - opts
 */
export function getIconPathData<U>(
  iconIds: (IconId | IconAndFail<IconId, U>)[],
  options?: GetIconDataOptions<U>,
): IconPathOrFail<U>[]

/**
 * Multi||Single icon ID
 * @param iconIds - icon id or aliases if searching aliases
 * @param options - opts
 */
export function getIconPathData<U>(
  iconIds: (IconId | IconAndFail<IconId, U>)[] | IconId,
  options?: GetIconDataOptions<U>,
): Conditional<typeof iconIds, any[], IconPathOrFail<U>[], IconPathOrFail<U>> {

  function handlePath(icon: IconOrFail<U>) {
    if (_isObj(icon) && _hasProperty('path', icon)) {
      return icon.path
    }
    return icon
  }

  return _isArr(iconIds) ? (
      (getIcon(iconIds ?? [null], options) as IconOrFail<U>[])
      .map(handlePath)
    ) : (
      [getIcon(iconIds ?? null, options) as IconOrFail<U>]
      .map(handlePath)[0]
    )
}
