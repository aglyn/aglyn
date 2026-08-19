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

import { listingInclusions } from './marketplace'

const labels = (listing: Parameters<typeof listingInclusions>[0], options = {}) =>
  listingInclusions(listing, options).map((row) => row.label)

describe('listingInclusions', () => {
  it('leads with what the install actually produces', () => {
    expect(labels({ artifactType: 'template' })[0]).toBe(
      'Editable screens you can rework in Besigner',
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
    expect(orgWide[1].label).toContain('org-wide')
    expect(orgWide[1].tone).toBe('included')
    expect(perSite[1].label).toContain('not covered automatically')
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
})
