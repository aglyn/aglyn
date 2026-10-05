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
  buildScreenRouteEntries,
  liveScreenDescendants,
  SCREEN_KIND_GROUP,
  type ScreenRouteNode,
} from './screen-route'

/**
 * NOTHING ABOVE A LIVE PAGE CAN TAKE IT OFF THE SITE (AGL-3463).
 *
 * Moving, unpublishing, emptying the slug of or deleting a PARENT keeps every
 * live page below it routed. The routing map is the whole of what the tenant
 * serves, so each case here is asserted on the map that results: every page
 * that was live before is live after, except a page that was itself the one
 * taken down.
 *
 * Unpublish and delete remove exactly the named screen's entry
 * (`unpublishScreenRoute`), so they are modeled as deleting that one key;
 * everything else is what `buildScreenRouteEntries` hands the write.
 */

type Tree = Record<string, ScreenRouteNode | undefined>
type RoutingMap = Record<string, string>

/** The site: a live section, a draft parent with a slug, a slugless page. */
const tree: Tree = {
  company: { slug: 'company' },
  about: { slug: 'about', parentId: 'company' },
  team: { slug: 'team', parentId: 'about' },
  pricing: { slug: 'pricing' },
  faq: { slug: 'faq', parentId: 'pricing' },
  // A page with a slug that was never published.
  drafts: { slug: 'drafts' },
  // A page with no slug at all.
  noSlug: {},
  // A page with a slug whose OWN chain does not compose.
  stranded: { slug: 'stranded', parentId: 'noSlug' },
  campaigns: { kind: SCREEN_KIND_GROUP },
}

const live: RoutingMap = {
  company: 'company',
  about: 'company/about',
  team: 'company/about/team',
  pricing: 'pricing',
  faq: 'pricing/faq',
}

/** The map after a sync of `entries`, which only ever sets. */
function applySync(map: RoutingMap, entries: Record<string, string>) {
  return { ...map, ...entries }
}

/** The map after `unpublishScreenRoute` for one screen. */
function applyUnpublish(map: RoutingMap, screenId: string) {
  const next = { ...map }
  delete next[screenId]
  return next
}

/** Every page live in `before` is live in `after`, bar the ones named. */
function expectStillLive(
  before: RoutingMap,
  after: RoutingMap,
  takenDown: string[] = [],
) {
  for (const id of Object.keys(before)) {
    if (takenDown.includes(id)) continue
    expect([id, typeof after[id]]).toEqual([id, 'string'])
  }
}

/** Re-parent one screen, the way both move surfaces build the candidate. */
function moved(id: string, parentId: string | undefined): Tree {
  return { ...tree, [id]: { ...tree[id], parentId } }
}

describe('moving a live page', () => {
  it('under an UNPUBLISHED parent: it follows the parent’s slug and stays live', () => {
    // `drafts` has a slug and no route. The tenant serves the routing map, not
    // the parent's state, so the page is live at its new composed address.
    const next = moved('pricing', 'drafts')
    const entries = buildScreenRouteEntries('pricing', next, live, {
      publish: false,
      currentById: tree,
    })
    expect(entries).toEqual({
      pricing: 'drafts/pricing',
      faq: 'drafts/pricing/faq',
    })
    expectStillLive(live, applySync(live, entries))
    // …and moving it does not publish the parent.
    expect(entries).not.toHaveProperty('drafts')
  })

  it('under a SLUGLESS parent: it keeps the address it has', () => {
    const next = moved('pricing', 'noSlug')
    const entries = buildScreenRouteEntries('pricing', next, live, {
      publish: false,
      currentById: tree,
    })
    expect(entries).toEqual({})
    const after = applySync(live, entries)
    expect(after.pricing).toBe('pricing')
    expect(after.faq).toBe('pricing/faq')
    expectStillLive(live, after)
  })

  it('under an UNROUTED parent whose own chain does not compose: it keeps its address', () => {
    const next = moved('pricing', 'stranded')
    const entries = buildScreenRouteEntries('pricing', next, live, {
      publish: false,
      currentById: tree,
    })
    expect(entries).toEqual({})
    expectStillLive(live, applySync(live, entries))
  })

  it('a whole live section under a slugless parent: every page in it stays', () => {
    const next = moved('company', 'noSlug')
    const after = applySync(
      live,
      buildScreenRouteEntries('company', next, live, {
        publish: false,
        currentById: tree,
      }),
    )
    expect(after).toEqual(live)
  })
})

describe('unpublishing a parent that has live children', () => {
  it('takes down the parent alone, and names the pages that stay up', () => {
    expect(liveScreenDescendants('company', tree, live)).toEqual([
      { id: 'about', path: 'company/about' },
      { id: 'team', path: 'company/about/team' },
    ])
    const after = applyUnpublish(live, 'company')
    expect(after.company).toBeUndefined()
    expectStillLive(live, after, ['company'])
  })

  it('republishing it at the same address leaves the children where they are', () => {
    const after = applyUnpublish(live, 'company')
    const entries = buildScreenRouteEntries('company', tree, after, {
      currentById: tree,
    })
    expect(entries).toEqual({
      company: 'company',
      about: 'company/about',
      team: 'company/about/team',
    })
    expect(applySync(after, entries)).toEqual(live)
  })

  it('never lists a group or a draft as a page that stays up', () => {
    const withGroup: Tree = {
      ...tree,
      folder: { kind: SCREEN_KIND_GROUP, parentId: 'company' },
      inFolder: { slug: 'news', parentId: 'folder' },
      draftChild: { slug: 'draft', parentId: 'company' },
    }
    const map = { ...live, folder: 'stray', inFolder: 'company/news' }
    expect(
      liveScreenDescendants('company', withGroup, map).map((page) => page.id),
    ).toEqual(['about', 'team', 'inFolder'])
  })
})

describe('emptying a parent’s slug', () => {
  // The besigner's Unpublish with the slug field cleared: the parent's entry
  // and slug go, in `unpublishScreenRoute`, and nothing else.
  const cleared: Tree = { ...tree, company: {} }
  const after = applyUnpublish(live, 'company')

  it('keeps every live page below it', () => {
    expectStillLive(live, after, ['company'])
    // And a rebuild of the subtree with the slug gone removes nothing.
    expect(
      buildScreenRouteEntries('company', cleared, after, {
        publish: false,
        currentById: cleared,
      }),
    ).toEqual({})
  })

  it('leaves the pages below DETACHED: a later publish of the parent does not move them', () => {
    const republished: Tree = { ...tree, company: { slug: 'firm' } }
    const entries = buildScreenRouteEntries('company', republished, after, {
      currentById: cleared,
    })
    // The parent goes live at its new address…
    expect(entries).toEqual({ company: 'firm' })
    // …and the pages that kept theirs keep them.
    const final = applySync(after, entries)
    expect(final.about).toBe('company/about')
    expect(final.team).toBe('company/about/team')
  })

  it('a rename of a LIVE parent still carries its attached children', () => {
    // The contrast: nothing was detached, so the section moves together.
    const renamed: Tree = { ...tree, company: { slug: 'firm' } }
    expect(
      buildScreenRouteEntries('company', renamed, live, {
        publish: false,
        currentById: tree,
      }),
    ).toEqual({
      company: 'firm',
      about: 'firm/about',
      team: 'firm/about/team',
    })
  })
})

describe('deleting a parent', () => {
  // A delete soft-deletes the screen and calls `unpublishScreenRoute` for it.
  // The surfaces that compose paths drop deleted screens, so the children's
  // parent is simply missing from the tree afterwards.
  const withoutCompany: Tree = { ...tree }
  delete withoutCompany.company
  const after = applyUnpublish(live, 'company')

  it('keeps every live page below it', () => {
    expect(liveScreenDescendants('company', tree, live)).toHaveLength(2)
    expectStillLive(live, after, ['company'])
  })

  it('and nothing rebuilt over the orphaned pages removes them', () => {
    for (const id of ['about', 'team']) {
      expect(
        buildScreenRouteEntries(id, withoutCompany, after, {
          publish: false,
          currentById: withoutCompany,
        }),
      ).toEqual({})
    }
  })

  it('moving an orphaned page is an explicit move, and composes its new address', () => {
    const next: Tree = {
      ...withoutCompany,
      about: { slug: 'about', parentId: 'campaigns' },
    }
    const entries = buildScreenRouteEntries('about', next, after, {
      publish: false,
      currentById: withoutCompany,
    })
    // `about` itself moves to where it now composes; `team` below it was
    // detached by the delete and stays where it is.
    expect(entries).toEqual({ about: 'about' })
    expectStillLive(after, applySync(after, entries))
  })
})
