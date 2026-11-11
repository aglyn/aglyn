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

import { useEffect } from 'react'

/**
 * The Besigner's own way back inside the native apps (AGL-4056).
 *
 * In the apps the editor has no native head and no Done button: the editor's
 * own back control is the one way out, and the apps' Esc, ⌘[ (Ctrl+[) and
 * back gesture all press it, so whatever that control does first (a prompt,
 * a save) happens the same for every one of them. The control goes to the
 * document's `/view`, which the apps read as "leave the editor".
 *
 * The apps reach the control by this id: native code clicks it from a script
 * (`BesignerEntry.backScript` in the Swift and Kotlin kits), and this file's
 * hook clicks it for the keys the web view receives itself.
 */
export const NATIVE_BESIGNER_BACK_CONTROL_ID = 'aglyn-besigner-back'

/** What a key event needs for the decision, so a spec can hand in a plain object. */
export interface BackKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

/** Whether `target` takes typing: a field, a select, or editable content. */
function takesTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return Boolean(element.isContentEditable) || element.getAttribute?.('contenteditable') === 'true'
}

/**
 * Something open over the editor that Esc should close first: a dialog, a
 * menu, a popover or a picker's list. MUI marks every one of them with these
 * roles; one kept mounted while closed sits inside a hidden modal.
 */
const OPEN_OVER_EDITOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .MuiPopover-root'
const CLOSED = '.MuiModal-hidden, [aria-hidden="true"], [hidden]'

function somethingOpenOverEditor(doc: Pick<Document, 'querySelectorAll'>): boolean {
  return Array.from(doc.querySelectorAll(OPEN_OVER_EDITOR)).some(
    (element) => !element.closest(CLOSED),
  )
}

/**
 * Whether a key leaves the editor through its back control: Esc on its own
 * when nothing else wanted it, or ⌘[ (Ctrl+[ off a Mac) at any time.
 *
 * Esc never leaves while a field has the focus, while something is open over
 * the editor, or when the page already handled it (a pick in progress, an
 * inline editor reverting): those are the Esc a person meant for them.
 */
export function backKeyLeavesEditor(
  event: BackKeyEvent,
  doc: Pick<Document, 'querySelectorAll'>,
  mac: boolean,
): boolean {
  if (event.defaultPrevented) return false
  if (event.key === '[') {
    const command = mac ? event.metaKey : event.ctrlKey
    return command && !event.altKey && !event.shiftKey
  }
  if (event.key !== 'Escape' && event.key !== 'Esc') return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
  if (takesTyping(event.target)) return false
  return !somethingOpenOverEditor(doc)
}

/** Presses the editor's back control; false when the page has none. */
export function pressBesignerBack(doc: Pick<Document, 'getElementById'>): boolean {
  const control = doc.getElementById(NATIVE_BESIGNER_BACK_CONTROL_ID)
  if (!control) return false
  control.click()
  return true
}

/** Whether this browser is on a Mac (where ⌘ is the command key). */
function onMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
}

/**
 * Inside the apps' web view, Esc and ⌘[ press the editor's back control.
 * Off (`enabled` false) it adds nothing, so a browser tab keeps Esc and ⌘[
 * exactly as they were.
 *
 * It listens after the page's own handlers (bubbling, on the window), so a
 * handler that took the key first stops it reaching here.
 */
export function useNativeBesignerBackKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const mac = onMac()
    const onKeyDown = (event: KeyboardEvent) => {
      if (!backKeyLeavesEditor(event, document, mac)) return
      if (!pressBesignerBack(document)) return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
