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

import { render, screen } from '@testing-library/react'
import Section, { SECTION_ELEMENTS, schema } from './section'

describe('Section renders the element the author chose (AGL-336)', () => {
  it('defaults to `section` when no element is given', () => {
    render(<Section>{'body'}</Section>)
    expect(screen.getByText('body').tagName).toBe('SECTION')
  })

  it('renders each offered element', () => {
    for (const element of SECTION_ELEMENTS) {
      const { unmount } = render(<Section element={element}>{element}</Section>)
      expect(screen.getByText(element).tagName).toBe(element.toUpperCase())
      unmount()
    }
  })

  it('offers exactly the elements the renderer accepts', () => {
    // A picker offering a value the resolver silently rewrites is a field that
    // lies to the author about what they chose.
    const field = schema.attributes.find((a) => a.name === 'element')
    const options = (field as unknown as { options: { value: string }[] })
      .options
    expect(options.map((o) => o.value)).toEqual([...SECTION_ELEMENTS])
  })
})

/**
 * `main` IS NOT AN ELEMENT AN AUTHOR MAY PICK (AGL-2486).
 *
 * A published page carries exactly one `main` landmark, placed by composition
 * on the page's content region — the layout slot, or the screen root when
 * there is no layout. A `main` chosen on a grouping container that may appear
 * any number of times per page could only ever be the SECOND one, and two
 * `main` elements is a worse accessibility outcome than none, because the
 * landmark stops naming anything in particular. It was offered in this select
 * with field help recommending it, which made the duplicate the documented
 * choice rather than a mistake an author had to work at.
 *
 * ⛔ Restoring it to `SECTION_ELEMENTS` re-opens that, silently and
 * platform-wide: nothing at render time can see the page's landmark to refuse
 * a competing one.
 */
describe('the Section picker cannot mint a second `main` (AGL-2486)', () => {
  it('does not offer `main`', () => {
    expect(SECTION_ELEMENTS).not.toContain('main' as never)
    // CONTROL — the picker still offers the landmarks it should, so this reads
    // as a targeted subtraction rather than passing on an empty list.
    for (const element of ['section', 'article', 'aside', 'nav', 'header', 'footer']) {
      expect(SECTION_ELEMENTS).toContain(element as never)
    }
  })

  it('DEGRADES a stored `element: "main"` to `section` rather than breaking', () => {
    // Published screens authored while `main` was on offer still carry it, and
    // they must keep rendering. The resolver falls back for any unlisted value,
    // so the node stays where the author put it and stops competing with the
    // page's landmark.
    render(<Section element={'main' as never}>{'legacy'}</Section>)
    expect(screen.getByText('legacy').tagName).toBe('SECTION')
  })
})
