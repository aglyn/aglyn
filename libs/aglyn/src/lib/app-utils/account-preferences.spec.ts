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
  effectivePinnedOrgs,
  keepPinnedOrgs,
  pinOrg,
  railWorkspaces,
  workspaceInitial,
  readAppTheme,
  recordRecent,
  recordRecentOrg,
  replacePinnedOrg,
  resolveWorkspaceColor,
  RECENTS_MAX,
  STARRED_MAX,
  toggleStarred,
  type AccountItemRef,
} from './account-preferences'

/**
 * The account preferences' rules (AGL-3943). The native apps replay the
 * same answers from `function-cases.generated.json`; this holds the ones the
 * decisions turn on.
 */

const ids = (n: number, prefix = 'o') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
const item = (id: string): AccountItemRef => ({ kind: 'page', id, orgId: 'o1', label: id, screen: 'site.pages' })

describe('pins: five everywhere (Zach, 2026-10-18)', () => {
  it('pins up to five and answers a sixth with full, never dropping one quietly', () => {
    expect(pinOrg(ids(4), 'o5')).toEqual({ pinned: ids(5), outcome: 'pinned' })
    expect(pinOrg(ids(5), 'o6')).toEqual({ pinned: ids(5), outcome: 'full' })
  })

  it('keeps the first five of a list pinned before the cap until the person picks', () => {
    expect(effectivePinnedOrgs(ids(7))).toEqual(ids(5))
    expect(keepPinnedOrgs(ids(7), ['o7', 'o1'])).toEqual(['o1', 'o7'])
    expect(keepPinnedOrgs(ids(7), ids(7))).toEqual(ids(5))
  })

  it('replaces one pin in its place', () => {
    expect(replacePinnedOrg(ids(5), 'o2', 'o9')).toEqual(['o1', 'o9', 'o3', 'o4', 'o5'])
  })
})

describe('the rail', () => {
  it('shows a small account the same rail: pins, recents, then All (Zach, 2026-10-19)', () => {
    expect(railWorkspaces(ids(6), ['o6'], ['o6', 'o2'])).toEqual({
      pinned: ['o6'],
      recent: ['o2'],
      rest: [],
      allTile: true,
      total: 6,
    })
    expect(railWorkspaces([], [], [])).toEqual({ pinned: [], recent: [], rest: [], allTile: false, total: 0 })
  })

  it('shows a large one five pins, three recent not pinned, then All', () => {
    const rail = railWorkspaces(ids(100), ['o9', 'o2'], ['o2', 'o40', 'o41', 'o42', 'o43'])
    expect(rail).toEqual({ pinned: ['o9', 'o2'], recent: ['o40', 'o41', 'o42'], rest: [], allTile: true, total: 100 })
  })

  it('gives a tile one letter, its name\'s first letter or digit', () => {
    expect(workspaceInitial('Elevated Concepts')).toBe('E')
    expect(workspaceInitial('  42 Studio')).toBe('4')
    expect(workspaceInitial('\u{1F33F} fern & fig')).toBe('F')
    expect(workspaceInitial('—')).toBe('?')
  })

  it('moves an opened workspace to the front of the recents', () => {
    expect(recordRecentOrg(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })
})

describe('starred and recent items stay within their caps', () => {
  it('refuses a star past the cap and unstars a starred one', () => {
    const full = Array.from({ length: STARRED_MAX }, (_, i) => ({ ...item(`p${i}`), starredAtMs: i }))
    expect(toggleStarred(full, item('new'), 1).outcome).toBe('full')
    expect(toggleStarred(full, item('p0'), 1).starred).toHaveLength(STARRED_MAX - 1)
  })

  it('drops the oldest recent', () => {
    const full = Array.from({ length: RECENTS_MAX }, (_, i) => ({ ...item(`p${i}`), openedAtMs: i }))
    const next = recordRecent(full, item('new'), 99)
    expect(next).toHaveLength(RECENTS_MAX)
    expect(next[0]).toMatchObject({ id: 'new', openedAtMs: 99 })
  })
})

describe("a workspace's color", () => {
  it('is the picked one, else the brand color, else the logo color', () => {
    expect(resolveWorkspaceColor('#111111', '#222222', '#333333', true).source).toBe('picked')
    expect(resolveWorkspaceColor(null, '#222222', '#333333', true).source).toBe('brand')
    expect(resolveWorkspaceColor(null, null, '#333333', true).source).toBe('logo')
  })

  it('stops tinting the app with the brand when the person turned that off, not their own pick', () => {
    expect(resolveWorkspaceColor(null, '#222222', null, false).tintsApp).toBe(false)
    expect(resolveWorkspaceColor('#111111', '#222222', null, false).tintsApp).toBe(true)
  })
})

describe('the synced theme', () => {
  it('reads anything unknown as the default', () => {
    expect(readAppTheme({ appTheme: { appearance: 'sepia', accent: 'purple', density: 'compact' } })).toMatchObject({
      appearance: 'system',
      accent: 'theme',
      density: 'compact',
    })
  })
})
