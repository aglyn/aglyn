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
 * Reads the RENDERED typography off a canvas element so an editing surface
 * can wear it (AGL-2486).
 *
 * Zach: *"Can we also make it so we are not seeing a text box we are editing
 * it in? We see/edit it exactly how it appears"*. A 96px display heading was
 * editing as small body text in a white box — the size, weight, colour and
 * alignment all lost at exactly the moment the author needs to see them.
 *
 * Computed values, not the node's `sx`. The `sx` is a recipe: variant
 * defaults, the site theme, breakpoint objects, palette tokens and the
 * device-preview transform all resolve on the way to the screen, and only
 * the browser knows the answer. `getComputedStyle` reads what the author is
 * actually looking at, in px, and so survives every one of those layers
 * without this file knowing any of them exist.
 *
 * PADDING is copied with the type: the overlay is positioned on the
 * element's border box, so the text only lands on the same pixel if the box
 * insets match. Border width is deliberately NOT copied — the surface draws
 * no border, and a copied one would reintroduce the box this exists to
 * remove.
 *
 * `whiteSpace` is deliberately NOT copied either, and it is the one place
 * fidelity loses on purpose: the plain surface keeps `pre-wrap` so a
 * Shift+Enter newline is visible while typing. Under an element computing
 * `normal` the two differ only for explicit newlines and runs of spaces —
 * which is precisely the content the author has to be able to see to edit.
 */

/**
 * The properties that decide how a run of text looks. Longhand only:
 * shorthands like `font` come back from `getComputedStyle` normalized in
 * ways that lose `lineHeight` on some engines.
 */
const TEXT_STYLE_PROPERTIES = [
  'color',
  'direction',
  'fontFamily',
  'fontFeatureSettings',
  'fontSize',
  'fontStretch',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'textAlign',
  'textDecorationLine',
  'textIndent',
  'textShadow',
  'textTransform',
  'wordSpacing',
] as const

export type AnchorTextStyle = Partial<
  Record<(typeof TEXT_STYLE_PROPERTIES)[number], string>
>

/**
 * The typographic properties `anchor` currently renders with, ready to
 * spread into an editing surface's `sx`.
 *
 * Returns `undefined` rather than a partial answer when there is nothing
 * trustworthy to read — no anchor, no DOM, or an element already detached
 * (a re-render between opening the editor and this call). The caller then
 * keeps `font: 'inherit'`, which is what the surface did before any of this:
 * degrading to the old look beats painting text in a guess.
 */
export function readAnchorTextStyle(
  anchor: Element | undefined | null,
): AnchorTextStyle | undefined {
  if (!anchor || typeof window === 'undefined') return undefined
  if (!anchor.isConnected) return undefined
  const computed = window.getComputedStyle(anchor)
  // A detached or display:none element computes an empty style declaration.
  if (!computed || computed.length === 0) return undefined
  const style: Record<string, string> = {}
  for (const property of TEXT_STYLE_PROPERTIES) {
    const value = computed[property]
    if (typeof value === 'string' && value !== '') style[property] = value
  }
  return Object.keys(style).length ? (style as AnchorTextStyle) : undefined
}

/**
 * The element whose TEXT the editing surface is standing in for.
 *
 * `<aglyn-text>` holds the leaf's text node and nothing else, so hiding it
 * leaves an icon, an adornment or a nested child visible while the author
 * types — hiding the whole leaf would take them with it. Falls back to the
 * leaf itself for the rich-text case, where `props.html` is rendered
 * straight onto the leaf and there is no `<aglyn-text>` at all.
 */
export function findAnchorTextElement(
  anchor: Element | undefined | null,
): HTMLElement | undefined {
  if (!anchor) return undefined
  const text = anchor.querySelector('aglyn-text')
  const element = (text ?? anchor) as HTMLElement
  return typeof element.style === 'object' ? element : undefined
}
