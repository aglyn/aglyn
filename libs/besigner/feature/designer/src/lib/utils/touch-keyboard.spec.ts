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

import { holdKeyboardForEdit, KEYBOARD_HANDOFF_MS } from './touch-keyboard'

const standIns = () => document.querySelectorAll('input[aria-hidden="true"]')

afterEach(() => {
  jest.useRealTimers()
  document.body.innerHTML = ''
})

describe('holdKeyboardForEdit', () => {
  it('focuses an invisible 16px field at the tap, so iOS raises the keyboard without zooming', () => {
    const input = holdKeyboardForEdit({ x: 120, y: 340 })
    expect(document.activeElement).toBe(input)
    expect(input.style.position).toBe('fixed')
    expect(input.style.left).toBe('120px')
    expect(input.style.top).toBe('340px')
    expect(input.style.fontSize).toBe('16px')
    expect(input.style.opacity).toBe('0')
  })

  it('goes away the moment the editor takes focus from it', () => {
    holdKeyboardForEdit({ x: 0, y: 0 })
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.tabIndex = 0
    document.body.appendChild(editor)
    editor.focus()
    expect(document.activeElement).toBe(editor)
    expect(standIns()).toHaveLength(0)
  })

  it('lets go when no editor takes over, so the keyboard is not left up', () => {
    jest.useFakeTimers()
    const input = holdKeyboardForEdit({ x: 0, y: 0 })
    jest.advanceTimersByTime(KEYBOARD_HANDOFF_MS)
    expect(document.activeElement).not.toBe(input)
    expect(standIns()).toHaveLength(0)
  })
})
