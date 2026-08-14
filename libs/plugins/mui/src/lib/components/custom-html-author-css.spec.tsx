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

import { render } from '@testing-library/react'
import CustomHtml, { sanitizeCustomHtml } from './custom-html'

/**
 * The `<style>` block and the `style` attribute (AGL-1725).
 *
 * The first of the two sinks no source-level control can see. DOMPurify is
 * applied to the `html` attribute only, so the `css` attribute shipped to
 * every visitor of a published page unexamined.
 *
 * Two things were measured against the installed DOMPurify 3.4.13 with this
 * component's exact config, and both are pinned below:
 *
 * - a `<style>` tag inside `html` IS stripped by the tag allowlist, so the
 *   `css` attribute really was the only `<style>` route;
 * - a `style` ATTRIBUTE receives NO CSS filtering whatsoever — the config
 *   comment used to claim it did — so it was a second, undocumented route
 *   to the same egress, and it is shared with the email blocks, where a
 *   remote image in a style attribute is an open-tracking pixel.
 */
describe('custom HTML author CSS (AGL-1725)', () => {
  describe('the css attribute, rendered as a <style> block', () => {
    const styleText = (css: string) => {
      const { container } = render(
        <CustomHtml html="<p>hi</p>" css={css} />,
      )
      return container.querySelector('style')?.textContent ?? ''
    }

    it('refuses an http background-image', () => {
      const out = styleText(
        '.hero{background-image:url(http://attacker.example/beacon.png)}',
      )
      expect(out).toBe('.hero{background-image:url(about:invalid)}')
      expect(out).not.toContain('attacker.example')
    })

    it('leaves an https hotlink alone — the site owner chose that host', () => {
      const css = '.hero{background-image:url(https://images.example/h.jpg)}'
      expect(styleText(css)).toBe(css)
    })

    it('still emits the author’s other declarations untouched', () => {
      expect(
        styleText('.a{color:red}.b{background:url(http://x.example/b.png)}'),
      ).toBe('.a{color:red}.b{background:url(about:invalid)}')
    })
  })

  describe('the style attribute inside the html attribute', () => {
    it('refuses an http url() DOMPurify passes through', () => {
      const out = sanitizeCustomHtml(
        '<p style="background:url(http://attacker.example/b.png)">hi</p>',
      )
      expect(out).toContain('about:invalid')
      expect(out).not.toContain('attacker.example')
    })

    it('refuses url(javascript:…), which DOMPurify also passes through', () => {
      expect(
        sanitizeCustomHtml('<p style="background:url(javascript:alert(1))">x</p>'),
      ).not.toContain('javascript:')
    })

    it('keeps an https url() and every non-url declaration', () => {
      const out = sanitizeCustomHtml(
        '<p style="color:red;background:url(https://ok.example/a.png)">hi</p>',
      )
      expect(out).toContain('color:red')
      expect(out).toContain('https://ok.example/a.png')
    })

    it('leaves markup carrying no style attribute byte-identical', () => {
      expect(sanitizeCustomHtml('<p class="x"><b>hi</b></p>')).toBe(
        '<p class="x"><b>hi</b></p>',
      )
    })
  })

  describe('pinned DOMPurify behaviour the fix depends on', () => {
    it('strips a <style> tag from the html attribute', () => {
      // If this ever flips, the css attribute stops being the only <style>
      // route and the sanitizer needs to filter the tag's text too.
      expect(
        sanitizeCustomHtml(
          '<style>.a{background:url(http://x.example/b.png)}</style><p>hi</p>',
        ),
      ).toBe('<p>hi</p>')
    })
  })
})
