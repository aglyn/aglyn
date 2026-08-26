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

import * as Aglyn from '@aglyn/aglyn'
import type { BesignerStateFlag } from '@aglyn/besigner'
import isEqual from 'lodash-es/isEqual'

/**
 * Interaction-state style slices for the Styles panel (AGL-2486 item 39).
 *
 * Hover, focus and active states are reachable in the document already — the
 * JSS tab's own caption advertises nested selectors — but only by typing raw
 * sx, which most of this panel's audience cannot do. These slices are the
 * picker for the same capability.
 *
 * ## What is stored is the REAL selector
 *
 * A state slice is `node.sx['&:hover']`, not a reserved `@state hover` key.
 * That choice is what makes this feature need NO renderer change at all:
 * MUI's `styleFunctionSx` hands an unrecognised object key straight back to
 * itself (`wrapper.sx = value; css[styleKey] = styleFunctionSx(wrapper)`), so
 * the slice gets the full sx treatment — palette tokens, system-prop aliases
 * (`bgcolor`), and responsive breakpoint objects — identically on the canvas,
 * in Preview and on the published page. A reserved key would have needed a
 * substitution pass on every render path, and the recorded reason the scheme
 * slices work is that there is exactly ONE such path.
 *
 * It also means the panel and the JSS tab are editing the same thing rather
 * than two representations of it, and that an author who already hand-wrote
 * `&:hover` finds the panel showing it.
 *
 * ## Nesting order: state OUTER, scheme INNER, breakpoints innermost
 *
 * ```ts
 * { '&:hover': { '@scheme dark': { color: { xs: '#eee', md: '#fff' } } } }
 * ```
 *
 * Not a new invariant — `scheme-rendering.spec.tsx` already proves
 * `resolveSchemeSx` resolves exactly this shape, because it recurses into
 * nested selector objects. The REVERSE order would be a bug: `mergeSchemeValue`
 * replaces a nested object wholesale, so a `@scheme dark` slice containing
 * `&:hover` would clobber the light hover block rather than merge with it.
 *
 * ## The scrub is not bypassed
 *
 * `sanitizeAuthorSx` walks nested records with no key filtering, and
 * `leaf-author-css.spec.tsx` already asserts that a `url(http://…)` inside an
 * `&:hover` slice is rewritten to `about:invalid`. Author CSS in a state slice
 * goes through the same scrub as author CSS anywhere else.
 */

/**
 * The interaction states the panel offers, in the order the chip row shows
 * them.
 *
 * ## Why plain `:focus` is deliberately absent — do not "fix" this
 *
 * `:focus` matches on mouse and touch focus as well as keyboard focus, so the
 * overwhelmingly common thing an author does with a `:focus` control is remove
 * the ring they consider ugly on click — and that removes it for keyboard
 * users too, who have no other way to tell where they are on the page. Adding
 * the field would mean shipping a purpose-built UI for an accessibility
 * regression, on a product whose authors are explicitly not expected to know
 * CSS.
 *
 * `:focus-visible` is the same capability without that failure mode: the
 * browser only matches it when it judges a focus indicator should be shown
 * (keyboard and programmatic focus, not a mouse click), so styling it can
 * essentially only ADD an indicator. That covers the legitimate reason to
 * style focus — making the ring match the brand — while making the harmful
 * one much harder to reach by accident.
 *
 * An author with a genuine `:focus` need still has the JSS (sx) tab, which
 * accepts any selector. That friction is the point: it is reachable by someone
 * who knows what they are doing and not by someone clicking through a panel.
 */
export const SX_STATES: readonly BesignerStateFlag[] = Object.freeze([
  'hover',
  'active',
  'focusVisible',
  'disabled',
])

/**
 * Alias of the canvas flag union, which is declared in `@aglyn/besigner` so
 * the flag store that HOLDS the state and the panel that WRITES the slice
 * cannot drift apart.
 */
export type SxState = BesignerStateFlag

/** The CSS selector each state is stored under in `node.sx`. */
export const SX_STATE_SELECTORS: Readonly<Record<SxState, string>> =
  Object.freeze({
    hover: '&:hover',
    active: '&:active',
    focusVisible: '&:focus-visible',
    disabled: '&:disabled',
  })

/**
 * Chip labels. **Keep them short — this row must never wrap.**
 *
 * These shipped once as "Focus (keyboard)", to stop a bare "Focus" implying
 * that the mouse-click ring is what you are styling. The reasoning was right
 * and the label was wrong: measured against the styles panel, the five chips
 * needed **368px** of the **359px** a default 375px panel has, so `Disabled`
 *
 * Short labels bring the row to 272px, which fits every panel width down to
 * about 290px, and {@link SX_STATE_LABEL_MAX} pins them so the next person to
 * reach for a clarifying parenthetical gets a failing test instead of a
 * wrapped row.
 *
 * The keyboard nuance did not get dropped, it moved somewhere better than a
 * label: {@link SX_STATE_DESCRIPTIONS} carries the full rule in the chip
 * tooltip, and {@link SX_STATE_PROSE} puts "keyboard focus" in the preview
 * banner — which appears the moment Focus is selected, so it is READ rather
 * than hovered for. That is the same job the long label was doing, done where
 * there is room for it.
 */
export const SX_STATE_LABELS: Readonly<Record<SxState, string>> = Object.freeze({
  hover: 'Hover',
  active: 'Active',
  focusVisible: 'Focus',
  disabled: 'Disabled',
})

/**
 * The longest a chip label may be before the row stops fitting a narrow
 * panel. `Disabled` is 8 and is the longest today; the budget is measured,
 * not guessed — see {@link SX_STATE_LABELS}.
 */
export const SX_STATE_LABEL_MAX = 8

/** The same states in running prose — banners, the override chips. */
export const SX_STATE_PROSE: Readonly<Record<SxState, string>> = Object.freeze({
  hover: 'hover',
  active: 'active',
  focusVisible: 'keyboard focus',
  disabled: 'disabled',
})

/**
 * What each state means, in the panel's voice — shown as the chip tooltip so
 * an author can tell `Active` (held down) from `Focus` (keyboard) without
 * knowing the selectors.
 */
export const SX_STATE_DESCRIPTIONS: Readonly<Record<SxState, string>> =
  Object.freeze({
    hover: 'While the pointer is over this element.',
    active: 'While this element is being pressed or clicked.',
    focusVisible:
      'While this element has keyboard focus. Styling this state adds to the ' +
      'focus indicator keyboard visitors rely on — it will not show on a ' +
      'plain mouse click.',
    disabled: 'While this element is disabled. Only form controls can be disabled.',
  })

const STATE_SELECTOR_SET: ReadonlySet<string> = new Set(
  Object.values(SX_STATE_SELECTORS),
)

/** Whether an sx key is one of the state selectors this module owns. */
export function isSxStateSelector(key: string): boolean {
  return STATE_SELECTOR_SET.has(key)
}

/**
 * The state a stored selector belongs to, or null when the key is not one of
 * ours. Lets a surface that lists RAW sx keys — the instance-override chips —
 * name a slice the way the chip row does instead of printing `&:hover` at an
 * author who never typed it.
 */
export function sxStateForSelector(key: string): SxState | null {
  return (
    SX_STATES.find((state) => SX_STATE_SELECTORS[state] === key) ?? null
  )
}

/** The override-chip label for a raw sx key, or null to fall through. */
export function sxStateSliceLabel(key: string): string | null {
  const state = sxStateForSelector(key)
  return state ? `${SX_STATE_PROSE[state]} state` : null
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The stored slice for a state, or undefined when the element has none.
 *
 * `state: null` is the base scope and returns the record itself, so callers
 * can pass the panel's active scope through without branching.
 */
export function readStateSlice(
  sx: Record<string, any> | undefined,
  state: SxState | null,
): Record<string, any> | undefined {
  if (!state) return sx
  const slice = sx?.[SX_STATE_SELECTORS[state]]
  return isPlainObject(slice) ? slice : undefined
}

/**
 * What the element actually LOOKS like in a state: the base styles with the
 * state slice merged over them, which is what the browser paints because a
 * `:hover` block only overrides the properties it names.
 *
 * This is what the panel reads from, so a field the author has not overridden
 * for hover shows the inherited base value rather than empty — the same
 * reading the breakpoint scope gives, and the reason the write seam can skip
 * a value that would not change anything.
 *
 * `mergeNodeSx` is the house merge: responsive objects cascade mobile-first,
 * `@scheme dark` and nested selector blocks merge key by key. Reusing it keeps
 * the panel's reading identical to the graft's.
 *
 * Returns the input BY IDENTITY at base scope or when no slice exists, which
 * is every element that has never been given a state style.
 */
/**
 * The element's base styles with every state selector removed — the baseline a
 * state slice is a difference FROM. Returned by identity when the element
 * carries no state slices at all, which is every element today.
 */
export function stripStateSlices(
  sx: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (!sx) return sx
  if (!Object.keys(sx).some(isSxStateSelector)) return sx
  const base: Record<string, any> = { ...sx }
  for (const selector of STATE_SELECTOR_SET) delete base[selector]
  return base
}

export function stateScopedSx(
  sx: Record<string, any> | undefined,
  state: SxState | null,
): Record<string, any> | undefined {
  const slice = state ? readStateSlice(sx, state) : undefined
  if (!slice) return sx
  // Every state selector is dropped from the reading: the slice being edited
  // is merged in below, and a SIBLING state's block is not part of what this
  // state looks like.
  const base = stripStateSlices(sx)
  return Aglyn.mergeNodeSx(base, slice) as Record<string, any>
}

/**
 * Replaces one state's slice, removing it entirely when it comes back empty.
 *
 * An emptied slice is DELETED rather than stored as `{}` — the same rule
 * `writeSxValue` applies to an emptied scheme slice and `getNodeStyleTarget`
 * applies to an emptied instance override. A `{}` left behind would make
 * "does this element have a hover style" answer yes forever, which the chip's
 * own dot indicator and the override badge both read.
 *
 * Returns a new record; the input is never mutated.
 */
export function writeStateSlice(
  sx: Record<string, any> | undefined,
  state: SxState,
  slice: Record<string, any> | undefined,
): Record<string, any> {
  const next: Record<string, any> = { ...sx }
  const selector = SX_STATE_SELECTORS[state]
  if (slice && Object.keys(slice).length > 0) next[selector] = slice
  else delete next[selector]
  return next
}

/**
 * The slice implied by an edited state-scope reading (AGL-2486).
 *
 * The panel edits the MERGED record — base with the slice over it, which is
 * what the element actually looks like in that state — so the write has to be
 * split back out: only what genuinely differs from the base belongs in the
 * slice. That split is what gives the three behaviours the panel needs, all
 * from one rule:
 *
 * - a property the author changed for this state lands in the slice;
 * - a property the author set back to the base value LEAVES the slice, because
 *   a `:hover` block that restates the base paints nothing and would show as a
 *   permanent override in the chip's dot;
 * - a property the author cleared leaves the slice too, so the state falls
 *   back to inheriting the base — which is the only thing a pseudo-class block
 *   can express, since CSS has no way to un-declare a property.
 *
 * `base` must already have the state selectors stripped (which
 * {@link stateScopedSx} does), or a sibling state's block would read as a
 * difference and be copied in.
 */
export function deriveStateSlice(
  base: Record<string, any> | undefined,
  edited: Record<string, any> | undefined,
): Record<string, any> {
  const slice: Record<string, any> = {}
  for (const [key, value] of Object.entries(edited ?? {})) {
    if (isSxStateSelector(key)) continue
    if (isEqual(base?.[key], value)) continue
    slice[key] = value
  }
  return slice
}

/** Whether the element carries any styles for this state. */
export function sxHasStateSlice(
  sx: Record<string, any> | undefined,
  state: SxState,
): boolean {
  const slice = readStateSlice(sx, state)
  return !!slice && Object.keys(slice).length > 0
}

/** Every state the element currently carries a slice for, in chip order. */
export function sxStatesWithSlices(
  sx: Record<string, any> | undefined,
): SxState[] {
  return SX_STATES.filter((state) => sxHasStateSlice(sx, state))
}

/**
 * Components that put a real tab stop / focusable control in the DOM. Matched
 * on the component id, which is the only thing the panel reliably knows about
 * an element before it renders.
 */
const INTERACTIVE_COMPONENT_PATTERN =
  /button|link|anchor|field|input|select|checkbox|radio|switch|slider|tabs?$|menuitem|textarea|toggle|rating|autocomplete/i

/**
 * The advisory to show under the state chips, or null when the state makes
 * plain sense on this element (AGL-2486 item 39).
 *
 * States are deliberately NOT constrained by element type. A hover effect on a
 * Box or Section wrapping a link is among the commonest real designs, and
 * refusing it would block more good work than it prevents mistakes. But
 * `:focus-visible` on something with no tab stop and `:disabled` on something
 * that cannot be disabled will simply never fire, and an author who styles one
 * and sees nothing has no way to find out why. So: allow it, and say so.
 */
export function stateAdvisory(
  state: SxState | null,
  element: { componentId?: string; hasHref?: boolean; hasTabIndex?: boolean },
): string | null {
  if (state !== 'focusVisible' && state !== 'disabled') return null
  const interactive =
    !!element.hasHref ||
    !!element.hasTabIndex ||
    INTERACTIVE_COMPONENT_PATTERN.test(element.componentId ?? '')
  if (interactive) return null
  if (state === 'disabled') {
    return (
      'Only form controls — buttons, inputs, selects — can be disabled. On ' +
      'this element these styles are valid but will never show. You can still ' +
      'set them if a plugin or custom code disables it.'
    )
  }
  return (
    'This element cannot receive keyboard focus today, so these styles will ' +
    'never show. They will start working if you make it a link or a button, ' +
    'or give it a tab stop.'
  )
}

/**
 * CANVAS ONLY: renders an element as if it were in the given state, by
 * hoisting that state's slice over the base declarations (AGL-2486 item 39).
 *
 * You cannot hover an element while working in a side panel, so a state whose
 * styles you cannot see is a state you cannot design. This is what holds the
 * state on — and it is deliberately NOT a toggle that can be left on and
 * published by mistake: selecting the state in the panel's chip row IS the
 * hold, so you cannot be editing the hover slice and not see hover, and
 * returning to `Default` ends it. It lives in editor UI state and never enters
 * the document, so Preview and the published page cannot receive it.
 *
 * Applied through `LeafSxTransformContext` — the SAME canvas-only seam the
 * artboard device-width transform already uses, at the one point in `Leaf`
 * where the merged sx reaches the element. There is still exactly one
 * substitution path, and the tenant never mounts the provider.
 *
 * Runs on the fully merged sx AFTER scheme resolution, so a slice that carried
 * `@scheme dark` has already collapsed to the active scheme's values by the
 * time it is hoisted. `mergeSchemeValue` does the per-value merge so a
 * responsive override keeps the base's other breakpoints.
 *
 * The hoisted selector is removed, so what renders is exactly the state's
 * appearance rather than the state's appearance plus a live `:hover` that
 * would repaint the same declarations. Sibling states are left untouched.
 *
 * Returns the input BY IDENTITY when there is nothing to hoist.
 */
export function hoistStateSx<T>(sx: T, state: SxState | null): T {
  if (!state) return sx
  const selector = SX_STATE_SELECTORS[state]
  if (Array.isArray(sx)) {
    let changed = false
    const next = sx.map((entry) => {
      const value = hoistStateSx(entry, state)
      if (value !== entry) changed = true
      return value
    })
    return (changed ? next : sx) as unknown as T
  }
  if (!isPlainObject(sx)) return sx
  const slice = (sx as Record<string, any>)[selector]
  if (!isPlainObject(slice)) return sx
  const out: Record<string, any> = { ...(sx as Record<string, any>) }
  delete out[selector]
  for (const [key, value] of Object.entries(slice)) {
    const merged = Aglyn.mergeSchemeValue(out[key], value)
    if (merged === undefined) delete out[key]
    else out[key] = merged
  }
  return out as unknown as T
}

export default SX_STATES
