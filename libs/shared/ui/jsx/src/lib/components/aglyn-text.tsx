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

import { forwardRef } from 'react'

/**
 * The authored text of a leaf, as a plain element (AGL-2011).
 *
 * ## Why this is no longer a shadow host
 *
 * This used to be `ShadowDom.AglynText` — a `shadowDomRootFactory` host that
 * `attachShadow`ed and then rendered the string through a `createPortal` into
 * the shadow root. The tag name is unchanged, so every
 * `querySelectorAll('aglyn-text')` and every editor ref target still resolves;
 * what is gone is the shadow boundary.
 *
 * A shadow root exists to encapsulate STYLE, and here it encapsulated nothing.
 * Measured on the live `/pricing` page: **960 hosts, 960 shadow roots holding a
 * single bare text node, zero elements inside any of them, and zero carrying
 * any CSS** — no `adoptedStyleSheets`, no `<style>`, no `<link>`. There was
 * nothing for a selector to match, and inherited typography (font, colour,
 * line-height) crosses a shadow boundary regardless. The encapsulation was a
 * no-op.
 *
 * The COSTS were not. A shadow root makes text invisible to `textContent`,
 * and the repo paid for that four separate times:
 *
 *  - **AGL-2349 shipped a bug.** Every published split accordion summary named
 *    its chevron "Toggle section", because the label could not be read back.
 *    `accordion.tsx` still carries the bespoke `childText` React-tree walker
 *    written to work around it.
 *  - Legal-page verification had to read the **Flight payload** rather than the
 *    DOM (`published-legal-pages.ts`).
 *  - `leaf.spec.tsx` records that `textContent` cannot see it.
 *  - Every external check — drift tooling, a11y tooling, find-in-page — needed
 *    a bespoke shadow-piercing walk before the page would yield any text.
 *
 * ## Why dropping it is safe
 *
 * The original reason for the shadow root was to give the editor a ref target
 * for inline editing. That is not load-bearing: an ELEMENT provides the ref,
 * not a shadow root, and the besigner's inline text and markdown editors mount
 * **light-DOM** `contenteditable` halves (`besigner/core` → `text-entry.ts`).
 * Nothing edits inside this element.
 *
 * Layout is unchanged: an unknown element defaults to `display: inline`, which
 * is what the shadow HOST already was, and the host was always in the light
 * tree — only its CONTENT moved.
 *
 * Hydration gets simpler rather than riskier. The old component rendered the
 * text as light DOM on the server and during the first client render, then
 * attached the shadow in a layout effect and re-rendered the same string
 * through a portal; the light copy stopped displaying only because a shadow
 * host without slots hides its children. Now the server output is final — and
 * a page like `/pricing` does 960 fewer `attachShadow` calls and mounts 960
 * fewer portals.
 */
export interface AglynTextProps {
  children?: any
}

export const AglynText = forwardRef<HTMLElement, AglynTextProps>(
  (props, ref) => {
    const { children, ...rest } = props
    // `aglyn-text` is not a registered custom element and never was — there is
    // no `customElements.define` for it anywhere in the repo. React renders an
    // unknown lowercase tag as-is, which is all this needs to be.
    const Tag = 'aglyn-text' as any
    return (
      <Tag ref={ref} {...rest}>
        {children}
      </Tag>
    )
  },
)
AglynText.displayName = 'AglynText'

export default AglynText
