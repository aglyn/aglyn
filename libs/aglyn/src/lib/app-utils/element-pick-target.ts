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

import { normalizeLeafId } from './element-ui'

/** The stamp the node renderer's `Leaf` puts on every element it draws. */
const LEAF_STAMP_SELECTOR = '[data-aglyn^="leaf:"]'

export interface ElementPickTarget {
  /** The stamped element the click resolves to. */
  element: Element
  /** The selector stored for it — the Besigner picker's form. */
  selector: string
  /** What it reads as: its accessible name or text, else its tag. */
  label: string
}

function readableLabel(element: Element): string {
  const named =
    element.getAttribute('aria-label') ||
    element.getAttribute('alt') ||
    element.getAttribute('title') ||
    (element.textContent ?? '')
  const text = named.replace(/\s+/g, ' ').trim()
  const tag = element.tagName.toLowerCase()
  if (!text) return tag === 'img' ? 'Image' : `Element (${tag})`
  return text.length > 40 ? `“${text.slice(0, 39)}…”` : `“${text}”`
}

/**
 * The element a pick resolves to (AGL-3758): the nearest ancestor-or-self the
 * renderer stamped, its stored selector, and a label. A layout's namespace is
 * stripped off the id, exactly as the Besigner picker stores the raw canvas
 * id; the runtime's `expandLeafSelector` matches it on every page again.
 * `null` for a point on nothing Aglyn drew.
 */
export function elementPickTarget(from: Element | null): ElementPickTarget | null {
  const element = from?.closest?.(LEAF_STAMP_SELECTOR) ?? null
  if (!element) return null
  const stamp = element.getAttribute('data-aglyn') ?? ''
  const id = normalizeLeafId(stamp.slice('leaf:'.length))
  if (!id || id.includes('"') || id.includes('\\')) return null
  return {
    element,
    selector: `[data-aglyn="leaf:${id}"]`,
    label: readableLabel(element),
  }
}
