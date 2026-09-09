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
 * The "start hidden" class and the one CSS rule behind it.
 *
 * Its own module because a published page reads only the rule text — it goes
 * into the SSR HTML so an author-applied hidden class paints hidden from the
 * first frame — while `element-ui.ts` around it is the authoring-time
 * choreography contract: the visibility executor, the drawer and menu command
 * buses, leaf-selector expansion and the responsive bands, and through
 * `compose-layout-nodes.ts` the layout composer as well. None of that runs to
 * paint a hidden element, and a bundler cannot drop it around a single named
 * import.
 */

/**
 * Class the show/hide steps toggle. The tenant page ships
 * {@link ELEMENT_HIDDEN_STYLE_TEXT} in its SSR HTML so an author-applied
 * "start hidden" class paints hidden from the first frame; the besigner
 * canvas deliberately omits the rule so hidden elements stay editable
 * (same posture as the AGL-557 reveal outcome).
 */
export const ELEMENT_HIDDEN_CLASS = 'aglyn-hidden'

/** Stylesheet rule backing {@link ELEMENT_HIDDEN_CLASS}. */
export const ELEMENT_HIDDEN_STYLE_TEXT = `.${ELEMENT_HIDDEN_CLASS}{display:none !important}`

/** Id of the injected fallback style tag (idempotence marker). */
export const ELEMENT_HIDDEN_STYLE_ID = 'aglyn-element-hidden-style'

/**
 * Ensures the hidden-class rule exists in the document (the tenant page
 * renders it during SSR; this is the belt-and-braces path for other
 * surfaces, e.g. the interaction builder's Test button).
 */
export function ensureElementHiddenStyle(doc: Document = document): void {
  if (doc.getElementById(ELEMENT_HIDDEN_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = ELEMENT_HIDDEN_STYLE_ID
  style.textContent = ELEMENT_HIDDEN_STYLE_TEXT
  doc.head.appendChild(style)
}
