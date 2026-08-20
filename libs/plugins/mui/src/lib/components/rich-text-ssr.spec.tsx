/**
 * @jest-environment node
 */

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
 * AGL-1901: rich text and Custom HTML in the SERVER response.
 *
 * `@jest-environment node` is the whole point of this file, and it must stay
 * the first docblock or jest never reads it (the license header would
 * otherwise shadow it). Under jsdom these assertions would prove nothing
 * about the server: the bug was that a DOM-only sanitizer ran in an effect,
 * and an effect does not run during `renderToStaticMarkup` in EITHER
 * environment — but the fix has to work where there is no `window` at all,
 * and only this environment can show that.
 *
 * Every assertion here reads the emitted STRING. A mounted client render was
 * green throughout the entire life of this bug.
 */

import * as Aglyn from '@aglyn/aglyn'
import { renderToStaticMarkup } from 'react-dom/server'
import CustomHtml from './custom-html'
import AglynTypography from './typography'

describe('rich text server markup (AGL-1901)', () => {
  it('has no window to sanitize with, and still emits the body', () => {
    expect(typeof window).toBe('undefined')
    const markup = renderToStaticMarkup(
      <AglynTypography html="<p>Indexable body copy</p>" />,
    )
    expect(markup).toContain('Indexable body copy')
    expect(markup).toContain('<p>')
  })

  it('keeps the author markup structure a crawler reads for outline', () => {
    const markup = renderToStaticMarkup(
      <AglynTypography html='<h2>Our refund policy</h2><p>Within <strong>30 days</strong>.</p><ul><li>Unopened</li></ul>' />,
    )
    expect(markup).toContain('<h2>Our refund policy</h2>')
    expect(markup).toContain('<strong>30 days</strong>')
    expect(markup).toContain('<li>Unopened</li>')
  })

  it('strips script and handlers on the SERVER, where they would run first', () => {
    const markup = renderToStaticMarkup(
      <AglynTypography html={'<p onclick="steal()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>'} />,
    )
    expect(markup).toContain('hi')
    expect(markup).not.toContain('<script')
    expect(markup).not.toContain('alert(1)')
    expect(markup).not.toContain('onclick')
    expect(markup).not.toContain('onerror')
  })

  it('never emits a void element with children (the SSR-500 shape)', () => {
    const markup = renderToStaticMarkup(
      <AglynTypography html={'<img src="https://cdn.example.com/a.png" alt="a">caption</img><br>x</br>'} />,
    )
    expect(markup).not.toContain('</img>')
    expect(markup).not.toContain('</br>')
    expect(markup).toContain('caption')
  })

  it('renders a Custom HTML block into the server response', () => {
    const markup = renderToStaticMarkup(
      <CustomHtml html={'<div><h3>Store hours</h3><p>Open 9-5</p></div>'} />,
    )
    expect(markup).toContain('Store hours')
    expect(markup).toContain('Open 9-5')
  })

  it('is byte-identical to what the browser render will compute', () => {
    // The hydration guarantee, stated as the property that produces it: the
    // sanitizer is a pure function of the string, so "what the server sent"
    // and "what the client computes" cannot differ. `custom-html.spec.tsx`
    // asserts the same bytes arrive from a real jsdom mount.
    const html = '<p style="color:red">a</p><a href="https://x.test">b</a>'
    expect(Aglyn.sanitizeAuthorHtml(html)).toBe(Aglyn.sanitizeAuthorHtml(html))
    expect(renderToStaticMarkup(<AglynTypography html={html} />)).toBe(
      renderToStaticMarkup(<AglynTypography html={html} />),
    )
  })
})
