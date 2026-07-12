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

import {
  renderEmailHtml,
  substituteMergeTokens,
} from './email-render'

const NODES = {
  root: { componentId: 'div', nodes: ['section'] },
  section: {
    componentId: 'emailSection',
    props: { backgroundColor: '#ffffff', padding: 20 },
    nodes: ['text', 'button', 'product', 'spacer'],
  },
  text: {
    componentId: 'emailText',
    props: { children: 'Hi {{contact.firstName}},', variant: 'heading' },
  },
  button: {
    componentId: 'emailButton',
    props: { children: 'Shop', href: 'https://x.test/shop' },
  },
  product: {
    componentId: 'emailProduct',
    props: { productId: 'p1' },
  },
  spacer: { componentId: 'emailSpacer', props: { height: 32 } },
}

describe('substituteMergeTokens', () => {
  it('substitutes known tokens and keeps unknown ones visible', () => {
    expect(
      substituteMergeTokens('Hi {{contact.firstName}} {{nope}}', {
        'contact.firstName': 'Sam',
      }),
    ).toBe('Hi Sam {{nope}}')
  })
})

describe('renderEmailHtml', () => {
  it('renders table HTML with merge values and product data', () => {
    const { html, text } = renderEmailHtml({
      nodes: NODES as any,
      subject: 'Hello',
      preheader: 'Preview line',
      merge: { 'contact.firstName': 'Sam' },
      products: {
        p1: {
          name: 'Widget',
          priceLabel: '$29',
          url: 'https://x.test/products/widget',
        },
      },
    })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Hi Sam,')
    expect(html).toContain('https://x.test/shop')
    expect(html).toContain('Widget')
    expect(html).toContain('$29')
    expect(html).toContain('Preview line')
    expect(html).toContain('height:32px')
    // Table layout, not divs-with-flex.
    expect(html).toContain('role="presentation"')
    // Plain-text alternative captures the content.
    expect(text).toContain('Hi Sam,')
    expect(text).toContain('Widget — $29')
  })

  it('escapes user text and skips unresolvable products', () => {
    const { html } = renderEmailHtml({
      nodes: {
        root: { componentId: 'div', nodes: ['t', 'p'] },
        t: {
          componentId: 'emailText',
          props: { children: '<script>alert(1)</script>' },
        },
        p: { componentId: 'emailProduct', props: { productId: 'gone' } },
      } as any,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('sanitizes richtext through the provided sanitizer', () => {
    const { html } = renderEmailHtml({
      nodes: {
        root: { componentId: 'div', nodes: ['r'] },
        r: {
          componentId: 'emailRichtext',
          props: { html: '<p onclick="x()">hey</p>' },
        },
      } as any,
      sanitize: (value) => value.replace(/ onclick="[^"]*"/g, ''),
    })
    expect(html).toContain('<p>hey</p>')
    expect(html).not.toContain('onclick')
  })

  it('renders children of unknown components instead of dropping them', () => {
    const { html } = renderEmailHtml({
      nodes: {
        root: { componentId: 'div', nodes: ['stack'] },
        stack: { componentId: 'muiStack', nodes: ['t'] },
        t: { componentId: 'emailText', props: { children: 'inside' } },
      } as any,
    })
    expect(html).toContain('inside')
  })
})
