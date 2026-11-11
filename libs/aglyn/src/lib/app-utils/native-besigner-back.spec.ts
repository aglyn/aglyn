/**
 * @jest-environment jsdom
 *
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

import {
  type BackKeyEvent,
  backKeyLeavesEditor,
  NATIVE_BESIGNER_BACK_CONTROL_ID,
  pressBesignerBack,
} from './native-besigner-back'

function key(overrides: Partial<BackKeyEvent>): BackKeyEvent {
  return {
    key: 'Escape',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: document.body,
    ...overrides,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('which keys leave the editor in the apps (AGL-4056)', () => {
  it('Esc on the editor does', () => {
    expect(backKeyLeavesEditor(key({}), document, true)).toBe(true)
  })

  it('⌘[ on a Mac and Ctrl+[ elsewhere do, and not the other way round', () => {
    expect(backKeyLeavesEditor(key({ key: '[', metaKey: true }), document, true)).toBe(true)
    expect(backKeyLeavesEditor(key({ key: '[', ctrlKey: true }), document, false)).toBe(true)
    expect(backKeyLeavesEditor(key({ key: '[', ctrlKey: true }), document, true)).toBe(false)
    expect(backKeyLeavesEditor(key({ key: '[' }), document, true)).toBe(false)
  })

  it('Esc a field, a select or editable text has the focus in stays theirs', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag)
      document.body.appendChild(field)
      expect(backKeyLeavesEditor(key({ target: field }), document, true)).toBe(false)
    }
    const text = document.createElement('div')
    text.setAttribute('contenteditable', 'true')
    document.body.appendChild(text)
    expect(backKeyLeavesEditor(key({ target: text }), document, true)).toBe(false)
  })

  it('Esc closes what is open over the editor first', () => {
    document.body.innerHTML = '<div role="menu"></div>'
    expect(backKeyLeavesEditor(key({}), document, true)).toBe(false)
    document.body.innerHTML = '<div class="MuiPopover-root"></div>'
    expect(backKeyLeavesEditor(key({}), document, true)).toBe(false)
  })

  it('a menu kept mounted while closed does not hold Esc', () => {
    document.body.innerHTML = '<div class="MuiModal-hidden"><div role="menu"></div></div>'
    expect(backKeyLeavesEditor(key({}), document, true)).toBe(true)
  })

  it('an Esc the page already handled, or one with a modifier, does not', () => {
    expect(backKeyLeavesEditor(key({ defaultPrevented: true }), document, true)).toBe(false)
    expect(backKeyLeavesEditor(key({ shiftKey: true }), document, true)).toBe(false)
    expect(backKeyLeavesEditor(key({ key: 'a' }), document, true)).toBe(false)
  })
})

describe('pressing the back control', () => {
  it('clicks the control the apps know by id', () => {
    const control = document.createElement('button')
    control.id = NATIVE_BESIGNER_BACK_CONTROL_ID
    const clicked = jest.fn()
    control.addEventListener('click', clicked)
    document.body.appendChild(control)
    expect(pressBesignerBack(document)).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('answers false on a page without one', () => {
    expect(pressBesignerBack(document)).toBe(false)
  })
})
