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
 * A FORM SAVE IS NEVER REFUSED ON ITS FIRST PRESS JUST BECAUSE THE SERVER IS
 * LATE (AGL-4047).
 *
 * `writeGuardedBySeed` waits for the server to confirm a cache-served seed
 * before it writes (AGL-4120), and refuses with "We could not confirm your …
 * with the server yet" when that wait runs past its deadline. Right after a
 * page load on the shared cache the wait routinely ran past it, so the first
 * press of Save was refused and the second, a few seconds later, saved.
 *
 * The fix has two halves, and a surface needs both:
 *
 * 1. HOLD SAVE while the seed is unconfirmed, with the reason beside it
 *    ({@link isSeedChecking}, {@link seedCheckingText}). The press then comes
 *    after the server answers, when the guard writes at once. The guard still
 *    wraps the write, for a read that falls back to the cache after the
 *    surface rendered.
 * 2. KEEP THE EDITS AS EDITS ({@link useSeedEdits}), replayed onto whatever the
 *    seed is now. Without this, holding Save is a trap: a form that copied the
 *    cached values into its own state when they arrived would, once the server
 *    confirmed different ones, save the cached values for every field the
 *    person never touched, which is the loss the guard exists to stop. A form
 *    that reset itself on every snapshot would instead drop what was typed.
 *
 * Forms on `final-form` get the second half from `keepDirtyOnReinitialize`,
 * which is the same rule: a field the person changed keeps their value, every
 * other field follows the new seed.
 *
 * First built for a site's Admin › Plugins (#2552); this is that pattern
 * lifted so every guarded form can share it.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Whether a save seeded from this read should be HELD rather than pressed.
 *
 * Unconfirmed, and not failed: a failed read is left to the guard, whose
 * refusal says the values could not be loaded, which no wait would change.
 * The same two flags the call site hands `writeGuardedBySeed`.
 */
export function isSeedChecking(read: {
  fromCache?: boolean
  unreadable?: boolean
}): boolean {
  return Boolean(read.fromCache) && !read.unreadable
}

/**
 * What a held Save says beside it, so a held control is never unexplained.
 * Takes the same `subject` as the guard ("profile", "language settings") and,
 * like the guard's refusals, reads right for a plural one (AGL-1446).
 */
export function seedCheckingText(subject: string): string {
  return `Checking your ${subject} with the server…`
}

export interface SeedEdits<T extends object> {
  /** The seed with the person's edits on top. What the form shows and saves. */
  values: T
  /**
   * The edits in force: unsaved ones, plus the ones a save just wrote until
   * the seed shows them. For a form whose display reads which keys were
   * touched rather than only the merged values.
   */
  edits: Partial<T>
  /** Something is typed that has not been saved. */
  dirty: boolean
  /**
   * Record edits. A function receives the current values, for an edit that
   * derives from them.
   */
  edit: (patch: Partial<T> | ((values: T) => Partial<T>)) => void
  /** Take back the edit to these keys, so they follow the seed again. */
  revert: (...keys: (keyof T)[]) => void
  /**
   * The save landed. The edits it wrote stop being unsaved, and stay applied
   * until the seed moves, so the form never flashes back to the values before
   * the save. Pass what the save wrote (`edits` when it began) so a key typed
   * again while the save was in flight stays unsaved; without it, every edit
   * in force now counts as written.
   */
  settle: (written?: Partial<T>) => void
  /** Throw every unsaved edit away. */
  discard: () => void
}

function seedKeyOf(seed: object): string {
  try {
    return JSON.stringify(seed) ?? ''
  } catch {
    return ''
  }
}

/**
 * A form's edits, kept as edits and replayed onto the seed on every render
 * rather than copied from it once (AGL-4047).
 *
 * Edits are per top-level key. A key the person never touched always shows
 * what the seed says NOW, so a confirmation that changes it is reflected, and
 * a save writes it; a key they did touch keeps their value through any number
 * of snapshots.
 */
export function useSeedEdits<T extends object>(seed: T): SeedEdits<T> {
  const [edits, setEdits] = useState<Partial<T>>({})
  /**
   * What a save just wrote, held against the seed it was written over. The
   * seed normally moves at once, because a local write reaches the cache
   * before the server acknowledges it; this covers the case where it has not.
   */
  const [saved, setSaved] = useState<{ key: string; edits: Partial<T> } | null>(
    null,
  )
  const seedKey = seedKeyOf(seed)
  // Dropped the moment the seed moves, so a later change back to the values
  // as they stood before the save is shown as it is, not hidden behind it.
  if (saved && saved.key !== seedKey) setSaved(null)

  const applied = useMemo<Partial<T>>(
    () =>
      saved && saved.key === seedKey ? { ...saved.edits, ...edits } : edits,
    [saved, seedKey, edits],
  )
  const values = useMemo<T>(() => ({ ...seed, ...applied }), [seed, applied])

  // Read by `edit`'s updater form and `settle`, which must see what is on
  // screen at the call without re-creating the callbacks on every keystroke.
  const latest = useRef({ seed, seedKey, applied })
  latest.current = { seed, seedKey, applied }

  const edit = useCallback(
    (patch: Partial<T> | ((values: T) => Partial<T>)) => {
      setEdits((current) => {
        const next =
          typeof patch === 'function'
            ? patch({ ...latest.current.seed, ...latest.current.applied, ...current })
            : patch
        return { ...current, ...next }
      })
    },
    [],
  )

  const revert = useCallback((...keys: (keyof T)[]) => {
    setEdits((current) => {
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
    setSaved((current) => {
      if (!current) return current
      const next = { ...current.edits }
      for (const key of keys) delete next[key]
      return { ...current, edits: next }
    })
  }, [])

  const settle = useCallback((written?: Partial<T>) => {
    const wrote = written ?? latest.current.applied
    setSaved({ key: latest.current.seedKey, edits: wrote })
    setEdits((current) => {
      const next: Partial<T> = {}
      for (const key of Object.keys(current) as (keyof T)[]) {
        if (!(key in wrote) || !Object.is(current[key], wrote[key])) {
          next[key] = current[key]
        }
      }
      return next
    })
  }, [])

  const discard = useCallback(() => {
    setSaved(null)
    setEdits({})
  }, [])

  return {
    values,
    edits: applied,
    dirty: Object.keys(edits).length > 0,
    edit,
    revert,
    settle,
    discard,
  }
}

export default useSeedEdits

/**
 * The rule {@link useSeedEdits} keeps, for a form that already holds its own
 * buffer and seeds it once (AGL-4047).
 *
 * A key whose value still equals what the previous seed said is UNTOUCHED, so
 * it follows the next seed; a key the person changed keeps their value. Hand it
 * the seed the buffer was built from, the buffer as it stands, and the seed
 * that just arrived, and store the result with the next seed as the new
 * baseline. Compared by content, since a snapshot rebuilds every value.
 */
export function rebaseSeedEdits<T extends object>(
  previousSeed: T,
  current: T,
  nextSeed: T,
): T {
  const next = { ...nextSeed }
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (seedKeyOf({ v: current[key] }) !== seedKeyOf({ v: previousSeed[key] })) {
      next[key] = current[key]
    }
  }
  return next
}
