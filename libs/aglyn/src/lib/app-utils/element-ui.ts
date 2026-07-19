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
 * Element UI choreography contract (AGL-562): the shared pieces the
 * interactions executor (marketing site runtime), the drawer element
 * (plugins-mui), and the besigner authoring surfaces agree on —
 * show/hide semantics, the drawer command event bus, and the responsive
 * visibility media bands. Pure constants + DOM helpers; every function
 * that touches `window`/`document` is only ever called client-side.
 */

/**
 * Class the show/hide steps toggle. The tenant page ships
 * `ELEMENT_HIDDEN_STYLE_TEXT` in its SSR HTML so an author-applied
 * "start hidden" class paints hidden from the first frame; the besigner
 * canvas deliberately omits the rule so hidden elements stay editable
 * (same posture as the AGL-557 reveal outcome).
 */
export const ELEMENT_HIDDEN_CLASS = 'aglyn-hidden'

/** Stylesheet rule backing {@link ELEMENT_HIDDEN_CLASS}. */
export const ELEMENT_HIDDEN_STYLE_TEXT = `.${ELEMENT_HIDDEN_CLASS}{display:none !important}`

/** Id of the injected fallback style tag (idempotence marker). */
export const ELEMENT_HIDDEN_STYLE_ID = 'aglyn-element-hidden-style'

/**
 * Ensures the hidden-class rule exists in the document (the tenant page
 * renders it during SSR; this is the belt-and-braces path for other
 * surfaces, e.g. the interaction builder's Test button).
 */
export function ensureElementHiddenStyle(doc: Document = document): void {
  if (doc.getElementById(ELEMENT_HIDDEN_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = ELEMENT_HIDDEN_STYLE_ID
  style.textContent = ELEMENT_HIDDEN_STYLE_TEXT
  doc.head.appendChild(style)
}

export type ElementVisibilityCommand = 'show' | 'hide' | 'toggle'

/**
 * Applies a show/hide/toggle command to every element the selector
 * matches. Hide adds the shared hidden class; show removes it AND any
 * inline `display: none` so an element hidden either way reveals; toggle
 * flips per element. Returns the number of elements touched (0 for a
 * selector that matches nothing — steps never throw).
 */
export function applyElementVisibility(
  command: ElementVisibilityCommand,
  selector: string,
  root: ParentNode = document,
): number {
  let elements: Element[]
  try {
    elements = Array.from(root.querySelectorAll(selector))
  } catch {
    return 0 // Invalid stored selector — never break the page.
  }
  for (const element of elements) {
    const hidden = element.classList.contains(ELEMENT_HIDDEN_CLASS)
    const nextHidden = command === 'toggle' ? !hidden : command === 'hide'
    element.classList.toggle(ELEMENT_HIDDEN_CLASS, nextHidden)
    if (!nextHidden && element instanceof HTMLElement) {
      // Clear a leftover inline hide (e.g. from custom CSS experiments)
      // so "show" always actually reveals.
      if (element.style.display === 'none') element.style.removeProperty('display')
    }
  }
  return elements.length
}

/* ── Drawer command bus ─────────────────────────────────────────────── */

export type DrawerCommand = 'open' | 'close' | 'toggle'

/**
 * Window event carrying a drawer command. Keeping the transport at the
 * DOM level lets the marketing automations engine drive drawers without
 * importing the mui plugin (and vice versa).
 */
export const DRAWER_COMMAND_EVENT = 'aglyn:drawer-command'

export interface DrawerCommandDetail {
  command: DrawerCommand
  /** Target drawer's canvas node id; absent = the page's first drawer. */
  nodeId?: string
}

/** Dispatches a drawer command onto the window event bus. */
export function dispatchDrawerCommand(
  command: DrawerCommand,
  nodeId?: string,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<DrawerCommandDetail>(DRAWER_COMMAND_EVENT, {
      detail: { command, ...(nodeId ? { nodeId } : {}) },
    }),
  )
}

/**
 * Subscribes to drawer commands; returns the unsubscriber. The handler
 * receives every command — drawer instances filter by their own node id
 * (or first-registered status for broadcasts).
 */
export function subscribeDrawerCommands(
  handler: (detail: DrawerCommandDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<DrawerCommandDetail>).detail
    if (detail?.command) handler(detail)
  }
  window.addEventListener(DRAWER_COMMAND_EVENT, listener)
  return () => window.removeEventListener(DRAWER_COMMAND_EVENT, listener)
}

/* ── Responsive visibility bands (AGL-562) ──────────────────────────── */

/**
 * The three authoring-facing visibility bands and the sx media-query
 * keys the styles panel writes `display: none` under. Range-scoped
 * queries (not MUI's mobile-first responsive objects) so hiding one band
 * never needs a "restore" display value on the others — the element's
 * natural display simply keeps applying outside the hidden range.
 * Boundaries follow the MUI defaults the device preview uses: mobile
 * under 600, tablet 600–899, desktop 900 and up.
 */
export const VISIBILITY_BANDS = ['mobile', 'tablet', 'desktop'] as const

export type VisibilityBand = (typeof VISIBILITY_BANDS)[number]

export const VISIBILITY_BAND_MEDIA: Record<VisibilityBand, string> = {
  mobile: '@media (max-width:599.95px)',
  tablet: '@media (min-width:600px) and (max-width:899.95px)',
  desktop: '@media (min-width:900px)',
}
