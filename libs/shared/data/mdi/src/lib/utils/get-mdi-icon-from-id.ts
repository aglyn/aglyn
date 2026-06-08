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

import { MdiIcons } from '@aglyn/shared-data-mdi/constants/mdi-icons'
import type { Icon, IconResponse, IdParam } from '../types'
import { handleIconNotFound } from './handle-icon-not-found'

export function getMdiIconFromId<T extends IdParam>(
  iconId: T,
): IconResponse<T> {
  if (Array.isArray(iconId)) {
    const result: Icon[] = []
    for (const id of iconId) {
      const icon = id ? MdiIcons.get(id) : undefined
      result.push(handleIconNotFound(id, icon))
    }
    return result as IconResponse<T>
  }
  const icon = iconId ? MdiIcons.get(iconId) : undefined
  return handleIconNotFound(iconId, icon) as IconResponse<T>
}
export default getMdiIconFromId
