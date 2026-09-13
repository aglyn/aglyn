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

import { SCROLL_TO_MAX_OFFSET_PX, type ScrollToBehavior } from './actions'
import { LAYOUT_NODE_ID_PREFIXES } from './compose-layout-nodes'
import { ELEMENT_HIDDEN_CLASS } from './element-hidden-style'
import { COMPONENT_NODE_ID_PREFIX } from './reusable-component-keys'

export * from './element-hidden-style'

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
 * Whether an id looks like a reusable-component graft (AGL-1229).
 *
 * A graft's namespace is `cmp__{instanceId}__`, and unlike the layout
 * prefixes it CANNOT be enumerated — there is one per placement, and the
 * instance id is itself often composed: the nav really ships
 * `cmp__layout__52Ef-3t6yd___R91yATrXH`.
 *
 * It also cannot be reliably PARSED off. With a raw id that starts with `_`
 * (nanoid does that routinely) the `___` boundary splits two ways and both
 * are structurally valid, so stripping guesses wrong half the time. Hence
 * {@link leafIdsMatch} compares by suffix instead of normalizing — a
 * composed id always ends in the raw id it was built from.
 */
const isComponentGraft = (id: string) =>
  id.startsWith(COMPONENT_NODE_ID_PREFIX)

/**
 * Strips a single leading LAYOUT namespace prefix from a node/leaf id so ids
 * authored against the raw canvas id and ids stamped on the live
 * layout-composed DOM compare equal (AGL-573). Idempotent for an
 * already-raw id, and only a *leading* prefix is removed, so unrelated ids
 * can never be coerced into colliding.
 *
 * Deliberately does NOT try to strip a reusable-component graft — that
 * namespace is unparseable (see {@link isComponentGraft}); `leafIdsMatch`
 * and `expandLeafSelector` handle grafts by suffix.
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
 * namespace prefixes (AGL-573, extended to reusable-component grafts by
 * AGL-1229) — the durable half of the fix for interactions authored on
 * composed elements, whose stored command id is the raw canvas id while the
 * live element's id is namespaced.
 *
 * Layout prefixes are stripped exactly. A component graft is matched by
 * SUFFIX instead, because its namespace cannot be parsed off unambiguously
 * (see {@link isComponentGraft}) — a composed id always ends in `__` plus
 * the raw id it was built from, and a raw id is a single nanoid with no
 * `__` boundary to spare, so the suffix cannot reach an unrelated node.
 *
 * Two empty ids never match (a missing id is not a wildcard).
 */
export function leafIdsMatch(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  const left = normalizeLeafId(a)
  const right = normalizeLeafId(b)
  if (left === '' || right === '') return false
  if (left === right) return true
  if (isComponentGraft(right) && right.endsWith(`__${left}`)) return true
  if (isComponentGraft(left) && left.endsWith(`__${right}`)) return true
  return false
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
 * same node once composition has namespaced its live id (AGL-573, extended
 * to reusable components by AGL-1229):
 *
 *   [data-aglyn="leaf:_5I3TBXywa"]
 *     → [data-aglyn="leaf:_5I3TBXywa"],
 *       [data-aglyn="leaf:layout___5I3TBXywa"],
 *       [data-aglyn$="___5I3TBXywa"]
 *
 * The layout alternatives stay enumerated and exactly anchored. The last is
 * a SUFFIX match, and it is the only way to reach a reusable-component
 * graft: its namespace is `cmp__{instanceId}__`, one per placement, so
 * there is no finite prefix list to enumerate.
 *
 * The suffix cannot collide. A composed id always ends in the raw id it was
 * built from, so matching `__` + the exact raw id can only reach a
 * composition OF THAT id — reaching an unrelated node would need that
 * node's own raw id to end in `__` plus a full id, and raw ids are a single
 * fixed-length nanoid with no `__` boundary to spare.
 *
 * Any non-leaf selector — a plain CSS selector an author typed by hand —
 * passes through verbatim.
 */
export function expandLeafSelector(selector: string): string {
  const rawId = leafIdFromSelector(selector)
  if (!rawId) return selector
  const base = normalizeLeafId(rawId)
  const exact = [
    base,
    ...LEAF_ID_NAMESPACE_PREFIXES.map((prefix) => `${prefix}${base}`),
  ].map((id) => `[data-aglyn="leaf:${id}"]`)
  return [...exact, `[data-aglyn$="__${base}"]`].join(', ')
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

/* ── One-target steps: scroll to an element, play a video (AGL-2867) ── */

/**
 * The element a one-target step acts on: the first match that has a layout
 * box, or null.
 *
 * Every match is read rather than only the first, because one element can
 * legitimately appear twice — an expanded leaf selector reaches each
 * composition of an id, and a page may carry a desktop and a mobile copy with
 * one hidden at each breakpoint. The copy the visitor can see is the one they
 * meant.
 *
 * A match with no box is never acted on. Scrolling to a `display: none`
 * element lands at the top of the page, and pressing a hidden player starts a
 * film nobody can see, so a target that is not on the page in the layout
 * sense makes the step a no-op, as a missing or deleted one does.
 */
export function resolveStepTarget(
  selector: string,
  root: ParentNode = document,
): HTMLElement | SVGElement | null {
  let matches: Element[]
  try {
    matches = Array.from(root.querySelectorAll(selector))
  } catch {
    return null // Invalid stored selector — never break the page.
  }
  const shown = matches.find((element) => element.getClientRects().length > 0)
  return (shown as HTMLElement | SVGElement | undefined) ?? null
}

export interface ScrollToStepOptions {
  /** Absent means `smooth`; reduced motion overrides either to `instant`. */
  behavior?: ScrollToBehavior
  /** Pixels left above the target; clamped to 0–{@link SCROLL_TO_MAX_OFFSET_PX}. */
  offsetPx?: number
}

/** The nearest ancestor that scrolls its own content, below the document. */
function scrollContainerOf(element: Element, view: Window): Element | null {
  const doc = element.ownerDocument
  for (
    let node = element.parentElement;
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    const { overflowY } = view.getComputedStyle(node)
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node
    }
  }
  return null
}

/**
 * Focus for a keyboard visitor, without the second scroll `focus()` would
 * start on its own.
 *
 * An element that cannot take focus is given `tabindex="-1"` for the length
 * of the visit to it — focusable by script, never added to the Tab order —
 * and loses it again on blur, so the author's markup is left as it was.
 */
function focusWithoutScrolling(element: HTMLElement | SVGElement): void {
  if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1')
    element.addEventListener('blur', () => element.removeAttribute('tabindex'), {
      once: true,
    })
  }
  element.focus({ preventScroll: true })
}

/**
 * Runs a `scrollTo` step: brings the target to the top of the window, less
 * the offset, and moves focus to it. Returns whether there was a target.
 *
 * The position is computed and handed to the window rather than asked of
 * `scrollIntoView`, because the offset has nowhere to go in that call except
 * a `scroll-margin` written onto the author's element. A target inside a box
 * that scrolls its own content is the exception, and there the box has to be
 * scrolled too, which `scrollIntoView` does for every such ancestor at once;
 * the offset is for a header over the page, not for a panel's own edge.
 *
 * Reduced motion is read at the moment of the press, so a visitor who changes
 * the setting mid-visit gets what they asked for on the next one.
 */
export function runScrollToStep(
  selector: string,
  options: ScrollToStepOptions = {},
  doc: Document = document,
): boolean {
  const view = doc.defaultView
  const target = resolveStepTarget(selector, doc)
  if (!view || !target) return false
  const reduceMotion =
    view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  const behavior: ScrollBehavior =
    reduceMotion || options.behavior === 'instant' ? 'instant' : 'smooth'
  if (scrollContainerOf(target, view)) {
    target.scrollIntoView({ behavior, block: 'start' })
  } else {
    const requested = Number(options.offsetPx)
    const offset = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 0), SCROLL_TO_MAX_OFFSET_PX)
      : 0
    const top = view.scrollY + target.getBoundingClientRect().top - offset
    view.scrollTo({ top: Math.max(0, top), behavior })
  }
  focusWithoutScrolling(target)
  return true
}

/**
 * The event a Video element answers with its own poster press.
 *
 * Dispatched ON the element, where the drawer and menu commands go to
 * `window`. Those buses need an address because a command with none means
 * "the page's first drawer"; a `playVideo` step has already found its element
 * through its selector, so the element that receives the event is the one that
 * should answer, with no id to parse or compare.
 */
export const VIDEO_COMMAND_EVENT = 'aglyn:video-command'

export type VideoCommand = 'play'

export interface VideoCommandDetail {
  command: VideoCommand
}

/**
 * Sends a command to an element. Returns whether a Video element answered —
 * a listener registered through {@link subscribeVideoCommands} cancels the
 * event to say so — which is false for an element that is not a Video.
 */
export function dispatchVideoCommand(
  element: EventTarget,
  command: VideoCommand,
): boolean {
  return !element.dispatchEvent(
    new CustomEvent<VideoCommandDetail>(VIDEO_COMMAND_EVENT, {
      detail: { command },
      cancelable: true,
    }),
  )
}

/** Answers video commands sent to `element`; returns the unsubscriber. */
export function subscribeVideoCommands(
  element: EventTarget,
  handler: (detail: VideoCommandDetail) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<VideoCommandDetail>).detail
    if (!detail?.command) return
    event.preventDefault()
    handler(detail)
  }
  element.addEventListener(VIDEO_COMMAND_EVENT, listener)
  return () => element.removeEventListener(VIDEO_COMMAND_EVENT, listener)
}

/**
 * Runs a `playVideo` step: presses the poster of the Video element the
 * selector names. Returns whether a Video answered.
 */
export function runPlayVideoStep(
  selector: string,
  doc: Document = document,
): boolean {
  const target = resolveStepTarget(selector, doc)
  return target ? dispatchVideoCommand(target, 'play') : false
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
