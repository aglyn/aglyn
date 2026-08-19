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
 * One spelling per style property (AGL-2207).
 *
 * Node `sx` is an MUI `sx` record, and MUI honours TWO names for the same
 * declaration: its system-prop aliases (`bgcolor`, `p`/`px`/`py`/…,
 * `m`/`mx`/`my`/…) and the CSS longhands. The Styles panel only ever names
 * the longhands — `buildStyleFieldGroups` declares `backgroundColor`, and
 * `ElementStylesForm` reads `paddingTop`…`marginLeft` for the box model —
 * so a stored alias RENDERS but reaches no field: the control shows empty,
 * and clearing the field deletes a key that was never the one painting.
 *
 * The longhand is therefore canonical. Not because the renderer prefers it
 * (it resolves both, so the renderer cannot arbitrate) but because the
 * panel's field names are the only schema the product has.
 *
 * This module is the single table, plus the expansion every read/write
 * seam applies. Nothing REMOVES the alias spelling from the corpus: live
 * documents carry it, the Custom CSS builder is free-solo and its JSON tab
 * takes any key at all, so an alias can arrive at any time. Expanding on
 * read is what makes those documents editable; expanding the colliding
 * keys on write is what makes clearing actually clear.
 */

/**
 * Alias → the CSS longhands it stands for.
 *
 * Ground truth is MUI's own tables, not this file's memory:
 * `@mui/system/styleFunctionSx/defaultSxConfig` gives
 * `bgcolor.cssProperty === 'backgroundColor'`, and `@mui/system/spacing`
 * builds its `CSS_PROPERTIES` table by crossing the two property roots
 * (`m` is margin, `p` is padding) with six direction suffixes — `t` Top,
 * `r` Right, `b` Bottom, `l` Left, `x` Left and Right, `y` Top and Bottom
 * — and then points `paddingX`/`paddingY`/`marginX`/`marginY` at
 * `px`/`py`/`mx`/`my`. `sx-property-aliases.spec.ts` asserts
 * this table against those modules so a MUI upgrade cannot open a spelling
 * we do not know about.
 *
 * Deliberately NOT here:
 *
 * - `p` and `m` map to the CSS shorthands `padding`/`margin` in MUI, but
 *   the panel has no shorthand field — BoxStyler owns four per-side
 *   controls — so they expand to the four longhands. That is exact for the
 *   atomic values {@link isAtomicSxValue} admits and refused for the rest.
 * - `padding`/`margin` themselves. They are real CSS properties whose
 *   value may be a multi-side shorthand, and no panel field owns them
 *   either; rewriting them is a value-parsing problem, not a naming one.
 * - Logical properties (`paddingInline*`, `marginBlock*`, …). MUI lists
 *   them in its spacing set, but each maps to the SAME-named CSS property
 *   — they are not aliases, they are direction-agnostic properties whose
 *   whole point is that they differ from `left`/`right` under RTL.
 */
export const SX_PROPERTY_ALIASES: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  bgcolor: ['backgroundColor'],

  p: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  pt: ['paddingTop'],
  pr: ['paddingRight'],
  pb: ['paddingBottom'],
  pl: ['paddingLeft'],
  px: ['paddingLeft', 'paddingRight'],
  py: ['paddingTop', 'paddingBottom'],
  paddingX: ['paddingLeft', 'paddingRight'],
  paddingY: ['paddingTop', 'paddingBottom'],

  m: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  mt: ['marginTop'],
  mr: ['marginRight'],
  mb: ['marginBottom'],
  ml: ['marginLeft'],
  mx: ['marginLeft', 'marginRight'],
  my: ['marginTop', 'marginBottom'],
  marginX: ['marginLeft', 'marginRight'],
  marginY: ['marginTop', 'marginBottom'],
})

/** Every alias spelling, for guards and callers that only need the set. */
export const SX_ALIAS_PROPERTIES: readonly string[] = Object.freeze(
  Object.keys(SX_PROPERTY_ALIASES),
)

/** Whether `name` is a stray spelling of a canonical style property. */
export function isSxAliasProperty(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SX_PROPERTY_ALIASES, name)
}

/** The canonical longhands `name` stands for; empty when it IS canonical. */
export function canonicalSxProperties(name: string): readonly string[] {
  return SX_PROPERTY_ALIASES[name] ?? []
}

/** Aliases that would write `property` — the keys an edit to it must clear. */
export function sxAliasesFor(property: string): string[] {
  return SX_ALIAS_PROPERTIES.filter((alias) =>
    SX_PROPERTY_ALIASES[alias].includes(property),
  )
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether a value survives being copied onto EACH longhand an alias covers.
 *
 * A number does (`p: 2` → four `padding*: 2`, each through the same MUI
 * spacing transform, so 16px on all four sides either way). A single-token
 * string does (`px: '2rem'`). A multi-token string does NOT: a value like
 * `'10px 20px'` is the CSS shorthand's own per-side syntax, and copying it
 * onto `paddingTop` would silently turn 10px into a two-value declaration
 * CSS drops. Those are left as they are: still rendering, still not editable,
 * but not corrupted either. The panel has no control that could express
 * them anyway.
 *
 * A responsive object (`{xs: 2, md: 4}`) is atomic when every slice is,
 * because the expansion just carries the whole object onto each longhand
 * and MUI resolves it per breakpoint exactly as before.
 */
export function isAtomicSxValue(value: unknown): boolean {
  if (typeof value === 'number') return true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 && !/[\s,]/.test(trimmed)
  }
  if (isPlainObject(value)) {
    const entries = Object.values(value)
    return entries.length > 0 && entries.every(isAtomicSxValue)
  }
  return false
}

/**
 * Whether an alias key in this record could be expanded — the guard's
 * question, and the identity fast-path's.
 */
export function hasExpandableSxAlias(sx: unknown): boolean {
  if (!isPlainObject(sx)) return false
  for (const [key, value] of Object.entries(sx)) {
    if (isSxAliasProperty(key)) {
      if (SX_PROPERTY_ALIASES[key].length === 1 || isAtomicSxValue(value)) {
        return true
      }
    }
  }
  return false
}

/** Options for {@link expandSxAliases}. */
export interface ExpandSxAliasesOptions {
  /**
   * Expand only aliases that stand for one of these properties. Used by
   * the panel's write seam, which must not rewrite keys the author is not
   * editing. Omitted = expand every expandable alias.
   */
  only?: readonly string[]
  /**
   * Also expand nested records — the `@scheme dark` slice, breakpoint
   * media keys, `&:hover` blocks. Off by default so a caller that only
   * cares about the top level pays for nothing.
   */
  deep?: boolean
}

/**
 * Rewrites alias keys to their canonical longhands, IN PLACE in the key
 * order (AGL-2207).
 *
 * Order is the whole correctness argument. MUI's `styleFunctionSx` walks
 * `sx` with `for…in` and later keys overwrite earlier ones, so
 * `{p: 2, paddingTop: 8}` renders 8px on top and `{paddingTop: 8, p: 2}`
 * renders 2 × the spacing unit. Expanding each alias where it stands —
 * rather than appending the longhands — reproduces both, so the expansion
 * is a pure renaming of what already renders and never a restyle.
 *
 * Returns the input BY IDENTITY when there is nothing to expand, which is
 * every node in a corpus once the presets stop writing aliases, so this
 * sitting on a render path costs one key scan and no allocation.
 */
export function expandSxAliases<T>(sx: T, options?: ExpandSxAliasesOptions): T {
  if (!isPlainObject(sx)) return sx
  const only = options?.only
  const deep = options?.deep ?? false

  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sx)) {
    const canonical = SX_PROPERTY_ALIASES[key]
    const wanted =
      canonical &&
      (!only || canonical.some((name) => only.includes(name))) &&
      (canonical.length === 1 || isAtomicSxValue(value))
    if (wanted) {
      changed = true
      for (const name of canonical) out[name] = value
      continue
    }
    if (deep && isPlainObject(value)) {
      const nested = expandSxAliases(value, options)
      if (nested !== value) changed = true
      out[key] = nested
      continue
    }
    out[key] = value
  }
  return (changed ? out : sx) as T
}

export default expandSxAliases
