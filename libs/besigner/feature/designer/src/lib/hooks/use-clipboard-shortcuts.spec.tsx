/**
 * @jest-environment jsdom
 */
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
import * as Besigner from '@aglyn/besigner'
import { renderHook } from '@testing-library/react'
import { inlineTextEdit } from '../utils/inline-text-edit.store'
import useClipboardShortcuts from './use-clipboard-shortcuts'

const mockCopyElements = jest.fn()
const mockPasteElements = jest.fn()
// The module exports exactly these two hooks plus a default alias of the
// first — the whole surface, so nothing the hook reaches for is missing.
jest.mock('./use-clipboard-callbacks', () => ({
  useCopyElementsCallback: () => mockCopyElements,
  usePasteElementsCallback: () => mockPasteElements,
  default: () => mockCopyElements,
}))

const STACK = 'aglTestStack2204'

/**
 * The DOM Monaco renders for `Edit -> Raw JSON` under the EditContext API
 * (monaco-editor 0.56 defaults `editor.editContext` to true): the focusable
 * node is a bare DIV inside `.monaco-editor`.
 */
function mountRawJsonEditor(): HTMLElement {
  const editor = document.createElement('div')
  editor.className = 'monaco-editor'
  const input = document.createElement('div')
  input.className = 'native-edit-context'
  input.setAttribute('tabindex', '0')
  editor.appendChild(input)
  document.body.appendChild(editor)
  return input
}

/** Dispatches a real Cmd+<key> keydown from `target`; returns the event. */
function pressCommandKey(key: string, target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

/**
 * AGL-2211 — the besigner's canvas clipboard shortcuts live on `window`, so
 * they fire wherever focus is. Every test below asserts BOTH halves: the
 * shortcut still drives the canvas when focus is on the canvas, AND it stands
 * down inside the raw JSON editor. A one-sided "it does not fire in the
 * editor" test would pass just as happily if the feature were deleted.
 */
describe('useClipboardShortcuts — canvas shortcuts vs. the raw JSON editor', () => {
  beforeAll(() => {
    Aglyn.components.registerComponent((() => null) as any, {
      $id: STACK,
      pluginId: 'test-plugin',
      displayName: 'Stack',
    } as any)
  })

  afterAll(() => {
    Aglyn.components.unregisterComponent(STACK)
    Aglyn.canvas.reset()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    document.body.innerHTML = ''
    inlineTextEdit.close()
    Besigner.clipboard.clear()
    Besigner.focus.clearSelection()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: {
        $id: Aglyn.NODE_ROOT_ID,
        type: 'node',
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: 'div',
        props: {},
        sx: {},
        nodes: ['card'],
      },
      card: {
        $id: 'card',
        type: 'node',
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: STACK,
        pluginId: 'test-plugin',
        props: {},
        sx: {},
        nodes: [],
      },
    } as any)
    Besigner.focus.setSelectedNode(Aglyn.canvas.getNode('card') as any)
  })

  afterEach(() => {
    Besigner.focus.clearSelection()
    Besigner.clipboard.clear()
  })

  describe('Cmd+C', () => {
    it('COPIES CANVAS ELEMENTS when focus is on the canvas', () => {
      renderHook(() => useClipboardShortcuts())

      const event = pressCommandKey('c', document.body)

      expect(mockCopyElements).toHaveBeenCalledTimes(1)
      expect(mockCopyElements.mock.calls[0][0]).toHaveLength(1)
      expect(mockCopyElements.mock.calls[0][0][0].$id).toBe('card')
      // The canvas handler owns the keystroke here.
      expect(event.defaultPrevented).toBe(true)
    })

    it('stands down inside the raw JSON editor, leaving the copy to the browser', () => {
      renderHook(() => useClipboardShortcuts())
      const input = mountRawJsonEditor()
      input.focus()

      const event = pressCommandKey('c', input)

      expect(mockCopyElements).not.toHaveBeenCalled()
      // Not preventing default is the whole point: `preventDefault()` on the
      // keydown is what suppresses the browser's own `copy` event.
      expect(event.defaultPrevented).toBe(false)
    })
  })

  describe('Cmd+V', () => {
    beforeEach(() => {
      // Something on the clipboard, or the handler returns early for an
      // unrelated reason and the "editor" half would pass vacuously.
      Besigner.clipboard.copyNodes([Aglyn.canvas.getNode('card') as any])
      expect(Besigner.clipboard.hasContent()).toBe(true)
    })

    it('PASTES CANVAS ELEMENTS when focus is on the canvas', () => {
      renderHook(() => useClipboardShortcuts())

      const event = pressCommandKey('v', document.body)

      expect(mockPasteElements).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })

    it('stands down inside the raw JSON editor, leaving the paste to the browser', () => {
      renderHook(() => useClipboardShortcuts())
      const input = mountRawJsonEditor()
      input.focus()

      const event = pressCommandKey('v', input)

      expect(mockPasteElements).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })
  })

  describe('Cmd+A', () => {
    it('SELECTS THE CANVAS SIBLINGS when focus is on the canvas', () => {
      renderHook(() => useClipboardShortcuts())

      const event = pressCommandKey('a', document.body)

      expect(event.defaultPrevented).toBe(true)
      expect(Besigner.focus.getSelected().length).toBeGreaterThan(0)
    })

    it('stands down inside the raw JSON editor, leaving select-all to the editor', () => {
      renderHook(() => useClipboardShortcuts())
      const input = mountRawJsonEditor()
      input.focus()

      const event = pressCommandKey('a', input)

      expect(event.defaultPrevented).toBe(false)
    })
  })

  describe('the other text-entry surfaces on the same guard', () => {
    it.each([
      ['a panel text field', () => document.createElement('input')],
      ['a multiline field', () => document.createElement('textarea')],
      [
        'a contenteditable',
        () => {
          const element = document.createElement('div')
          element.setAttribute('contenteditable', 'true')
          return element
        },
      ],
    ])('stands down in %s', (_label, make) => {
      renderHook(() => useClipboardShortcuts())
      const field = make()
      document.body.appendChild(field)
      field.focus()

      const event = pressCommandKey('c', field)

      expect(mockCopyElements).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it('stands down while the canvas inline text editor is open', () => {
      // The canvas is a CLOSED shadow root, so the keydown retargets to the
      // host and looks like "the canvas has focus" — the store is the only
      // honest signal, and it must keep working alongside the DOM checks.
      renderHook(() => useClipboardShortcuts())
      inlineTextEdit.open(Aglyn.canvas.getNode('card') as any, {
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      })

      const event = pressCommandKey('c', document.body)

      expect(mockCopyElements).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })
  })

  it('removes its listener on unmount', () => {
    const { unmount } = renderHook(() => useClipboardShortcuts())
    unmount()

    pressCommandKey('c', document.body)

    expect(mockCopyElements).not.toHaveBeenCalled()
  })
})
