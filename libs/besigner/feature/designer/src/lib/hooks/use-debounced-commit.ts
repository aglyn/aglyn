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

import { useCallback, useEffect, useRef } from 'react'

// Attribute edits commit to the node model on a short debounce, never once
// per keystroke (AGL-567). A commit runs `canvas.updateNodeProps`, which calls
// `saveHistory` — deep-cloning the ENTIRE node map onto the undo stack — and
// mutates the observable props the canvas tree renders from. Firing that on
// every character of a long value (a 30-plus-character External URL is the
// reproducer) floods the main thread with full-tree clones and full-tree
// re-renders faster than it can drain them, until the renderer process is
// killed ("Aw, Snap"). Short labels never typed enough characters to reach the
// tipping point, which is why only long URLs crashed. The data-driven-forms
// field keeps the typed value in its own local state, so typing stays
// responsive while the (expensive) model commit is deferred.
export const ATTRIBUTE_COMMIT_DEBOUNCE_MS = 250

export interface DebouncedCommitOptions {
  /**
   * Upper bound on how long a continuously-rescheduled commit may be
   * deferred. Without one, a trailing debounce starves under sustained
   * activity: a long drag or an unbroken burst of typing keeps pushing the
   * timer back and the commit never runs at all. Attribute edits do not need
   * this (a keystroke burst ends in milliseconds); a draft snapshot does,
   * because the whole point is that the work is on disk *before* the crash
   * (AGL-1256). Omit for a pure trailing debounce.
   */
  maxWait?: number
}

/**
 * Debounces a commit callback and exposes an imperative `flush`. Rapid
 * `schedule()` calls (keystrokes) coalesce into a single commit; `flush()`
 * forces a pending commit out immediately (focus leaving a field, an explicit
 * Save), and a pending commit is also flushed on unmount (panel close) so an
 * in-flight edit is never dropped. `commit` may change identity between
 * renders (react-final-form's `handleSubmit` does) — the latest is always used
 * without resubscribing the timer.
 */
export function useDebouncedCommit(
  commit: () => void,
  delay: number = ATTRIBUTE_COMMIT_DEBOUNCE_MS,
  options: DebouncedCommitOptions = {},
) {
  const { maxWait } = options
  const commitRef = useRef(commit)
  commitRef.current = commit
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)
  /** When the currently-pending run was first scheduled, for `maxWait`. */
  const pendingSinceRef = useRef<number | null>(null)

  const run = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current = false
    pendingSinceRef.current = null
    commitRef.current()
  }, [])

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current) run()
  }, [run])

  const schedule = useCallback(() => {
    if (!pendingRef.current) pendingSinceRef.current = Date.now()
    pendingRef.current = true
    if (
      maxWait !== undefined &&
      pendingSinceRef.current !== null &&
      Date.now() - pendingSinceRef.current >= maxWait
    ) {
      return run()
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(run, delay)
    return undefined
  }, [delay, maxWait, run])

  // Flush any pending edit when the form tears down (panel close) so the last
  // keystrokes are never lost.
  useEffect(() => flush, [flush])

  return { schedule, flush }
}

export default useDebouncedCommit
