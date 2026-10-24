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

/** How long the stand-in waits for the editor to take focus from it, in ms. */
export const KEYBOARD_HANDOFF_MS = 1500

/**
 * Puts the on-screen keyboard up for an editor that is about to open.
 *
 * iOS raises the keyboard only for a focus made while the tap that asked for
 * it is still being handled. The in-place editors focus their surface a
 * render later — they cannot sooner, the surface is built in an effect — and
 * by then the tap is over: the element takes the caret and the keyboard never
 * comes, so there is nothing to type with.
 *
 * So the tap focuses an invisible text field of its own, which is allowed to
 * raise the keyboard, and the editor takes focus from it when it opens. iOS
 * keeps a raised keyboard up when focus moves from one editable to another.
 * If no editor ever takes over, the stand-in lets go and the keyboard goes
 * down with it.
 *
 * Placed at the tap, so the scroll iOS makes to bring a focused field into
 * view has nowhere to go; 16px type, because iOS zooms the page in on any
 * smaller field it focuses.
 */
export function holdKeyboardForEdit(
  at: { x: number; y: number },
  doc: Document = document,
) {
  const input = doc.createElement('input')
  input.type = 'text'
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  input.setAttribute('autocomplete', 'off')
  Object.assign(input.style, {
    position: 'fixed',
    left: `${Math.max(0, at.x)}px`,
    top: `${Math.max(0, at.y)}px`,
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    fontSize: '16px',
    pointerEvents: 'none',
  })
  doc.body.appendChild(input)

  let timer = 0
  const release = () => {
    clearTimeout(timer)
    input.remove()
  }
  input.addEventListener('blur', release, { once: true })
  timer = window.setTimeout(() => {
    if (doc.activeElement === input) input.blur()
    release()
  }, KEYBOARD_HANDOFF_MS)
  input.focus({ preventScroll: true })
  return input
}
