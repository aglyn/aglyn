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
import {
  buildResultHref,
  describeEntities,
  entitlementAllows,
  GLOBAL_SEARCH_ENTITIES,
  globalSearchScopeMessage,
  resolveGlobalSearchScope,
  type GlobalSearchEntity,
  type GlobalSearchEntityDef,
} from './global-search-scope'

/** A workspace with everything switched on. */
const RICH = {
  reusableComponents: true,
  workflows: true,
  commerce: true,
  redirects: true,
  bookings: true,
  sharedLayoutsPerHost: 5,
  templatesPerHost: 10,
  workflowsPerHost: 5,
  productsPerHost: 100,
  redirectsPerHost: 10,
  servicesPerHost: 3,
}

/** The free plan, as `PLAN_ENTITLEMENTS.free` actually shapes it. */
const FREE = {
  reusableComponents: false,
  workflows: false,
  commerce: false,
  redirects: false,
  bookings: false,
  sharedLayoutsPerHost: 1,
  templatesPerHost: 10,
  workflowsPerHost: 0,
  productsPerHost: 0,
  redirectsPerHost: 0,
  servicesPerHost: 0,
}

const scopeAt = (overrides: Record<string, any> = {}) =>
  resolveGlobalSearchScope({
    orgId: 'org-1',
    hostId: 'host-1',
    hostReady: true,
    entitlements: RICH,
    entitlementsReady: true,
    ...overrides,
  })

const ids = (scope: { entities: GlobalSearchEntityDef[] }) =>
  scope.entities.map((entity) => entity.id)

describe('where the caller is standing', () => {
  it('offers nothing at all before a workspace resolves', () => {
    const scope = scopeAt({ orgId: null })
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
    const offered = ids(scopeAt())
    expect(offered).toContain('sites')
    expect(offered).toContain('screens')
    expect(offered).toContain('emails')
    expect(offered).toContain('components')
    expect(offered).toContain('layouts')
    expect(offered).toContain('templates')
    expect(offered).toContain('collections')
    expect(offered).toContain('authors')
  })

  /**
   * Contacts are org data judged by `visibleTo` (AGL-2596): the group exists
   * only when the caller can say which tokens the viewer reads with. Absent,
   * empty and unresolved all mean the same thing — no group — because a read
   * without the filter is denied and would render as a failure.
   */
  it('offers contacts only with the viewer\'s scope tokens', () => {
    expect(ids(scopeAt({ orgDataTokens: ['org', 'host:host-1'] }))).toContain(
      'contacts',
    )
    expect(ids(scopeAt())).not.toContain('contacts')
    expect(ids(scopeAt({ orgDataTokens: null }))).not.toContain('contacts')
    expect(ids(scopeAt({ orgDataTokens: [] }))).not.toContain('contacts')
    // Tokens without a workspace address `orgs//contacts`.
    expect(
      ids(scopeAt({ orgId: null, orgDataTokens: ['org', 'host:host-1'] })),
    ).not.toContain('contacts')
  })

  it('offers contacts whatever the plan — every tier has an audience band', () => {
    expect(
      ids(scopeAt({ entitlements: FREE, orgDataTokens: ['org', 'host:host-1'] })),
    ).toContain('contacts')
  })

  /**
   * Companies and deals are org data under the same predicate as contacts,
   * and leads are host data whose rows open in the CRM (AGL-2622). All three
   * follow the contacts gate: offered with the tokens, withheld without them,
   * whatever the plan says.
   */
  it('offers leads, companies and deals under the same gate as contacts', () => {
    const withTokens = ids(scopeAt({ orgDataTokens: ['org', 'host:host-1'] }))
    expect(withTokens).toContain('leads')
    expect(withTokens).toContain('companies')
    expect(withTokens).toContain('deals')
    for (const context of [{}, { orgDataTokens: null }, { orgDataTokens: [] }]) {
      const offered = ids(scopeAt(context))
      expect(offered).not.toContain('leads')
      expect(offered).not.toContain('companies')
      expect(offered).not.toContain('deals')
    }
    const free = ids(scopeAt({ entitlements: FREE, orgDataTokens: ['org', 'host:host-1'] }))
    expect(free).toContain('leads')
    expect(free).toContain('companies')
    expect(free).toContain('deals')
  })

  it('withholds leads off a site even with tokens — they are host data', () => {
    expect(
      ids(scopeAt({ hostId: null, hostReady: false, orgDataTokens: ['org'] })),
    ).not.toContain('leads')
  })
})

describe('entitlement gating, which is a cost control as well as a correctness one', () => {
  /**
   * A free workspace has no workflows, products, services or redirects, so
   * querying those collections would spend a read to render nothing, every
   * time. Cost scaling with what the org actually owns is the right direction
   * for a plan that has to hard-cap.
   */
  it('never reads a collection the plan does not grant', () => {
    const offered = ids(scopeAt({ entitlements: FREE }))
    expect(offered).not.toContain('workflows')
    expect(offered).not.toContain('products')
    expect(offered).not.toContain('services')
    expect(offered).not.toContain('redirects')
    expect(offered).not.toContain('components')
    // …but the ungated groups are unaffected.
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
    expect(offered).not.toContain('workflows')
    expect(offered).not.toContain('products')
    // The ungated groups still work, so the palette is useful immediately.
    expect(offered).toContain('screens')
    expect(offered).toContain('sites')
  })

  it('does not treat a resolved-but-silent entitlement as a denial', () => {
    // Every pre-existing org has a record that simply does not mention a
    // newer quota; reading absence as denial would empty most of the palette.
    const quiet = { ...RICH } as Record<string, unknown>
    delete quiet.workflowsPerHost
    expect(
      entitlementAllows(
        GLOBAL_SEARCH_ENTITIES.find((e) => e.id === 'workflows') as any,
        quiet,
      ),
    ).toBe(true)
  })

  it('reads a zero quota as denied and a positive one as allowed', () => {
    const workflows = GLOBAL_SEARCH_ENTITIES.find((e) => e.id === 'workflows')!
    expect(entitlementAllows(workflows, { workflows: true, workflowsPerHost: 0 })).toBe(false)
    expect(entitlementAllows(workflows, { workflows: true, workflowsPerHost: 3 })).toBe(true)
    expect(entitlementAllows(workflows, { workflows: false, workflowsPerHost: 3 })).toBe(false)
  })

  it('lets an ungated group through with no entitlements at all', () => {
    const screens = GLOBAL_SEARCH_ENTITIES.find((e) => e.id === 'screens')!
    expect(entitlementAllows(screens, null)).toBe(true)
  })
})

describe('the registry', () => {
  /**
   * Getting `nameField` wrong renders a whole group of rows labelled with
   * their document id. The split is real and not tidy: the besigner resources
   * use `displayName`, the logic and commerce resources use `name`.
   */
  it('names each collection by the field that write path actually stores', () => {
    const nameFieldOf = (id: GlobalSearchEntity) =>
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === id)?.nameField
    expect(nameFieldOf('screens')).toBe('displayName')
    expect(nameFieldOf('layouts')).toBe('displayName')
    expect(nameFieldOf('components')).toBe('displayName')
    expect(nameFieldOf('templates')).toBe('displayName')
    expect(nameFieldOf('collections')).toBe('displayName')
    expect(nameFieldOf('authors')).toBe('name')
    expect(nameFieldOf('workflows')).toBe('name')
    expect(nameFieldOf('products')).toBe('name')
    expect(nameFieldOf('services')).toBe('name')
    expect(nameFieldOf('redirects')).toBe('source')
    // A contact's canonical name, with the email standing in for a person a
    // checkout captured without one.
    expect(nameFieldOf('contacts')).toBe('name')
    expect(
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === 'contacts')
        ?.fallbackNameField,
    ).toBe('email')
    // A lead is labelled the way the Leads list labels it; a company by its
    // name and found by its domain; a deal by its title (AGL-2622).
    expect(nameFieldOf('leads')).toBe('name')
    expect(
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === 'leads')?.fallbackNameField,
    ).toBe('email')
    expect(nameFieldOf('companies')).toBe('name')
    expect(
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === 'companies')?.extraFields,
    ).toContain('domain')
    expect(nameFieldOf('deals')).toBe('title')
  })

  it('reads pages and emails out of the SAME collection', () => {
    const collectionOf = (id: GlobalSearchEntity) =>
      GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === id)?.collection
    expect(collectionOf('screens')).toBe('screens')
    expect(collectionOf('emails')).toBe('screens')
  })

  /**
   * Nothing here may be a top-level collection query: that is the shape that
   * can leak, whatever it filters on. Sites come from the caller's own
   * projection, everything else from the site already open.
   */
  it('scopes every group under a user, a host or the org data root, never the root', () => {
    for (const entity of GLOBAL_SEARCH_ENTITIES) {
      expect(['org', 'host', 'orgData']).toContain(entity.scopeKind)
    }
    expect(
      GLOBAL_SEARCH_ENTITIES.filter((entity) => entity.scopeKind === 'org').map(
        (entity) => entity.collection,
      ),
    ).toEqual(['hostMemberships'])
    // The org data root is read through `visibleTo`, and only the CRM's
    // collections are read that way — a new entry here needs the rules'
    // predicate too.
    expect(
      GLOBAL_SEARCH_ENTITIES.filter((entity) => entity.scopeKind === 'orgData').map(
        (entity) => entity.collection,
      ),
    ).toEqual(['contacts', 'companies', 'deals'])
    // Leads are host data whose rows open in the CRM, and the flag is what
    // ties the group to the hub's gate rather than the site's membership.
    const leads = GLOBAL_SEARCH_ENTITIES.find((entity) => entity.id === 'leads')
    expect(leads?.scopeKind).toBe('host')
    expect(leads?.collection).toBe('leads')
    expect(leads?.surface).toBe('crm')
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

describe('where a result row goes', () => {
  const context = { orgSlug: 'acme', hostSubdomain: 'demo' }
  const href = (entity: GlobalSearchEntity, row: Record<string, any>) =>
    buildResultHref(entity, row, context, ((route: Route, payload: any) => {
      let out = String(route)
      for (const [key, value] of Object.entries(payload)) {
        out = out.replace(`[${key}]`, String(value))
      }
      return out
    }) as any)

  it('reaches every kind of row', () => {
    expect(href('sites', { $id: 'h1', subdomain: 'demo' })).toBe(
      '/acme/hosts/demo',
    )
    expect(href('screens', { $id: 's1', versionId: 'v1' })).toBe(
      '/acme/hosts/demo/screens/s1/versions/v1/view',
    )
    expect(href('emails', { $id: 's2', versionId: 'v2' })).toBe(
      '/acme/hosts/demo/screens/s2/versions/v2/besigner',
    )
    expect(href('components', { $id: 'c1' })).toBe(
      '/acme/hosts/demo/components/c1',
    )
    expect(href('layouts', { $id: 'l1' })).toBe('/acme/hosts/demo/layouts/l1')
    expect(href('templates', { $id: 't1' })).toBe(
      '/acme/hosts/demo/templates/t1',
    )
    expect(href('collections', { $id: 'x' })).toBe('/acme/hosts/demo/content')
    expect(href('authors', { $id: 'a1' })).toBe('/acme/hosts/demo/content')
    expect(href('workflows', { $id: 'w1' })).toBe('/acme/hosts/demo/automation')
    expect(href('products', { $id: 'p1' })).toBe('/acme/hosts/demo/products')
    expect(href('redirects', { $id: 'r1' })).toBe('/acme/hosts/demo/redirects')
    expect(href('services', { $id: 'sv1' })).toBe('/acme/hosts/demo/bookings')
    // A person's own page, under the CRM hub's contacts section — and a
    // lead's, a company's and a deal's under theirs (AGL-2622).
    expect(href('contacts', { $id: 'c 1' })).toBe(
      '/acme/hosts/demo/crm/contacts/c%201',
    )
    expect(href('leads', { $id: 'l1' })).toBe('/acme/hosts/demo/crm/leads/l1')
    expect(href('companies', { $id: 'co1' })).toBe(
      '/acme/hosts/demo/crm/companies/co1',
    )
    expect(href('deals', { $id: 'd/1' })).toBe('/acme/hosts/demo/crm/deals/d%2F1')
  })

  /**
   * The complaint this issue opened with was a row that does nothing when
   * clicked. A row that cannot be addressed returns null here and is dropped
   * by the dialog, rather than rendering as a link to nowhere.
   */
  it('returns null rather than a link to nowhere', () => {
    // The besigner routes are version-keyed; a screen with no version has
    // never been opened.
    expect(href('screens', { $id: 's1' })).toBeNull()
    expect(href('emails', { $id: 's1' })).toBeNull()
    // A membership row with no subdomain cannot address its site.
    expect(href('sites', { $id: 'h1' })).toBeNull()
    // Off a site there is no host segment to build with.
    expect(
      buildResultHref(
        'layouts',
        { $id: 'l1' },
        { orgSlug: 'acme', hostSubdomain: null },
        ((r: any) => String(r)) as any,
      ),
    ).toBeNull()
    for (const entity of ['contacts', 'leads', 'companies', 'deals'] as const) {
      expect(
        buildResultHref(
          entity,
          { $id: 'c1' },
          { orgSlug: 'acme', hostSubdomain: null },
          ((r: any) => String(r)) as any,
        ),
      ).toBeNull()
    }
    // And without a workspace slug nothing in the console is addressable.
    expect(
      buildResultHref(
        'screens',
        { $id: 's1', versionId: 'v1' },
        { orgSlug: null, hostSubdomain: 'demo' },
        ((r: any) => String(r)) as any,
      ),
    ).toBeNull()
  })
})
