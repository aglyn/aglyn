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
 * A template is not necessarily this org's, and an installed one is not
 * necessarily still offered. The assertions here are about the difference
 * between "checked and fine" and "not checked", which is the distinction a
 * boolean would lose.
 */

import { templateProvenance } from './template-provenance'

/** The full AGL-1015 stamp: listing, hash and artifact type together. */
const INSTALLED = {
  displayName: 'Welcome',
  installedFrom: {
    listingId: 'listing_1',
    version: '3',
    sha256: 'a'.repeat(64),
    artifactType: 'emailTemplate',
    publisherOrgId: 'org_pub',
  },
}

describe('whose template this is', () => {
  it('treats a template with no install stamp as locally authored', () => {
    const provenance = templateProvenance({ displayName: 'Welcome' })
    expect(provenance.origin).toBe('local')
    expect(provenance.installed).toBeNull()
    // No note: "you wrote this" is the default assumption, and repeating it
    // on every page is noise.
    expect(provenance.note).toBeNull()
    expect(provenance.warn).toBe(false)
  })

  it('reads an installed template through the shared core resolver', () => {
    const provenance = templateProvenance(INSTALLED)
    expect(provenance.origin).toBe('installed')
    expect(provenance.installed?.listingId).toBe('listing_1')
    expect(provenance.installed?.version).toBe('3')
    expect(provenance.installed?.publisherOrgId).toBe('org_pub')
  })
})

describe('whether an installed template is still offered', () => {
  it('says the listing has not been read, rather than that it is fine', () => {
    const provenance = templateProvenance(INSTALLED)
    expect(provenance.standing).toBe('unread')
    expect(provenance.note).toContain('has not been checked')
    // Not a warning: nothing is known to be wrong.
    expect(provenance.warn).toBe(false)
  })

  it('reports a stamped standing when the install path recorded one', () => {
    const provenance = templateProvenance({
      ...INSTALLED,
      installedFrom: { ...INSTALLED.installedFrom, standing: 'offered' },
    })
    expect(provenance.standing).toBe('offered')
    expect(provenance.warn).toBe(false)
  })

  it('warns on a template its publisher no longer offers', () => {
    for (const stamped of ['withdrawn', 'rejected', 'killed', 'revoked']) {
      const provenance = templateProvenance({
        ...INSTALLED,
        installedFrom: { ...INSTALLED.installedFrom, standing: stamped },
      })
      expect(provenance.standing).toBe('withdrawn')
      expect(provenance.warn).toBe(true)
      // It still SENDS. Hiding it would hide a message already scheduled
      // against it, so the page warns rather than refusing.
      expect(provenance.note).toContain('still sends')
    }
  })

  it('a local template has no publisher to stand with', () => {
    expect(templateProvenance({}).standing).toBe('local')
  })
})
