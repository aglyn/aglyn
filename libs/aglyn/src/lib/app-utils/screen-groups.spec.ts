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
  billableScreenIds,
  buildScreenRouteEntries,
  composeScreenRoutePath,
  isScreenGroup,
  nonPageScreenIds,
  SCREEN_KIND_GROUP,
  SCREEN_ROOT_PATH,
  screenGroupDissolveMoves,
  screenRouteParentId,
  toScreenRouteNode,
  type ScreenRouteNode,
} from './screen-route'

/**
 * PAGE GROUPS (AGL-3463): a folder in the Pages list that holds pages and is
 * not one.
 *
 * Before groups existed the only way to put pages under something was an
 * unpublished, slugless parent page — and `composeScreenRoutePath` refuses
 * every path beneath one of those, so the children lost their addresses the
 * next time any of them was moved or published.
 */

const group = (parentId?: string): ScreenRouteNode => ({
  kind: SCREEN_KIND_GROUP,
  ...(parentId ? { parentId } : {}),
})

const screens: Record<string, ScreenRouteNode> = {
  home: { slug: '/' },
  company: { slug: 'company' },
  campaigns: group(),
  inner: group('campaigns'),
  underCompany: group('company'),
  landing: { slug: 'landing', parentId: 'campaigns' },
  deep: { slug: 'deep', parentId: 'inner' },
  deepChild: { slug: 'child', parentId: 'deep' },
  about: { slug: 'about', parentId: 'underCompany' },
  draft: { parentId: 'campaigns' },
}

/** The live addresses of the tree above. */
const routingMap: Record<string, string> = {
  company: 'company',
  landing: 'landing',
  deep: 'deep',
  deepChild: 'deep/child',
  about: 'company/about',
}

/** Every entry a write would make equals the address it already has. */
function expectRoutesUnchanged(entries: Record<string, string>) {
  for (const [screenId, path] of Object.entries(entries)) {
    expect([screenId, path]).toEqual([screenId, routingMap[screenId]])
  }
}

describe('isScreenGroup / toScreenRouteNode', () => {
  it('reads the kind, and only that kind', () => {
    expect(isScreenGroup({ kind: SCREEN_KIND_GROUP })).toBe(true)
    expect(isScreenGroup({ kind: 'template' })).toBe(false)
    expect(isScreenGroup({})).toBe(false)
    expect(isScreenGroup(undefined)).toBe(false)
  })

  it('carries the kind into the route node, so a group is never read as a draft', () => {
    expect(
      toScreenRouteNode({
        slug: 'about',
        parentId: 'company',
        kind: SCREEN_KIND_GROUP,
      }),
    ).toEqual({ slug: 'about', parentId: 'company', kind: SCREEN_KIND_GROUP })
    // Firestore's empty and absent values do not become fields.
    expect(toScreenRouteNode({ parentId: '', slug: null, kind: null })).toEqual(
      {},
    )
  })
})

describe('composeScreenRoutePath through groups', () => {
  it('composes a group child exactly as if it sat at the group’s level', () => {
    expect(composeScreenRoutePath('landing', screens)).toBe('landing')
  })

  it('passes through nested groups', () => {
    expect(composeScreenRoutePath('deep', screens)).toBe('deep')
    expect(composeScreenRoutePath('deepChild', screens)).toBe('deep/child')
  })

  it('keeps the page above a group in the path', () => {
    expect(composeScreenRoutePath('about', screens)).toBe('company/about')
  })

  it('never gives a group an address, even with a stray slug', () => {
    expect(composeScreenRoutePath('campaigns', screens)).toBeUndefined()
    expect(composeScreenRoutePath('inner', screens)).toBeUndefined()
    expect(
      composeScreenRoutePath('g', {
        g: { kind: SCREEN_KIND_GROUP, slug: 'should-not-route' },
      }),
    ).toBeUndefined()
    // …and a stray slug on an ANCESTOR group contributes nothing either.
    expect(
      composeScreenRoutePath('p', {
        g: { kind: SCREEN_KIND_GROUP, slug: 'stray' },
        p: { slug: 'p', parentId: 'g' },
      }),
    ).toBe('p')
  })

  it('still refuses a slugless page inside a group', () => {
    expect(composeScreenRoutePath('draft', screens)).toBeUndefined()
  })

  it('lets the home page sit in a top-level group, but not under a page', () => {
    expect(
      composeScreenRoutePath('home', {
        ...screens,
        home: { slug: '/', parentId: 'inner' },
      }),
    ).toBe(SCREEN_ROOT_PATH)
    expect(
      composeScreenRoutePath('home', {
        ...screens,
        home: { slug: '/', parentId: 'underCompany' },
      }),
    ).toBeUndefined()
  })

  it('is what an unpublished, slugless PAGE parent is not', () => {
    // The pre-AGL-3463 shape: the same tree with an ordinary page standing in
    // for the group unroutes its child. This is why the kind exists.
    expect(
      composeScreenRoutePath('landing', { ...screens, campaigns: {} }),
    ).toBeUndefined()
  })

  it('refuses a cycle through a group', () => {
    expect(
      composeScreenRoutePath('p', {
        g: { kind: SCREEN_KIND_GROUP, parentId: 'p' },
        p: { slug: 'p', parentId: 'g' },
      }),
    ).toBeUndefined()
  })
})

describe('buildScreenRouteEntries around groups', () => {
  /** A call that changes nothing about the tree. */
  const unchanged = { currentById: screens }

  it('never writes an entry for a group', () => {
    // A publish of the group itself — the toolbar a group never shows —
    // writes nothing for it, and puts none of the drafts inside it live.
    expect(buildScreenRouteEntries('campaigns', screens, {}, unchanged)).toEqual(
      {},
    )
    expect(buildScreenRouteEntries('inner', screens, {}, unchanged)).toEqual({})
    // A stray entry is left for `unpublishScreenRoute` to remove — this never
    // answers a removal — and the live pages inside keep theirs.
    expect(
      buildScreenRouteEntries(
        'campaigns',
        screens,
        { ...routingMap, campaigns: 'campaigns' },
        unchanged,
      ),
    ).toEqual({ landing: 'landing', deep: 'deep', deepChild: 'deep/child' })
  })

  it('publishes a group’s child normally', () => {
    expect(buildScreenRouteEntries('landing', screens, {}, unchanged)).toEqual({
      landing: 'landing',
    })
    expect(
      buildScreenRouteEntries('deepChild', screens, {}, unchanged),
    ).toEqual({ deepChild: 'deep/child' })
  })

  it('leaves the routing map unchanged when a page moves INTO a group', () => {
    // `landing` and the `deep` subtree start at the top level, live.
    const before: Record<string, ScreenRouteNode> = {
      ...screens,
      landing: { slug: 'landing' },
      deep: { slug: 'deep' },
    }
    for (const [id, nextParentId] of [
      ['landing', 'campaigns'],
      ['deep', 'inner'],
    ] as const) {
      const after = { ...before, [id]: { ...before[id], parentId: nextParentId } }
      expect(screenRouteParentId(id, after)).toBe(
        screenRouteParentId(id, before),
      )
      const entries = buildScreenRouteEntries(id, after, routingMap, {
        publish: false,
        currentById: before,
      })
      expect(Object.keys(entries).length).toBeGreaterThan(0)
      expectRoutesUnchanged(entries)
    }
  })

  it('leaves the routing map unchanged when a page moves OUT of a group', () => {
    for (const id of ['landing', 'deep'] as const) {
      const after: Record<string, ScreenRouteNode> = {
        ...screens,
        [id]: { ...screens[id], parentId: undefined },
      }
      expect(screenRouteParentId(id, after)).toBe(
        screenRouteParentId(id, screens),
      )
      expectRoutesUnchanged(
        buildScreenRouteEntries(id, after, routingMap, {
          publish: false,
          currentById: screens,
        }),
      )
    }
  })

  it('leaves the routing map unchanged when a whole group moves', () => {
    // Nesting one top-level group in another moves every page inside it.
    const after = { ...screens, inner: group() }
    expectRoutesUnchanged(
      buildScreenRouteEntries('inner', after, routingMap, {
        publish: false,
        currentById: screens,
      }),
    )
  })

  it('does change the address when the move crosses a page level', () => {
    // Into a group that sits UNDER `company`: the page is now under company.
    const after = {
      ...screens,
      landing: { slug: 'landing', parentId: 'underCompany' },
    }
    expect(screenRouteParentId('landing', after)).toBe('company')
    expect(
      buildScreenRouteEntries('landing', after, routingMap, {
        publish: false,
        currentById: screens,
      }),
    ).toEqual({ landing: 'company/landing' })
  })
})

describe('screenRouteParentId', () => {
  it('skips groups to the page a path is composed under', () => {
    expect(screenRouteParentId('landing', screens)).toBeUndefined()
    expect(screenRouteParentId('deep', screens)).toBeUndefined()
    expect(screenRouteParentId('about', screens)).toBe('company')
    expect(screenRouteParentId('deepChild', screens)).toBe('deep')
    expect(screenRouteParentId('company', screens)).toBeUndefined()
  })
})

describe('screenGroupDissolveMoves', () => {
  it('moves a deleted group’s direct children up one level', () => {
    expect(screenGroupDissolveMoves('campaigns', screens)).toEqual({
      inner: undefined,
      landing: undefined,
      draft: undefined,
    })
    expect(screenGroupDissolveMoves('inner', screens)).toEqual({
      deep: 'campaigns',
    })
    expect(screenGroupDissolveMoves('underCompany', screens)).toEqual({
      about: 'company',
    })
  })

  it('keeps every route when the group is gone', () => {
    for (const groupId of ['campaigns', 'inner', 'underCompany']) {
      const moves = screenGroupDissolveMoves(groupId, screens)
      const after: Record<string, ScreenRouteNode | undefined> = { ...screens }
      delete after[groupId]
      for (const [id, parentId] of Object.entries(moves)) {
        after[id] = { ...screens[id], parentId }
      }
      for (const id of Object.keys(moves)) {
        expectRoutesUnchanged(
          buildScreenRouteEntries(id, after, routingMap, {
            publish: false,
            currentById: screens,
          }),
        )
      }
    }
  })

  it('answers nothing for a page', () => {
    expect(screenGroupDissolveMoves('company', screens)).toEqual({})
  })
})

describe('a group and the plan', () => {
  it('spends no page allowance unless something routed it anyway', () => {
    const rows = [{ id: 'page' }, { id: 'campaigns', kind: SCREEN_KIND_GROUP }]
    expect([...billableScreenIds(rows, { page: 'page' })]).toEqual(['page'])
    expect([...nonPageScreenIds(rows, { page: 'page' })]).toEqual(['campaigns'])
    // The routing map outranks the document, as for every non-page kind.
    expect(
      billableScreenIds(rows, { page: 'page', campaigns: 'x' }).has('campaigns'),
    ).toBe(true)
  })
})
