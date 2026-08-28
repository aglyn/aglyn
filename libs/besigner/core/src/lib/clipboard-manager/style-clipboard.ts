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

/**
 * Besigner STYLE clipboard.
 *
 * The element clipboard beside it carries whole subtrees. This carries a
 * look: everything the Styles panel writes to one element, so a heading
 * styled once can be applied to five more without rebuilding it field by
 * field or duplicating an element and re-authoring its content.
 *
 * ## What a "style" is here
 *
 * `node.sx` and only `node.sx` — the Styles panel's entire output, including
 * its responsive, `@scheme` and interaction-state slices, which are keys
 * inside that object rather than separate storage.
 *
 * NOT classes. A class is a name pointing at rules the element does not own,
 * and two of them carry behaviour rather than appearance: `aglyn-hidden`
 * enrols an element in interaction choreography, and a theme utility class
 * may be targeted by an interaction's class steps. Carrying those across on
 * a "paste styles" would move behaviour under a label that promises looks.
 *
 * ## Paste REPLACES
 *
 * Merging would make the result depend on what the target already had, so
 * pasting the same look onto two elements could produce two different
 * elements — and there would be no way to paste "no styles". Undo is the way
 * back, as it is for every other edit.
 *
 * Mirrored into `localStorage` on the same terms as the element clipboard, so
 * a look copied in one document can be pasted in another after the full page
 * navigation between two besigner routes.
 */

/** `localStorage` key holding the mirrored style entry. */
export const STYLE_CLIPBOARD_STORAGE_KEY = 'aglyn:besigner:style-clipboard'

/** Bumped when the persisted shape changes; an older entry is dropped. */
export const STYLE_CLIPBOARD_FORMAT_VERSION = 1

export interface StyleClipboardEntry {
  version: number
  /** The element the look was taken from, for the menu ("from Heading"). */
  label: string
  /** The Styles panel's whole output. `null` is a real value: no styles. */
  sx: Record<string, unknown> | null
}

interface StyleClipboardState {
  entry: StyleClipboardEntry | null
  hydrated: boolean
}

const state = observable<StyleClipboardState>({ entry: null, hydrated: false })

const storage = (): Storage | null => {
  try {
    // SSR and privacy-mode both make this throw rather than return null.
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function hydrate(): void {
  if (state.hydrated) return
  runInAction(() => {
    state.hydrated = true
  })
  const store = storage()
  if (!store) return
  try {
    const raw = store.getItem(STYLE_CLIPBOARD_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as StyleClipboardEntry
    if (parsed?.version !== STYLE_CLIPBOARD_FORMAT_VERSION) return
    runInAction(() => {
      state.entry = parsed
    })
  } catch {
    // A corrupt or foreign entry is no entry. Never throw on read.
  }
}

/** The copied look, or null. */
export function getStyleEntry(): StyleClipboardEntry | null {
  hydrate()
  return state.entry
}

/** Whether anything has been copied. Observed, so menus enable on copy. */
export function hasStyles(): boolean {
  return Boolean(getStyleEntry())
}

/** The label of the element the look came from, for the menu. */
export function getStyleLabel(): string {
  return getStyleEntry()?.label ?? ''
}

/** Takes the look off one node. Returns false when there is no node. */
export function copyStyles(node: Aglyn.NodeSchema<any> | undefined): boolean {
  if (!node) return false
  // Deep-cloned through JSON: `node.sx` is a MobX observable, and keeping a
  // live reference would make the clipboard track later edits to the element
  // it was copied from — a copy that changes under you is not a copy.
  let sx: Record<string, unknown> | null
  try {
    sx = node.sx ? (JSON.parse(JSON.stringify(node.sx)) as never) : null
  } catch {
    return false
  }
  // The ELEMENT's own label. `labelShort` answers the document root with the
  // document's name, which is a true answer to a different question and reads
  // as "paste styles from this whole screen" on the menu below.
  const label = Aglyn.canvas.isRootNode(node)
    ? (node.componentSchema?.displayName ?? 'element')
    : (node.labelShort ?? 'element')
  const entry: StyleClipboardEntry = {
    version: STYLE_CLIPBOARD_FORMAT_VERSION,
    label,
    sx,
  }
  runInAction(() => {
    state.entry = entry
    state.hydrated = true
  })
  const store = storage()
  try {
    store?.setItem(STYLE_CLIPBOARD_STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // A full or unavailable store costs the cross-document paste, not the
    // copy — the in-memory entry above is already set.
  }
  return true
}

/**
 * Applies the copied look to a node, replacing whatever it had.
 *
 * Returns false when there is nothing to paste. A copied entry of `null`
 * styles IS something to paste — it clears the target — which is why the
 * check is on the entry rather than on its `sx`.
 */
export function pasteStyles(node: Aglyn.NodeSchema<any> | undefined): boolean {
  const entry = getStyleEntry()
  if (!node || !entry) return false
  let sx: Record<string, unknown> | null
  try {
    sx = entry.sx ? (JSON.parse(JSON.stringify(entry.sx)) as never) : null
  } catch {
    return false
  }
  // Through the canvas, not by assigning to `node.sx`. That records an undo
  // step — a paste the author cannot take back is worse than no paste — and
  // it re-resolves the node by `$id`, because a caller can be holding an
  // instance the map replaced (an undo, a draft restore), and writing to that
  // one loses the edit silently. Cloned per target as well: pasting onto
  // three elements must give three independent objects.
  Aglyn.canvas.updateNodeFields(node, { sx: (sx ?? undefined) as never })
  return true
}

/** Forgets the copied look. Tests, and a future "clear" affordance. */
export function clearStyles(): void {
  runInAction(() => {
    state.entry = null
    state.hydrated = true
  })
  try {
    storage()?.removeItem(STYLE_CLIPBOARD_STORAGE_KEY)
  } catch {
    // Ditto.
  }
}
