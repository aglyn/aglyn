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

import { beginInPlaceEdit, findLeafTextElement } from './in-place-edit-surface'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host.firstElementChild as HTMLElement
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('findLeafTextElement', () => {
  /**
   * The Accordion Summary shape (AGL-2556): MUI's content div is what
   * carries `textAlign: 'start'`, so an edit that empties the button loses
   * it and the UA stylesheet centres the label. Anchoring on the text keeps
   * the div — and the chevron — for the duration.
   */
  it('finds the text inside a composite, not the composite root', () => {
    const root = mount(
      `<button data-aglyn="leaf:sum1">
         <div class="MuiAccordionSummary-content">
           <aglyn-text>Can I import my Webflow site?</aglyn-text>
         </div>
         <div class="MuiAccordionSummary-expandIconWrapper"></div>
       </button>`,
    )

    const text = findLeafTextElement(root)

    expect(text?.tagName.toLowerCase()).toBe('aglyn-text')
    expect(text?.textContent).toBe('Can I import my Webflow site?')
  })

  /**
   * A child node rendered into this one's slot brings its own
   * `<aglyn-text>`. Editing it would commit THIS node's props over someone
   * else's text, so the leaf stamp scopes the search.
   */
  it('ignores text belonging to a child node', () => {
    const root = mount(
      `<div data-aglyn="leaf:parent">
         <p data-aglyn="leaf:child"><aglyn-text>child copy</aglyn-text></p>
       </div>`,
    )

    expect(findLeafTextElement(root)).toBeUndefined()
  })

  it('takes its own text even when a child node is rendered first', () => {
    const root = mount(
      `<div data-aglyn="leaf:parent">
         <p data-aglyn="leaf:child"><aglyn-text>child copy</aglyn-text></p>
         <aglyn-text>own copy</aglyn-text>
       </div>`,
    )

    expect(findLeafTextElement(root)?.textContent).toBe('own copy')
  })

  it('has nothing to offer for a leaf that renders no text wrapper', () => {
    expect(findLeafTextElement(mount('<img data-aglyn="leaf:i1" />'))).toBeUndefined()
    expect(findLeafTextElement(null)).toBeUndefined()
  })
})

describe('beginInPlaceEdit on the resolved text element', () => {
  /**
   * The whole point of resolving the text first: everything the component
   * built around it is still standing while the author types.
   */
  it('leaves the composite chrome standing', () => {
    const root = mount(
      `<button data-aglyn="leaf:sum1">
         <div class="MuiAccordionSummary-content">
           <aglyn-text>Question?</aglyn-text>
         </div>
         <div class="MuiAccordionSummary-expandIconWrapper"></div>
       </button>`,
    )
    const target = findLeafTextElement(root)!

    const surface = beginInPlaceEdit(target, (el) => {
      el.appendChild(el.ownerDocument.createTextNode('Question?'))
    })

    expect(surface).toBeDefined()
    expect(root.querySelector('.MuiAccordionSummary-content')).not.toBeNull()
    expect(
      root.querySelector('.MuiAccordionSummary-expandIconWrapper'),
    ).not.toBeNull()
    expect(target.getAttribute('contenteditable')).toBe('true')

    surface!.dispose()
    expect(target.getAttribute('contenteditable')).toBeNull()
    expect(target.textContent).toBe('Question?')
  })
})
