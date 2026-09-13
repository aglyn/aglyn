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

import { MdiIcons } from '../constants/mdi-icons'

export { iconPathPropName } from './icon-path-prop-name'

/**
 * Looks up an icon's SVG path, or `undefined` when the catalog has no such
 * id — or simply has not been loaded on this surface.
 *
 * Deliberately NOT `getMdiIconFromId`, which substitutes `DEFAULT_ICON` for
 * a miss. That fallback carries a real `path`, so callers that only check
 * `icon?.path` render a "help" glyph with full confidence instead of
 * degrading (AGL-1212). Anything on a render path wants this function.
 */
export function getMdiIconPath(iconId: string | undefined): string | undefined {
  if (!iconId) return undefined
  return MdiIcons.get(iconId)?.path || undefined
}
