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
 * AGL-2173 — the `WHAT'S INCLUDED` box on the marketplace listing mockup.
 *
 * Every row has to be a fact the listing already carries. The mockup's own
 * bullets are publisher prose (`12 responsive screens`) that nothing
 * collects, and a checklist that guessed at content would be the one part
 * of a shop page nobody can dispute and everybody believes.
 */

import { listingInclusions, type ListingInstallReach } from './marketplace'

const labels = (listing: Parameters<typeof listingInclusions>[0], options = {}) =>
  listingInclusions(listing, options).map((row) => row.label)

describe('listingInclusions', () => {
  it('leads with what the install actually produces', () => {
    expect(labels({ artifactType: 'template' })[0]).toBe(
      'Editable pages you can rework in Besigner',
    )
    expect(labels({ artifactType: 'datasetSchema' })[0]).toContain(
      'new empty dataset',
    )
    expect(labels({ artifactType: 'theme' })[0]).toContain('theme')
  })

  it('says where it lands, and flags the per-site limit as a NOTE', () => {
    // `INSTALL_TARGETS` is not a policy choice — it is where the install
    // routes physically write. A template cannot org-pin, so new sites are
    // genuinely not covered, and softening that would put the caveat only
    // in the picker where it is read once.
    const orgWide = listingInclusions({ artifactType: 'plugin' })
    const perSite = listingInclusions({ artifactType: 'template' })
    expect(orgWide[1].label).toBe('Installs on every site, including sites you add later')
    expect(orgWide[1].tone).toBe('included')
    expect(perSite[1].label).toContain("A new site doesn't get it automatically")
    expect(perSite[1].tone).toBe('note')
  })

  it('claims review only for a version that passed it', () => {
    expect(labels({ artifactType: 'plugin' })).not.toContain(
      'This version passed marketplace review',
    )
    expect(
      labels({ artifactType: 'plugin' }, { reviewedVersion: true }),
    ).toContain('This version passed marketplace review')
  })

  it('omits the licence row when the publisher declared none', () => {
    // `Licensed undefined` is the shape this guards against.
    expect(labels({ artifactType: 'template' }).join(' ')).not.toContain(
      'Licensed',
    )
    expect(labels({ artifactType: 'template', license: 'MIT' })).toContain(
      'Licensed MIT',
    )
  })

  it('distinguishes a one-time purchase from a free listing', () => {
    expect(labels({ artifactType: 'template', priceUsd: 29 })).toContain(
      'A one-time purchase — updates to this listing are included',
    )
    expect(labels({ artifactType: 'template' })).toContain(
      'Free, including every future update',
    )
    expect(labels({ artifactType: 'template', priceUsd: 0 })).toContain(
      'Free, including every future update',
    )
  })

  it('still says something for a LEGACY listing with no artifactType', () => {
    // Listings predating AGL-654 carry only `type`/`kind`, and a blank
    // box on an install page is worse than a general one.
    const legacy = labels({ kind: 'template' })
    expect(legacy.length).toBeGreaterThanOrEqual(3)
    expect(legacy[0]).toBeTruthy()
  })

  it('never invents a content count', () => {
    // The line this whole helper exists to not cross.
    expect(labels({ artifactType: 'template' }).join(' ')).not.toMatch(/\d+ screens/)
  })

  it('says which plans connecting a declared service needs (AGL-4197)', () => {
    const rows = listingInclusions(
      { artifactType: 'plugin' },
      { connections: ['Google Business Profile'] },
    )
    expect(rows[1]).toEqual({
      label:
        'Connecting Google Business Profile comes with the Starter, Pro and Custom plans',
      tone: 'note',
    })
    expect(labels({ artifactType: 'plugin' }).join(' ')).not.toContain('Connecting')
    expect(
      labels({ artifactType: 'template' }, { connections: ['Google Business Profile'] }).join(' '),
    ).not.toContain('Connecting')
  })

  it('does not call a realm-trusted plugin separate from the site', () => {
    expect(labels({ artifactType: 'plugin' })[0]).toBe(
      'A plugin that runs in its own secure space, separate from your site',
    )
    const realm = labels({ artifactType: 'plugin' }, { realmTrusted: true })[0]
    expect(realm).toMatch(/^A plugin, reviewed and signed by .+ to run with your site$/)
    expect(realm).not.toContain('separate')
  })

  it('says the reach of the Install to choice on offer', () => {
    const reach = (artifactType: string, installTo: ListingInstallReach) =>
      listingInclusions({ artifactType }, { installTo })[1]
    expect(reach('plugin', 'selected')).toEqual({
      label: "Installs only on the sites you pick. A new site doesn't get it until you add it",
      tone: 'note',
    })
    expect(reach('plugin', 'allExcept')).toEqual({
      label: 'Installs on every site but the ones you leave out, including sites you add later',
      tone: 'included',
    })
    expect(reach('plugin', 'thisSite')).toEqual({
      label: 'Installs on this site only',
      tone: 'note',
    })
    expect(reach('component', 'selected').label).toContain('only on the sites you pick')
    expect(reach('component', 'allExcept')).toEqual({
      label:
        "Installs on the sites you have now, minus the ones you leave out. A new site doesn't get it automatically",
      tone: 'note',
    })
    // An org-only artifact has no per-site form, so any choice reads as All sites.
    expect(reach('datasetSchema', 'selected')).toEqual(reach('datasetSchema', 'all'))
    expect(reach('datasetSchema', 'all').label).toContain('including sites you add later')
  })

  it('never pairs a choice that leaves sites out with sites added later', () => {
    for (const artifactType of ['plugin', 'component', 'template']) {
      for (const installTo of ['selected', 'thisSite'] as const) {
        expect(
          listingInclusions({ artifactType }, { installTo })[1].label,
        ).not.toContain('sites you add later')
      }
    }
  })
})
