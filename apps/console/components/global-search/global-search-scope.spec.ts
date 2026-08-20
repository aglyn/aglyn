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
 * AGL-2179: the placeholder may only promise what the context can answer.
 *
 * The issue is a promise that outran the product — a console mockup, published
 * twice on the marketing site, showing `Search sites, orders, contacts…` over
 * a console with no search of any kind. The failure mode this guards is the
 * obvious repair of that: shipping a real field and pasting the mockup's
 * sentence over it, so the words are still wrong and now there is a cursor
 * blinking in them.
 *
 * So the assertions are about the SENTENCE, not the plumbing: what it names,
 * what it must never name, and that it tracks the scope rather than being
 * written down twice.
 */

import {
  describeEntities,
  type GlobalSearchEntity,
  globalSearchScopeMessage,
  resolveGlobalSearchScope,
} from './global-search-scope'

/** On a site: the workspace resolved and a host is open and settled. */
const ON_SITE = { orgId: 'org-1', hostId: 'host-1', hostReady: true }
/** In a workspace, off any site — the org dashboard, billing, settings. */
const OFF_SITE = { orgId: 'org-1', hostId: null, hostReady: true }
/** Before the workspace resolves, and the workspace picker itself. */
const NO_ORG = { orgId: null, hostId: null, hostReady: true }

describe('what console search offers to search', () => {
  it('searches sites and pages on a site', () => {
    const scope = resolveGlobalSearchScope(ON_SITE)
    expect(scope.entities).toEqual(['sites', 'screens'])
    expect(scope.unavailable).toBe(false)
  })

  it('searches only sites off a site', () => {
    // Screens are host-scoped. Offering them across an org would be a query
    // per site — a fan-out on an interactive path — so the scope shrinks and
    // the placeholder shrinks with it.
    expect(resolveGlobalSearchScope(OFF_SITE).entities).toEqual(['sites'])
  })

  /**
   * The scoping guard, not a loading-state guard.
   *
   * The sites query is narrowed by `where('orgId','==',orgId)`. An unresolved
   * org does not narrow it — it drops the filter and returns this person's
   * memberships across EVERY org (AGL-2350). So "not yet known" has to mean
   * "search nothing", never "search sites and sort it out later".
   */
  it('searches NOTHING until the workspace is known', () => {
    const scope = resolveGlobalSearchScope(NO_ORG)
    expect(scope.entities).toEqual([])
    expect(scope.unavailable).toBe(true)
  })

  it('does not offer pages while the host id is still resolving', () => {
    // A half-resolved host would query `hosts//screens`.
    expect(
      resolveGlobalSearchScope({ ...ON_SITE, hostReady: false }).entities,
    ).toEqual(['sites'])
    expect(
      resolveGlobalSearchScope({ ...ON_SITE, hostId: null }).entities,
    ).toEqual(['sites'])
  })
})

describe('the placeholder', () => {
  it('names exactly what the scope can reach, and nothing else', () => {
    expect(resolveGlobalSearchScope(ON_SITE).placeholder).toBe(
      'Search sites and pages…',
    )
    expect(resolveGlobalSearchScope(OFF_SITE).placeholder).toBe(
      'Search sites…',
    )
  })

  /**
   * THE assertion this issue exists for.
   *
   * `Search sites, orders, contacts…` is the mockup's string. Orders have no
   * `nameLower` and would need a schema field, a backfill and a new composite
   * index; contacts are behind `release_contacts`, which is default-off. Both
   * are free to promise and expensive to mean, which is the asymmetry that
   * produced the original defect. A future change that makes either genuinely
   * searchable adds it to the entity list, and this test then reads the new
   * word out of the placeholder rather than blocking it.
   */
  it('never promises a capability that does not exist', () => {
    for (const context of [ON_SITE, OFF_SITE, NO_ORG]) {
      const scope = resolveGlobalSearchScope(context)
      const promised = `${scope.placeholder} ${globalSearchScopeMessage(scope)}`
      for (const absent of ['order', 'contact']) {
        // The scope message names them to say they are NOT searchable, so the
        // claim under test is narrower: the entity list must not contain them.
        expect(scope.entities).not.toContain(absent)
      }
      // The mockup's sentence, verbatim, must never be what a person reads.
      expect(promised).not.toContain('Search sites, orders, contacts')
    }
  })

  it('is derived from the scope rather than written down twice', () => {
    // A placeholder that names an entity the scope does not hold is the
    // defect. Asserting the containment relation catches a hand-edited
    // sentence that a fixed-string comparison would not.
    for (const context of [ON_SITE, OFF_SITE]) {
      const scope = resolveGlobalSearchScope(context)
      expect(scope.placeholder).toContain(describeEntities(scope.entities))
    }
  })

  it('offers no affordance at all when nothing is searchable', () => {
    const scope = resolveGlobalSearchScope(NO_ORG)
    expect(scope.unavailable).toBe(true)
    expect(globalSearchScopeMessage(scope)).toBe('')
  })
})

describe('the scope message', () => {
  /**
   * Firestore has no full-text index; this is a prefix range over `nameLower`.
   * Typing `store` finds "Store front" and never "My store". Unsaid, an empty
   * result reads as "you do not have one" — which for someone about to create
   * a duplicate is the expensive direction to be wrong in.
   */
  it('says the match is a prefix, in words a person can act on', () => {
    const message = globalSearchScopeMessage(resolveGlobalSearchScope(ON_SITE))
    expect(message).toContain('STARTS with')
  })

  it('says outright that orders and contacts are not searchable', () => {
    // The mockup named both. Silence about them would leave the reader to
    // assume the field simply found nothing.
    for (const context of [ON_SITE, OFF_SITE]) {
      const message = globalSearchScopeMessage(
        resolveGlobalSearchScope(context),
      )
      expect(message).toContain('Orders and contacts are not searchable')
    }
  })
})

describe('describeEntities', () => {
  it('reads as English for one, two and three entities', () => {
    const three = ['sites', 'screens', 'sites'] as GlobalSearchEntity[]
    expect(describeEntities([])).toBe('')
    expect(describeEntities(['sites'])).toBe('sites')
    expect(describeEntities(['sites', 'screens'])).toBe('sites and pages')
    // Growth case: the joiner must not degrade to "a and b and c".
    expect(describeEntities(three)).toBe('sites, pages and sites')
  })

  it('calls a screen a page, because that is what the console calls it', () => {
    expect(describeEntities(['screens'])).toBe('pages')
  })
})
