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
 * AGL-4069 — editing canvas text with a finger.
 *
 * On a phone the press that grabs one of the selection handles iOS hangs off
 * the ends of selected text lands on whatever is NEXT to the text. The edit
 * used to end on that press, closing the keyboard under an author who was
 * only selecting more words. With a finger the edit now ends only on a real
 * tap; a mouse keeps ending it on the press, as before.
 */
describe('editing canvas text with a finger (AGL-4069)', () => {
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

  const rect = { left: 20, top: 160, width: 300, height: 40 }

  const richNode = () =>
    ({
      $id: 'agl4069-heading',
      type: 'node',
      componentId: 'rich-text',
      props: { children: 'Design on a living canvas' },
      componentSchema: {
        flags: { richTextEditable: Aglyn.FEATURE_FLAG.ENABLED },
      },
      nodes: [],
    }) as any

  /**
   * The canvas as the renderer builds it: a shadow root holding the heading
   * being edited and the paragraph under it, where a handle hangs.
   */
  const canvas = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    const heading = document.createElement('h2')
    heading.setAttribute('data-aglyn', 'leaf:agl4069-heading')
    const text = document.createElement('aglyn-text')
    text.textContent = 'Design on a living canvas'
    heading.appendChild(text)
    const paragraph = document.createElement('p')
    paragraph.setAttribute('data-aglyn', 'leaf:agl4069-paragraph')
    paragraph.textContent = 'Besigner is a real visual builder.'
    root.append(heading, paragraph)
    return { heading, paragraph }
  }

  const touch = (x: number, y: number) => ({
    pointerType: 'touch',
    pointerId: 7,
    isPrimary: true,
    clientX: x,
    clientY: y,
  })

  const openWith = async (pointerType: 'touch' | 'mouse') => {
    const { heading, paragraph } = canvas()
    render(<InlineTextEditorComponent />)
    // The press that opened the edit says which kind of pointer is in use.
    fireEvent.pointerDown(document.body, { ...touch(40, 170), pointerType })
    act(() => inlineTextEdit.open(richNode(), rect, undefined, heading))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy(),
    )
    return { heading, paragraph }
  }

  const stillEditing = (heading: HTMLElement) => {
    expect(updateNodeProps).not.toHaveBeenCalled()
    expect(inlineTextEdit.node).toBeTruthy()
    expect(heading.getAttribute('contenteditable')).toBe('true')
  }

  it('keeps the edit when a selection handle is dragged from the paragraph below', async () => {
    const { heading, paragraph } = await openWith('touch')

    fireEvent.pointerDown(paragraph, touch(200, 214))
    fireEvent.pointerMove(paragraph, touch(240, 214))
    fireEvent.pointerMove(paragraph, touch(290, 212))
    fireEvent.pointerUp(paragraph, touch(290, 212))

    stillEditing(heading)
  })

  it('keeps the edit when the browser takes the touch over', async () => {
    const { heading, paragraph } = await openWith('touch')

    fireEvent.pointerDown(paragraph, touch(200, 214))
    fireEvent.pointerCancel(paragraph, touch(200, 214))
    fireEvent.pointerUp(paragraph, touch(200, 214))

    stillEditing(heading)
  })

  it('keeps the edit through selectionchange', async () => {
    const { heading } = await openWith('touch')

    fireEvent(document, new Event('selectionchange'))

    stillEditing(heading)
  })

  it('keeps the edit when the text loses focus to the keyboard bar or the edit menu', async () => {
    const { heading } = await openWith('touch')

    fireEvent.blur(heading)

    stillEditing(heading)
  })

  it('keeps the edit through the visual viewport moving under the keyboard', async () => {
    const { heading } = await openWith('touch')

    fireEvent(window, new Event('resize'))
    fireEvent.scroll(window)

    stillEditing(heading)
  })

  it('does not let the press select the element under a handle', async () => {
    const { paragraph } = await openWith('touch')
    const selects = jest.fn()
    paragraph.addEventListener('pointerdown', selects)

    fireEvent.pointerDown(paragraph, touch(200, 214))

    expect(selects).not.toHaveBeenCalled()
  })

  it('ends the edit, with what was typed, on a real tap somewhere else', async () => {
    const node = richNode()
    const { heading, paragraph } = canvas()
    render(<InlineTextEditorComponent />)
    fireEvent.pointerDown(document.body, touch(40, 170))
    act(() => inlineTextEdit.open(node, rect, undefined, heading))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy(),
    )
    heading.appendChild(document.createTextNode(' today'))

    fireEvent.pointerDown(paragraph, touch(200, 260))
    expect(inlineTextEdit.node).toBeTruthy()
    fireEvent.pointerUp(paragraph, touch(201, 261))

    expect(updateNodeProps).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ children: 'Design on a living canvas today' }),
    )
    expect(inlineTextEdit.node).toBeUndefined()
  })

  it('ends the edit on Done', async () => {
    await openWith('touch')

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(inlineTextEdit.node).toBeUndefined()
  })

  it('still ends a mouse edit on the press, as it always has', async () => {
    const { paragraph } = await openWith('mouse')

    fireEvent.pointerDown(paragraph, { ...touch(200, 260), pointerType: 'mouse' })

    expect(inlineTextEdit.node).toBeUndefined()
  })

  it('still commits a mouse edit on blur', async () => {
    const { heading } = await openWith('mouse')

    fireEvent.blur(heading)

    expect(inlineTextEdit.node).toBeUndefined()
  })

  describe('the toolbar', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    afterEach(() => {
      if (original) Object.defineProperty(window, 'visualViewport', original)
      else delete (window as { visualViewport?: unknown }).visualViewport
    })

    const keyboardUp = () => {
      const visual = new EventTarget() as EventTarget & Record<string, number>
      Object.assign(visual, {
        offsetLeft: 0,
        offsetTop: 0,
        width: 390,
        height: 420,
      })
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: visual,
      })
      return visual
    }

    const toolbar = () =>
      document.querySelector(
        '[data-aglyn="overlay:inline-text-toolbar"]',
      ) as HTMLElement

    it('docks inside the visible area, above the keyboard, for a finger', async () => {
      keyboardUp()
      await openWith('touch')

      // The heading is clear of the keyboard, so the bar sits on top of it.
      expect(toolbar().getAttribute('data-docked')).toBe('bottom')
      expect(getComputedStyle(toolbar()).position).toBe('fixed')
    })

    it('moves with the visual viewport as the keyboard pans the page', async () => {
      const visual = keyboardUp()
      await openWith('touch')
      const before = getComputedStyle(toolbar()).top

      act(() => {
        visual['offsetTop'] = 200
        visual.dispatchEvent(new Event('scroll'))
      })

      expect(getComputedStyle(toolbar()).top).not.toBe(before)
    })

    it('hangs above the text, undocked, for a mouse', async () => {
      keyboardUp()
      await openWith('mouse')

      expect(toolbar().hasAttribute('data-docked')).toBe(false)
      expect(getComputedStyle(toolbar()).position).toBe('absolute')
    })
  })
})
