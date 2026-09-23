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
 * An element's pinned color scheme (AGL-3284).
 *
 * A layout element — Section, Container, Stack, Box, Grid — may say "Always
 * light" or "Always dark", and everything inside it then renders with the
 * site's theme for that scheme, whatever the visitor picked: palette tokens
 * (`background.default`, `text.primary`, `divider`, …) and every node's
 * `@scheme dark` sx slice resolve for the pinned scheme. The renderer's leaf
 * consumes the prop; it never reaches the DOM or the MUI component.
 *
 * Stored as a real value for all three choices. "Match the site" is the
 * {@link ELEMENT_COLOR_SCHEME_SITE} sentinel rather than `''`, because an empty
 * option value cannot survive the attributes form's save (AGL-1453) — and it
 * resolves exactly like a missing prop, so an element that never had the
 * attribute and one switched back to "Match the site" render identically.
 */

/** The node prop carrying the pinned scheme. */
export const NODE_COLOR_SCHEME_PROP = 'colorScheme'

/** "Match the site": follow the visitor's scheme, as if the prop were unset. */
export const ELEMENT_COLOR_SCHEME_SITE = 'site'

export type ElementColorScheme = 'light' | 'dark'

/**
 * The scheme an element is pinned to, or `undefined` when it follows the site.
 * Anything other than `light`/`dark` — the sentinel, a cleared `null`, a
 * stray paste — follows the site.
 */
export function resolveElementColorScheme(
  value: unknown,
): ElementColorScheme | undefined {
  return value === 'light' || value === 'dark' ? value : undefined
}
