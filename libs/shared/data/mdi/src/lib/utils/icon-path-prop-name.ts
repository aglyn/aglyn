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

/**
 * Companion prop that carries a picked icon's resolved SVG path (AGL-1212).
 *
 * `iconId` → `iconPath`, `startIconId` → `startIconPath`. Every icon
 * attribute in the catalog is an `ICON_PICKER` field whose name ends in
 * `Id`, so the editor can derive the companion name generically instead of
 * each component hard-coding a pair.
 *
 * The id stays the source of truth — the path is a denormalized copy so
 * render surfaces never have to load the ~2.9 MB icon catalog.
 *
 * A module of its own, importing nothing, so the page composition that fills
 * the companion in can name the rule without reaching the catalog's loader.
 */
export function iconPathPropName(idPropName: string): string {
  return idPropName.replace(/Id$/, 'Path')
}
