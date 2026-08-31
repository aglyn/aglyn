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

import { hasSafeLinkScheme, hasSafeMediaScheme } from './safe-url-scheme'

describe('hasSafeLinkScheme', () => {
  it('allows the schemes a link is actually written in', () => {
    // The control. A guard that refuses everything passes every refusal test
    // in this file and breaks every link in the product.
    expect(hasSafeLinkScheme('https://acme.test/sale?utm=spring&a=1')).toBe(true)
    expect(hasSafeLinkScheme('http://acme.test/sale')).toBe(true)
    expect(hasSafeLinkScheme('mailto:hi@acme.test')).toBe(true)
    expect(hasSafeLinkScheme('tel:+15125550100')).toBe(true)
    expect(hasSafeLinkScheme('sms:+15125550100')).toBe(true)
  })

  it('allows a value that names no scheme at all', () => {
    expect(hasSafeLinkScheme('/products/widget')).toBe(true)
    expect(hasSafeLinkScheme('#unsubscribe')).toBe(true)
    expect(hasSafeLinkScheme('?page=2')).toBe(true)
    expect(hasSafeLinkScheme('//cdn.acme.test/x')).toBe(true)
    expect(hasSafeLinkScheme('')).toBe(true)
  })

  it('refuses javascript: however it is spelled', () => {
    expect(hasSafeLinkScheme('javascript:alert(1)')).toBe(false)
    expect(hasSafeLinkScheme('JaVaScRiPt:alert(1)')).toBe(false)
    // Browsers strip C0 controls and spaces while resolving a scheme, so all
    // of these navigate. A check that reads raw characters sees none of them.
    expect(hasSafeLinkScheme('java\tscript:alert(1)')).toBe(false)
    expect(hasSafeLinkScheme('java\nscript:alert(1)')).toBe(false)
    expect(hasSafeLinkScheme('java\rscript:alert(1)')).toBe(false)
    expect(hasSafeLinkScheme('  javascript:alert(1)')).toBe(false)
    expect(hasSafeLinkScheme('\x00javascript:alert(1)')).toBe(false)
  })

  it('refuses the other script-bearing and unknown schemes', () => {
    expect(hasSafeLinkScheme('vbscript:msgbox(1)')).toBe(false)
    expect(hasSafeLinkScheme('file:///etc/passwd')).toBe(false)
    expect(hasSafeLinkScheme('ftp://acme.test/x')).toBe(false)
    // Refused by construction — the allowlist is the rule, not a denylist.
    expect(hasSafeLinkScheme('someschemenobodyinvented:x')).toBe(false)
  })

  it('refuses a data: href deliberately, whatever the payload claims', () => {
    // A data: href is a document the reader navigates INTO. text/html is the
    // obvious vector; the raster form is refused too, because an href is not
    // a place a picture goes and allowing it only widens the parsing surface.
    expect(hasSafeLinkScheme('data:text/html,<script>alert(1)</script>')).toBe(
      false,
    )
    expect(hasSafeLinkScheme('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(hasSafeLinkScheme('data:image/svg+xml,<svg onload="x()"/>')).toBe(
      false,
    )
  })

  it('refuses a non-string rather than throwing', () => {
    expect(hasSafeLinkScheme(null)).toBe(false)
    expect(hasSafeLinkScheme(undefined)).toBe(false)
  })
})

describe('hasSafeMediaScheme', () => {
  it('allows what an inbox or a page can fetch', () => {
    expect(hasSafeMediaScheme('https://cdn.acme.test/hero.png')).toBe(true)
    expect(hasSafeMediaScheme('http://cdn.acme.test/hero.png')).toBe(true)
    expect(hasSafeMediaScheme('/api/media/cdn/h1/med9')).toBe(true)
    expect(hasSafeMediaScheme('//cdn.acme.test/hero.png')).toBe(true)
  })

  it('is narrower than a link: no mailto, tel or sms in a src', () => {
    expect(hasSafeMediaScheme('mailto:hi@acme.test')).toBe(false)
    expect(hasSafeMediaScheme('tel:+15125550100')).toBe(false)
    expect(hasSafeMediaScheme('sms:+15125550100')).toBe(false)
  })

  it('refuses javascript: and data: in a src', () => {
    expect(hasSafeMediaScheme('javascript:alert(1)')).toBe(false)
    expect(hasSafeMediaScheme('java\tscript:alert(1)')).toBe(false)
    expect(hasSafeMediaScheme('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(hasSafeMediaScheme('data:image/svg+xml,<svg onload="x()"/>')).toBe(
      false,
    )
  })
})
