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
 * A Styles-panel font size must beat the theme's responsive type ramp.
 *
 * `createResponsiveTheme` finishes with MUI's `responsiveFontSizes`, which
 * bakes a per-breakpoint `fontSize` into each ramped typography VARIANT as
 * literal `@media (min-width:…px)` keys. Emotion serialises a style object's
 * plain properties before its at-rules, and the variant is serialised before
 * the `sx` prop, so the emitted rule for one element reads:
 *
 * ```css
 * .css-x { font-size: 1.5625rem;  ……  font-size: 44px; }   ← variant, then sx
 * @media (min-width:1536px) { .css-x { font-size: 2.125rem; } }  ← variant ramp
 * ```
 *
 * Both declarations sit on the same class, so the LAST one wins — and the
 * variant's ramp is last. An author who typed 44 into Font Size at "all
 * screen sizes" got 34px on a desktop viewport, with nothing in the panel
 * to explain it. The value was stored correctly and reported correctly; only
 * the cascade disagreed.
 *
 * The canvas never showed the bug, which is why it survived: the besigner
 * renders through `createDevicePinnedTheme`, which flattens every variant's
 * media keys at the artboard width before the leaf mounts. So the ramp was
 * already gone there and the author's value won — the editor and the
 * published page genuinely disagreed.
 *
 * The fix is one line of cascade position, not a new precedence rule: a
 * scalar `fontSize` is re-expressed as `{ xs: value }`. `xs` is `min-width:0`
 * and therefore always matches, so the RESOLVED value is unchanged for every
 * viewport; it simply moves the declaration out of the base block and into an
 * at-rule that Emotion emits after the variant's, restoring "the author's
 * explicit choice wins". A `fontSize` the author already scoped per
 * breakpoint is left exactly as written — those breakpoints are a deliberate
 * ramp of their own and already sort after the variant.
 *
 * Scoped to the sx object's TOP level — the element's own styles, which are
 * the only ones competing with the element's own variant. A `fontSize` nested
 * under a descendant selector (`'& .price': { fontSize: 12 }`) is left alone:
 * it is not in that contest, and rewriting it would grow the stylesheet for
 * nothing.
 */

/**
 * Typography properties `responsiveFontSizes` ramps, and therefore the ones
 * whose author value can lose to a variant at-rule.
 *
 * `fontSize` alone: MUI's ramp only rewrites `fontSize`, and only aligns
 * `lineHeight` when `disableAlign` is off AND the variant's line height is a
 * unitless number — the console theme's ramped variants (h1–h3) all carry
 * unitless line heights, and the emitted CSS carries no `line-height` inside
 * the ramp's media queries. Adding properties here that the theme does not
 * ramp would emit at-rules that change nothing.
 */
export const RAMPED_TYPOGRAPHY_PROPERTIES = ['fontSize'] as const

/** MUI breakpoint keys, smallest first; `xs` is the always-matching base. */
const BREAKPOINT_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'] as const

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether a value is already an sx responsive object (`{ xs, md, … }`).
 * Such a value is the author's own breakpoint ramp and is never rewritten.
 */
const isResponsiveValue = (value: unknown): boolean =>
  isPlainObject(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((key) =>
    (BREAKPOINT_KEYS as readonly string[]).includes(key),
  )

/**
 * Pins scalar ramped-typography values into the `xs` slice so they sort
 * after the theme's variant ramp. Identity-preserving: an sx carrying no
 * scalar `fontSize` comes back as the very same object, so the hot render
 * path allocates nothing in the overwhelmingly common case.
 */
export function pinRampedTypographySx<T>(sx: T): T {
  if (Array.isArray(sx)) {
    let changed = false
    const next = sx.map((entry) => {
      const pinned = pinRampedTypographySx(entry)
      if (pinned !== entry) changed = true
      return pinned
    })
    return (changed ? next : sx) as T
  }
  // An sx callback is resolved by MUI with the theme; wrap it so its RESULT
  // gets the same treatment the object form does.
  if (typeof sx === 'function') {
    const callback = sx as (...args: unknown[]) => unknown
    return ((...args: unknown[]) =>
      pinRampedTypographySx(callback(...args))) as T
  }
  if (!isPlainObject(sx)) return sx

  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sx)) {
    const ramped = (
      RAMPED_TYPOGRAPHY_PROPERTIES as readonly string[]
    ).includes(key)
    // Only a SCALAR needs moving. `null`/`undefined` are the panel's cleared
    // state and must stay scalar so they keep meaning "let the theme decide".
    if (
      ramped &&
      value != null &&
      !isPlainObject(value) &&
      !Array.isArray(value) &&
      typeof value !== 'function' &&
      !isResponsiveValue(value)
    ) {
      out[key] = { xs: value }
      changed = true
      continue
    }
    out[key] = value
  }
  return (changed ? out : sx) as T
}

export default pinRampedTypographySx
