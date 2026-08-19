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

/**
 * "Is the user typing?" — the single predicate every besigner shortcut that
 * lives on `window`/`document` must consult before it acts (AGL-2211).
 *
 * A global shortcut is registered once and fires wherever focus happens to
 * be. The canvas shortcuts (Cmd+C/V/A) and the picker's Escape are only
 * meaningful when focus is on the element tree; inside a text-entry surface
 * the surface — or the browser — owns the keystroke, and the canvas handler
 * must return without calling `preventDefault()`.
 *
 * The surfaces are enumerated from what the besigner actually mounts, not
 * guessed:
 *
 * - `INPUT` / `TEXTAREA` / `SELECT` — every attributes-panel field, dialog
 *   field, and the plugin-settings raw-JSON `TextField`.
 * - `contenteditable` — the inline text and markdown editors' light-DOM
 *   halves, and MUI's rich fields.
 * - `role="textbox"` / `role="searchbox"` — ARIA-labelled custom inputs.
 * - **Monaco** (`.monaco-editor`), which is what `Edit -> Raw JSON` is.
 *   Monaco 0.52+ ships the `EditContext` API and `editor.editContext`
 *   DEFAULTS TO `true` (monaco-editor 0.56 —
 *   `esm/vs/editor/common/config/editorOptions.js`), so the focused node is
 *   a bare `<div class="native-edit-context" tabindex="0">`: **not** a
 *   textarea, **not** contenteditable, no role. Every tag/attribute test
 *   above misses it, which is exactly how Cmd+C in the raw JSON editor came
 *   to copy canvas ELEMENTS. `.native-edit-context` is matched too so the
 *   guard holds even if Monaco is ever mounted without its outer chrome.
 *
 * Deliberately DOM-only and dependency-free: `pick-manager` (this lib) and
 * the designer's clipboard shortcuts (the feature lib) both need it, so it
 * cannot reach for the inline-editor stores — the designer's
 * `isEditingText()` layers those on top.
 */

/**
 * Ancestors that make everything inside them a text-entry surface. Matched
 * with `closest()`, so a click target deep inside Monaco's view still reads
 * as "the user is typing".
 */
export const TEXT_ENTRY_HOST_SELECTOR = [
  '.monaco-editor',
  '.native-edit-context',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
].join(',')

/** Element tags that are always text entry. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** ARIA roles that are always text entry. */
const TEXT_ENTRY_ROLES = new Set(['textbox', 'searchbox'])

/**
 * True when `target` is (or sits inside) a surface that owns the keystroke.
 *
 * Accepts an `EventTarget` so a handler can pass `event.target` straight
 * through; anything that is not an element answers `false`.
 */
export function isTextEntryElement(
  target: EventTarget | Node | null | undefined,
): boolean {
  const element = target as HTMLElement | null
  if (!element || element.nodeType !== 1) return false
  if (element.isContentEditable) return true
  if (TEXT_ENTRY_TAGS.has(element.tagName)) return true
  const role = element.getAttribute?.('role')
  if (role && TEXT_ENTRY_ROLES.has(role)) return true
  return typeof element.closest === 'function'
    ? !!element.closest(TEXT_ENTRY_HOST_SELECTOR)
    : false
}

/**
 * True when focus currently rests in a text-entry surface.
 *
 * Descends through OPEN shadow roots: `document.activeElement` reports the
 * shadow HOST, so a field inside a web component would otherwise read as
 * "not text". The besigner canvas uses a CLOSED root, which is unreachable
 * by design — the designer's inline-edit stores answer for that surface.
 */
export function isTextEntryFocused(doc?: Document): boolean {
  const root = doc ?? (typeof document === 'undefined' ? null : document)
  if (!root) return false
  let active: Element | null = root.activeElement
  while (active) {
    if (isTextEntryElement(active)) return true
    const inner = (active as HTMLElement).shadowRoot?.activeElement
    if (!inner || inner === active) return false
    active = inner
  }
  return false
}
