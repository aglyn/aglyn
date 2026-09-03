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

import { schema as appBar } from '../components/app-bar'
import { cardSchema } from '../components/card'
import { schema as container } from '../components/container'
import { schema as grid } from '../components/grid'
import { schema as paper } from '../components/paper'
import { schema as stack } from '../components/stack'
import { schema as toolbar } from '../components/toolbar'
import {
  SEMANTIC_ELEMENTS,
  resolveSemanticElement,
  semanticElementAttribute,
  semanticElementProp,
} from './element-picker'

/**
 * THE ELEMENT PICKER IS NOT SECTION'S ALONE (AGL-2525).
 *
 * `aglyn.com` shipped with no `nav` landmark because the nav links sit in a
 * Stack and only Section could name an element — so saying "this row IS the
 * navigation" meant wrapping it in a second element, which nobody did.
 */
describe('the shared element picker (AGL-2525)', () => {
  it('offers the sectioning elements and never `main`', () => {
    // A page carries exactly one `main`, placed by `stampDocumentLandmark` on
    // the Document layer or the Layout Slot. Everything using this picker can
    // appear many times per page, so an author-selected one is the second.
    expect([...SEMANTIC_ELEMENTS]).toEqual([
      'div',
      'section',
      'article',
      'aside',
      'nav',
      'header',
      'footer',
    ])
    expect(SEMANTIC_ELEMENTS).not.toContain('main')
    expect(resolveSemanticElement('main')).toBeUndefined()
  })

  it('leaves the component default alone when unset or unknown', () => {
    // Returning `div` for "unset" would have stripped App Bar's `header` —
    // MUI's own default — off every site's chrome the moment this shipped.
    expect(semanticElementProp(undefined)).toEqual({})
    expect(semanticElementProp('')).toEqual({})
    expect(semanticElementProp(null)).toEqual({})
    expect(semanticElementProp('script')).toEqual({})
    expect(semanticElementProp('marquee')).toEqual({})
  })

  it('passes an author’s choice through as `component`', () => {
    expect(semanticElementProp('nav')).toEqual({ component: 'nav' })
    expect(semanticElementProp('footer')).toEqual({ component: 'footer' })
  })

  it('is named and labelled `Component`, like every other element picker', () => {
    const field = semanticElementAttribute('this stack') as unknown as {
      name: string
      label: string
      options: { value: string }[]
    }
    expect(field.name).toBe('component')
    expect(field.label).toBe('Component')
    expect(field.options.map((o) => o.value)).toEqual([...SEMANTIC_ELEMENTS])
  })

  it('reaches every container an author groups things with', () => {
    // The point of the issue: one element could name a landmark and the rest
    // had to be wrapped to do it. Each of these is a thing authors put a nav
    // row, a masthead or a footer band inside.
    for (const [name, schema] of [
      ['Stack', stack],
      ['Container', container],
      ['Grid', grid],
      ['Paper', paper],
      ['Card', cardSchema],
      ['Toolbar', toolbar],
      ['App Bar', appBar],
    ] as const) {
      const has = (schema.attributes ?? []).some(
        (attribute) => attribute.name === 'component',
      )
      expect([name, has]).toEqual([name, true])
    }
  })
})
