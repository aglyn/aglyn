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

import {
  isResponsiveSxObject,
  mergeSchemeValue,
} from './scheme-sx'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Merges one sx PROPERTY value over another, following the two house
 * rules this codebase already enforces elsewhere:
 *
 * - `mergeThemeOptions` (host-theme): an override replaces the LEAF it
 *   names, never the whole record — so two plain objects (a `&:hover`
 *   block, a `@media` block) merge key-by-key rather than the override
 *   clobbering the base's siblings.
 * - `mergeSchemeValue` (scheme-sx): responsive breakpoint objects merge
 *   with real mobile-first cascade semantics — a `{ md: … }` override
 *   keeps the base's xs–sm values, and a plain override applies at every
 *   width.
 *
 * Everything else (scalars, arrays, theme callbacks) is a leaf: the
 * override replaces it.
 */
function mergeSxProperty(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (base === undefined) return override
  if (isResponsiveSxObject(base) || isResponsiveSxObject(override)) {
    return mergeSchemeValue(base, override)
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
      const next = mergeSxProperty(base[key], value)
      if (next === undefined) delete merged[key]
      else merged[key] = next
    }
    return merged
  }
  return override
}

/**
 * Merges an sx-shaped override over a base sx record with REAL merge
 * semantics — the compose point for a component instance's root style
 * overrides (AGL-1306): the component root's own sx is the base, the
 * instance's `styleOverrides.root` is the override, and the grafted root
 * renders the merged result on every surface (canvas, Preview, tenant
 * SSR) because the graft itself calls this.
 *
 * Property-level behaviour (see {@link mergeSxProperty}):
 *
 * - A plain property replaces exactly the leaf it names; the base's
 *   other properties survive.
 * - Responsive breakpoint objects merge with mobile-first cascade
 *   semantics via `mergeSchemeValue` — a partial `{ md: … }` override
 *   keeps the base's values below `md` instead of silently dropping
 *   them.
 * - The `@scheme dark` slice is a plain record of style properties, so
 *   it merges key-by-key: overriding one dark colour keeps the base
 *   slice's siblings. A base-scope override does NOT erase the base's
 *   dark slice — the slice is a more specific selector of the same
 *   stylesheet, exactly as it behaves within a single node's sx.
 * - Nested selector records (`&:hover`, `@media …`) merge key-by-key
 *   for the same reason.
 *
 * Non-record forms degrade honestly: when either side is an array, a
 * function, or a scalar there is no record to merge into, so the pair
 * composes in MUI's array form (later entries win per property at style
 * resolution). Inputs are never mutated.
 */
export function mergeNodeSx(base: unknown, override: unknown): unknown {
  if (override === null || override === undefined) return base
  if (isPlainObject(override) && Object.keys(override).length === 0) {
    return base
  }
  if (base === null || base === undefined) return override
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return [base, override].flat()
  }
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const next = mergeSxProperty(base[key], value)
    if (next === undefined) delete merged[key]
    else merged[key] = next
  }
  return merged
}

export default mergeNodeSx
