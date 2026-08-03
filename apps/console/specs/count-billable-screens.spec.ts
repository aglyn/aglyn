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

import { countBillableScreens } from '../app/api/hosts/resources/count-billable-screens'

/** Minimal stand-in for the admin SDK's snapshot/ref surface. */
function hostRef(
  screens: Array<Record<string, unknown> & { id: string }>,
  collections: Array<Record<string, unknown>> = [],
) {
  const snapshot = (rows: Array<Record<string, unknown>>) => ({
    docs: rows.map((row) => ({
      id: String(row['id'] ?? ''),
      get: (field: string) => row[field],
    })),
  })
  return {
    collection: (name: string) => ({
      select: () => ({
        get: async () =>
          snapshot(name === 'screens' ? screens : collections),
      }),
    }),
  }
}

describe('countBillableScreens (AGL-1173)', () => {
  it('counts ordinary screens', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    )
    expect(count).toBe(3)
  })

  // Delete stamps `deletedAt` instead of removing the doc, so counting raw
  // docs meant deleting a screen never freed a slot — a dead end on free.
  it('does not count soft-deleted screens', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'a' }, { id: 'b', deletedAt: { seconds: 1 } }]),
    )
    expect(count).toBe(1)
  })

  // Email screens live on the Emails page and were already hidden from the
  // screens list's count; enforcement charged for them anyway.
  it('does not count email screens', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'a' }, { id: 'e', kind: 'email' }]),
    )
    expect(count).toBe(1)
  })

  it('does not count a collection list or entry template screen', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }, { id: 'blogList' }, { id: 'blogEntry' }],
        [{ id: 'blog', listScreenId: 'blogList', entryScreenId: 'blogEntry' }],
      ),
    )
    expect(count).toBe(1)
  })

  it('honours the legacy templateScreenId field', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }, { id: 'legacyTmpl' }],
        [{ id: 'blog', templateScreenId: 'legacyTmpl' }],
      ),
    )
    expect(count).toBe(1)
  })

  // A collection can point at a screen that was since deleted, and two
  // collections can share one template — neither may discount a real screen
  // twice or discount a screen that no longer exists.
  it('ignores dangling and duplicated template references', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }, { id: 'shared' }],
        [
          { id: 'blog', listScreenId: 'shared', entryScreenId: 'gone' },
          { id: 'news', listScreenId: 'shared' },
        ],
      ),
    )
    expect(count).toBe(1)
  })

  it('ignores empty and non-string template references', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }],
        [{ id: 'blog', listScreenId: '', entryScreenId: 42 }],
      ),
    )
    expect(count).toBe(1)
  })
})
