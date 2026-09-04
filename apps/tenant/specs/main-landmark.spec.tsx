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
 * Measured on production before it existed: `https://aglyn.com/press` rendered
 * `document.querySelectorAll('main').length === 0`, so the only landmark in
 * the document was `body`. It was added as a wrapper in the ROOT layout, which
 * guaranteed one per document and put the site nav and the site footer inside
 * it — the one thing `main` is defined as excluding, and the reason a "skip to
 * content" link would land at the top of the chrome it was meant to skip.
 *
 * So the landmark moved to the region it names. `stampDocumentLandmark` picks
 * the node — the layout's slot, the screen root without a layout, or whichever
 * one an author's element picker claimed — and this file asserts the two ends
 * of that: the root layout no longer emits one, and the screens that compose
 * no author nodes still carry their own.
 *
 * ⛔ EXACTLY ONE. The guarantee holds while nothing else can emit a second,
 * and the assertions keeping the two author-facing routes closed live with the
 * lists they constrain: `section.spec.tsx` and `author-html.spec.ts`. The
 * placement rule itself is unit-tested in `document-landmark.spec.ts`.
 */

import { render } from '@testing-library/react'
import StatusScreenPlain from '@aglyn/shared-ui-jsx/components/status-screen-plain.component'

describe('the `main` landmark sits on the page, not around it (AGL-2486)', () => {
  it('is no longer a wrapper in the root layout', async () => {
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
    expect(serialized.match(/"main"/g) ?? []).toHaveLength(0)
  })

  it('still renders the page, now unwrapped', async () => {
    // Removing the wrapper must not take the children with it.
    const { default: RootLayout } = await import('../app/layout')
    const serialized = JSON.stringify(
      RootLayout({ children: <p>page content</p> }),
      (key, value) => (key === '_owner' ? undefined : value),
    )
    expect(serialized).toContain('page content')
  })

  it('is carried by the boundary screens, which compose no author nodes', () => {
    // The root error and not-found boundaries render this and nothing else,
    // so without one here those documents would be the only pages on the
    // platform with no landmark at all.
    const { container } = render(
      <StatusScreenPlain
        code="404"
        title="We can’t find that page"
        message="The link may be out of date."
      />,
    )
    const mains = container.querySelectorAll('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]?.textContent).toContain('We can’t find that page')
  })
})
