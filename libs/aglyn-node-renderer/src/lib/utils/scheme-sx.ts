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
 * Scheme-scoped node sx (AGL-588) — implementation moved to
 * `@aglyn/aglyn` (`app-utils/scheme-sx`) for AGL-1306: the instance
 * override layer merges sx inside `composeReusableComponentNodes`, which
 * lives there and cannot import this renderer back. This path stays as
 * the renderer's export so its many consumers (the designer's responsive
 * and style-group utils, the canvas leaf) are untouched.
 */
export {
  SX_SCHEME_DARK_KEY,
  isResponsiveSxObject,
  mergeSchemeValue,
  resolveSchemeSx,
  resolveSchemeSx as default,
  type SxScheme,
} from '@aglyn/aglyn'

/**
 * Palette `var()` substitution (AGL-1331) rides along beside the scheme
 * pass: both resolve persisted sx against the ACTIVE theme, and the leaf
 * applies them together.
 */
export { resolvePaletteVars, resolvePaletteVarsSx } from '@aglyn/aglyn'
