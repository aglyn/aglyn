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

import { LAYOUT_NODE_ID_PREFIXES } from './compose-layout-nodes'

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

/* ── Visibility choreography: grace delays + self-dismissal (AGL-589) ── */

export interface ElementVisibilityOptions {
  /** Defer the change; a later visibility step on the same selector
   * cancels the pending one — the hover grace period. */
  delayMs?: number
  /** Self-dismiss a SHOWN element on Escape / a pointerdown outside it. */
  dismissOn?: Array<'escape' | 'outsideClick'>
}

// Selector-keyed registries. One document per site runtime, so module
// scope is the right lifetime; reset exists for tests.
const pendingVisibilityTimers = new Map<string, ReturnType<typeof setTimeout>>()
const activeDismissers = new Map<string, () => void>()

/** Tears down all pending timers and dismiss listeners (tests). */
export function resetElementVisibilityChoreography(): void {
  for (const timer of pendingVisibilityTimers.values()) clearTimeout(timer)
  pendingVisibilityTimers.clear()
  for (const teardown of activeDismissers.values()) teardown()
  activeDismissers.clear()
}

function disarmDismissal(selector: string): void {
  activeDismissers.get(selector)?.()
  activeDismissers.delete(selector)
}

function armDismissal(
  selector: string,
  dismissOn: NonNullable<ElementVisibilityOptions['dismissOn']>,
  doc: Document,
): void {
  disarmDismissal(selector)
  if (!dismissOn.length) return
  const dismiss = () => {
    applyElementVisibility('hide', selector, doc)
    disarmDismissal(selector)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss()
  }
  const onPointerDown = (event: Event) => {
    const target = event.target as Element | null
    // Inside the shown element (or its trigger sharing a wrapper that
    // matches the selector) never dismisses — only genuine outside taps.
    if (target?.closest?.(selector)) return
    dismiss()
  }
  if (dismissOn.includes('escape')) {
    doc.addEventListener('keydown', onKeyDown)
  }
  if (dismissOn.includes('outsideClick')) {
    doc.addEventListener('pointerdown', onPointerDown)
  }
  activeDismissers.set(selector, () => {
    doc.removeEventListener('keydown', onKeyDown)
    doc.removeEventListener('pointerdown', onPointerDown)
  })
}

/**
 * Runs an element-visibility step with menu-grade choreography (AGL-589):
 *
 * - `delayMs` defers the change; ANY later visibility step on the same
 *   selector cancels the pending one first. Hover menus author
 *   hover-enter → show (immediate, cancels a pending hide) and
 *   hover-leave → hide with a small delay — the classic grace period.
 * - `dismissOn` arms Escape / outside-pointerdown listeners while the
 *   element is shown (armed AFTER the change applies, so the click that
 *   opened it can never instantly close it) and disarms them on hide.
 *
 * Without options this is exactly {@link applyElementVisibility}.
 */
export function runElementVisibilityStep(
  command: ElementVisibilityCommand,
  selector: string,
  options: ElementVisibilityOptions = {},
  doc: Document = document,
): void {
  // Later intent wins: cancel whatever is pending for this selector.
  const pending = pendingVisibilityTimers.get(selector)
  if (pending != null) {
    clearTimeout(pending)
    pendingVisibilityTimers.delete(selector)
  }
  const apply = () => {
    pendingVisibilityTimers.delete(selector)
    applyElementVisibility(command, selector, doc)
    const dismissOn = options.dismissOn ?? []
    if (!dismissOn.length) return
    // Toggle can land either way — read the DOM for the outcome.
    let shown = command === 'show'
    if (command === 'toggle') {
      try {
        const element = doc.querySelector(selector)
        shown =
          element != null &&
          !element.classList.contains(ELEMENT_HIDDEN_CLASS)
      } catch {
        shown = false
      }
    }
    if (command === 'hide' || !shown) disarmDismissal(selector)
    else armDismissal(selector, dismissOn, doc)
  }
  const delay = Number(options.delayMs)
  if (Number.isFinite(delay) && delay > 0) {
    pendingVisibilityTimers.set(selector, setTimeout(apply, delay))
  } else {
    apply()
  }
}

/* ── Layout-namespace-insensitive id matching (AGL-573) ─────────────── */

/**
 * Composition namespace prefixes the live runtime can graft onto a node's
 * canvas id. Layout nodes are namespaced during screen composition
 * ({@link LAYOUT_NODE_ID_PREFIXES}) so they can never collide with screen
 * ids — which means an interaction authored against the RAW canvas id
 * (what the besigner builder emits: `menuNodeId` and the
 * `[data-aglyn="leaf:<id>"]` selector) is not byte-equal to the id the
 * live, layout-composed DOM carries.
 *
 * One entry per level of the layout chain (AGL-703): a layout nested
 * inside another carries `layout2__`, and an interaction authored on it
 * must still match. Being a list was already the design; nesting is the
 * case it was left open for.
 */
const LEAF_ID_NAMESPACE_PREFIXES = LAYOUT_NODE_ID_PREFIXES

/**
 * Strips a single leading composition namespace prefix from a node/leaf id
 * so ids authored against the raw canvas id and ids stamped on the live
 * (layout-composed) DOM compare equal (AGL-573). Idempotent for an
 * already-raw id, and only a *leading* prefix is removed, so unrelated ids
 * can never be coerced into colliding.
 *
 * @example
 * normalizeLeafId('layout___5I3TBXywa') // → '_5I3TBXywa'
 * normalizeLeafId('_5I3TBXywa')         // → '_5I3TBXywa'
 */
export function normalizeLeafId(id: string | undefined | null): string {
  const value = String(id ?? '')
  for (const prefix of LEAF_ID_NAMESPACE_PREFIXES) {
    if (value.startsWith(prefix)) return value.slice(prefix.length)
  }
  return value
}

/**
 * Whether two node ids address the same node ignoring composition
 * namespace prefixes (AGL-573) — the durable half of the fix for
 * interactions authored on layout-scoped elements, whose stored command id
 * is the raw canvas id while the live element's id is `layout__`-namespaced.
 * Two empty ids never match (a missing id is not a wildcard).
 */
export function leafIdsMatch(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  const left = normalizeLeafId(a)
  return left !== '' && left === normalizeLeafId(b)
}

/**
 * Extracts the leaf id from a canonical `[data-aglyn="leaf:<id>"]`
 * selector (the exact form the renderer and the interaction builder emit),
 * or `undefined` for any other selector.
 */
export function leafIdFromSelector(selector: string): string | undefined {
  const match = /^\s*\[data-aglyn="leaf:(.+)"\]\s*$/.exec(selector)
  return match?.[1] || undefined
}

/**
 * Rewrites a `[data-aglyn="leaf:<id>"]` selector so it ALSO matches the
 * same node once layout composition has namespaced its live id (AGL-573):
 *
 *   [data-aglyn="leaf:_5I3TBXywa"]
 *     → [data-aglyn="leaf:_5I3TBXywa"], [data-aglyn="leaf:layout___5I3TBXywa"]
 *
 * Each alternative is anchored to the exact id (raw, or a namespace prefix
 * plus the exact id), so an id can never match an unrelated node that
 * merely contains it as a substring. Any non-leaf selector — a plain CSS
 * selector an author typed by hand — passes through verbatim.
 */
export function expandLeafSelector(selector: string): string {
  const rawId = leafIdFromSelector(selector)
  if (!rawId) return selector
  const base = normalizeLeafId(rawId)
  const ids = [
    base,
    ...LEAF_ID_NAMESPACE_PREFIXES.map((prefix) => `${prefix}${base}`),
  ]
  return ids.map((id) => `[data-aglyn="leaf:${id}"]`).join(', ')
}

/* ── UI command buses (drawer AGL-562, menu AGL-568) ────────────────── */

/**
 * Shared open/close/toggle transport for popup-like elements. Keeping
 * the transport at the DOM level lets the marketing automations engine
 * drive drawers and menus without importing the mui plugin (and vice
 * versa). Each surface keeps its own event name so the drawer contract
 * shipped in AGL-562 stays byte-for-byte stable.
 */
interface UiCommandDetail {
  command: 'open' | 'close' | 'toggle'
  nodeId?: string
}

function dispatchUiCommand<TDetail extends UiCommandDetail>(
  eventName: string,
  detail: TDetail,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<TDetail>(eventName, { detail }))
}

function subscribeUiCommands<TDetail extends UiCommandDetail>(
  eventName: string,
  handler: (detail: TDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TDetail>).detail
    if (detail?.command) handler(detail)
  }
  window.addEventListener(eventName, listener)
  return () => window.removeEventListener(eventName, listener)
}

export type DrawerCommand = 'open' | 'close' | 'toggle'

/** Window event carrying a drawer command (AGL-562). */
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
  dispatchUiCommand<DrawerCommandDetail>(DRAWER_COMMAND_EVENT, {
    command,
    ...(nodeId ? { nodeId } : {}),
  })
}

/**
 * Subscribes to drawer commands; returns the unsubscriber. The handler
 * receives every command — drawer instances filter by their own node id
 * (or first-registered status for broadcasts).
 */
export function subscribeDrawerCommands(
  handler: (detail: DrawerCommandDetail) => void,
): () => void {
  return subscribeUiCommands(DRAWER_COMMAND_EVENT, handler)
}

export type MenuCommand = 'open' | 'close' | 'toggle'

/**
 * Window event carrying a nav-menu command (AGL-568): the interactions
 * system's open/close/toggle steps address Dropdown Menu and Mega Menu
 * elements over this bus, exactly like drawers — no bespoke "open on"
 * attribute involved.
 */
export const MENU_COMMAND_EVENT = 'aglyn:menu-command'

export interface MenuCommandDetail {
  command: MenuCommand
  /** Target menu's canvas node id; absent = the page's first menu. */
  nodeId?: string
  /**
   * Set when the command came from a hover trigger: a menu opened this
   * way closes itself once the pointer leaves the trigger + panel
   * surface (standard hover-menu UX), while click/command opens stay
   * put until an explicit close, click-away, or Escape.
   */
  hover?: boolean
}

/** Dispatches a menu command onto the window event bus. */
export function dispatchMenuCommand(
  command: MenuCommand,
  nodeId?: string,
  options?: { hover?: boolean },
): void {
  dispatchUiCommand<MenuCommandDetail>(MENU_COMMAND_EVENT, {
    command,
    ...(nodeId ? { nodeId } : {}),
    ...(options?.hover ? { hover: true } : {}),
  })
}

/**
 * Subscribes to menu commands; returns the unsubscriber. The handler
 * receives every command — menu instances filter by their own node id
 * (or first-registered status for broadcasts).
 */
export function subscribeMenuCommands(
  handler: (detail: MenuCommandDetail) => void,
): () => void {
  return subscribeUiCommands(MENU_COMMAND_EVENT, handler)
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
