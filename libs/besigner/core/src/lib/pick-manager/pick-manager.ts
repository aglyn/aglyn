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

import * as Aglyn from '@aglyn/aglyn'
import { observable, runInAction } from 'mobx'
import { isTextEntryElement, isTextEntryFocused } from '../text-entry'

/**
 * Canvas element-picker (AGL-574): the bridge that lets the console's
 * interaction builder point at an element by *clicking it on the canvas*
 * instead of hand-writing a CSS selector. The dialog calls {@link startPick}
 * with a callback and minimizes itself; the canvas leaves read
 * {@link isPicking} to paint a pick affordance and route the next click
 * through {@link handlePickClick}, which resolves the leaf's node id + a
 * human label and hands both back to the dialog before exiting pick mode.
 *
 * A MobX store (mirroring the focus-manager seam) so the canvas
 * `node-leaf` / `draggable-droppable` observers react without threading
 * React context through the dnd layer, while the console dialog drives it
 * imperatively via the exported functions. The picked selector is the RAW
 * canvas id — `[data-aglyn="leaf:<id>"]` — which resolves on the live site
 * thanks to AGL-573's prefix-insensitive matching.
 */
export type PickHandler = (nodeId: string, label: string) => void

export interface StartPickOptions {
  /** Prompt shown in the picking banner (e.g. "Click a menu element"). */
  hint?: string
  /** Invoked when the user aborts the pick (Escape / Cancel). */
  onCancel?: () => void
}

interface PickState {
  /** True while the canvas is waiting for the designer to click an element. */
  isPicking: boolean
  /** Optional prompt for the picking banner. */
  hint?: string
}

const state = observable<PickState>({ isPicking: false, hint: undefined })

// Handler refs live outside the observable — they are plain callbacks, not
// reactive state, and must not be wrapped by MobX.
let onPicked: PickHandler | null = null
let onCancel: (() => void) | null = null
let escapeListener: ((event: KeyboardEvent) => void) | null = null

/** Reactive: true while a pick is in progress (read from canvas observers). */
export function isPicking(): boolean {
  return state.isPicking
}

/** Reactive: the current picking banner prompt, if any. */
export function getHint(): string | undefined {
  return state.hint
}

/**
 * Enters pick mode. The next canvas leaf click resolves to
 * `handler(nodeId, label)`; Escape (or {@link cancelPick}) aborts and runs
 * `options.onCancel`. Starting a new pick supersedes any in-flight one.
 */
export function startPick(
  handler: PickHandler,
  options: StartPickOptions = {},
): void {
  teardownEscape()
  onPicked = handler
  onCancel = options.onCancel ?? null
  runInAction(() => {
    state.isPicking = true
    state.hint = options.hint
  })
  if (typeof window !== 'undefined') {
    escapeListener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Pick mode only MINIMIZES the interaction builder — the whole
      // besigner (attributes panel, custom-CSS field, raw JSON editor,
      // inline editors) stays live underneath. A capture-phase Escape that
      // ignores focus therefore steals the keystroke a field owns: closing
      // a Select/Autocomplete popper, reverting an inline text edit, or
      // dismissing Monaco's find widget. Text entry wins; the banner's
      // Cancel button, and Escape once focus leaves the field, still abort
      // the pick (AGL-2212).
      if (isTextEntryElement(event.target) || isTextEntryFocused()) return
      event.preventDefault()
      event.stopPropagation()
      cancelPick()
    }
    // Capture phase so the canvas/dialog can't swallow the abort first.
    window.addEventListener('keydown', escapeListener, true)
  }
}

/** Aborts the current pick and notifies the caller's `onCancel`. */
export function cancelPick(): void {
  if (!state.isPicking && !onPicked) return
  const cancel = onCancel
  teardown()
  cancel?.()
}

/**
 * Canvas-side entry point: the leaf that was clicked while picking hands us
 * its node id. Resolves a human label, exits pick mode, then fires the
 * dialog's callback. No-ops when not picking so a stray click is harmless.
 */
export function handlePickClick(nodeId: string): void {
  if (!state.isPicking) return
  const handler = onPicked
  const label = nodeElementLabel(nodeId)
  teardown()
  handler?.(nodeId, label)
}

function teardown(): void {
  onPicked = null
  onCancel = null
  teardownEscape()
  runInAction(() => {
    state.isPicking = false
    state.hint = undefined
  })
}

function teardownEscape(): void {
  if (escapeListener && typeof window !== 'undefined') {
    window.removeEventListener('keydown', escapeListener, true)
  }
  escapeListener = null
}

/**
 * A friendly, human-readable label for a canvas node — its component's
 * display name, the first string child in quotes when present, and the raw
 * componentId in parentheses (e.g. `Dropdown "Shop" (muiNavMenu)`). Shared
 * by the picker callback and the dialog's target chip so both read the same.
 */
export function nodeElementLabel(nodeId: string): string {
  const node = Aglyn.canvas.getNode(nodeId as Aglyn.NodeId) as
    { componentId?: string; props?: { children?: unknown } } | undefined
  const componentId = String(node?.componentId ?? '')
  const displayName =
    Aglyn.components.getSchema(componentId as Aglyn.ComponentId)?.displayName ||
    componentId ||
    'Element'
  const rawChildren = node?.props?.children
  const text =
    typeof rawChildren === 'string' ? rawChildren.trim().slice(0, 24) : ''
  const suffix =
    componentId && componentId !== displayName ? ` (${componentId})` : ''
  return `${displayName}${text ? ` "${text}"` : ''}${suffix}`
}
