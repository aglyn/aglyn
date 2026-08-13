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
 * Selecting and un-listing DAM assets without going back to Firestore
 * (AGL-1462).
 *
 * Two halves of one problem, which is why they share a module.
 *
 * ## Editing the loaded window instead of refetching it
 *
 * The library accumulates pages of 60 documents behind "Load more". Every
 * mutation used to bump `refreshKey`, and the load effect keyed on it replaces
 * `pages` with `[page one]` — so deleting a single file threw away every page
 * past the first and charged the reads again to get back. A delete of 65 files
 * out of a 174-asset library re-read thousands of documents to display a list
 * the client already had.
 *
 * A delete is the one mutation where the client knows the whole answer: the
 * document is gone and its id is in hand. `dropMediaFromPages` removes it from
 * the accumulated window and leaves the cursor alone, which costs nothing.
 * `patchMediaInPages` does the same for a field the client just wrote.
 *
 * The page structure is preserved rather than flattened because the cursor
 * that "Load more" resumes from is a snapshot of the LAST document of the last
 * page. Firestore reads the order-by values out of that snapshot rather than
 * re-reading the document, so a cursor whose document has since been deleted
 * still names a valid position — but only as long as nothing re-slices the
 * pages underneath it.
 *
 * ## Range selection
 *
 * Multi-select existed as a checkbox per card, so selecting 30 files was 30
 * clicks — which is why the delete-one-then-re-page loop above got run 65
 * times rather than twice. ⇧-click fixes that, and the two belong together:
 * range selection on a list that resets would lose the selection every time.
 *
 * The anchor is an ID, never an index. That distinction is the whole reason
 * this is a tested module: once a delete removes an item from the middle of a
 * selected range, every stored index past it points at a different file. An id
 * either still exists — in which case its position is recomputed against the
 * order on screen right now — or it does not, in which case the anchor is
 * dropped and the next ⇧-click starts a fresh one.
 */

/** One fetched page of media documents. */
export type MediaPage = any[]

/** What the grid tracks while a person builds a selection. */
export interface MediaSelectionState {
  /** Currently selected asset ids. */
  readonly ids: ReadonlySet<string>
  /**
   * The id a ⇧-click measures from — the last plainly-clicked card, not the
   * last card touched. Null when there is nothing to measure from, including
   * after the anchor itself has been deleted.
   */
  readonly anchorId: string | null
}

/** The starting point, and what "Clear" restores. */
export const EMPTY_MEDIA_SELECTION: MediaSelectionState = {
  ids: new Set<string>(),
  anchorId: null,
}

/**
 * Remove ids from the accumulated pages.
 *
 * Returns the SAME array when nothing matched, so a delete that raced a filter
 * change cannot cost a re-render of the whole grid.
 */
export function dropMediaFromPages(
  pages: readonly MediaPage[],
  ids: Iterable<string>,
): MediaPage[] {
  const doomed = new Set(ids)
  if (!doomed.size) return pages as MediaPage[]
  let removed = false
  const next = pages.map((page) => {
    const kept = page.filter((item: any) => !doomed.has(String(item?.$id)))
    if (kept.length !== page.length) removed = true
    return kept.length === page.length ? page : kept
  })
  return removed ? next : (pages as MediaPage[])
}

/**
 * Apply a field update the client has already written to the server.
 *
 * `patch` may be a plain object or a function of the existing document, which
 * is what a per-asset answer — the new tag array for THIS file — needs.
 */
export function patchMediaInPages(
  pages: readonly MediaPage[],
  ids: Iterable<string>,
  patch:
    | Record<string, unknown>
    | ((item: any) => Record<string, unknown> | null | undefined),
): MediaPage[] {
  const targets = new Set(ids)
  if (!targets.size) return pages as MediaPage[]
  let changed = false
  const next = pages.map((page) => {
    let pageChanged = false
    const mapped = page.map((item: any) => {
      if (!targets.has(String(item?.$id))) return item
      const fields = typeof patch === 'function' ? patch(item) : patch
      if (!fields) return item
      pageChanged = true
      return { ...item, ...fields }
    })
    if (!pageChanged) return page
    changed = true
    return mapped
  })
  return changed ? next : (pages as MediaPage[])
}

/**
 * The inclusive run of ids between the anchor and the clicked card, in the
 * order they are on screen.
 *
 * Both ends are resolved against `orderedIds` at click time. A missing anchor
 * — deleted, filtered out, or on a page that is no longer loaded — degrades to
 * the clicked card alone rather than guessing at a range.
 */
export function mediaSelectionRange(
  orderedIds: readonly string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const target = orderedIds.indexOf(targetId)
  if (target < 0) return []
  const anchor = anchorId === null ? -1 : orderedIds.indexOf(anchorId)
  if (anchor < 0) return [targetId]
  const from = Math.min(anchor, target)
  const to = Math.max(anchor, target)
  return orderedIds.slice(from, to + 1)
}

/** One click on a card or its checkbox. */
export interface MediaSelectionClick {
  /** Ids in the order the grid is currently drawing them. */
  orderedIds: readonly string[]
  /** The card that was clicked. */
  id: string
  /** Selecting or de-selecting. */
  checked: boolean
  /** ⇧ was held: act on everything from the anchor to here. */
  range?: boolean
}

/**
 * The selection after a click.
 *
 * A ⇧-click leaves the anchor where it was, so dragging a range open one card
 * at a time keeps measuring from the same end — the behaviour every file
 * manager has. A plain click moves the anchor to the clicked card, whether it
 * selected or de-selected it.
 */
export function nextMediaSelection(
  state: MediaSelectionState,
  click: MediaSelectionClick,
): MediaSelectionState {
  const { orderedIds, id, checked, range } = click
  const ids = new Set(state.ids)
  const span =
    range && state.anchorId !== null && state.anchorId !== id
      ? mediaSelectionRange(orderedIds, state.anchorId, id)
      : null
  if (span && span.length > 1) {
    for (const member of span) {
      if (checked) ids.add(member)
      else ids.delete(member)
    }
    // The anchor stays put: it is the fixed end of the range being dragged.
    return { ids, anchorId: state.anchorId }
  }
  if (checked) ids.add(id)
  else ids.delete(id)
  return { ids, anchorId: id }
}

/**
 * Forget assets that no longer exist.
 *
 * Called after a delete, and the reason the anchor is an id: a range whose
 * anchor was one of the deleted files must not silently re-anchor onto
 * whichever file slid into that position.
 */
export function forgetMediaSelection(
  state: MediaSelectionState,
  ids: Iterable<string>,
): MediaSelectionState {
  const gone = new Set(ids)
  if (!gone.size) return state
  const next = new Set<string>()
  for (const id of state.ids) if (!gone.has(id)) next.add(id)
  const anchorId =
    state.anchorId !== null && gone.has(state.anchorId) ? null : state.anchorId
  if (next.size === state.ids.size && anchorId === state.anchorId) return state
  return { ids: next, anchorId }
}
