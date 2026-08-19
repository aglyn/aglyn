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
  attachPluginInstalls,
  isPluginNetworkAllowed,
  isPluginRevoked,
  isListingWideRevocation,
  newestInstallableVersion,
  nextRevocationState,
  offeredPluginVersion,
  PLUGIN_COMPONENT_ID,
  type PluginManifest,
  type PluginRevocation,
  pluginArtifactPath,
  validatePluginManifest,
  resolvePluginPropFields,
  unknownPluginPropKeys,
  resolvePluginElements,
} from './plugin-manifest'

const base = {
  id: 'weather-widget',
  name: 'Weather Widget',
  version: '1.2.0',
  entry: 'dist/index.js',
}

describe('validatePluginManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validatePluginManifest(base)
    expect(result.ok).toBe(true)
  })

  it('normalizes capabilities and dedupes lists', () => {
    const result = validatePluginManifest({
      ...base,
      capabilities: {
        network: ['https://api.example.com', 'https://api.example.com'],
        props: ['city', 'city', 'units'],
        events: ['refresh'],
        size: { width: 320, height: 200 },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.capabilities?.network).toEqual([
        'https://api.example.com',
      ])
      expect(result.manifest.capabilities?.props).toEqual(['city', 'units'])
      expect(result.manifest.capabilities?.size).toEqual({
        width: 320,
        height: 200,
      })
    }
  })

  it('rejects bad ids, versions, and absolute entries', () => {
    expect(validatePluginManifest({ ...base, id: 'Bad Id' }).ok).toBe(false)
    expect(validatePluginManifest({ ...base, version: '1.0' }).ok).toBe(false)
    expect(
      validatePluginManifest({ ...base, entry: 'https://evil.com/x.js' }).ok,
    ).toBe(false)
    expect(validatePluginManifest({ ...base, entry: '//evil.com/x.js' }).ok).toBe(
      false,
    )
  })

  it('rejects non-https network origins and over-limit lists', () => {
    expect(
      validatePluginManifest({
        ...base,
        capabilities: { network: ['http://insecure.com'] },
      }).ok,
    ).toBe(false)
    expect(
      validatePluginManifest({
        ...base,
        capabilities: {
          network: Array.from({ length: 11 }, (_, i) => `https://a${i}.com`),
        },
      }).ok,
    ).toBe(false)
  })

  it('rejects invalid prop/event identifiers', () => {
    expect(
      validatePluginManifest({
        ...base,
        capabilities: { props: ['9bad'] },
      }).ok,
    ).toBe(false)
  })
})

describe('pluginArtifactPath', () => {
  it('is content-addressed and immutable per version', () => {
    expect(pluginArtifactPath('l1', '1.0.0', 'abc123')).toBe(
      'artifacts/l1/1.0.0/abc123.bundle',
    )
  })
})

describe('attachPluginInstalls', () => {
  const nodes = {
    root: { componentId: 'muiStack', props: {}, nodes: ['p1', 'p2', 'other'] },
    p1: { componentId: PLUGIN_COMPONENT_ID, props: { listingId: 'L1' } },
    p2: { componentId: PLUGIN_COMPONENT_ID, props: { listingId: 'gone' } },
    other: { componentId: 'muiTypography', props: { children: 'hi' } },
  }

  it('stamps install data onto matching plugin nodes', () => {
    const result = attachPluginInstalls(nodes, {
      L1: {
        listingId: 'L1',
        version: '1.0.0',
        sha256: 'abc',
        capabilities: { events: ['refresh'] },
        revoked: false,
      },
    })
    expect(result.p1.props).toMatchObject({
      listingId: 'L1',
      version: '1.0.0',
      sha256: 'abc',
      revoked: false,
    })
    // Uninstalled + non-plugin nodes untouched.
    expect(result.p2).toBe(nodes.p2)
    expect(result.other).toBe(nodes.other)
  })

  it('propagates the revoked kill switch', () => {
    const result = attachPluginInstalls(nodes, {
      L1: { listingId: 'L1', version: '1.0.0', sha256: 'abc', revoked: true },
    })
    expect((result.p1.props as { revoked?: boolean }).revoked).toBe(true)
  })
})

describe('isPluginNetworkAllowed (AGL-191)', () => {
  const caps = { network: ['https://api.example.com'] }
  it('allows only exact-origin https matches in the allowlist', () => {
    expect(isPluginNetworkAllowed('https://api.example.com/data', caps)).toBe(
      true,
    )
    expect(isPluginNetworkAllowed('https://evil.com/x', caps)).toBe(false)
    expect(isPluginNetworkAllowed('http://api.example.com/x', caps)).toBe(false)
    expect(isPluginNetworkAllowed('https://api.example.com/x', {})).toBe(false)
    expect(isPluginNetworkAllowed('not-a-url', caps)).toBe(false)
  })
})

describe('isPluginRevoked', () => {
  it('kills the whole listing or a specific version', () => {
    expect(isPluginRevoked({ versions: 'all' }, '1.0.0')).toBe(true)
    expect(isPluginRevoked({ versions: ['1.0.0'] }, '1.0.0')).toBe(true)
    expect(isPluginRevoked({ versions: ['1.0.0'] }, '1.1.0')).toBe(false)
    expect(isPluginRevoked(null, '1.0.0')).toBe(false)
  })
})

/**
 * What the listing may advertise as an update (AGL-2306).
 *
 * `latestApprovedVersion` was written on approval and never moved back, so a
 * version rejected on re-review or killed with the per-version switch stayed
 * on offer — an "Update to vX" that `install-plugin` answers 409 to. Two
 * properties, not one: approved AND not revoked.
 */
describe('newestInstallableVersion (AGL-2306)', () => {
  const compare = (a: string, b: string) =>
    Number(a.split('.')[0]) - Number(b.split('.')[0])

  const v = (version: string, reviewState?: string) => ({ version, reviewState })

  it('picks the newest approved version', () => {
    expect(
      newestInstallableVersion(
        [v('1.0.0', 'approved'), v('3.0.0', 'approved'), v('2.0.0', 'approved')],
        null,
        compare,
      ),
    ).toBe('3.0.0')
  })

  it('skips a version that is not approved — pending, rejected or absent', () => {
    expect(
      newestInstallableVersion(
        [v('1.0.0', 'approved'), v('2.0.0', 'rejected'), v('3.0.0', 'pending'), v('4.0.0')],
        null,
        compare,
      ),
    ).toBe('1.0.0')
  })

  it('skips a REVOKED version even though it is approved', () => {
    // The half that a mirror tracking only `reviewState` would get wrong: a
    // revoked version keeps its approval, and `install-plugin` still 409s.
    expect(
      newestInstallableVersion(
        [v('1.0.0', 'approved'), v('2.0.0', 'approved')],
        { versions: ['2.0.0'] },
        compare,
      ),
    ).toBe('1.0.0')
  })

  it('answers null under a listing-wide kill', () => {
    expect(
      newestInstallableVersion(
        [v('1.0.0', 'approved'), v('2.0.0', 'approved')],
        { versions: 'all' },
        compare,
      ),
    ).toBeNull()
  })

  it('answers null when nothing qualifies — an absent mirror, not a stale one', () => {
    expect(newestInstallableVersion([v('1.0.0', 'rejected')], null, compare)).toBeNull()
    expect(newestInstallableVersion([], null, compare)).toBeNull()
  })

  it('keeps an uncomparable version out of the offer rather than into it', () => {
    // A null comparison sorts as "not newer": a malformed version string must
    // not become what everyone is told to upgrade to.
    expect(
      newestInstallableVersion(
        [v('1.0.0', 'approved'), v('nonsense', 'approved')],
        null,
        () => null,
      ),
    ).toBe('1.0.0')
  })
})

describe('offeredPluginVersion (AGL-2368)', () => {
  const listing = (latestApprovedVersion?: string) => ({ latestApprovedVersion })

  it('CONTROL: hands back the mirror when nothing is revoked', () => {
    expect(offeredPluginVersion(listing('2.0.0'), null)).toBe('2.0.0')
    expect(offeredPluginVersion(listing('2.0.0'), undefined)).toBe('2.0.0')
    // A revocation that does not name this version is not a revocation of it.
    expect(offeredPluginVersion(listing('2.0.0'), { versions: ['1.0.0'] })).toBe(
      '2.0.0',
    )
  })

  it('offers NOTHING when the mirror names a revoked version', () => {
    // The whole point. `latestApprovedVersion` is a review verdict and the
    // kill switch does not clear it, so the two are simultaneously true and a
    // client reading only the first advertises stopped bytes.
    expect(offeredPluginVersion(listing('2.0.0'), { versions: ['2.0.0'] })).toBeNull()
  })

  it('offers nothing under a listing-wide takedown', () => {
    expect(offeredPluginVersion(listing('2.0.0'), { versions: 'all' })).toBeNull()
  })

  it('does not guess a next-best version', () => {
    // A client has no version list — it holds one mirror and one revocation
    // document. Answering "nothing to offer" is the honest reading of a
    // mirror caught between two non-transactional writes; inventing 1.0.0
    // here would be inventing a fact.
    expect(
      offeredPluginVersion(
        { latestApprovedVersion: '2.0.0', latestVersion: '3.0.0' } as never,
        { versions: ['2.0.0'] },
      ),
    ).toBeNull()
  })

  it('treats an absent or empty mirror as nothing on offer', () => {
    expect(offeredPluginVersion(listing(undefined), null)).toBeNull()
    expect(offeredPluginVersion(listing(''), null)).toBeNull()
    expect(offeredPluginVersion(null, null)).toBeNull()
    expect(offeredPluginVersion(undefined, { versions: 'all' })).toBeNull()
  })

  it('reads a NUMERIC mirror, which is what legacy listings carry', () => {
    // `latestApprovedVersion` is typed `string | number` on the listing.
    expect(offeredPluginVersion({ latestApprovedVersion: 3 }, null)).toBe('3')
    expect(
      offeredPluginVersion({ latestApprovedVersion: 3 }, { versions: ['3'] }),
    ).toBeNull()
  })
})

describe('isListingWideRevocation (AGL-2288)', () => {
  it('is true only for the listing-wide kill', () => {
    expect(isListingWideRevocation({ versions: 'all' })).toBe(true)
    expect(isListingWideRevocation({ versions: ['1.0.0'] })).toBe(false)
    expect(isListingWideRevocation(null)).toBe(false)
    expect(isListingWideRevocation(undefined)).toBe(false)
  })

  it('is the same fact `isPluginRevoked` reads', () => {
    // The point of splitting it out: marketplace checkout has no version to
    // ask about, and a second spelling of `versions === 'all'` at that call
    // site is how the two would come apart.
    expect(isPluginRevoked({ versions: 'all' }, 'anything')).toBe(true)
  })
})

/**
 * A legacy or hand-written revocations document is ADOPTED, not rebuilt
 * (AGL-2305).
 *
 * `withReview` replaces `versions` wholesale from the `reviewVersions` seed,
 * and documents written before AGL-1085 have no `reviewVersions` at all —
 * `revocations` is `allow write: if isStaff()`, so a staff client can produce
 * that shape by hand today. Seeding from an empty list made the next review
 * action silently discard every version already revoked, and an un-revoke
 * return `null`, which the caller turns into a DELETE of the whole kill
 * switch.
 */
describe('nextRevocationState on a pre-AGL-1085 document (AGL-2305)', () => {
  const legacy = { versions: ['1.0.0'] } as const

  it('keeps the legacy version when a second one is revoked', () => {
    expect(
      nextRevocationState(legacy as never, {
        type: 'revoke-version',
        version: '2.0.0',
      }),
    ).toMatchObject({
      versions: ['1.0.0', '2.0.0'],
      reviewVersions: ['1.0.0', '2.0.0'],
    })
  })

  it('does not DELETE the document when an unrelated version is un-revoked', () => {
    // The sharp end: `null` here means "delete the kill switch", and 1.0.0 was
    // never un-revoked by anybody.
    expect(
      nextRevocationState(legacy as never, {
        type: 'unrevoke-version',
        version: '2.0.0',
      }),
    ).toMatchObject({ versions: ['1.0.0'] })
  })

  it('still deletes once the last legacy version is un-revoked', () => {
    // Adoption must not make a revocation un-clearable — that would be the
    // opposite failure.
    expect(
      nextRevocationState(legacy as never, {
        type: 'unrevoke-version',
        version: '1.0.0',
      }),
    ).toBeNull()
  })

  it('does not adopt the takedown form as review-owned', () => {
    // `versions: 'all'` is the takedown's own half, restored by `restore`.
    // Adopting it would turn an un-hide into a permanent per-version
    // revocation of a version string that does not exist.
    expect(
      nextRevocationState({ versions: 'all', source: 'takedown' } as never, {
        type: 'restore',
      }),
    ).toBeNull()
  })

  it('leaves an AGL-1085-shaped document alone', () => {
    expect(
      nextRevocationState(
        { versions: ['1.0.0'], reviewVersions: ['1.0.0'] } as never,
        { type: 'unrevoke-version', version: '1.0.0' },
      ),
    ).toBeNull()
  })
})

describe('nextRevocationState (AGL-1085)', () => {
  // Every assertion goes through isPluginRevoked rather than reading fields:
  // what matters is whether the loaders stop the bytes, and a writer that
  // agreed with itself but not the reader is the failure being guarded.
  const revoked = (state: PluginRevocation | null, version: string) =>
    isPluginRevoked(state, version)

  it('revokes one version without touching the others', () => {
    const state = nextRevocationState(null, {
      type: 'revoke-version',
      version: '1.0.0',
    })
    expect(revoked(state, '1.0.0')).toBe(true)
    expect(revoked(state, '1.1.0')).toBe(false)
  })

  it('accumulates versions and is idempotent', () => {
    let state = nextRevocationState(null, {
      type: 'revoke-version',
      version: '1.0.0',
    })
    state = nextRevocationState(state, {
      type: 'revoke-version',
      version: '2.0.0',
    })
    state = nextRevocationState(state, {
      type: 'revoke-version',
      version: '1.0.0',
    })
    expect(state?.versions).toEqual(['1.0.0', '2.0.0'])
    expect(revoked(state, '1.0.0')).toBe(true)
    expect(revoked(state, '2.0.0')).toBe(true)
  })

  it('deletes the doc once the last version is un-revoked', () => {
    const state = nextRevocationState(
      nextRevocationState(null, { type: 'revoke-version', version: '1.0.0' }),
      { type: 'unrevoke-version', version: '1.0.0' },
    )
    // null means "delete" — an empty `versions: []` would read as revoking
    // nothing while leaving a doc behind for the next reader to interpret.
    expect(state).toBeNull()
    expect(revoked(state, '1.0.0')).toBe(false)
  })

  it('un-revoking one version leaves the rest revoked', () => {
    let state = nextRevocationState(null, {
      type: 'revoke-version',
      version: '1.0.0',
    })
    state = nextRevocationState(state, {
      type: 'revoke-version',
      version: '2.0.0',
    })
    state = nextRevocationState(state, {
      type: 'unrevoke-version',
      version: '1.0.0',
    })
    expect(revoked(state, '1.0.0')).toBe(false)
    expect(revoked(state, '2.0.0')).toBe(true)
  })

  it('a takedown kills everything, including un-revoked versions', () => {
    const state = nextRevocationState(
      nextRevocationState(null, { type: 'revoke-version', version: '1.0.0' }),
      { type: 'takedown' },
    )
    expect(state?.versions).toBe('all')
    expect(revoked(state, '9.9.9')).toBe(true)
  })

  it('RESTORING after a takedown keeps the review-revoked version dead', () => {
    // The bug this whole field exists to prevent: un-hiding a listing used to
    // delete the doc outright, which would silently un-revoke a version a
    // reviewer stopped for an entirely unrelated reason.
    let state = nextRevocationState(null, {
      type: 'revoke-version',
      version: '1.0.0',
    })
    state = nextRevocationState(state, { type: 'takedown' })
    state = nextRevocationState(state, { type: 'restore' })
    expect(revoked(state, '1.0.0')).toBe(true)
    expect(revoked(state, '2.0.0')).toBe(false)
    expect(state?.source).toBeUndefined()
  })

  it('restoring a pure takedown deletes the doc', () => {
    const state = nextRevocationState(
      nextRevocationState(null, { type: 'takedown' }),
      { type: 'restore' },
    )
    expect(state).toBeNull()
  })

  it('a version revoked DURING a takedown survives the restore', () => {
    let state = nextRevocationState(null, { type: 'takedown' })
    state = nextRevocationState(state, {
      type: 'revoke-version',
      version: '1.0.0',
    })
    // Still 'all' while hidden — the takedown is the stronger statement.
    expect(state?.versions).toBe('all')
    state = nextRevocationState(state, { type: 'restore' })
    expect(revoked(state, '1.0.0')).toBe(true)
    expect(revoked(state, '2.0.0')).toBe(false)
  })
})

/* ---- declared prop schema (AGL-1049) ---- */

describe('capabilities.propSchema — authoring metadata, never a second allowlist', () => {
  const manifest = (capabilities: Record<string, unknown>) => ({
    id: 'promo',
    name: 'Promo',
    version: '1.0.0',
    entry: 'index.js',
    capabilities,
  })

  it('keeps a schema entry for a declared prop', () => {
    const result = validatePluginManifest(
      manifest({
        props: ['title'],
        propSchema: [
          { name: 'title', type: 'string', label: 'Headline', default: 'Sale' },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    expect((result as any).manifest.capabilities.propSchema).toEqual([
      { name: 'title', type: 'string', label: 'Headline', default: 'Sale' },
    ])
  })

  it('DROPS a schema entry for a prop that was never declared', () => {
    // The security property: describing a prop must not grant it. Dropped
    // rather than rejected — a publisher who forgot to declare it made an
    // authoring mistake, and failing the whole publish over a label is worse.
    const result = validatePluginManifest(
      manifest({
        props: ['title'],
        propSchema: [
          { name: 'title', type: 'string' },
          { name: 'secretToken', type: 'string', label: 'Token' },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    const schema = (result as any).manifest.capabilities.propSchema
    expect(schema.map((entry: any) => entry.name)).toEqual(['title'])
  })

  it('never widens what crosses the bridge', () => {
    const result = validatePluginManifest(
      manifest({
        props: ['title'],
        propSchema: [{ name: 'secretToken', type: 'string' }],
      }),
    )
    // props is untouched, and an all-dropped schema is simply absent.
    expect((result as any).manifest.capabilities.props).toEqual(['title'])
    expect((result as any).manifest.capabilities.propSchema).toBeUndefined()
  })

  it('degrades an unknown type to text rather than refusing the plugin', () => {
    // A manifest written against a newer platform must still install.
    const result = validatePluginManifest(
      manifest({ props: ['title'], propSchema: [{ name: 'title', type: 'quantum' }] }),
    )
    expect(result.ok).toBe(true)
    expect((result as any).manifest.capabilities.propSchema[0].type).toBe(
      'string',
    )
  })

  it('rejects a name that is not an identifier, and junk entries', () => {
    const result = validatePluginManifest(
      manifest({
        props: ['title'],
        propSchema: [
          { name: 'no-hyphens' },
          null,
          'not an object',
          { type: 'string' },
          { name: 'title' },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    expect(
      (result as any).manifest.capabilities.propSchema.map((e: any) => e.name),
    ).toEqual(['title'])
  })

  it('deduplicates repeated names', () => {
    const result = validatePluginManifest(
      manifest({
        props: ['title'],
        propSchema: [
          { name: 'title', label: 'First' },
          { name: 'title', label: 'Second' },
        ],
      }),
    )
    expect(
      (result as any).manifest.capabilities.propSchema,
    ).toHaveLength(1)
    expect((result as any).manifest.capabilities.propSchema[0].label).toBe(
      'First',
    )
  })

  it('bounds publisher-authored text', () => {
    const result = validatePluginManifest(
      manifest({
        props: ['title'],
        propSchema: [{ name: 'title', label: 'x'.repeat(5000) }],
      }),
    )
    expect(
      (result as any).manifest.capabilities.propSchema[0].label.length,
    ).toBeLessThanOrEqual(200)
  })

  it('refuses an absurd number of schema entries', () => {
    const result = validatePluginManifest(
      manifest({
        props: ['title'],
        propSchema: Array.from({ length: 500 }, (_, i) => ({ name: `p${i}` })),
      }),
    )
    expect(result.ok).toBe(false)
  })

  it('keeps select options, dropping unusable ones', () => {
    const result = validatePluginManifest(
      manifest({
        props: ['size'],
        propSchema: [
          {
            name: 'size',
            type: 'select',
            options: [{ value: 'sm', label: 'Small' }, { label: 'no value' }, {}],
          },
        ],
      }),
    )
    expect((result as any).manifest.capabilities.propSchema[0].options).toEqual([
      { value: 'sm', label: 'Small' },
    ])
  })
})

describe('resolvePluginPropFields', () => {
  it('is driven by the ALLOWLIST, decorated by the schema', () => {
    expect(
      resolvePluginPropFields({
        capabilities: {
          props: ['title', 'accent'],
          propSchema: [{ name: 'title', type: 'string', label: 'Headline' }],
        },
      }),
    ).toEqual([
      { name: 'title', type: 'string', label: 'Headline' },
      // No schema entry: still editable, as plain text named by its key.
      { name: 'accent', type: 'string', label: 'accent' },
    ])
  })

  it('gives a pre-propSchema plugin a field per declared prop', () => {
    // Every plugin installed today predates this, so this is the common case.
    expect(
      resolvePluginPropFields({ capabilities: { props: ['city'] } }),
    ).toEqual([{ name: 'city', type: 'string', label: 'city' }])
  })

  it('cannot be longer than the allowlist, whatever the schema says', () => {
    const fields = resolvePluginPropFields({
      capabilities: {
        props: ['title'],
        propSchema: [
          { name: 'title' },
          { name: 'sneaky', type: 'string', label: 'Sneaky' },
        ],
      },
    })
    expect(fields.map((field) => field.name)).toEqual(['title'])
  })

  it('is empty for a plugin declaring no props', () => {
    expect(resolvePluginPropFields({ capabilities: {} })).toEqual([])
    expect(resolvePluginPropFields(null)).toEqual([])
  })
})

describe('unknownPluginPropKeys — name the key that does nothing', () => {
  const manifest = { capabilities: { props: ['title'] } }

  it('names a key the plugin will silently ignore', () => {
    expect(unknownPluginPropKeys(manifest, { title: 'a', titel: 'typo' })).toEqual(
      ['titel'],
    )
  })

  it('says nothing when every key is declared', () => {
    expect(unknownPluginPropKeys(manifest, { title: 'a' })).toEqual([])
  })

  it('treats a plugin with no declared props as ignoring everything', () => {
    expect(unknownPluginPropKeys({ capabilities: {} }, { a: 1 })).toEqual(['a'])
  })

  it('is empty for no values', () => {
    expect(unknownPluginPropKeys(manifest, null)).toEqual([])
  })
})

/* ---- declared canvas elements (AGL-1031) ---- */

describe('manifest.elements — publisher data the HOST renders', () => {
  const manifest = (extra: Record<string, unknown>) => ({
    id: 'promo',
    name: 'Promo',
    version: '1.0.0',
    entry: 'index.js',
    ...extra,
  })
  const elementsOf = (result: unknown) => (result as any).manifest.elements

  it('keeps a well-formed element', () => {
    const result = validatePluginManifest(
      manifest({
        capabilities: { props: ['title'] },
        elements: [
          {
            id: 'countdown',
            displayName: 'Promo Countdown',
            description: 'A sale timer.',
            category: 'Data Display',
            icon: 'mdiTimerOutline',
            attributes: [{ name: 'title', type: 'string', label: 'Headline' }],
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    expect(elementsOf(result)).toEqual([
      {
        id: 'countdown',
        displayName: 'Promo Countdown',
        description: 'A sale timer.',
        category: 'Data Display',
        icon: 'mdiTimerOutline',
        attributes: [{ name: 'title', type: 'string', label: 'Headline' }],
      },
    ])
  })

  it('DROPS an attribute the plugin never declared as a prop', () => {
    // The same intersection the top-level schema gets. A declared element must
    // not be a second way to widen what crosses the bridge.
    const result = validatePluginManifest(
      manifest({
        capabilities: { props: ['title'] },
        elements: [
          {
            id: 'countdown',
            displayName: 'Countdown',
            attributes: [{ name: 'title' }, { name: 'secretToken' }],
          },
        ],
      }),
    )
    expect(elementsOf(result)[0].attributes.map((a: any) => a.name)).toEqual([
      'title',
    ])
  })

  it('refuses a structural category rather than granting it', () => {
    // LAYOUT/NAVIGATION are withheld: a third-party element among the
    // containers a page is built from invites placements the sandbox cannot
    // honour. Dropped, not failed — the element is still usable.
    const result = validatePluginManifest(
      manifest({
        elements: [
          { id: 'a', displayName: 'A', category: 'Layout' },
          { id: 'b', displayName: 'B', category: 'Navigation' },
        ],
      }),
    )
    expect(elementsOf(result)[0].category).toBeUndefined()
    expect(elementsOf(result)[1].category).toBeUndefined()
  })

  it('accepts only an mdi icon NAME, never a path or markup', () => {
    const result = validatePluginManifest(
      manifest({
        elements: [
          { id: 'a', displayName: 'A', icon: 'mdiTimerOutline' },
          { id: 'b', displayName: 'B', icon: 'M12 2L2 7l10 5 10-5-10-5z' },
          { id: 'c', displayName: 'C', icon: '<svg onload=alert(1)>' },
          { id: 'd', displayName: 'D', icon: 'https://evil.example/x.svg' },
        ],
      }),
    )
    const icons = elementsOf(result).map((element: any) => element.icon)
    expect(icons).toEqual(['mdiTimerOutline', undefined, undefined, undefined])
  })

  it('drops a junk entry rather than failing the whole release', () => {
    const result = validatePluginManifest(
      manifest({
        elements: [
          null,
          'nope',
          { displayName: 'No id' },
          { id: 'no-hyphens-allowed!', displayName: 'Bad id' },
          { id: 'ok', displayName: '   ' },
          { id: 'ok', displayName: 'Fine' },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    expect(elementsOf(result).map((e: any) => e.id)).toEqual(['ok'])
  })

  it('deduplicates repeated ids, keeping the first', () => {
    const result = validatePluginManifest(
      manifest({
        elements: [
          { id: 'a', displayName: 'First' },
          { id: 'a', displayName: 'Second' },
        ],
      }),
    )
    expect(elementsOf(result)).toHaveLength(1)
    expect(elementsOf(result)[0].displayName).toBe('First')
  })

  it('REFUSES an absurd number of elements', () => {
    // A malformed array is a build error the publisher can see and fix.
    const result = validatePluginManifest(
      manifest({
        elements: Array.from({ length: 200 }, (_, i) => ({
          id: `e${i}`,
          displayName: `E${i}`,
        })),
      }),
    )
    expect(result.ok).toBe(false)
  })

  it('bounds publisher-authored text', () => {
    const result = validatePluginManifest(
      manifest({
        elements: [{ id: 'a', displayName: 'x'.repeat(5000) }],
      }),
    )
    expect(elementsOf(result)[0].displayName.length).toBeLessThanOrEqual(200)
  })

  it('leaves a manifest with no elements untouched', () => {
    const result = validatePluginManifest(manifest({}))
    expect(result.ok).toBe(true)
    expect(elementsOf(result)).toBeUndefined()
  })
})

describe('resolvePluginElements — palette entries from the PINNED install', () => {
  const install = {
    listingId: 'listing-1',
    capabilities: { props: ['title', 'accent'] },
    manifest: {
      elements: [
        {
          id: 'countdown',
          displayName: 'Promo Countdown',
          category: 'Data Display',
          icon: 'mdiTimerOutline',
          attributes: [
            { name: 'title', type: 'string' as const, label: 'Headline' },
          ],
        },
      ],
    },
  }

  it('resolves a declared element with its own attributes', () => {
    expect(resolvePluginElements(install)).toEqual([
      {
        listingId: 'listing-1',
        elementId: 'countdown',
        displayName: 'Promo Countdown',
        category: 'Data Display',
        icon: 'mdiTimerOutline',
        fields: [{ name: 'title', type: 'string', label: 'Headline' }],
      },
    ])
  })

  it('falls back to the plugin’s whole declared prop set', () => {
    const noAttributes = {
      ...install,
      manifest: { elements: [{ id: 'x', displayName: 'X' }] },
    }
    expect(resolvePluginElements(noAttributes)[0].fields.map((f) => f.name)).toEqual(
      ['title', 'accent'],
    )
  })

  it('defaults an undeclared category rather than leaving it blank', () => {
    const noCategory = {
      ...install,
      manifest: { elements: [{ id: 'x', displayName: 'X' }] },
    }
    expect(resolvePluginElements(noCategory)[0].category).toBe('Data Display')
  })

  it('is empty without a listing id — nothing to place', () => {
    expect(resolvePluginElements({ ...install, listingId: undefined })).toEqual(
      [],
    )
    expect(resolvePluginElements(null)).toEqual([])
  })

  it('is empty for a plugin that declares no elements', () => {
    expect(
      resolvePluginElements({ listingId: 'l', capabilities: { props: ['a'] } }),
    ).toEqual([])
  })
})
