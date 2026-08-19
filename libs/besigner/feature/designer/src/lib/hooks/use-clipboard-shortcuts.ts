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

import * as Besigner from '@aglyn/besigner'
import { useEffect } from 'react'
import { inlineMarkdownEdit } from '../utils/inline-markdown-edit.store'
import { inlineTextEdit } from '../utils/inline-text-edit.store'
import {
  useCopyElementsCallback,
  usePasteElementsCallback,
} from './use-clipboard-callbacks'

/**
 * True when the keystroke belongs to text the user is editing, not to the
 * element tree — in which case the browser's own copy/paste must win.
 *
 * Three surfaces have to be recognised. The attributes panel, every dialog
 * and the raw JSON editor live in the light DOM, so the event target and
 * `document.activeElement` identify them — that is
 * {@link Besigner.isTextEntryElement} / {@link Besigner.isTextEntryFocused},
 * which enumerate the real surfaces (fields, `contenteditable`, ARIA text
 * roles, and **Monaco**, whose focused node under the EditContext API is a
 * bare `<div class="native-edit-context">`; missing it is what made Cmd+C in
 * the raw JSON editor copy canvas ELEMENTS — AGL-2211).
 *
 * The canvas is the exception: it renders into a CLOSED shadow root, so a
 * keydown from an inline text editor retargets to the shadow host and looks
 * exactly like "the canvas has focus". The inline editor's own store is the
 * only honest signal there, so it is consulted directly.
 *
 * The in-place markdown editor (AGL-1624) needs the same treatment for a
 * second reason: its toolbar buttons, link popover and URL dialog take focus,
 * so `document.activeElement` is often a BUTTON while the author is very much
 * editing a document — and Cmd+C would then copy canvas ELEMENTS.
 *
 * @param target - Optional event target — the keydown's own target, which is
 *   more precise than `activeElement` and is checked first.
 */
export function isEditingText(target?: EventTarget | null): boolean {
  if (inlineTextEdit.node) return true
  if (inlineMarkdownEdit.node) return true

  if (Besigner.isTextEntryElement(target)) return true
  if (Besigner.isTextEntryFocused()) return true
  if (!document.activeElement) return false

  // A real text selection means the user is copying words, not structure.
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && !!selection.toString()
}

/**
 * Cmd/Ctrl+C and Cmd/Ctrl+V for canvas elements (AGL-1202), plus Cmd/Ctrl+A
 * for the same-depth "select all" the focus manager already implements.
 *
 * Mounted once by the besigner root provider, so every besigner surface
 * (screens, layouts, components, templates, emails) gets the same shortcuts.
 */
export function useClipboardShortcuts(): void {
  const copyElements = useCopyElementsCallback()
  const pasteElements = usePasteElementsCallback()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'c' && key !== 'v' && key !== 'a') return
      if (isEditingText(event.target)) return

      if (key === 'a') {
        // Nothing selected means no anchor to pick a depth from, and
        // swallowing Cmd+A then would break select-all everywhere else.
        if (!Besigner.focus.getSelected().length) return
        event.preventDefault()
        Besigner.focus.selectAllAtDepth()
        return
      }
      if (key === 'c') {
        const selected = Besigner.focus.getSelected()
        if (!selected.length) return
        event.preventDefault()
        copyElements(selected)
        return
      }
      // Paste targets the current selection; with nothing selected the
      // canvas root receives it, matching Add element.
      if (!Besigner.clipboard.hasContent()) return
      event.preventDefault()
      pasteElements(Besigner.focus.getLastSelected())
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copyElements, pasteElements])
}

export default useClipboardShortcuts
