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

import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const mockAddElement = jest.fn()
jest.mock('../hooks/use-add-element-drawer-callback', () => ({
  useAddElementDrawerCallback: () => mockAddElement,
}))

import { EmptyDocumentSlot } from './empty-document-slot'

describe('EmptyDocumentSlot (AGL-1246)', () => {
  beforeEach(() => mockAddElement.mockReset())

  it('renders a labelled, clickable region', () => {
    render(<EmptyDocumentSlot />)
    const region = screen.getByRole('button')
    expect(region.hasAttribute('data-aglyn-empty-document')).toBe(true)
    expect(region.textContent).toContain('This screen is empty')
    expect(region.textContent).toContain('Drag an element here')
  })

  it('opens the drawer with NO parent, so it resolves to the document root', () => {
    // Passing a parent here would insert into whatever was last selected —
    // the whole point is that an empty document has only one valid target.
    render(<EmptyDocumentSlot />)
    fireEvent.click(screen.getByRole('button'))
    expect(mockAddElement).toHaveBeenCalledTimes(1)
    expect(mockAddElement).toHaveBeenCalledWith()
  })

  it('is reachable from the keyboard', () => {
    render(<EmptyDocumentSlot />)
    const region = screen.getByRole('button')
    expect(region.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(region, { key: 'Enter' })
    fireEvent.keyDown(region, { key: ' ' })
    fireEvent.keyDown(region, { key: 'a' })
    expect(mockAddElement).toHaveBeenCalledTimes(2)
  })
})
