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
import {
  cancelPick,
  handlePickClick,
  isPicking,
  nodeElementLabel,
  startPick,
} from './pick-manager'

const NAV_MENU = 'muiNavMenu'

/** Dispatches a real, cancellable Escape keydown from `target`. */
function pressEscape(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

/**
 * The DOM Monaco renders for `Edit -> Raw JSON` under the EditContext API
 * (monaco-editor 0.56 defaults `editor.editContext` to true): the focusable
 * node is a bare DIV inside `.monaco-editor` — no textarea, no
 * contenteditable, no role.
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

describe('pick-manager — canvas element picker (AGL-574)', () => {
  beforeAll(() => {
    Aglyn.components.registerComponent((() => null) as any, {
      $id: NAV_MENU,
      pluginId: 'test-plugin',
      displayName: 'Dropdown',
    } as any)
  })

  afterAll(() => {
    Aglyn.components.unregisterComponent(NAV_MENU)
    Aglyn.canvas.reset()
  })

  beforeEach(() => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: {
        $id: Aglyn.NODE_ROOT_ID,
        type: 'node',
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: 'div',
        props: {},
        sx: {},
        nodes: ['shop-menu'],
      },
      'shop-menu': {
        $id: 'shop-menu',
        type: 'node',
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: NAV_MENU,
        pluginId: 'test-plugin',
        props: { children: 'Shop' },
        sx: {},
        nodes: [],
      },
    } as any)
  })

  afterEach(() => {
    // Abandon any pick a failing test left armed.
    cancelPick()
    document.body.innerHTML = ''
  })

  it('captures the clicked node id + label and exits pick mode', () => {
    const onPicked = jest.fn()
    expect(isPicking()).toBe(false)

    startPick(onPicked)
    expect(isPicking()).toBe(true)

    handlePickClick('shop-menu')

    expect(onPicked).toHaveBeenCalledTimes(1)
    // The picked selector is built from this raw id by the dialog; here we
    // assert the id + friendly label the canvas hands back.
    expect(onPicked).toHaveBeenCalledWith('shop-menu', 'Dropdown "Shop" (muiNavMenu)')
    expect(isPicking()).toBe(false)
  })

  it('derives a friendly label from componentId + first text child', () => {
    expect(nodeElementLabel('shop-menu')).toBe('Dropdown "Shop" (muiNavMenu)')
    // Unknown node → safe fallback, never a throw.
    expect(nodeElementLabel('does-not-exist')).toBe('Element')
  })

  it('cancelPick aborts without firing the pick handler', () => {
    const onPicked = jest.fn()
    const onCancel = jest.fn()

    startPick(onPicked, { onCancel })
    cancelPick()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onPicked).not.toHaveBeenCalled()
    expect(isPicking()).toBe(false)
  })

  it('Escape cancels the in-flight pick', () => {
    const onPicked = jest.fn()
    const onCancel = jest.fn()

    startPick(onPicked, { onCancel })
    const event = pressEscape(window)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onPicked).not.toHaveBeenCalled()
    expect(isPicking()).toBe(false)
    // The picker owns the keystroke when nothing is being typed into.
    expect(event.defaultPrevented).toBe(true)
  })

  // AGL-2212 — pick mode only MINIMIZES the interaction builder; the whole
  // besigner stays live underneath, so this capture-phase window listener
  // fires while the author is typing in a panel field or the raw JSON
  // editor. Both halves are asserted together: a test that only checked
  // "Escape does not cancel in a field" would pass just as well if Escape
  // had stopped cancelling the pick at all.
  describe('Escape and text entry (AGL-2212)', () => {
    it.each([
      ['a panel text field', () => document.createElement('input')],
      ['a multiline field', () => document.createElement('textarea')],
      ['the raw JSON editor (Monaco)', mountRawJsonEditor],
    ])('does NOT cancel the pick from %s', (_label, make) => {
      const onCancel = jest.fn()
      startPick(jest.fn(), { onCancel })

      const field = make()
      // MUST be attached: a keydown dispatched on a detached element never
      // reaches the window listener at all, which would make this test pass
      // without ever exercising the guard.
      if (!field.isConnected) document.body.appendChild(field)
      field.focus()
      const event = pressEscape(field)

      expect(onCancel).not.toHaveBeenCalled()
      expect(isPicking()).toBe(true)
      // The field's own Escape (close the popper, revert the edit) must
      // still reach it.
      expect(event.defaultPrevented).toBe(false)
    })

    it('still cancels once focus leaves the field', () => {
      const onCancel = jest.fn()
      startPick(jest.fn(), { onCancel })

      const field = mountRawJsonEditor()
      field.focus()
      pressEscape(field)
      expect(isPicking()).toBe(true)

      field.blur()
      const event = pressEscape(document.body)

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(isPicking()).toBe(false)
      expect(event.defaultPrevented).toBe(true)
    })
  })

  it('ignores clicks when not picking', () => {
    const onPicked = jest.fn()
    startPick(onPicked)
    handlePickClick('shop-menu')
    // Second click after teardown must not re-fire the (already spent) handler.
    handlePickClick('shop-menu')
    expect(onPicked).toHaveBeenCalledTimes(1)
  })

  it('a new pick supersedes an unfinished one', () => {
    const first = jest.fn()
    const second = jest.fn()
    startPick(first)
    startPick(second)
    handlePickClick('shop-menu')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
