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

'use client'

/**
 * A DIALOG'S DRAFT OF A ROW, KEPT AS EDITS OVER THE LIVE ROW (AGL-4047).
 *
 * {@link useSeedEdits} for the editor that opens on one row of a list: an
 * Edit dialog, a drawer. Those used to copy the row into a
 * `useState<Draft | null>` when they opened, which is the copy the hold in
 * `use-seed-edits` warns about: opened from the cache's row, a Save held
 * until the server answered would then write the cache's values for every
 * field nobody touched.
 *
 * This is a drop-in for that `useState`. `setDraft(row)` opens the editor on
 * a row, `setDraft(null)` closes it, and while it is open every
 * `setDraft({ ...draft, name })` records only the keys that moved, as edits.
 * The draft shown is `live(opened)` (the same row as the list has it NOW)
 * with those edits on top, so the server's copy replaces the cache's under
 * everything the person did not change.
 */

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useSeedEdits, type SeedEdits } from './use-seed-edits'

const CLOSED = Object.freeze({}) as object

function keyOf(seed: object): string {
  try {
    return JSON.stringify(seed) ?? ''
  } catch {
    return ''
  }
}

/**
 * The keys of `next` that differ from `values`, as an edit: for an editor
 * that builds its whole next draft, to hand `useSeedEdits`' `edit` only what
 * moved, so every other key keeps following the seed.
 */
export function seedEditsBetween<T extends object>(
  values: T,
  next: T,
): Partial<T> {
  const patch: Partial<T> = {}
  const keys = new Set([
    ...Object.keys(values),
    ...Object.keys(next),
  ]) as Set<keyof T>
  for (const key of keys) {
    if (!Object.is(values[key], next[key])) patch[key] = next[key]
  }
  return patch
}

/**
 * @param live The opened row as the list has it now, in the draft's shape,
 *   or `undefined` when the list no longer holds it (a new row, or one
 *   paged out of the window). Undefined keeps the row as it was opened.
 * @returns `[draft, setDraft, form]`: the first two exactly as
 *   `useState<T | null>(null)` gives them, and the edits underneath.
 */
export function useSeedDraft<T extends object>(
  live: (opened: T) => T | undefined,
): [T | null, Dispatch<SetStateAction<T | null>>, SeedEdits<T>] {
  const [opened, setOpened] = useState<T | null>(null)
  const fresh = opened ? (live(opened) ?? opened) : (CLOSED as T)
  /*
   * `live` builds a new object on every render. Kept while it says the same
   * thing, so the draft handed to a memoized editor keeps its identity until
   * a keystroke or the server actually changes it.
   */
  const stable = useRef<{ key: string; seed: T } | null>(null)
  const freshKey = keyOf(fresh)
  // A row that cannot be written as JSON is never taken for unchanged.
  if (!stable.current || !freshKey || stable.current.key !== freshKey) {
    stable.current = { key: freshKey, seed: fresh }
  }
  const seed = stable.current.seed
  const form = useSeedEdits<T>(seed)
  const draft = opened ? form.values : null

  /*
   * What the draft is as of the last call, so two calls in one handler (and
   * the updater form) each build on the one before rather than on the
   * render's copy.
   */
  const current = useRef<{ opened: T | null; draft: T | null }>({
    opened,
    draft,
  })
  current.current = { opened, draft }

  const { edit, discard } = form
  const setDraft = useCallback<Dispatch<SetStateAction<T | null>>>(
    (action) => {
      const next =
        typeof action === 'function'
          ? (action as (previous: T | null) => T | null)(current.current.draft)
          : action
      if (next === null) {
        current.current = { opened: null, draft: null }
        setOpened(null)
        discard()
        return
      }
      if (!current.current.opened) {
        current.current = { opened: next, draft: next }
        setOpened(next)
        discard()
        return
      }
      current.current = { ...current.current, draft: next }
      edit((values) => seedEditsBetween(values, next))
    },
    [edit, discard],
  )

  return [draft, setDraft, form]
}

export default useSeedDraft
