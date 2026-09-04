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
import { AglynText } from '@aglyn/shared-ui-jsx'
import type { ReactNode } from 'react'

/**
 * The formatted label of a CONTROL — a Button, a Screen Link, an Accordion
 * Summary (AGL-2557).
 *
 * ## The three parts that have to travel together
 *
 * The inline editor's rich mode commits sanitized markup into an `html` prop
 * and keeps `children` as the plain-text fallback. Until this existed,
 * `typography.tsx` was the only component that read `html` back, so setting
 * the editor's flag anywhere else would have shipped a toolbar whose output
 * was discarded: bold while typing, plain the moment it committed. A
 * component earns the flag by declaring the prop, rendering it through here,
 * and only then turning the flag on.
 *
 * ## Sanitized on EVERY render (AGL-497)
 *
 * The editor sanitizes at commit, and that is not where the guarantee comes
 * from. Screen node props are written straight through the Firebase client
 * SDK, so a host editor can plant arbitrary `html` on a node without the
 * editor ever seeing it — and it would then execute on the published site
 * AND on the besigner canvas at app.aglyn.com. `sanitizeAuthorHtml` is pure
 * and needs no DOM (AGL-1901), so the server and the first client render
 * compute the same bytes and hydration is clean by construction.
 *
 * ## Why the narrowed allowlist
 *
 * A control's content model is phrasing content with no interactive
 * descendant, so this passes {@link Aglyn.INLINE_AUTHOR_HTML_ELEMENTS}: no
 * lists, no blocks, no nested anchor. That is a rendering requirement, not a
 * tidiness one — the parser closes a `<button>` on a `<div>` start tag and
 * promotes the rest to a sibling, which is a React hydration mismatch on the
 * tenant. The toolbar declines to OFFER those commands for these components
 * (`richTextCommands`), and this is what holds the line for markup that
 * arrived some other way.
 *
 * ## Why `<aglyn-text>` and not a `<span>`
 *
 * The canvas edits a leaf's own `<aglyn-text>` when it renders one, and
 * falls back to the leaf root otherwise (AGL-2556). For a composite like
 * Accordion Summary the root is the `<button>`, and in-place editing EMPTIES
 * whatever it is handed — which would take MUI's content wrapper, and its
 * `textAlign: 'start'`, with it for the length of the edit. Rendering the
 * formatted label into the same element the plain label uses keeps one edit
 * target for both modes.
 */
export function authorHtmlLabel(html: unknown): ReactNode | null {
  if (typeof html !== 'string' || !html) return null
  return (
    <AglynText
      dangerouslySetInnerHTML={{
        __html: Aglyn.sanitizeAuthorHtml(html, undefined, {
          allowedElements: Aglyn.INLINE_AUTHOR_HTML_ELEMENTS,
        }),
      }}
    />
  )
}

/**
 * `props` with the formatted label substituted for its children, or `props`
 * itself when the node carries no `html`.
 *
 * Returned BY IDENTITY in the unformatted case, which is the overwhelmingly
 * common one — a Screen Link is the busiest element on a published page at
 * 70–77 nodes — so an element nobody has formatted allocates nothing and
 * renders the tree it always did.
 */
export function withAuthorHtmlLabel<P extends object>(
  props: P,
  html: unknown,
): P {
  const label = authorHtmlLabel(html)
  return label ? ({ ...props, children: label } as P) : props
}
