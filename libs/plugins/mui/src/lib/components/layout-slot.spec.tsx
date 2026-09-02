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
import LayoutSlot, { LAYOUT_SLOT_ELEMENTS, schema } from './layout-slot'

/**
 * THE SLOT IS THE PAGE'S CONTENT REGION (AGL-2486).
 *
 * It is the one node in a composed tree that is by construction "everything
 * between the chrome", which is the definition of the `main` landmark —
 * placed there by `stampDocumentLandmark` rather than hardcoded here, so an
 * author who says otherwise is not overruled.
 */
describe('Layout Slot renders the element composition chose (AGL-2486)', () => {
  it('renders a div until something says otherwise', () => {
    // Nothing is assumed at render: an uncomposed preview is not a document.
    render(<LayoutSlot>{'screen'}</LayoutSlot>)
    expect(screen.getByText('screen').tagName).toBe('DIV')
  })

  it('renders each offered element', () => {
    for (const element of LAYOUT_SLOT_ELEMENTS) {
      const { unmount } = render(
        <LayoutSlot element={element}>{element}</LayoutSlot>,
      )
      expect(screen.getByText(element).tagName).toBe(element.toUpperCase())
      unmount()
    }
  })

  it('degrades an unlisted element rather than emitting it', () => {
    render(<LayoutSlot element="script">{'safe'}</LayoutSlot>)
    expect(screen.getByText('safe').tagName).toBe('DIV')
  })

  it('keeps the slot marker attribute the composer keys on', () => {
    const { container } = render(<LayoutSlot element="main">{'x'}</LayoutSlot>)
    expect(container.querySelector('main[data-aglyn-layout-slot]')).toBeTruthy()
  })

  it('offers exactly the elements the renderer accepts', () => {
    const field = (schema.attributes ?? []).find((a) => a.name === 'element')
    const options = (field as unknown as { options: { value: string }[] })
      .options
    expect(options.map((o) => o.value)).toEqual([...LAYOUT_SLOT_ELEMENTS])
  })

  it('is one of the two places `main` may be chosen at all', () => {
    expect(LAYOUT_SLOT_ELEMENTS).toContain('main' as never)
  })
})
