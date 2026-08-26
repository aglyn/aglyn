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

import { selectionOf } from '../utils/in-place-edit-surface'
import { inlineTextEdit } from '../utils/inline-text-edit.store'
import InlineTextEditorComponent from './inline-text-editor.component'

/**
 * AGL-2486 — the canvas leaf IS the editing surface.
 *
 * We see/edit it exactly how it appears, then *"the original
 * allocated space is not reflecting changes"*, then *"The reserved space is
 * still not updating as we are editing text live"* with two texts drawn over
 * each other, and finally *"No don't go back to the inlined boxed editor,
 * just finish the project"*.
 *
 * Every one of those is the same defect: an overlay is a rectangle, the
 * thing it stands in for is a flow of line boxes, and the two geometries can
 * always disagree. Editing the element directly does not solve that; it
 * deletes it. There is no second rectangle, so the text cannot move or
 * restyle, and the layout re-flows because the element really did grow.
 */
describe('the canvas leaf is the editing surface (AGL-2486)', () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => {
    act(() => inlineTextEdit.close())
    updateNodeProps.mockRestore()
    document.body.innerHTML = ''
  })

  const rect = { left: 480, top: 300, width: 534, height: 104 }

  const plainNode = (children: string) =>
    ({
      $id: 'agl2486-leaf',
      type: 'node',
      componentId: 'text',
      props: { children },
      componentSchema: { flags: {} },
      nodes: [],
    }) as any

  const richNode = (children: string, html?: string) =>
    ({
      $id: 'agl2486-leaf-rich',
      type: 'node',
      componentId: 'rich-text',
      props: html ? { children, html } : { children },
      componentSchema: {
        flags: { richTextEditable: Aglyn.FEATURE_FLAG.ENABLED },
      },
      nodes: [],
    }) as any

  /** A canvas leaf as the renderer builds one: text inside `<aglyn-text>`. */
  const leafFor = (text: string, tag = 'div') => {
    const leaf = document.createElement(tag)
    leaf.setAttribute('data-aglyn', 'leaf:agl2486-leaf')
    leaf.style.fontSize = '96px'
    const inner = document.createElement('aglyn-text')
    inner.textContent = text
    leaf.appendChild(inner)
    document.body.appendChild(leaf)
    return leaf
  }

  const openOn = async (node: any, anchor?: HTMLElement) => {
    render(<InlineTextEditorComponent />)
    act(() => inlineTextEdit.open(node, rect, undefined, anchor))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy(),
    )
  }

  it('makes the element itself editable, in its own place', async () => {
    const leaf = leafFor('One canvas.')
    await openOn(plainNode('One canvas.'), leaf)

    expect(leaf.getAttribute('contenteditable')).toBe('true')
    expect(leaf.getAttribute('data-aglyn-editing')).toBe('')
    expect(leaf.textContent).toBe('One canvas.')
  })

  /**
   * The whole point. A second rectangle is what could disagree with the
   * document's geometry, so in place there must not BE one.
   */
  it('renders no second surface to disagree with the layout', async () => {
    const leaf = leafFor('One canvas.')
    await openOn(plainNode('One canvas.'), leaf)

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps the toolbar, which is chrome rather than text', async () => {
    const leaf = leafFor('bold me')
    await openOn(richNode('bold me'), leaf)

    // By title: the accessible name of these is their glyph, which is not
    // what the control MEANS.
    for (const title of [
      'Bold',
      'Italic',
      'Underline',
      'Bulleted list',
      'Numbered list',
      'Insert link',
      'Insert data',
    ]) {
      expect(document.querySelector(`button[title="${title}"]`)).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  })

  it('renders a stored token as an atomic pill inside the element', async () => {
    const leaf = leafFor('Hi {{entry.title}}!')
    await openOn(plainNode('Hi {{entry.title}}!'), leaf)

    const pill = leaf.querySelector('[data-token]') as HTMLElement
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('contenteditable')).toBe('false')
    expect(leaf.textContent).toBe('Hi Title!')
  })

  it('commits what was typed into the element', async () => {
    const node = plainNode('One canvas.')
    const leaf = leafFor('One canvas.')
    await openOn(node, leaf)

    leaf.appendChild(document.createTextNode(' Two.'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(updateNodeProps).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ children: 'One canvas. Two.' }),
    )
  })

  /**
   * React's children are PARKED BY REFERENCE, not serialized. The same
   * objects go back under the same parent, so React's fibers still point at
   * live nodes in their expected places — an equal-looking copy would leave
   * a later unmount calling `removeChild` on a node that is not there.
   */
  describe('giving the element back to React', () => {
    it('restores the very same child nodes, not copies', async () => {
      const leaf = leafFor('One canvas.')
      const original = leaf.firstChild

      await openOn(plainNode('One canvas.'), leaf)
      expect(leaf.firstChild).not.toBe(original)

      act(() => inlineTextEdit.close())

      expect(leaf.firstChild).toBe(original)
      expect(leaf.textContent).toBe('One canvas.')
    })

    it('stops being editable', async () => {
      const leaf = leafFor('One canvas.')
      await openOn(plainNode('One canvas.'), leaf)

      act(() => inlineTextEdit.close())

      expect(leaf.hasAttribute('contenteditable')).toBe(false)
      expect(leaf.hasAttribute('data-aglyn-editing')).toBe(false)
    })

    it('gives it back even when the edit was committed', async () => {
      const leaf = leafFor('One canvas.')
      const original = leaf.firstChild
      await openOn(plainNode('One canvas.'), leaf)

      fireEvent.click(screen.getByRole('button', { name: 'Done' }))

      expect(leaf.firstChild).toBe(original)
      expect(leaf.hasAttribute('contenteditable')).toBe(false)
    })
  })

  /**
   * With the leaf itself editable, a click inside it is the author placing a
   * caret — the single most common gesture in an editor. Committing on it
   * would make the text impossible to correct.
   */
  describe('click-away, now that the surface is the element', () => {
    it('does not commit when the click lands in the text being edited', async () => {
      const leaf = leafFor('One canvas.')
      await openOn(plainNode('One canvas.'), leaf)

      fireEvent.pointerDown(leaf)

      expect(updateNodeProps).not.toHaveBeenCalled()
      expect(inlineTextEdit.node).toBeTruthy()
      expect(leaf.getAttribute('contenteditable')).toBe('true')
    })

    it('commits when the click lands somewhere else', async () => {
      const node = plainNode('One canvas.')
      const leaf = leafFor('One canvas.')
      await openOn(node, leaf)
      leaf.appendChild(document.createTextNode(' Two.'))

      const elsewhere = document.createElement('div')
      document.body.appendChild(elsewhere)
      // The canvas leaf handler prevents this default, which is why no blur
      // follows it (524ebd4fc).
      elsewhere.addEventListener('pointerdown', (e) => e.preventDefault())
      fireEvent.pointerDown(elsewhere)

      expect(updateNodeProps).toHaveBeenCalledWith(
        node,
        expect.objectContaining({ children: 'One canvas. Two.' }),
      )
      expect(inlineTextEdit.node).toBeUndefined()
    })
  })

  /**
   * AGL-2486 — the line break persists regardless if you remove it
   * or not once you click out.
   *
   * The markup the commit computed was always right; it was being undone a
   * moment later. Ending the edit restores the element's original child
   * nodes, and that restore used to run in the effect cleanup — AFTER
   * `updateNodeProps` had told React to re-render the leaf. React painted
   * the new text and the parked ORIGINAL nodes went back over the top.
   *
   * Worst for formatted text, which is how it was found: a node with `html`
   * renders through `dangerouslySetInnerHTML`, so React never tracks those
   * children and never corrects them afterwards. The canvas kept the
   * pre-edit markup while the store held the new value.
   */
  describe('an edit to formatted text actually lands', () => {
    const richLeaf = () => {
      const leaf = document.createElement('div')
      leaf.setAttribute('data-aglyn', 'leaf:agl2486-leaf-rich')
      leaf.innerHTML = 'About <div>us</div>'
      document.body.appendChild(leaf)
      return leaf
    }

    it('drops the html once the markup is gone, keeping the words', async () => {
      const node = richNode('About \nus', 'About <div>us</div>')
      const leaf = richLeaf()
      await openOn(node, leaf)

      // The author removes the line break.
      leaf.innerHTML = 'About us'
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))

      const props = updateNodeProps.mock.calls.at(-1)?.[1] as Record<
        string,
        unknown
      >
      expect(props).toBeTruthy()
      expect(props['children']).toBe('About us')
      // Markup identical to its own plain text is dead weight, and a future
      // source of exactly this confusion.
      expect('html' in props).toBe(false)
    })

    it('has already given the element back when it writes', async () => {
      const node = richNode('About \nus', 'About <div>us</div>')
      const leaf = richLeaf()
      await openOn(node, leaf)
      leaf.innerHTML = 'About us'

      let domAtWrite: { html: string; editable: boolean } | undefined
      updateNodeProps.mockImplementation((() => {
        domAtWrite = {
          html: leaf.innerHTML,
          editable: leaf.hasAttribute('contenteditable'),
        }
      }) as any)

      fireEvent.click(screen.getByRole('button', { name: 'Done' }))

      expect(domAtWrite).toBeTruthy()
      // The parked originals are back, and the element is no longer
      // editable, BEFORE React is told anything — so the re-render that
      // follows lands on a subtree exactly where React left it, instead of
      // being overwritten by a restore that comes afterwards.
      expect(domAtWrite?.editable).toBe(false)
      expect(domAtWrite?.html).toBe('About <div>us</div>')
    })
  })

  /**
   * Unchanged from `d7ba450b5`: a commit that changes nothing must not
   * dirty the document, or the co-editing mirror replays a phantom edit to
   * every joiner for seven days.
   */
  it('is still not an edit when nothing was typed', async () => {
    const leaf = leafFor('Be first through the door')
    await openOn(richNode('Be first through the door'), leaf)

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(updateNodeProps).not.toHaveBeenCalled()
  })

  /**
   * The fallback, and the invariant that governs it: an edit with no element
   * to type into gets a surface, and that surface is OPAQUE. A see-through
   * one over a layout that cannot re-flow is what drew two texts over each
   * other.
   */
  describe('with no element to edit', () => {
    it('falls back to a surface of its own', async () => {
      await openOn(plainNode('One canvas.'), undefined)
      const surface = await screen.findByRole('textbox', { name: 'Edit text' })
      expect(surface).toBeTruthy()
    })

    it('and that surface is opaque', async () => {
      await openOn(plainNode('One canvas.'), undefined)
      const surface = await screen.findByRole('textbox', { name: 'Edit text' })
      const style = window.getComputedStyle(surface)
      expect(['transparent', 'rgba(0, 0, 0, 0)']).not.toContain(
        style.backgroundColor,
      )
      expect(style.borderWidth).toBe('2px')
    })
  })
})

/**
 * The canvas renders into `mode="closed"` (`viewport-frame.component.tsx`),
 * so `document.getSelection()` cannot see a caret inside it. What still
 * works is that a node INSIDE the tree can always reach its own root —
 * `getRootNode()` returns the `ShadowRoot` whatever its mode — and Chrome
 * implements `ShadowRoot.getSelection()`.
 */
describe('selectionOf reads the caret across a closed shadow root (AGL-2486)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('asks the element’s own root, not the document', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'closed' })
    const inner = document.createElement('p')
    root.appendChild(inner)

    const scoped = {} as Selection
    ;(root as unknown as { getSelection: () => Selection }).getSelection =
      () => scoped

    expect(selectionOf(inner)).toBe(scoped)
  })

  it('falls back to the document for a light-DOM element', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(selectionOf(el)).toBe(document.getSelection())
  })
})
