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

/**
 * AGL-2179/AGL-2486: what console search offers, and whether the sentence
 * under the field is true.
 *
 * The caption is the part that can lie, so it is tested like code. The old
 * one said results were matched by a name PREFIX, which was true and made the
 * feature unusable; the new one says any part of a name and states the window
 * it looked at, which has to stay true as groups are added.
 */

import { Route } from '@aglyn/aglyn/app-utils/console-routes'
import type { ConsoleSearchSource } from '@aglyn/aglyn'
import {
  buildResultHref,
  describeEntities,
  entitlementAllows,
  GLOBAL_SEARCH_ENTITIES,
  globalSearchScopeMessage,
  resolveGlobalSearchScope,
  searchSourceEntity,
  type GlobalSearchEntityDef,
} from './global-search-scope'

/**
 * Two groups as a plugin contributes them (AGL-3080): records in the
 * organization's shared data, and a site collection behind a plan quota. The
 * palette names no plugin, so these stand in for every plugin that declares
 * `searchSources`.
 */
const PEOPLE: ConsoleSearchSource = {
  id: 'people',
  group: 'People',
  noun: 'people',
  scope: 'orgData',
  collection: 'people',
  nameField: 'name',
  fallbackNameField: 'email',
  extraFields: ['email'],
  order: 40,
  href: (row, { orgSlug, host }) =>
    host
      ? `/${orgSlug}/hosts/${host}/people/${String(row['$id'])}`
      : `/${orgSlug}/people/${String(row['$id'])}`,
}
const BOTTLES: ConsoleSearchSource = {
  id: 'bottles',
  group: 'Bottles',
  noun: 'bottles',
  scope: 'host',
  collection: 'bottles',
  nameField: 'name',
  entitlementKey: 'bottlesPerHost',
  featureFlag: 'reusableComponents',
  permission: 'data.manage',
  order: 150,
  href: (_row, { orgSlug, host }) => (host ? `/${orgSlug}/hosts/${host}/cellar` : null),
}
const SOURCES = [searchSourceEntity(PEOPLE), searchSourceEntity(BOTTLES)]

/** A workspace with everything switched on. */
const RICH = {
  reusableComponents: true,
  componentsPerHost: Number.POSITIVE_INFINITY,
  sharedLayoutsPerHost: 5,
  templatesPerHost: 10,
  bottlesPerHost: 12,
}

/** A plan that grants none of the gated groups. */
const FREE = {
  reusableComponents: false,
  // Free saves one reusable component per site (AGL-3615).
  componentsPerHost: 1,
  sharedLayoutsPerHost: 1,
  templatesPerHost: 10,
  bottlesPerHost: 0,
}

const TOKENS = ['org', 'host:host-1']

const scopeAt = (overrides: Record<string, any> = {}) =>
  resolveGlobalSearchScope({
    orgId: 'org-1',
    hostId: 'host-1',
    hostReady: true,
    entitlements: RICH,
    entitlementsReady: true,
    sources: SOURCES,
    ...overrides,
  })

const ids = (scope: { entities: GlobalSearchEntityDef[] }) =>
  scope.entities.map((entity) => entity.id)

describe('where the caller is standing', () => {
  it('offers nothing at all before a workspace resolves', () => {
    const scope = scopeAt({ orgId: null, orgDataTokens: TOKENS })
    expect(scope.entities).toHaveLength(0)
    expect(scope.unavailable).toBe(true)
  })

  it('offers only sites off a site', () => {
    expect(ids(scopeAt({ hostId: null }))).toEqual(['sites'])
  })

  it('holds host groups while the host id is still resolving', () => {
    // A half-resolved host would address `hosts//screens`.
    expect(ids(scopeAt({ hostReady: false }))).toEqual(['sites'])
  })

  it('offers the full set on a site', () => {
    const offered = ids(scopeAt({ orgDataTokens: TOKENS }))
    for (const group of [
      'sites',
      'screens',
      'emails',
      'components',
      'layouts',
      'templates',
      'collections',
      'authors',
      'people',
      'bottles',
    ]) {
      expect(offered).toContain(group)
    }
  })

  /**
   * A plugin's group sits among the console's by its declared `order`, and
   * the console names none of them: pages first, then the plugin's people,
   * then the site's building blocks, then the plugin's site collection.
   */
  it("lists a plugin's groups among the console's by their order", () => {
    expect(ids(scopeAt({ orgDataTokens: TOKENS }))).toEqual([
      'sites',
      'screens',
      'emails',
      'people',
      'components',
      'layouts',
      'templates',
      'collections',
      'authors',
      'bottles',
    ])
  })

  it("drops a plugin's group that claims one of the console's ids", () => {
    const imposter = searchSourceEntity({ ...PEOPLE, id: 'screens', scope: 'host' })
    const offered = scopeAt({ sources: [imposter], orgDataTokens: TOKENS }).entities
    expect(offered.filter((entity) => entity.id === 'screens')).toEqual([
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === 'screens'),
    ])
  })

  it('offers no plugin group the caller was not handed', () => {
    const offered = ids(scopeAt({ sources: undefined, orgDataTokens: TOKENS }))
    expect(offered).not.toContain('people')
    expect(offered).not.toContain('bottles')
    expect(offered).toContain('screens')
  })

  /**
   * Org data is judged by `visibleTo` (AGL-2596): under a site the group
   * exists only when the caller can say which tokens the viewer reads with.
   * Absent, empty and unresolved all mean the same thing — no group —
   * because a read without the filter is denied and would render as a
   * failure.
   */
  it("offers an org-data group only with the viewer's scope tokens", () => {
    expect(ids(scopeAt({ orgDataTokens: TOKENS }))).toContain('people')
    expect(ids(scopeAt())).not.toContain('people')
    expect(ids(scopeAt({ orgDataTokens: null }))).not.toContain('people')
    expect(ids(scopeAt({ orgDataTokens: [] }))).not.toContain('people')
    // Tokens without a workspace address `orgs//people`.
    expect(ids(scopeAt({ orgId: null, orgDataTokens: TOKENS }))).not.toContain(
      'people',
    )
  })

  /**
   * The organization level (AGL-2662). Off a site there is no consent group
   * to resolve tokens from, so the tokens cannot be the gate; org-wide
   * membership is, because the rules admit the unfiltered read to that
   * reader alone.
   */
  it('offers org data at the organization level to an org-wide member', () => {
    const offered = ids(scopeAt({ hostId: null, orgWide: true }))
    expect(offered).toContain('people')
    // A site's collections still belong to one site.
    expect(offered).not.toContain('screens')
    expect(offered).not.toContain('bottles')
  })

  it('withholds org data at the organization level from anyone else', () => {
    for (const context of [
      { hostId: null },
      { hostId: null, orgWide: false },
      // Tokens are a SITE's answer and say nothing about org-wide reach.
      { hostId: null, orgDataTokens: TOKENS },
    ]) {
      expect(ids(scopeAt(context))).not.toContain('people')
    }
  })

  /**
   * Org-wide membership is not a way into a SITE's window: under a site the
   * tokens are the question the rules ask, and a reader without them is
   * withheld the group rather than shown a denial.
   */
  it("does not let org-wide reach stand in for a site's tokens", () => {
    expect(ids(scopeAt({ orgWide: true, orgDataTokens: null }))).not.toContain(
      'people',
    )
  })
})

describe('entitlement gating, which is a cost control as well as a correctness one', () => {
  /**
   * Querying a collection the plan does not grant would spend a read to
   * render nothing, every time. Cost scaling with what the org actually owns
   * is the right direction for a plan that has to hard-cap.
   */
  it('never reads a collection the plan does not grant', () => {
    const offered = ids(scopeAt({ entitlements: FREE }))
    expect(offered).not.toContain('bottles')
    // …but the ungated groups are unaffected, and neither is a group whose
    // count Free holds one of (AGL-3615).
    expect(offered).toContain('components')
    expect(offered).toContain('screens')
    expect(offered).toContain('collections')
    expect(offered).toContain('layouts')
  })

  /**
   * A loading default that answers a question it was never asked is how a
   * paying org gets rendered as Free. Unresolved must mean "hold", not
   * "assume the cheapest plan" and not "assume the richest".
   */
  it('holds gated groups while entitlements are UNRESOLVED', () => {
    const offered = ids(scopeAt({ entitlements: null, entitlementsReady: false }))
    expect(offered).not.toContain('bottles')
    expect(offered).not.toContain('components')
    // The ungated groups still work, so the palette is useful immediately.
    expect(offered).toContain('screens')
    expect(offered).toContain('sites')
  })

  it('does not treat a resolved-but-silent entitlement as a denial', () => {
    // Every pre-existing org has a record that simply does not mention a
    // newer quota; reading absence as denial would empty most of the palette.
    const quiet = { ...RICH } as Record<string, unknown>
    delete quiet.bottlesPerHost
    expect(entitlementAllows(searchSourceEntity(BOTTLES), quiet)).toBe(true)
  })

  it('reads a zero quota as denied and a positive one as allowed', () => {
    const bottles = searchSourceEntity(BOTTLES)
    expect(entitlementAllows(bottles, { bottlesPerHost: 0 })).toBe(false)
    expect(entitlementAllows(bottles, { bottlesPerHost: 3 })).toBe(true)
    const components = GLOBAL_SEARCH_ENTITIES.find((e) => e.id === 'components')!
    expect(entitlementAllows(components, { componentsPerHost: 0 })).toBe(false)
    // Free's one component, not the `reusableComponents` flag it lacks (AGL-3615).
    expect(entitlementAllows(components, { componentsPerHost: 1, reusableComponents: false })).toBe(true)
  })

  it('lets an ungated group through with no entitlements at all', () => {
    const screens = GLOBAL_SEARCH_ENTITIES.find((e) => e.id === 'screens')!
    expect(entitlementAllows(screens, null)).toBe(true)
  })
})

describe('the registry', () => {
  /**
   * Getting `nameField` wrong renders a whole group of rows labeled with
   * their document id. The split is real and not tidy: the besigner resources
   * use `displayName`, authors use `name`.
   */
  it('names each collection by the field that write path actually stores', () => {
    const nameFieldOf = (id: string) =>
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === id)?.nameField
    expect(nameFieldOf('sites')).toBe('displayName')
    expect(nameFieldOf('screens')).toBe('displayName')
    expect(nameFieldOf('layouts')).toBe('displayName')
    expect(nameFieldOf('components')).toBe('displayName')
    expect(nameFieldOf('templates')).toBe('displayName')
    expect(nameFieldOf('collections')).toBe('displayName')
    expect(nameFieldOf('authors')).toBe('name')
  })

  it('reads pages and emails out of the SAME collection', () => {
    const collectionOf = (id: string) =>
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === id)?.collection
    expect(collectionOf('screens')).toBe('screens')
    expect(collectionOf('emails')).toBe('screens')
  })

  /**
   * Nothing here may be a top-level collection query: that is the shape that
   * can leak, whatever it filters on. Sites come from the caller's own
   * projection, everything else of the console's from the site already open.
   */
  it('scopes every group under a user or a host, never the root', () => {
    for (const entity of GLOBAL_SEARCH_ENTITIES) {
      expect(['org', 'host']).toContain(entity.scopeKind)
    }
    expect(
      GLOBAL_SEARCH_ENTITIES.filter((entity) => entity.scopeKind === 'org').map(
        (entity) => entity.collection,
      ),
    ).toEqual(['hostMemberships'])
  })

  /**
   * The console names no plugin's group: every one arrives through a
   * declaration, and the only thing the console keeps of it is the read it
   * describes, its quota and its link.
   */
  it("keeps no plugin's group of its own", () => {
    expect(GLOBAL_SEARCH_ENTITIES.map((entity) => entity.id)).toEqual([
      'sites',
      'screens',
      'emails',
      'components',
      'layouts',
      'templates',
      'collections',
      'authors',
    ])
  })

  it('takes a declared source as the read it describes', () => {
    const people = searchSourceEntity(PEOPLE)
    expect(people).toMatchObject({
      id: 'people',
      group: 'People',
      noun: 'people',
      scopeKind: 'orgData',
      collection: 'people',
      nameField: 'name',
      fallbackNameField: 'email',
      extraFields: ['email'],
      order: 40,
    })
    expect(people.href).toBe(PEOPLE.href)
    // The quota is judged here; the plan flag and the permission are the
    // shell's gates and were applied before the source was handed over.
    const bottles = searchSourceEntity(BOTTLES)
    expect(bottles.entitlementKey).toBe('bottlesPerHost')
    expect(bottles.featureKey).toBeUndefined()
    expect(bottles).not.toHaveProperty('permission')
  })
})

describe('the sentence under the field', () => {
  it('says nothing when there is nothing to search', () => {
    expect(globalSearchScopeMessage(scopeAt({ orgId: null }), 30)).toBe('')
  })

  /**
   * The claim the old copy had to make in the opposite direction. If this
   * ever reverts to a prefix matcher the caption has to revert with it.
   */
  it('promises a match on ANY part of a name', () => {
    expect(globalSearchScopeMessage(scopeAt(), 30)).toContain(
      'any part of a name',
    )
    expect(globalSearchScopeMessage(scopeAt(), 30)).not.toContain('STARTS')
  })

  /**
   * The claim that stops the new mechanism from being a nicer-looking version
   * of the old lie: a window is a partial set, and absence of a result is
   * only evidence of absence if everything was looked at.
   */
  it('states the window it actually looked at', () => {
    expect(globalSearchScopeMessage(scopeAt(), 30)).toContain('30')
    expect(globalSearchScopeMessage(scopeAt(), 7)).toContain('7')
    expect(globalSearchScopeMessage(scopeAt(), 30)).toMatch(/not shown|may hold/)
  })

  it('lists nouns without an Oxford comma, and shortens a long list', () => {
    expect(describeEntities([])).toBe('')
    expect(
      describeEntities(GLOBAL_SEARCH_ENTITIES.slice(0, 2)),
    ).toBe('sites and pages')
    expect(
      describeEntities(GLOBAL_SEARCH_ENTITIES.slice(0, 3)),
    ).toBe('sites, pages and emails')
  })

  it('does not put twelve nouns in a placeholder', () => {
    const { placeholder } = scopeAt()
    expect(placeholder).toContain('and more')
    expect(placeholder.length).toBeLessThan(60)
  })

  /**
   * Read off a real console, where it is the single most visible string this
   * feature owns: `Search sites, pages and emails and more…`. The truncated
   * list kept its own conjunction and then had another appended.
   */
  it('does not stutter "and" when the list is shortened', () => {
    const { placeholder } = scopeAt()
    expect(placeholder).toBe('Search sites, pages, emails and more…')
    expect(placeholder).not.toMatch(/and .* and more/)
  })
})

const buildRouteFake = ((route: Route, payload: any) => {
  let out = String(route)
  for (const [key, value] of Object.entries(payload)) {
    out = out.replace(`[${key}]`, String(value))
  }
  return out
}) as any

const core = (id: string) =>
  GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === id) as GlobalSearchEntityDef

describe('where a result row goes', () => {
  const href = (definition: GlobalSearchEntityDef, row: Record<string, any>) =>
    buildResultHref(
      definition,
      row,
      { orgSlug: 'acme', hostSubdomain: 'demo' },
      buildRouteFake,
    )

  it('reaches every kind of row the console keeps', () => {
    expect(href(core('sites'), { $id: 'h1', subdomain: 'demo' })).toBe(
      '/acme/hosts/demo',
    )
    expect(href(core('screens'), { $id: 's1', versionId: 'v1' })).toBe(
      '/acme/hosts/demo/screens/s1/versions/v1/view',
    )
    expect(href(core('emails'), { $id: 's2', versionId: 'v2' })).toBe(
      '/acme/hosts/demo/screens/s2/versions/v2/besigner',
    )
    expect(href(core('components'), { $id: 'c1' })).toBe(
      '/acme/hosts/demo/components/c1',
    )
    expect(href(core('layouts'), { $id: 'l1' })).toBe('/acme/hosts/demo/layouts/l1')
    expect(href(core('templates'), { $id: 't1' })).toBe(
      '/acme/hosts/demo/templates/t1',
    )
    expect(href(core('collections'), { $id: 'x' })).toBe('/acme/hosts/demo/content')
    expect(href(core('authors'), { $id: 'a1' })).toBe('/acme/hosts/demo/content')
  })

  /**
   * A plugin's row is linked by the plugin, handed the two route params —
   * the console app may not import a plugin to learn its addresses.
   */
  it("asks a plugin's group where its row opens", () => {
    expect(href(searchSourceEntity(PEOPLE), { $id: 'p1' })).toBe(
      '/acme/hosts/demo/people/p1',
    )
    expect(href(searchSourceEntity(BOTTLES), { $id: 'b1' })).toBe(
      '/acme/hosts/demo/cellar',
    )
  })
})

describe('where a result row goes at the organization level (AGL-2662)', () => {
  const href = (definition: GlobalSearchEntityDef, row: Record<string, any>) =>
    buildResultHref(
      definition,
      row,
      { orgSlug: 'acme', hostSubdomain: null },
      buildRouteFake,
    )

  it("hands a plugin's group no site, and takes its answer", () => {
    expect(href(searchSourceEntity(PEOPLE), { $id: 'p1' })).toBe('/acme/people/p1')
    expect(href(searchSourceEntity(BOTTLES), { $id: 'b1' })).toBeNull()
  })

  it('still refuses a site collection with no site', () => {
    expect(href(core('layouts'), { $id: 'l1' })).toBeNull()
    expect(href(core('screens'), { $id: 's1', versionId: 'v1' })).toBeNull()
  })

  /**
   * The complaint this issue opened with was a row that does nothing when
   * clicked. A row that cannot be addressed returns null here and is dropped
   * by the dialog, rather than rendering as a link to nowhere.
   */
  it('returns null rather than a link to nowhere', () => {
    const onSite = { orgSlug: 'acme', hostSubdomain: 'demo' }
    // The besigner routes are version-keyed; a screen with no version has
    // never been opened.
    expect(buildResultHref(core('screens'), { $id: 's1' }, onSite, buildRouteFake)).toBeNull()
    expect(buildResultHref(core('emails'), { $id: 's1' }, onSite, buildRouteFake)).toBeNull()
    // A membership row with no subdomain cannot address its site.
    expect(buildResultHref(core('sites'), { $id: 'h1' }, onSite, buildRouteFake)).toBeNull()
    // And without a workspace slug nothing in the console is addressable —
    // a plugin's group included, which is never asked.
    for (const definition of [core('screens'), searchSourceEntity(PEOPLE)]) {
      expect(
        buildResultHref(
          definition,
          { $id: 's1', versionId: 'v1' },
          { orgSlug: null, hostSubdomain: 'demo' },
          buildRouteFake,
        ),
      ).toBeNull()
    }
  })
})
