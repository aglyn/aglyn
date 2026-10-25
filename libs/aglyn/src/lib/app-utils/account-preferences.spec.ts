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
  pinHost,
  pinOrg,
  PINNED_HOSTS_MAX,
  railWorkspaces,
  workspaceInitial,
  readAppTheme,
  recordRecent,
  readPinnedHosts,
  recordRecentOrg,
  replacePinnedHost,
  replacePinnedOrg,
  resolveWorkspaceColor,
  workspaceStableColor,
  WORKSPACE_STABLE_COLORS,
  RECENTS_MAX,
  STARRED_MAX,
  toggleStarred,
  unpinHost,
  workspacePinnedHosts,
  type AccountItemRef,
  type PinnedHost,
  readAccountName,
  readAccountPhoto,
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

describe('site pins: five a workspace, like workspace pins (AGL-4005)', () => {
  const pins = (orgId: string, n: number, from = 1): PinnedHost[] =>
    Array.from({ length: n }, (_, i) => ({ orgId, hostId: `${orgId}-h${from + i}` }))

  it('reads only well-formed pins, once each', () => {
    expect(
      readPinnedHosts({
        pinnedHosts: [
          { orgId: 'o1', hostId: 'h1' },
          { orgId: 'o1', hostId: 'h1' },
          { orgId: '', hostId: 'h2' },
          'h3',
          { orgId: 'o2', hostId: 'h4', extra: true },
        ],
      }),
    ).toEqual([
      { orgId: 'o1', hostId: 'h1' },
      { orgId: 'o2', hostId: 'h4' },
    ])
    expect(readPinnedHosts({ pinnedHosts: 'h1' })).toEqual([])
    expect(readPinnedHosts(undefined)).toEqual([])
  })

  it("counts each workspace's pins on their own", () => {
    const stored = [...pins('o1', 5), ...pins('o2', 2)]
    expect(workspacePinnedHosts(stored, 'o2')).toEqual(['o2-h1', 'o2-h2'])
    expect(pinHost(stored, { orgId: 'o2', hostId: 'o2-h3' })).toEqual({
      pinnedHosts: [...stored, { orgId: 'o2', hostId: 'o2-h3' }],
      outcome: 'pinned',
    })
    expect(pinHost(stored, { orgId: 'o1', hostId: 'o1-h6' })).toEqual({
      pinnedHosts: stored,
      outcome: 'full',
    })
    expect(pinHost(stored, { orgId: 'o1', hostId: 'o1-h2' }).outcome).toBe('alreadyPinned')
  })

  it('makes room past the account bound only from other workspaces', () => {
    const stored = [...pins('o1', 1), ...pins('o9', 99)]
    const { pinnedHosts, outcome } = pinHost(stored, { orgId: 'o9', hostId: 'o9-h100' })
    expect(outcome).toBe('full')
    expect(pinnedHosts).toEqual(stored)
    const next = pinHost([...pins('o1', 2), ...pins('o9', 98, 10)], { orgId: 'o2', hostId: 'x' })
    expect(next.pinnedHosts).toHaveLength(PINNED_HOSTS_MAX)
    expect(next.pinnedHosts[0]).toEqual({ orgId: 'o1', hostId: 'o1-h2' })
    expect(next.pinnedHosts.at(-1)).toEqual({ orgId: 'o2', hostId: 'x' })
  })

  it('unpins one and replaces one in its place', () => {
    const stored = [...pins('o1', 2), ...pins('o2', 1)]
    expect(unpinHost(stored, 'o1-h1')).toEqual([...pins('o1', 1, 2), ...pins('o2', 1)])
    expect(replacePinnedHost(stored, 'o1-h1', { orgId: 'o1', hostId: 'o1-h9' })).toEqual([
      { orgId: 'o1', hostId: 'o1-h9' },
      { orgId: 'o1', hostId: 'o1-h2' },
      { orgId: 'o2', hostId: 'o2-h1' },
    ])
    // Another workspace's pin is never the one replaced.
    expect(replacePinnedHost(stored, 'o2-h1', { orgId: 'o1', hostId: 'o1-h9' })).toEqual(stored)
  })
})

describe('the rail', () => {
  it('shows a small account the same rail: pins, recents, then All (AGL-3996)', () => {
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
    expect(workspaceInitial('Acme Builders')).toBe('A')
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

  it('falls back to a stable color from the workspace id, which never tints the app', () => {
    const stable = resolveWorkspaceColor(null, null, null, true, 'org-acme')
    expect(stable).toEqual({ color: workspaceStableColor('org-acme'), source: 'stable', tintsApp: false })
    expect(resolveWorkspaceColor(null, null, '#333333', true, 'org-acme').source).toBe('logo')
    expect(resolveWorkspaceColor(null, null, null, true).source).toBe('none')
    expect(resolveWorkspaceColor(null, null, null, true, '').source).toBe('none')
  })

  it('gives the same id the same stable color, from the palette, and spreads ids across it', () => {
    expect(workspaceStableColor('org-acme')).toBe(workspaceStableColor('org-acme'))
    const ids = Array.from({ length: 64 }, (_, i) => `org-${i}`)
    const colors = new Set(ids.map((id) => workspaceStableColor(id)))
    for (const color of colors) expect(WORKSPACE_STABLE_COLORS).toContain(color)
    expect(colors.size).toBe(WORKSPACE_STABLE_COLORS.length)
    expect(workspaceStableColor(null)).toBeNull()
  })

  it('keeps every stable color dark enough for a white initial (4.5:1)', () => {
    const channel = (hex: string, at: number) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    for (const hex of WORKSPACE_STABLE_COLORS) {
      const luminance = 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
      expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
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

describe('who is signed in (AGL-4010)', () => {
  it('reads the profile photo first, then the sign-in record, never a blank', () => {
    expect(readAccountPhoto({ photoUrl: ' /api/media/cdn/org:o/m ' }, 'https://a.example.com/p.jpg')).toBe(
      '/api/media/cdn/org:o/m',
    )
    expect(readAccountPhoto({ photoUrl: '  ' }, ' https://a.example.com/p.jpg ')).toBe(
      'https://a.example.com/p.jpg',
    )
    // The roster's casing is not the profile's field.
    expect(readAccountPhoto({ photoURL: 'https://a.example.com/r.jpg' }, null)).toBeNull()
    expect(readAccountPhoto(null, '')).toBeNull()
  })

  it('names the person from the profile, then the sign-in record, then the email', () => {
    expect(readAccountName({ firstName: 'Jordan', lastName: 'Lee' }, 'J. Lee', 'j@example.com')).toBe(
      'Jordan Lee',
    )
    expect(readAccountName({ firstName: ' ' }, ' Pat Lee ', 'p@example.com')).toBe('Pat Lee')
    expect(readAccountName({}, '', ' p@example.com ')).toBe('p@example.com')
    expect(readAccountName(null, null, null)).toBe('')
  })
})
