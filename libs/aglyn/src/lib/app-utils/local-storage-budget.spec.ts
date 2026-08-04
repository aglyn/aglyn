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

import {
  pruneLocalStorageByAge,
  writeLocalStorageWithBudget,
} from './local-storage-budget'

/**
 * A `localStorage` stand-in with a byte budget, so the quota path is
 * exercised for real rather than by making `setItem` throw unconditionally.
 */
function createStorage(capacity = Infinity) {
  const entries = new Map<string, string>()
  const used = () => {
    let total = 0
    for (const [key, value] of entries) total += key.length + value.length
    return total
  }
  return {
    entries,
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      const previous = entries.get(key)
      entries.set(key, value)
      if (used() <= capacity) return
      if (previous === undefined) entries.delete(key)
      else entries.set(key, previous)
      const error = new Error('quota') as Error & { name: string }
      error.name = 'QuotaExceededError'
      throw error
    },
  }
}

const dated = (updatedAt: number, padding = 0) =>
  JSON.stringify({ updatedAt, pad: 'x'.repeat(padding) })

describe('writeLocalStorageWithBudget', () => {
  it('writes through when there is room', () => {
    const storage = createStorage()
    const result = writeLocalStorageWithBudget({
      key: 'a:1',
      value: dated(5),
      evictPrefixes: ['a:'],
      storage,
    })
    expect(result).toEqual({ ok: true, evicted: [] })
    expect(storage.getItem('a:1')).toBe(dated(5))
  })

  it('evicts oldest-first within the prefix until the write fits', () => {
    const storage = createStorage(240)
    storage.entries.set('a:old', dated(1, 40))
    storage.entries.set('a:mid', dated(2, 40))
    storage.entries.set('a:new', dated(3, 40))

    const result = writeLocalStorageWithBudget({
      key: 'a:incoming',
      value: dated(4, 80),
      evictPrefixes: ['a:'],
      storage,
    })

    expect(result.ok).toBe(true)
    expect(result.evicted).toEqual(['a:old', 'a:mid'])
    expect(storage.getItem('a:new')).not.toBeNull()
    expect(storage.getItem('a:incoming')).toBe(dated(4, 80))
  })

  // The scoping rule is the reason this helper exists rather than a bare
  // try/catch: a snapshot store that can evict anything is a snapshot store
  // that can sign a user out to save a draft.
  it('never evicts keys outside the given prefixes', () => {
    const storage = createStorage(150)
    storage.entries.set('auth:session', dated(1, 100))

    const result = writeLocalStorageWithBudget({
      key: 'a:incoming',
      value: dated(2, 100),
      evictPrefixes: ['a:'],
      storage,
    })

    expect(result).toEqual({ ok: false, evicted: [] })
    expect(storage.getItem('auth:session')).not.toBeNull()
  })

  it('never evicts the key it is writing', () => {
    const storage = createStorage(120)
    storage.entries.set('a:same', dated(1, 60))

    const result = writeLocalStorageWithBudget({
      key: 'a:same',
      value: dated(2, 200),
      evictPrefixes: ['a:'],
      storage,
    })

    expect(result.evicted).not.toContain('a:same')
    // The older value survives a failed write rather than being destroyed by
    // it — an outdated snapshot still beats no snapshot.
    expect(storage.getItem('a:same')).toBe(dated(1, 60))
  })

  it('reports failure rather than throwing when nothing can be freed', () => {
    const storage = createStorage(10)
    expect(() =>
      writeLocalStorageWithBudget({
        key: 'a:incoming',
        value: dated(1, 500),
        evictPrefixes: ['a:'],
        storage,
      }),
    ).not.toThrow()
  })

  it('does not evict for a non-quota failure', () => {
    const storage = {
      length: 1,
      key: () => 'a:old',
      getItem: () => dated(1),
      removeItem: jest.fn(),
      setItem: () => {
        const error = new Error('blocked') as Error & { name: string }
        error.name = 'SecurityError'
        throw error
      },
    }
    const result = writeLocalStorageWithBudget({
      key: 'a:incoming',
      value: dated(2),
      evictPrefixes: ['a:'],
      storage,
    })
    expect(result).toEqual({ ok: false, evicted: [] })
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  // Prefix order is sacrifice order: a regenerable preview snapshot is spent
  // before anyone's unsaved work, however recently that preview was taken.
  it('exhausts an earlier prefix before touching a later one', () => {
    const storage = createStorage(260)
    storage.entries.set('cheap:recent', dated(900, 40))
    storage.entries.set('precious:ancient', dated(1, 40))

    const result = writeLocalStorageWithBudget({
      key: 'precious:incoming',
      value: dated(1_000, 60),
      evictPrefixes: ['cheap:', 'precious:'],
      storage,
    })

    expect(result.ok).toBe(true)
    expect(result.evicted).toEqual(['cheap:recent'])
    expect(storage.getItem('precious:ancient')).not.toBeNull()
  })

  it('treats undateable values as oldest', () => {
    const storage = createStorage(200)
    storage.entries.set('a:dated', dated(1, 60))
    storage.entries.set('a:junk', 'not json at all, and quite long indeed!!')

    const result = writeLocalStorageWithBudget({
      key: 'a:incoming',
      value: dated(2, 60),
      evictPrefixes: ['a:'],
      storage,
    })

    expect(result.evicted[0]).toBe('a:junk')
  })
})

describe('pruneLocalStorageByAge', () => {
  it('removes only stale keys under the prefix', () => {
    const storage = createStorage()
    storage.entries.set('a:fresh', dated(1_000))
    storage.entries.set('a:stale', dated(10))
    storage.entries.set('b:stale', dated(10))

    const pruned = pruneLocalStorageByAge({
      prefix: 'a:',
      maxAgeMs: 100,
      now: 1_000,
      storage,
    })

    expect(pruned).toEqual(['a:stale'])
    expect(storage.getItem('a:fresh')).not.toBeNull()
    expect(storage.getItem('b:stale')).not.toBeNull()
  })
})
