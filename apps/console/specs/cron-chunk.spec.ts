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

import { selectCronChunk } from '../utils/cron-chunk'

describe('selectCronChunk', () => {
  const ids = ['e', 'a', 'd', 'b', 'c']

  it('returns the first chunk in a stable order, not query order', () => {
    // Firestore's iteration order is not a promise, so "everything after the
    // cursor" only means something if the order is imposed here.
    const chunk = selectCronChunk(ids, null, 2)
    expect(chunk.items).toEqual(['a', 'b'])
    expect(chunk.nextCursor).toBe('b')
    expect(chunk.done).toBe(false)
    expect(chunk.total).toBe(5)
  })

  it('resumes strictly after the cursor', () => {
    // Inclusive would redo the last subject on every resume — cheap here,
    // but this sweep sends Stripe meter events.
    const chunk = selectCronChunk(ids, 'b', 2)
    expect(chunk.items).toEqual(['c', 'd'])
  })

  it('reports done and a null cursor on the final chunk', () => {
    const chunk = selectCronChunk(ids, 'c', 5)
    expect(chunk.items).toEqual(['d', 'e'])
    expect(chunk.done).toBe(true)
    // Null rather than 'e', so a caller keying "keep going" off the cursor
    // agrees with `done` instead of making one extra pointless call.
    expect(chunk.nextCursor).toBeNull()
  })

  it('walks the whole sweep in chunks without gaps or repeats', () => {
    // The property that actually matters: chunking must be a partition.
    const all = ['org1', 'org2', 'org3', 'org4', 'org5', 'org6', 'org7']
    const seen: string[] = []
    let cursor: string | null = null
    let guard = 0
    for (;;) {
      const chunk = selectCronChunk(all, cursor, 3)
      seen.push(...chunk.items)
      if (chunk.done) break
      cursor = chunk.nextCursor
      if (++guard > 10) throw new Error('did not terminate')
    }
    expect(seen).toEqual([...all].sort())
    expect(new Set(seen).size).toBe(all.length)
  })

  it('terminates on an empty sweep instead of looping', () => {
    const chunk = selectCronChunk([], null, 5)
    expect(chunk.items).toEqual([])
    expect(chunk.done).toBe(true)
    expect(chunk.nextCursor).toBeNull()
  })

  it('makes progress even when handed a nonsense limit', () => {
    // A limit of 0 would produce an empty chunk that is never done — a cron
    // that loops forever making no progress, which is worse than a timeout.
    for (const limit of [0, -3, Number.NaN]) {
      const chunk = selectCronChunk(ids, null, limit as number)
      expect(chunk.items.length).toBeGreaterThan(0)
    }
  })

  it('ignores a cursor past the end rather than throwing', () => {
    // An org deleted mid-sweep can leave a cursor with nothing after it.
    const chunk = selectCronChunk(ids, 'zzz', 2)
    expect(chunk.items).toEqual([])
    expect(chunk.done).toBe(true)
  })

  it('de-duplicates, so one subject is never billed twice in a pass', () => {
    const chunk = selectCronChunk(['a', 'a', 'b'], null, 10)
    expect(chunk.items).toEqual(['a', 'b'])
  })
})
