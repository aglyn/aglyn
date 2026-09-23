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
 * The holder a cross-site reader sees a person through (AGL-2630 for a
 * contact, AGL-3278 for a lead).
 *
 * What both answers turn on is CAPTURE ORDER: `capturedByHostIds` is
 * maintained by `arrayUnion`, so its first entry is the site that met the
 * person first, and that is the profile a reader standing over the whole
 * organization should see. The sorted spelling next door
 * (`contactCaptureHostIds`) is for rendering and would answer a different
 * site for the same row.
 */

import { CONTACT_FACETS_FIELD } from './contacts'
import { contactPrimaryGroup, leadPrimaryGroup, NO_HOLDER_GROUP } from './contact-holder'

/** Two brands the org has declared to be one sender. */
const ORG = {
  consentGroups: {
    'group-1': { name: 'Wellbiz', hostIds: ['site-a', 'site-b'] },
  },
}

describe('leadPrimaryGroup', () => {
  it('answers the site that captured the person FIRST, not the first sorted', () => {
    const group = leadPrimaryGroup({ capturedByHostIds: ['site-z', 'site-a'] }, ORG)

    expect(group.hostId).toBe('site-z')
  })

  it('carries the DECLARED group the site belongs to, so a sibling refusal is seen', () => {
    const group = leadPrimaryGroup({ capturedByHostIds: ['site-b'] }, ORG)

    expect(group).toMatchObject({
      hostId: 'site-b',
      groupId: 'group-1',
      hostIds: ['site-a', 'site-b'],
      declared: true,
    })
  })

  it('reads a site outside every declared group as a group of one', () => {
    const group = leadPrimaryGroup({ capturedByHostIds: ['site-solo'] }, ORG)

    expect(group).toMatchObject({ hostId: 'site-solo', hostIds: ['site-solo'], declared: false })
  })

  it('holds nobody for a lead no site captured, rather than inventing a site', () => {
    expect(leadPrimaryGroup({ email: 'jane@example.com' }, ORG)).toBe(NO_HOLDER_GROUP)
    expect(leadPrimaryGroup(null, ORG)).toBe(NO_HOLDER_GROUP)
    expect(leadPrimaryGroup({ capturedByHostIds: ['', '  '] }, ORG)).toBe(NO_HOLDER_GROUP)
  })
})

describe('contactPrimaryGroup', () => {
  it('prefers the first capturing site that actually holds a facet', () => {
    const contact = {
      capturedByHostIds: ['site-z', 'site-b'],
      [CONTACT_FACETS_FIELD]: { 'group-1': { owner: 'ada' } },
    }

    // `site-z` captured first but holds no facet; `site-b`'s declared group
    // does, and that is the profile the org-level reader is shown.
    expect(contactPrimaryGroup(contact, ORG)).toMatchObject({
      hostId: 'site-b',
      groupId: 'group-1',
    })
  })

  it('falls back to the first capturing site when no facet has been written yet', () => {
    expect(contactPrimaryGroup({ capturedByHostIds: ['site-z'] }, ORG).hostId).toBe('site-z')
  })
})
