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

import { resolveProvenance, stableStringify } from './marketplace-provenance'

describe('stableStringify (AGL-1015)', () => {
  it('hashes the same content identically regardless of key order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })

  it('preserves array order, which is content', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })

  it('drops undefined members, matching a Firestore round-trip', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }))
  })

  it('sorts nested keys too', () => {
    expect(stableStringify({ outer: { z: 1, a: 2 } })).toBe(
      '{"outer":{"a":2,"z":1}}',
    )
  })
})

describe('resolveProvenance (AGL-1015)', () => {
  const stamp = {
    listingId: 'listing-1',
    version: '2.0.0',
    sha256: 'abc123',
    artifactType: 'component' as const,
    installedAt: null as unknown,
    publisherOrgId: 'org-1',
  }

  it('reports a full stamp as recorded and updatable', () => {
    expect(resolveProvenance({ installedFrom: stamp })).toEqual({
      state: 'recorded',
      listingId: 'listing-1',
      version: '2.0.0',
      sha256: 'abc123',
      artifactType: 'component',
      publisherOrgId: 'org-1',
      updatable: true,
    })
  })

  it('is unknown for a document that was never installed from anywhere', () => {
    const resolved = resolveProvenance({ })
    expect(resolved.state).toBe('unknown')
    expect(resolved.updatable).toBe(false)
  })

  it('is unknown for null', () => {
    expect(resolveProvenance(null).state).toBe('unknown')
  })

  it('infers a legacy component install from its `community` block', () => {
    const resolved = resolveProvenance(
      { community: { listingId: 'listing-1', profileId: 'org-1', version: 3 } },
      'component',
    )
    expect(resolved.state).toBe('inferred')
    expect(resolved.listingId).toBe('listing-1')
    expect(resolved.version).toBe('3')
    expect(resolved.publisherOrgId).toBe('org-1')
    // The point of the state: there is no base, so nothing may merge against it.
    expect(resolved.updatable).toBe(false)
  })

  it('infers a legacy template/layout install from its `source` block', () => {
    const resolved = resolveProvenance(
      { source: { type: 'marketplace', listingId: 'listing-2', version: '1.0.0' } },
      'layout',
    )
    expect(resolved.state).toBe('inferred')
    expect(resolved.artifactType).toBe('layout')
    expect(resolved.updatable).toBe(false)
  })

  it('treats the pre-AGL-1015 email-template marker as inferred, not recorded', () => {
    // It writes `installedFrom`, but with no hash and no base behind it —
    // trusting the field's presence alone would hand a merge a missing origin.
    const resolved = resolveProvenance(
      { installedFrom: { listingId: 'listing-3', version: '1.0.0' } },
      'emailTemplate',
    )
    expect(resolved.state).toBe('inferred')
    expect(resolved.sha256).toBeNull()
    expect(resolved.updatable).toBe(false)
  })

  it('reads a plugin pin as recorded — the bytes are already immutable', () => {
    const resolved = resolveProvenance({
      listingId: 'listing-4',
      profileId: 'org-2',
      pluginId: 'acme.widgets',
      version: '1.2.0',
      sha256: 'deadbeef',
    })
    expect(resolved.state).toBe('recorded')
    expect(resolved.artifactType).toBe('plugin')
    expect(resolved.updatable).toBe(true)
  })

  it('prefers the full stamp over the legacy block on a re-stamped document', () => {
    const resolved = resolveProvenance({
      installedFrom: stamp,
      community: { listingId: 'stale', version: 1 },
    })
    expect(resolved.listingId).toBe('listing-1')
    expect(resolved.version).toBe('2.0.0')
  })

  it('normalises a numeric version to a string so comparisons are total', () => {
    expect(
      resolveProvenance({ installedFrom: { ...stamp, version: 2 as never } }).version,
    ).toBe('2')
  })
})
