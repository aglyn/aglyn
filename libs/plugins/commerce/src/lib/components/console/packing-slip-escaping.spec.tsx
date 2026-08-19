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
 * AGL-2283. The packing slip is built by hand and written into a
 * `window.open('')` popup with `document.write`. React guards nothing here
 * because none of it is React, and the popup is an `about:blank` document that
 * INHERITS the console's origin — so script written into it runs against the
 * merchant's own authenticated session.
 *
 * `order.shippingAddress` is the input that makes this reachable by a stranger:
 * `billing-webhook.ts` copies it verbatim from Stripe's `shipping_details`,
 * which a SHOPPER types at checkout.
 *
 * ## Why this is a SOURCE guard and not a render test
 *
 * Mounting the dialog to reach one callback would need MUI, Firestore hooks, a
 * confirmation context and a `window.open` stub — a wholesale `jest.mock` tree,
 * which this repo has repeatedly found to be a closed world that manufactures
 * its own failures. And a spec that rebuilt the slip expression locally would
 * be worse than useless: it would stay green while someone deleted every
 * `escapeHtml` from the component, because it would be testing its own copy.
 *
 * So the escaper is unit-tested, and the CALL SITES are asserted against the
 * files on disk. Deleting an `escapeHtml` from either `document.write` fails
 * this file, which is the property that matters.
 */

import { escapeHtml } from '../../utils/escape-html'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('escapeHtml', () => {
  it('neutralises every character that can open a tag or an attribute', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    )
    expect(escapeHtml("it's & so")).toBe('it&#39;s &amp; so')
  })

  it('escapes the ampersand FIRST, so an escape cannot be double-escaped', () => {
    // `&lt;` must not become `&amp;lt;` — a single pass over the source string
    // is what guarantees it, and this pins the ordering rather than the code.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
    expect(escapeHtml('<')).toBe('&lt;')
  })

  it('coerces rather than throwing on the optional fields it reads', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(3)).toBe('3')
  })
})

/**
 * The two `document.write` call sites, asserted against the files on disk.
 *
 * Read through `readFileSync` on an explicit path rather than by walking the
 * tree: the check must name exactly the files it means, and a walk that found
 * nothing would pass silently.
 */
describe('the document.write call sites (AGL-2283)', () => {
  /**
   * The `document.write(...)` argument, whitespace-collapsed.
   *
   * Scoped to that region because both files mention `line.name` elsewhere in
   * ordinary JSX, where React escapes it and there is nothing to fix — a
   * whole-file grep would have reported the receipt as unescaped for a reason
   * that has nothing to do with this. Collapsed because prettier wraps these
   * template literals across lines, so the source text of one interpolation is
   * not a contiguous string.
   */
  const writeArgument = (relative: string) => {
    const source = readFileSync(join(__dirname, relative), 'utf8')
    const from = source.indexOf('win.document.write(')
    const to = source.indexOf('win.document.close()', from)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    return source.slice(from, to).replace(/\s+/g, '')
  }

  const SLIP = 'order-detail-dialog.component.tsx'
  const RECEIPT = 'pos-page.component.tsx'

  it('the packing slip escapes every value it interpolates', () => {
    // The rows are built above the `write` call, so they are checked on the
    // whole file — but by their escaped FORM, which no other line carries.
    const source = readFileSync(join(__dirname, SLIP), 'utf8').replace(
      /\s+/g,
      '',
    )
    // Matched by REGEX with an optional trailing comma: prettier wraps these
    // template literals, and whether the argument ends `line.name)` or
    // `line.name,)` is a formatting decision this guard must not pin.
    expect(source).toMatch(/escapeHtml\(line\.name,?\)/)
    expect(source).toMatch(/escapeHtml\(line\.variantLabel,?\)/)
    expect(source).toMatch(/escapeHtml\(line\.sku\?\?'',?\)/)
    expect(source).not.toContain('<td>${line.name}')
    expect(source).not.toContain("<td>${line.sku??''}</td>")

    // The shopper-typed one, and the reason this is a security fix rather
    // than a tidy-up.
    const written = writeArgument(SLIP)
    expect(written).toContain('.map((part)=>escapeHtml(part))')
    expect(written).not.toContain(".filter(Boolean).join('<br/>')")
  })

  it('the POS receipt escapes the product text it interpolates', () => {
    const written = writeArgument(RECEIPT)
    expect(written).toMatch(/escapeHtml\(line\.name,?\)/)
    expect(written).toMatch(/escapeHtml\(line\.variantLabel,?\)/)
    expect(written).not.toContain('${line.name}')
    expect(written).not.toContain('${line.variantLabel}')
  })

  /**
   * POSITIVE CONTROL for the guard itself. If a path were wrong or a slice
   * empty, every `not.toContain` above would pass vacuously — that is what a
   * check which cannot fail looks like.
   */
  it('POSITIVE CONTROL: it is really reading those two write calls', () => {
    expect(writeArgument(SLIP)).toContain('Packingslip')
    expect(writeArgument(SLIP).length).toBeGreaterThan(200)
    expect(writeArgument(RECEIPT)).toContain('TOTAL')
    expect(writeArgument(RECEIPT).length).toBeGreaterThan(200)
  })
})
