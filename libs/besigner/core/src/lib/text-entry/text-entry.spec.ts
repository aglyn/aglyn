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

import { isTextEntryElement, isTextEntryFocused } from './text-entry'

/**
 * Builds the DOM Monaco actually renders under the EditContext API
 * (monaco-editor 0.56, `editor.editContext` defaults to true): the focusable
 * node is a bare DIV — no textarea, no contenteditable, no role — nested in
 * the `.monaco-editor` chrome. Reproduced from
 * `esm/vs/editor/browser/controller/editContext/native/nativeEditContext.js`.
 */
function mountMonacoNativeEditContext(): HTMLElement {
  const editor = document.createElement('div')
  editor.className = 'monaco-editor'
  const guard = document.createElement('div')
  guard.className = 'overflow-guard'
  const input = document.createElement('div')
  input.className = 'native-edit-context'
  input.setAttribute('tabindex', '0')
  input.setAttribute('autocorrect', 'off')
  input.setAttribute('spellcheck', 'false')
  guard.appendChild(input)
  editor.appendChild(guard)
  document.body.appendChild(editor)
  return input
}

describe('text-entry — "is the user typing?" (AGL-2211)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('isTextEntryElement', () => {
    it('recognises Monaco under the EditContext API', () => {
      const input = mountMonacoNativeEditContext()
      // The exact node that would fail every tag/attribute test. (jsdom
      // does not implement `isContentEditable` at all, so it reads
      // `undefined` here and `false` in a browser — falsy either way, which
      // is why the ancestor selector is what actually carries this guard.)
      expect(input.tagName).toBe('DIV')
      expect(input.isContentEditable).toBeFalsy()
      expect(input.getAttribute('role')).toBeNull()

      expect(isTextEntryElement(input)).toBe(true)
    })

    it('recognises Monaco under the legacy hidden-textarea path', () => {
      const editor = document.createElement('div')
      editor.className = 'monaco-editor'
      const input = document.createElement('textarea')
      input.className = 'inputarea'
      editor.appendChild(input)
      document.body.appendChild(editor)

      expect(isTextEntryElement(input)).toBe(true)
    })

    it('recognises Monaco chrome around the input (find widget field)', () => {
      const input = mountMonacoNativeEditContext()
      const find = document.createElement('div')
      find.className = 'find-widget'
      input.parentElement!.appendChild(find)

      expect(isTextEntryElement(find)).toBe(true)
    })

    it.each([
      ['input', () => document.createElement('input')],
      ['textarea', () => document.createElement('textarea')],
      ['select', () => document.createElement('select')],
    ])('recognises a plain %s', (_label, make) => {
      const element = make()
      document.body.appendChild(element)
      expect(isTextEntryElement(element)).toBe(true)
    })

    it('recognises contenteditable, including a nested child', () => {
      const host = document.createElement('div')
      host.setAttribute('contenteditable', 'true')
      const child = document.createElement('span')
      host.appendChild(child)
      document.body.appendChild(host)

      // jsdom does not implement `isContentEditable`, so the ancestor
      // selector is what has to carry both of these.
      expect(isTextEntryElement(host)).toBe(true)
      expect(isTextEntryElement(child)).toBe(true)
    })

    it('recognises ARIA text roles', () => {
      const box = document.createElement('div')
      box.setAttribute('role', 'textbox')
      document.body.appendChild(box)
      expect(isTextEntryElement(box)).toBe(true)

      const search = document.createElement('div')
      search.setAttribute('role', 'searchbox')
      document.body.appendChild(search)
      expect(isTextEntryElement(search)).toBe(true)
    })

    it('is FALSE for the canvas and its chrome — the guard must not swallow everything', () => {
      const canvas = document.createElement('div')
      canvas.setAttribute('data-aglyn', 'leaf:_abc123')
      const button = document.createElement('button')
      const tree = document.createElement('div')
      tree.setAttribute('role', 'tree')
      document.body.append(canvas, button, tree)

      expect(isTextEntryElement(canvas)).toBe(false)
      expect(isTextEntryElement(button)).toBe(false)
      expect(isTextEntryElement(tree)).toBe(false)
      expect(isTextEntryElement(document.body)).toBe(false)
    })

    it('answers false for non-elements rather than throwing', () => {
      expect(isTextEntryElement(null)).toBe(false)
      expect(isTextEntryElement(undefined)).toBe(false)
      expect(isTextEntryElement(document.createTextNode('hi'))).toBe(false)
      expect(isTextEntryElement(window)).toBe(false)
    })
  })

  describe('isTextEntryFocused', () => {
    it('follows focus into Monaco and back out again', () => {
      const input = mountMonacoNativeEditContext()

      expect(isTextEntryFocused()).toBe(false) // body has focus
      input.focus()
      expect(document.activeElement).toBe(input)
      expect(isTextEntryFocused()).toBe(true)

      input.blur()
      expect(isTextEntryFocused()).toBe(false)
    })

    it('descends through an OPEN shadow root, where activeElement is the host', () => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = host.attachShadow({ mode: 'open' })
      const field = document.createElement('input')
      root.appendChild(field)

      field.focus()
      // The trap this exists for: the document reports the HOST.
      expect(document.activeElement).toBe(host)
      expect(isTextEntryElement(document.activeElement)).toBe(false)

      expect(isTextEntryFocused()).toBe(true)
    })

    it('does not loop forever on a shadow host with nothing focused inside', () => {
      const host = document.createElement('div')
      host.setAttribute('tabindex', '0')
      document.body.appendChild(host)
      host.attachShadow({ mode: 'open' })
      host.focus()

      expect(isTextEntryFocused()).toBe(false)
    })
  })
})
