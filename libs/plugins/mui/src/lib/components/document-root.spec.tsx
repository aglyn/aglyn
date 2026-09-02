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

import * as Aglyn from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import DocumentRoot, { DOCUMENT_ROOT_ELEMENTS, ID, schema } from './document-root'

/**
 * THE `Document` LAYER IS A NODE LIKE ANY OTHER (AGL-2486).
 *
 * Nothing was registered under the canvas root's component id, so the renderer
 * fell through to its unstyled `div` fallback and the attributes panel had no
 * schema to draw. The root could be styled and could not be told what element
 * to be — which is how the page's `main` landmark ended up being a wrapper in
 * the framework layout instead.
 */
describe('the document root (AGL-2486)', () => {
  it('registers under the persisted canvas root component id', () => {
    // Stored in every screen and layout document since the first seed.
    expect(ID).toBe('div')
    expect(schema.$id).toBe('div')
  })

  it('renders a plain div by default — the shape every stored root has', () => {
    render(<DocumentRoot>{'page'}</DocumentRoot>)
    expect(screen.getByText('page').tagName).toBe('DIV')
  })

  it('renders each offered element', () => {
    for (const element of DOCUMENT_ROOT_ELEMENTS) {
      const { unmount } = render(
        <DocumentRoot element={element}>{element}</DocumentRoot>,
      )
      expect(screen.getByText(element).tagName).toBe(element.toUpperCase())
      unmount()
    }
  })

  it('degrades an unlisted element rather than emitting it', () => {
    // The value is persisted and rendered verbatim, so anything but an
    // allow-list would put `script` into every visitor's page.
    render(<DocumentRoot element="script">{'safe'}</DocumentRoot>)
    expect(screen.getByText('safe').tagName).toBe('DIV')
  })

  it('offers exactly the elements the renderer accepts', () => {
    const field = (schema.attributes ?? []).find((a) => a.name === 'element')
    const options = (field as unknown as { options: { value: string }[] })
      .options
    expect(options.map((o) => o.value)).toEqual([...DOCUMENT_ROOT_ELEMENTS])
  })

  it('is named the way the hierarchy names it', () => {
    // The attributes panel and the tree have to be talking about one thing.
    expect(schema.displayName).toBe(Aglyn.NODE_ROOT_LABEL)
  })
})
