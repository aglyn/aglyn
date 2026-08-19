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
 * Published-site email fields must have an accessible NAME (AGL-2392).
 *
 * Found on the live marketing site 2026-08-19: the subscribe block at the
 * foot of `aglyn.com/blog` renders
 *
 *   <input type="email" placeholder="you@example.com" id="_R_…">
 *
 * with no `<label>`, no `aria-label` and no `aria-labelledby`. The "Get
 * product updates" line above it is a `subtitle1` Typography — a heading in
 * appearance only, associated with nothing. So the one conversion field on
 * the blog is nameless to assistive tech (WCAG 2.1 SC 4.1.2).
 *
 * The placeholder is not a substitute and that is the trap worth naming: it
 * LOOKS like a label in a screenshot, several ATs do announce it, and it
 * disappears as soon as the visitor types — so the field a user returns to
 * after a validation error has no visible name at all.
 *
 * `getByRole('textbox', { name })` is used deliberately rather than
 * `getByPlaceholderText`: it asks the accessibility tree the same question a
 * screen reader asks, so a future edit that drops the name back onto the
 * placeholder fails here instead of passing.
 */

import { render, screen } from '@testing-library/react'
import NewsletterSignup from './newsletter-signup'

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => async () => ({ ok: true, json: async () => ({}) }),
}))

describe('the newsletter block names its email field (AGL-2392)', () => {
  it('exposes it to the accessibility tree by name', () => {
    render(<NewsletterSignup heading="Get product updates" />)

    expect(
      screen.getByRole('textbox', { name: 'Email address' }),
    ).toBeTruthy()
  })

  it('names it even with no heading authored at all', () => {
    // `heading` is optional, so the block's WORST case is the one with no
    // surrounding text whatsoever — that is the case the name has to cover.
    render(<NewsletterSignup />)

    expect(
      screen.getByRole('textbox', { name: 'Email address' }),
    ).toBeTruthy()
  })

  it('does not let the placeholder stand in for the name', () => {
    // Negative control. Before the fix this query matched (the placeholder
    // was all there was); it must not match now, because a name sourced from
    // the placeholder is the exact defect being closed.
    render(<NewsletterSignup heading="Get product updates" />)

    expect(
      screen.queryByRole('textbox', { name: 'you@example.com' }),
    ).toBeNull()
  })
})

/**
 * The same defect was found in two more places while fixing this one, and
 * both are fixed in the same pass rather than filed:
 *
 *  - `product-detail.tsx` — the sold-out "notify me" field. Named
 *    "Email address for back-in-stock alert" rather than "Email address",
 *    because a product page can carry the newsletter block too and two
 *    textboxes with one name is barely better than none. Not asserted here:
 *    the component resolves its product over the network before it renders
 *    anything but a Skeleton, so covering it honestly needs the storefront
 *    fetch harness rather than this file's plain render.
 *  - `libs/plugins/marketing/.../site-runtime.tsx` — the email-capture
 *    popup's raw `<input>`. Asserted in that library's own spec, beside the
 *    popup harness that already exists there.
 */
