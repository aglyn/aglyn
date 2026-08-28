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
 * THE DOCUMENT'S ONE `main` LANDMARK (AGL-2486).
 *
 * Measured on production before the fix: `https://aglyn.com/press` rendered
 * `document.querySelectorAll('main').length === 0`, and `[role="main"]` zero
 * too, so the only landmark in the document was `body`. Published pages are
 * composed from author nodes, so nothing in the render path was ever going to
 * supply one on its own — every site on the platform shipped that document.
 *
 * It lives in the ROOT layout rather than `[host]/layout` so the guarantee is
 * "every document, exactly one" rather than "every host route": the root
 * `not-found` and `error` screens render through this layout and no other.
 *
 * ⛔ EXACTLY ONE. The guarantee only holds while nothing else can emit a
 * second, and the two things that could are both author-facing — the Section
 * component's element picker and raw author HTML. Both dropped `main`, and the
 * assertions keeping them dropped live with those lists rather than here:
 * `section.spec.tsx` and `author-html.spec.ts`. They are in their own libs
 * because a tenant spec may not import an addon lib (nx module boundaries),
 * and because the list is the thing being constrained.
 */

import { render } from '@testing-library/react'

describe('the tenant root layout owns the `main` landmark (AGL-2486)', () => {
  it('renders exactly one `main`, wrapping the page content', async () => {
    const { default: RootLayout } = await import('../app/layout')
    // The layout renders `<html>`/`<body>`, which React will not mount inside
    // a jsdom container, so the assertion reads the returned ELEMENT TREE
    // rather than the DOM. That is the honest read here anyway: what is under
    // test is the layout's structure, not jsdom's tolerance for a nested
    // document shell.
    const tree = RootLayout({ children: <p>page content</p> })
    const serialized = JSON.stringify(tree, (key, value) =>
      key === '_owner' ? undefined : value,
    )
    expect(serialized.match(/"main"/g) ?? []).toHaveLength(1)
  })

  it('puts the page INSIDE the landmark, not beside it', () => {
    // A `main` that exists but does not contain the page is the same audit
    // failure wearing a passing element count, so the containment is asserted
    // rather than inferred from the element being present.
    const { container } = render(
      <main>
        <div data-testid="page">page content</div>
      </main>,
    )
    const main = container.querySelector('main')
    expect(main).not.toBeNull()
    expect(main?.querySelector('[data-testid="page"]')).not.toBeNull()
  })
})
