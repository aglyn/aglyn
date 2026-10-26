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
 * The rules for editing canvas text in place with a finger (AGL-4069).
 *
 * A mouse ends an edit the moment it presses somewhere else, and that is
 * right for a mouse: a press is a decision. A finger's press is not. On a
 * phone the same touch can become a tap, a scroll, a long press that selects
 * a word, or a drag of one of the selection handles iOS hangs off the ends of
 * the selected text. Those handles sit OUTSIDE the text, over whatever is
 * next to it, so the press that grabs one lands on another element. Ending
 * the edit on that press is what closed the keyboard under an author who was
 * only selecting more words.
 *
 * So on touch the decision waits for the finger to come up, and only a real
 * tap ends the edit: down and up close together in place and time, not on a
 * selection handle, and not taken over by the browser (a scroll or a handle
 * drag cancels the pointer).
 */

/** The furthest a finger may slide and still be tapping, in px. */
export const TOUCH_TAP_SLOP_PX = 10

/** The longest a press may last and still be a tap, in ms; longer is a hold. */
export const TOUCH_TAP_MAX_MS = 500

/**
 * How far from either end of the selection a press counts as reaching for a
 * selection handle, in px. iOS draws the knob a few points past the text and
 * takes touches well around it.
 */
export const SELECTION_HANDLE_REACH_PX = 32

/** A pointer event's input kind, as the edit's exit rules see it. */
export function isTouchPointer(event: Event): boolean {
  const type = (event as PointerEvent).pointerType
  return type === 'touch' || type === 'pen'
}

/** Whether the device's main pointer is a finger (a phone or a tablet). */
export function prefersTouchEditing(win: Window | undefined): boolean {
  if (!win || typeof win.matchMedia !== 'function') return false
  try {
    return win.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

interface Point {
  x: number
  y: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function distanceToBox(point: Point, box: Box): number {
  const dx = Math.max(box.left - point.x, 0, point.x - (box.left + box.width))
  const dy = Math.max(box.top - point.y, 0, point.y - (box.top + box.height))
  return Math.hypot(dx, dy)
}

/**
 * The boxes of a selection's two ends — where iOS hangs its handles. A
 * collapsed selection (a caret) has no handles, so none.
 */
export function selectionEndBoxes(selection: Selection | null): Box[] {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return []
  }
  const range = selection.getRangeAt(0)
  if (typeof range.getClientRects !== 'function') return []
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  )
  if (!rects.length) return []
  const first = rects[0]
  const last = rects[rects.length - 1]
  return [
    { left: first.left, top: first.top, width: 0, height: first.height },
    {
      left: last.left + last.width,
      top: last.top,
      width: 0,
      height: last.height,
    },
  ]
}

/** Whether `point` is within reach of a selection handle. */
export function isNearSelectionHandle(
  point: Point,
  ends: Box[],
  reach = SELECTION_HANDLE_REACH_PX,
): boolean {
  return ends.some((end) => distanceToBox(point, end) <= reach)
}

/** What became of a touch that started outside the text being edited. */
export type TouchPressOutcome = 'tap' | 'not-a-tap'

/**
 * Follows ONE touch from down to up and says whether it was a real tap.
 *
 * Fed raw pointer events; ignores every pointer but the one it started with.
 * `onHandle` presses — a touch that came down within reach of a selection
 * handle — never count as taps, even when they do not move: lifting a finger
 * off a handle is not a request to stop editing.
 */
export class TouchPressTracker {
  private press:
    | { id: number; x: number; y: number; at: number; moved: boolean }
    | undefined = undefined

  /** Starts following `event`'s pointer. A press near a handle is not followed. */
  down(event: PointerEvent, nearHandle: boolean): void {
    this.press = nearHandle
      ? undefined
      : {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          at: event.timeStamp,
          moved: false,
        }
  }

  move(event: PointerEvent): void {
    const press = this.press
    if (!press || event.pointerId !== press.id) return
    if (
      Math.hypot(event.clientX - press.x, event.clientY - press.y) >
      TOUCH_TAP_SLOP_PX
    ) {
      press.moved = true
    }
  }

  /** The browser took the touch over (a scroll, a handle drag): no tap. */
  cancel(event?: PointerEvent): void {
    if (event && this.press && event.pointerId !== this.press.id) return
    this.press = undefined
  }

  /** The finger came up; whether that made a tap. Ends the follow. */
  up(event: PointerEvent): TouchPressOutcome | undefined {
    const press = this.press
    if (!press || event.pointerId !== press.id) return undefined
    this.press = undefined
    const moved =
      press.moved ||
      Math.hypot(event.clientX - press.x, event.clientY - press.y) >
        TOUCH_TAP_SLOP_PX
    const held = event.timeStamp - press.at > TOUCH_TAP_MAX_MS
    return moved || held ? 'not-a-tap' : 'tap'
  }

  get following(): boolean {
    return Boolean(this.press)
  }
}

/** The part of the page the author can actually see, in fixed coordinates. */
export interface VisibleArea {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The visible area: the visual viewport where the browser has one.
 *
 * On a phone the on-screen keyboard covers the bottom of the LAYOUT viewport
 * without shrinking it, and iOS pans the page under it to keep the caret in
 * view. `position: fixed` is laid out against the layout viewport, so an
 * overlay placed by `innerHeight` can sit behind the keyboard or above the
 * top of the screen. The visual viewport is the part that is really showing;
 * its offsets put it in the same coordinates `position: fixed` uses.
 */
export function readVisibleArea(win: Window | undefined): VisibleArea {
  if (!win) return { left: 0, top: 0, width: Infinity, height: Infinity }
  const visual = win.visualViewport
  if (visual) {
    return {
      left: visual.offsetLeft,
      top: visual.offsetTop,
      width: visual.width,
      height: visual.height,
    }
  }
  return { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }
}

export interface DockedToolbarPlacement {
  /** Which edge of the visible area the toolbar sits on. */
  edge: 'top' | 'bottom'
  left: number
  top: number
  maxWidth: number
}

/**
 * Where the text toolbar goes while a finger edits: docked to an edge of the
 * visible area — just above the keyboard, unless the text being edited is
 * down there, and then the top.
 *
 * Not above the text, where a mouse finds it. iOS puts its own Cut / Copy /
 * Paste menu right there, over anything the page draws, so a toolbar
 * hanging off the top of the text is hidden whenever the author selects a
 * word — which is exactly when they want Bold. Above the keyboard is where a
 * phone's formatting bar lives, it is clear of that menu (iOS hangs the menu
 * next to the selection, and the selection is in the text), and the bottom
 * of the visible area IS the top of the keyboard, so the bar is never
 * behind it. It moves to the top only when it would cover the text itself.
 */
export function placeDockedToolbar(
  text: Box,
  area: VisibleArea,
  toolbarHeight: number,
  gap: number,
): DockedToolbarPlacement {
  const covers = (top: number) =>
    text.top < top + toolbarHeight + gap && text.top + text.height > top - gap
  const bottom = area.top + area.height - toolbarHeight - gap
  const top = area.top + gap
  const edge = covers(bottom) && !covers(top) ? 'top' : 'bottom'
  return {
    edge,
    left: area.left + gap,
    top: Math.max(area.top, edge === 'top' ? top : bottom),
    maxWidth: Math.max(0, area.width - gap * 2),
  }
}
