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

/**
 * THE ELEMENT PICKER EVERY CONTAINER GETS (AGL-2525).
 *
 * Section owned the semantic elements alone, so an author who wanted their nav
 * row to BE the `nav` had to wrap it in a second element to say so — and on
 * `aglyn.com` nobody did, which is why the published page had no navigation
 * landmark at all. Wrapping to name a thing is the same shape of
 * element-nobody-authored that AGL-2521 removed from component placements,
 * arriving by a different route.
 *
 * ⛔ `main` IS NOT ON THIS LIST. A page carries exactly one, placed by
 * `stampDocumentLandmark` on the Document layer or the Layout Slot — the two
 * nodes that appear at most once per document. Everything using this picker can
 * be placed any number of times, so an author-selected `main` here could only
 * ever be the second one.
 *
 * An allow-list rather than free text: the value is persisted and rendered
 * verbatim, so a typed one would put `script` into every visitor's page.
 */
export const SEMANTIC_ELEMENTS = [
  'div',
  'section',
  'article',
  'aside',
  'nav',
  'header',
  'footer',
] as const
export type SemanticElement = (typeof SEMANTIC_ELEMENTS)[number]

/**
 * The element to render, or `undefined` to leave the component's own default
 * alone.
 *
 * Returning `undefined` rather than `'div'` is what lets this be added to a
 * component that does NOT default to a div — App Bar renders `header` unless
 * told otherwise, and a resolver that answered `'div'` for "unset" would have
 * silently stripped the banner landmark off every site's chrome the moment the
 * picker appeared.
 */
export function resolveSemanticElement(value: unknown): SemanticElement | undefined {
  return (SEMANTIC_ELEMENTS as readonly string[]).includes(String(value ?? ''))
    ? (value as SemanticElement)
    : undefined
}

/**
 * Spreadable `component` prop: present only when the author chose one, so an
 * unset picker is indistinguishable from never having had one.
 */
export function semanticElementProp(
  value: unknown,
): { component?: SemanticElement } {
  const element = resolveSemanticElement(value)
  return element ? { component: element } : {}
}

/**
 * The attribute schema. `subject` names what renders, e.g. "this stack".
 *
 * Labelled `Component`, the name Box, Typography, the Document layer and the
 * Layout Slot already use — Section and Inline text keep `element` as their
 * stored KEY because their values are persisted in published screens, but the
 * panel says one thing everywhere (AGL-2514).
 */
export function semanticElementAttribute(
  subject: string,
): Aglyn.AglynAttributeSchema {
  return {
    name: 'component',
    label: 'Component',
    description:
      `The DOM element ${subject} renders as. Use section/article/aside/nav/` +
      'header/footer to give the region meaning for assistive tech and search ' +
      'engines; div for purely visual grouping. "main" is not offered — the ' +
      'page’s content region carries that one.',
    component: Aglyn.FieldComponentType.SELECT,
    options: SEMANTIC_ELEMENTS.map((value) => ({ value, label: value })),
  } as Aglyn.AglynAttributeSchema
}
