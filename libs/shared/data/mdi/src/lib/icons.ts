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

import json from '../../json/icons.min.json'
import { Normal } from '../../common/data-type'


export type IconsJson = typeof json
export type IconKeys = Normal.KeysFromList<IconsJson['iconIds']> | keyof IconsJson['byIconId']
export type Icon = Normal.Values<IconsJson['byIconId']>
export type Icons = {
  iconIds: Normal.KeyList<IconKeys>
  byIconId: Normal.Lookup<Icon, IconKeys>
}

const helpRhombusPath = 'M12 2C11.5 2 11 2.19 10.59 2.59L2.59 10.59C1.8 11.37 1.8 12.63 2.59 13.41L10.59 21.41C11.37 22.2 12.63 22.2 13.41 21.41L21.41 13.41C22.2 12.63 22.2 11.37 21.41 10.59L13.41 2.59C13 2.19 12.5 2 12 2M12 6.95C14.7 7.06 15.87 9.78 14.28 11.81C13.86 12.31 13.19 12.64 12.85 13.07C12.5 13.5 12.5 14 12.5 14.5H11C11 13.65 11 12.94 11.35 12.44C11.68 11.94 12.35 11.64 12.77 11.31C14 10.18 13.68 8.59 12 8.46C11.18 8.46 10.5 9.13 10.5 9.97H9C9 8.3 10.35 6.95 12 6.95M11 15.5H12.5V17H11V15.5Z'
export const icons: Icons = json
export const DEFAULT_PATH = icons.byIconId['help-rhombus']?.path ?? helpRhombusPath
export const defaultFailover: Icon = {
  name: 'Not found',
  path: DEFAULT_PATH,
  alias: {},
}

export function getIcon<K extends IconKeys>(id: K, failover: Icon = defaultFailover): Icon {
  if (!id) {
    console.info('No icon id provided, falling back.')
    return failover
  }
  let icon = icons.byIconId[id]
  if (!icon) {
    icons.iconIds.forEach((iconId) => {
      if (icon) return
      // Search aliases
      if (icons.byIconId[iconId as string].alias[id as string]) {
        icon = icons.byIconId[iconId as string]
      }
    })
    if (!icon) {
      console.warn(`No icon exists with id(${id}), falling back`)
      return failover
    }
  }
  return icon
}
