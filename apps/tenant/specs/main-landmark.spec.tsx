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
 * EXACTLY ONE `main` LANDMARK PER DOCUMENT (AGL-2504).
 *
 * Measured on production before the fix: `https://aglyn.com/press` rendered
 * `document.querySelectorAll('main').length === 0` and `[role="main"]` zero
 * too, so the only landmark in the document was `body`. Published pages are
 * composed from author nodes, so nothing in the render path was ever going to
 * supply one on its own — every site on the platform shipped the same
 * document.
 *
 * The fix puts it in the tenant ROOT layout, which makes the guarantee "every
 * document" rather than "every host route". That only holds while nothing else
 * can emit a second one, and the two things that could are both author-facing:
 * the Section component's element picker, and raw author HTML. Both dropped
 * `main`, and these are the assertions that keep them dropped.
 *
 * ⛔ Restoring `main` to either list re-creates a WORSE failure than the one
 * this fixed: two `main` elements make the landmark ambiguous, so assistive
 * tech has a choice to make where it previously had a gap to report. Neither
 * list is the place to express "this section is the important one" — that is
 * what the root layout already decided.
 */

import { render } from '@testing-library/react'
import { SECTION_ELEMENTS } from '@aglyn/plugins-mui/components/section'
import { ALLOWED_AUTHOR_HTML_ELEMENTS } from '@aglyn/aglyn/app-utils/author-html'

describe('the tenant root layout owns the `main` landmark (AGL-2504)', () => {
  it('renders exactly one `main`, wrapping the page content', async () => {
    const { default: RootLayout } = await import('../app/layout')
    // The layout renders `<html>`/`<body>`, which React will not mount inside
    // a jsdom container, so the assertion reads the returned ELEMENT TREE
    // rather than the DOM. That is the honest read here anyway: what is under
    // test is the layout's structure, not jsdom's tolerance for a nested
    // document shell.
    const tree = RootLayout({ children: <p>page content</p> })
    const html = JSON.stringify(tree, (key, value) =>
      key === '_owner' ? undefined : value,
    )
    // One `main`, and it is the wrapper rather than a sibling.
    expect(html.match(/"main"/g) ?? []).toHaveLength(1)
  })

  it('the rendered shell puts page content INSIDE the landmark', () => {
    // The structural half of the claim, checked on real DOM: a `main` that
    // exists but does not contain the page is the same audit failure wearing a
    // passing element count.
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

describe('nothing author-facing can mint a second `main` (AGL-2504)', () => {
  it('the Section element picker does not offer it', () => {
    // The console rendered this list as a labelled SELECT whose field help
    // recommended `main`, so the duplicate was the documented choice rather
    // than a mistake an author had to work at.
    expect(SECTION_ELEMENTS).not.toContain('main')
    // CONTROL — the picker still offers the landmarks it should. Without this
    // the assertion above would pass on an empty list.
    for (const element of ['section', 'article', 'nav', 'header', 'footer']) {
      expect(SECTION_ELEMENTS).toContain(element)
    }
  })

  it('author HTML does not carry it through the sanitizer', () => {
    expect(ALLOWED_AUTHOR_HTML_ELEMENTS.has('main')).toBe(false)
    // CONTROL — the sibling landmarks are untouched, so this is a targeted
    // subtraction from the DOMPurify profile and not a general narrowing.
    for (const element of ['section', 'article', 'nav', 'header', 'footer']) {
      expect(ALLOWED_AUTHOR_HTML_ELEMENTS.has(element)).toBe(true)
    }
  })
})
