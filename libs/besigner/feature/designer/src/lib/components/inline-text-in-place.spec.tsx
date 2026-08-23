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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { inlineTextEdit } from '../utils/inline-text-edit.store'
import InlineTextEditorComponent from './inline-text-editor.component'

/**
 * AGL-2486 — editing the text where it lives, not in a box on top of it.
 *
 * Zach: *"Can we also make it so we are not seeing a text box we are editing
 * it in? We see/edit it exactly how it appears"*. A 96px display heading
 * edited as small body text in a white `background.paper` box with a 2px
 * border — the size, weight, colour and alignment of the real element all
 * lost at exactly the moment the author needs to see them, and the real text
 * still showing through underneath, offset from what was being typed.
 *
 * The bar Zach set is that the text does not visibly move, resize or
 * restyle when editing begins. These tests hold that bar on the three things
 * that decide it: the surface WEARS the element's rendered type, it stops
 * drawing a box, and the element stops painting the same words underneath.
 */
describe('the inline text editor edits in place (AGL-2486)', () => {
  afterEach(() => {
    act(() => inlineTextEdit.close())
    document.body.innerHTML = ''
  })

  const node = (children = 'One canvas.') =>
    ({
      $id: 'agl2486-inplace',
      type: 'node',
      componentId: 'text',
      props: { children },
      componentSchema: { flags: {} },
      nodes: [],
    }) as any

  /**
   * A canvas leaf as the renderer builds one: the display type on the leaf
   * root, and the text itself in the `<aglyn-text>` child (`leaf.tsx`).
   */
  const displayHeading = () => {
    const leaf = document.createElement('div')
    leaf.setAttribute('data-aglyn', 'leaf:agl2486-inplace')
    leaf.style.fontFamily = 'Anton, sans-serif'
    leaf.style.fontSize = '96px'
    leaf.style.fontWeight = '700'
    leaf.style.lineHeight = '104px'
    leaf.style.letterSpacing = '-2px'
    leaf.style.textAlign = 'center'
    leaf.style.textTransform = 'uppercase'
    leaf.style.color = 'rgb(41, 98, 255)'
    leaf.style.paddingLeft = '12px'
    const text = document.createElement('aglyn-text')
    text.textContent = 'One canvas.'
    leaf.appendChild(text)
    document.body.appendChild(leaf)
    leaf.getBoundingClientRect = () =>
      ({
        left: 480,
        top: 300,
        width: 534,
        height: 104,
        right: 1014,
        bottom: 404,
        x: 480,
        y: 300,
        toJSON: () => ({}),
      }) as DOMRect
    return leaf
  }

  const overlay = () =>
    document.querySelector(
      '[data-aglyn="overlay:inline-text-editor"]',
    ) as HTMLElement

  const openOn = async (anchor?: HTMLElement) => {
    render(<InlineTextEditorComponent />)
    act(() =>
      inlineTextEdit.open(
        node(),
        { left: 480, top: 300, width: 534, height: 104 },
        undefined,
        anchor,
      ),
    )
    const surface = await screen.findByRole('textbox', { name: 'Edit text' })
    await waitFor(() =>
      expect(surface.textContent && surface.textContent.length > 0).toBe(true),
    )
    return surface
  }

  it('types in the element’s own font, size, weight and colour', async () => {
    const surface = await openOn(displayHeading())
    const style = window.getComputedStyle(surface)

    expect(style.fontFamily).toBe('Anton, sans-serif')
    expect(style.fontSize).toBe('96px')
    expect(style.fontWeight).toBe('700')
    expect(style.color).toBe('rgb(41, 98, 255)')
  })

  it('keeps the element’s alignment, spacing and case', async () => {
    const surface = await openOn(displayHeading())
    const style = window.getComputedStyle(surface)

    expect(style.textAlign).toBe('center')
    expect(style.lineHeight).toBe('104px')
    expect(style.letterSpacing).toBe('-2px')
    expect(style.textTransform).toBe('uppercase')
  })

  /**
   * The overlay is positioned on the element's BORDER box, so the first
   * character only lands on the same pixel if the box insets match too.
   */
  it('reproduces the element’s padding so the text starts in the same place', async () => {
    const surface = await openOn(displayHeading())
    expect(window.getComputedStyle(surface).paddingLeft).toBe('12px')
  })

  it('no longer draws a box around what is being edited', async () => {
    const surface = await openOn(displayHeading())
    const style = window.getComputedStyle(surface)

    // The white `background.paper` fill and the 2px ring are what made this
    // read as a form control sitting on top of the design.
    expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(
      style.backgroundColor,
    )
    expect(style.borderWidth === '' || style.borderWidth === '0px').toBe(true)
    expect(style.boxShadow === '' || style.boxShadow === 'none').toBe(true)
  })

  /**
   * An outline is drawn OUTSIDE the box, so unlike a border it moves no
   * text — the author still gets told that editing has begun and where the
   * run ends.
   */
  it('still marks the run being edited, without moving it', async () => {
    const surface = await openOn(displayHeading())
    expect(window.getComputedStyle(surface).outlineStyle).toBe('dashed')
  })

  it('takes the element’s exact width, so nothing re-wraps', async () => {
    await openOn(displayHeading())
    expect(window.getComputedStyle(overlay()).width).toBe('534px')
  })

  /**
   * Zach: *"When updating text the original allocated space is not
   * reflecting changes until after you click out"*. Editing a card heading
   * that grew to two lines, the surface overlapped the paragraph beneath it:
   * the card had not grown, the grid row had not grown, the sibling cards
   * had not moved. An overlay contributes nothing to layout, so the document
   * kept the OLD text's geometry while the new text was drawn on top of it.
   *
   * The element's own text goes `display: none` and a hidden stand-in in its
   * place carries what has been typed so far — so every box between the leaf
   * and the page measures the new text, live, while the overlay paints the
   * only visible copy.
   */
  describe('the layout tracks the text as it is typed', () => {
    const ghostOf = (leaf: HTMLElement) =>
      leaf.querySelector('[data-aglyn-layout-ghost]') as HTMLElement | null

    it('takes the element’s own text out of the layout', async () => {
      const leaf = displayHeading()
      await openOn(leaf)
      const text = leaf.querySelector('aglyn-text') as HTMLElement
      // `display`, not `visibility`: a hidden run still occupies its OLD
      // box, so the element could never shrink.
      expect(text.style.display).toBe('none')
    })

    it('stands in for it with the current text, painting nothing', async () => {
      const leaf = displayHeading()
      await openOn(leaf)
      const ghost = ghostOf(leaf)

      expect(ghost).toBeTruthy()
      expect(ghost?.textContent).toBe('One canvas.')
      expect(ghost?.style.visibility).toBe('hidden')
      expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    })

    it('re-sizes the document on every keystroke', async () => {
      const leaf = displayHeading()
      const surface = await openOn(leaf)

      surface.textContent = 'One canvas, and a much longer heading than before'
      fireEvent.input(surface)

      expect(ghostOf(leaf)?.textContent).toBe(
        'One canvas, and a much longer heading than before',
      )
    })

    /**
     * Reflow is not commit. The mirror diffs the serialized node map on a
     * mobx autorun, so a keystroke that reached the node would be broadcast
     * to every co-editor and recorded as an undo step.
     */
    it('does not touch the node while typing', async () => {
      const updateNodeProps = jest
        .spyOn(Aglyn.canvas, 'updateNodeProps')
        .mockImplementation((() => undefined) as any)
      try {
        const leaf = displayHeading()
        const surface = await openOn(leaf)

        surface.textContent = 'typing'
        fireEvent.input(surface)
        surface.textContent = 'typing more'
        fireEvent.input(surface)

        expect(updateNodeProps).not.toHaveBeenCalled()
      } finally {
        updateNodeProps.mockRestore()
      }
    })

    /** The icon, adornment or nested child beside the text stays visible. */
    it('hides only the text, never the whole leaf', async () => {
      const leaf = displayHeading()
      await openOn(leaf)
      expect(leaf.style.visibility).toBe('')
      expect(leaf.style.display).toBe('')
    })

    it('gives the element its own text back when the editor closes', async () => {
      const leaf = displayHeading()
      await openOn(leaf)
      const text = leaf.querySelector('aglyn-text') as HTMLElement

      act(() => inlineTextEdit.close())

      expect(text.style.display).toBe('')
      expect(ghostOf(leaf)).toBeNull()
    })

    /**
     * Rich text renders through `dangerouslySetInnerHTML` straight onto the
     * leaf, so there is no `<aglyn-text>` to stand in for and a ghost would
     * have to duplicate markup React owns. It keeps the plain hide.
     */
    it('falls back to hiding the leaf when there is no text child', async () => {
      const leaf = displayHeading()
      leaf.querySelector('aglyn-text')?.remove()
      await openOn(leaf)

      expect(leaf.style.visibility).toBe('hidden')
      expect(ghostOf(leaf)).toBeNull()
    })
  })

  /**
   * Degrading to the old box beats painting the author's text in a guess.
   * An editor opened with no anchor — an older call site, or a node whose
   * element has gone — has nothing to read.
   */
  describe('with no element to read', () => {
    it('falls back to the legible box', async () => {
      const surface = await openOn(undefined)
      const style = window.getComputedStyle(surface)

      expect(style.backgroundColor).not.toBe('transparent')
      expect(style.borderWidth).toBe('2px')
    })

    it('leaves nothing hidden on the way out', async () => {
      await openOn(undefined)
      act(() => inlineTextEdit.close())
      expect(
        document.querySelectorAll('[style*="visibility"]').length,
      ).toBe(0)
    })
  })

  /**
   * Tokens stay PILLS while editing, and this is the one place in-place
   * editing deliberately does not show what the canvas shows.
   *
   * The canvas renders a binding as its RESOLVED value (`node-leaf.tsx`
   * calls `Aglyn.resolveBindings`), or as `{{Name}}` with the preview
   * toggle off. What is stored is neither — it is `{{var:id}}`. Editing the
   * resolved text would mean typing over the result of a binding and
   * destroying the binding to do it, and there is no keystroke that could
   * put it back. A pill is the honest shape: one atomic thing, not editable
   * from the inside, replaceable and removable through the popover it
   * already has. It inherits the element's type (`fontSize: 0.8em`), so it
   * sits on the same line at the same scale rather than re-flowing it.
   */
  it('renders a binding as an atomic pill in the element’s own type', async () => {
    const leaf = displayHeading()
    render(<InlineTextEditorComponent />)
    act(() =>
      inlineTextEdit.open(
        {
          ...node('Hi {{entry.title}}!'),
          props: { children: 'Hi {{entry.title}}!' },
        } as any,
        { left: 480, top: 300, width: 534, height: 104 },
        undefined,
        leaf,
      ),
    )
    const surface = await screen.findByRole('textbox', { name: 'Edit text' })
    await waitFor(() =>
      expect(surface.querySelector('[data-token]')).toBeTruthy(),
    )

    const pill = surface.querySelector('[data-token]') as HTMLElement
    expect(pill.getAttribute('contenteditable')).toBe('false')
    expect(window.getComputedStyle(pill).fontSize).toBe('0.8em')
    // The surface around it is still the element's own type.
    expect(window.getComputedStyle(surface).fontSize).toBe('96px')
  })
})

/**
 * Guards the seam the in-place look depends on: the editor asks the DOM what
 * the element renders, rather than trying to re-derive it from the node's
 * `sx`. Variant defaults, the site theme, breakpoint objects, palette tokens
 * and the device-preview transform all resolve on the way to the screen.
 */
describe('readAnchorTextStyle (AGL-2486)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readAnchorTextStyle, findAnchorTextElement } =
    require('../utils/anchor-text-style') as typeof import('../utils/anchor-text-style')

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reads the rendered value, not the authored one', () => {
    const el = document.createElement('div')
    el.style.fontSize = '96px'
    document.body.appendChild(el)
    expect(readAnchorTextStyle(el)?.fontSize).toBe('96px')
  })

  it('has no answer for an element that is not in the document', () => {
    expect(readAnchorTextStyle(document.createElement('div'))).toBeUndefined()
  })

  it('has no answer without an anchor', () => {
    expect(readAnchorTextStyle(undefined)).toBeUndefined()
  })

  it('finds the text child in preference to the leaf', () => {
    const leaf = document.createElement('div')
    const text = document.createElement('aglyn-text')
    leaf.appendChild(text)
    document.body.appendChild(leaf)
    expect(findAnchorTextElement(leaf)).toBe(text)
  })

  it('falls back to the leaf when rich text rendered no text child', () => {
    const leaf = document.createElement('div')
    leaf.innerHTML = '<strong>bold</strong>'
    document.body.appendChild(leaf)
    expect(findAnchorTextElement(leaf)).toBe(leaf)
  })
})
