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
import BoxElement, { BOX_ELEMENTS, presets, schema } from './box'

describe('Box element (AGL-1201)', () => {
  it('renders a div by default', () => {
    render(<BoxElement>{'Content'}</BoxElement>)
    expect(screen.getByText('Content').tagName).toBe('DIV')
  })

  it('renders the chosen element', () => {
    render(<BoxElement component="figure">{'Caption box'}</BoxElement>)
    expect(screen.getByText('Caption box').tagName).toBe('FIGURE')
  })

  it('refuses an element outside the allow-list', () => {
    // `component` is persisted and rendered verbatim; a stored `script`
    // or `iframe` would otherwise reach every visitor's page.
    render(
      <BoxElement component={'script' as any}>{'Not a script'}</BoxElement>,
    )
    expect(screen.getByText('Not a script').tagName).toBe('DIV')
    expect(BOX_ELEMENTS).not.toContain('script' as never)
    expect(BOX_ELEMENTS).not.toContain('iframe' as never)
  })

  it('leaves the landmark elements to Section', () => {
    // Section owns those, and also exposes the accessible-name field a
    // landmark needs; duplicating them here would produce unnamed ones.
    for (const landmark of ['section', 'nav', 'header', 'footer', 'main']) {
      expect(BOX_ELEMENTS).not.toContain(landmark as never)
    }
  })

  it('offers exactly the elements the renderer accepts', () => {
    const field = schema.attributes.find((a: any) => a.name === 'component')
    expect((field as any).options.map((o: any) => o.value)).toEqual([
      ...BOX_ELEMENTS,
    ])
  })

  it('ships a preset that is visible when dropped', () => {
    // A bare div has zero height and no border: the drop would look like
    // nothing happened.
    const props = (presets[0].data as any).props
    expect(props.sx.p).toBeTruthy()
    expect(props.sx.border).toBeTruthy()
  })
})
