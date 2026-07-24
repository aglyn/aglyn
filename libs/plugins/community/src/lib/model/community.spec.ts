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
  COMMUNITY_COMPONENT_ID_ALLOWLIST,
  installTargetsFor,
  isListingBrowsable,
  resolveInstallPlan,
  resolvePluginInstallState,
  sanitizeCommunityDefinition,
} from './community'

const nodes = {
  root: {
    $id: 'root',
    componentId: 'muiStack',
    pluginId: 'mui',
    parentId: 'outside',
    props: { spacing: 2 },
    nodes: ['child'],
    resolvedProps: { spacing: 2 },
    componentSchema: { $id: 'muiStack' },
  },
  child: {
    $id: 'child',
    componentId: 'muiTypography',
    pluginId: 'mui',
    parentId: 'root',
    props: { children: 'Hello' },
  },
  stray: {
    $id: 'stray',
    componentId: 'muiButton',
    pluginId: 'mui',
    parentId: null,
  },
}

describe('sanitizeCommunityDefinition', () => {
  it('keeps only the reachable subtree and persisted keys', () => {
    const result = sanitizeCommunityDefinition({ rootId: 'root', nodes })
    // `=== false` (not `!result.ok`): with strictNullChecks off, truthiness
    // checks don't narrow the discriminated union, but literal equality does.
    if (result.ok === false) throw new Error(result.error)
    expect(Object.keys(result.nodes).sort()).toEqual(['child', 'root'])
    expect((result.nodes['root'] as any).resolvedProps).toBeUndefined()
    expect((result.nodes['root'] as any).componentSchema).toBeUndefined()
    expect(result.nodes['root'].parentId).toBeNull()
    expect(result.nodes['child'].props).toEqual({ children: 'Hello' })
  })

  it('rejects reusable instances and non-allowlisted components', () => {
    expect(COMMUNITY_COMPONENT_ID_ALLOWLIST).not.toContain('reusableInstance')
    expect(COMMUNITY_COMPONENT_ID_ALLOWLIST).not.toContain('layoutSlot')
    const result = sanitizeCommunityDefinition({
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'reusableInstance',
          parentId: null,
          props: { refId: 'private' },
        },
      },
    })
    expect(result).toEqual({
      ok: false,
      error: 'Component "reusableInstance" cannot be published',
    })
  })

  /**
   * `extraComponentIds` widens the allowlist for one call (AGL-671). The
   * risk it introduces is scope creep: if it leaked, `layoutSlot` — or
   * anything else a caller passed — would become publishable everywhere.
   */
  it('permits extra component ids only for the call that asks', () => {
    const layoutNodes = {
      root: {
        $id: 'root',
        componentId: 'layoutSlot',
        parentId: null,
        props: {},
      },
    }
    // Default: still refused, exactly as before.
    expect(
      sanitizeCommunityDefinition({ rootId: 'root', nodes: layoutNodes }),
    ).toEqual({
      ok: false,
      error: 'Component "layoutSlot" cannot be published',
    })
    // Opted in: accepted.
    const allowed = sanitizeCommunityDefinition(
      { rootId: 'root', nodes: layoutNodes },
      { extraComponentIds: ['layoutSlot'] },
    )
    expect(allowed.ok).toBe(true)
    // The opt-in does not widen anything else — reusable instances stay
    // refused even when layoutSlot is permitted, since a nested instance
    // could smuggle another tenant's private definition.
    const smuggled = sanitizeCommunityDefinition(
      {
        rootId: 'root',
        nodes: {
          root: {
            $id: 'root',
            componentId: 'reusableInstance',
            parentId: null,
            props: { refId: 'private' },
          },
        },
      },
      { extraComponentIds: ['layoutSlot'] },
    )
    expect(smuggled.ok).toBe(false)
    // And the shared allowlist itself is untouched by the call.
    expect(COMMUNITY_COMPONENT_ID_ALLOWLIST).not.toContain('layoutSlot')
  })

  it('rejects missing roots and broken child references', () => {
    expect(
      sanitizeCommunityDefinition({ rootId: 'nope', nodes }).ok,
    ).toBe(false)
    expect(
      sanitizeCommunityDefinition({
        rootId: 'root',
        nodes: { root: { ...nodes.root, nodes: ['ghost'] } },
      }),
    ).toEqual({ ok: false, error: 'Missing node "ghost"' })
  })

  /**
   * The root node is the virtual root-collection wrapper (`_@_`) — a
   * `div`/absent componentId there is drag/drop metadata, not a real
   * component, so it must publish (AGL-783). Descendants stay checked, and a
   * root carrying a real disallowed component id is NOT a free pass.
   */
  it('exempts the div/absent root wrapper but keeps checking descendants', () => {
    const withDivRoot = sanitizeCommunityDefinition({
      rootId: '_@_',
      nodes: {
        '_@_': { $id: '_@_', componentId: 'div', parentId: null, nodes: ['t'] },
        t: {
          $id: 't',
          componentId: 'muiTypography',
          parentId: '_@_',
          props: { children: 'Footer' },
        },
      },
    })
    if (withDivRoot.ok === false) throw new Error(withDivRoot.error)
    expect(withDivRoot.nodes['_@_'].componentId).toBe('div')
    expect(Object.keys(withDivRoot.nodes).sort()).toEqual(['_@_', 't'])

    // An absent root componentId is the same wrapper; normalized to div.
    const withAbsentRoot = sanitizeCommunityDefinition({
      rootId: '_@_',
      nodes: {
        '_@_': { $id: '_@_', parentId: null, nodes: [] },
      } as any,
    })
    if (withAbsentRoot.ok === false) throw new Error(withAbsentRoot.error)
    expect(withAbsentRoot.nodes['_@_'].componentId).toBe('div')
  })

  it('still rejects a NON-root div and a disallowed real component at the root', () => {
    // A div that isn't the root is real content and must be allowlisted.
    expect(
      sanitizeCommunityDefinition({
        rootId: '_@_',
        nodes: {
          '_@_': { $id: '_@_', componentId: 'div', parentId: null, nodes: ['d'] },
          d: { $id: 'd', componentId: 'div', parentId: '_@_' },
        },
      }),
    ).toEqual({ ok: false, error: 'Component "div" cannot be published' })

    // The exemption is only for the wrapper shape — a real, disallowed
    // component at the root can't be smuggled through.
    expect(
      sanitizeCommunityDefinition({
        rootId: '_@_',
        nodes: {
          '_@_': {
            $id: '_@_',
            componentId: 'reusableInstance',
            parentId: null,
          },
        },
      }),
    ).toEqual({
      ok: false,
      error: 'Component "reusableInstance" cannot be published',
    })
  })

  it('rejects oversized definitions', () => {
    const result = sanitizeCommunityDefinition({
      rootId: 'root',
      nodes: {
        root: {
          $id: 'root',
          componentId: 'muiTypography',
          parentId: null,
          props: { children: 'x'.repeat(210 * 1024) },
        },
      },
    })
    expect(result).toEqual({
      ok: false,
      error: 'Definition is too large to publish',
    })
  })
})

describe('validateListingContent (AGL-430)', () => {
  const { validateListingContent, LISTING_CATEGORIES } =
    require('./community') as typeof import('./community')

  it('accepts a full, valid content payload', () => {
    const verdict = validateListingContent({
      logoUrl: 'https://cdn.example.com/logo.png',
      screenshots: ['https://cdn.example.com/a.png'],
      readme: '# Hi',
      homepageUrl: 'https://example.com',
      repositoryUrl: 'https://github.com/x/y',
      license: 'MIT',
      categories: [LISTING_CATEGORIES[0]],
    })
    expect(verdict.ok).toBe(true)
    expect(verdict.content?.license).toBe('MIT')
  })

  it('rejects non-https URLs and oversized readme', () => {
    expect(validateListingContent({ logoUrl: 'http://x.com/a.png' }).ok).toBe(
      false,
    )
    expect(
      validateListingContent({ readme: 'x'.repeat(20_001) }).ok,
    ).toBe(false)
  })

  it('rejects off-taxonomy categories and too many screenshots', () => {
    expect(validateListingContent({ categories: ['not-real'] }).ok).toBe(false)
    expect(
      validateListingContent({
        screenshots: Array(7).fill('https://x.com/s.png'),
      }).ok,
    ).toBe(false)
  })

  it('treats absent fields as no-ops', () => {
    const verdict = validateListingContent({})
    expect(verdict.ok).toBe(true)
    expect(verdict.content).toEqual({})
  })
})

/**
 * Pre-publication review stays plugin-only — plugins execute code, so they
 * earn the wait, while a component or template is inert until installed.
 * Staff TAKEDOWN is the part that has to cover everything (AGL-658): before
 * this, the early return meant a non-plugin listing was permanently
 * browsable no matter what it turned out to contain.
 */
describe('isListingBrowsable (AGL-658)', () => {
  it('leaves non-plugin listings browsable without review', () => {
    expect(isListingBrowsable({ artifactType: 'component' })).toBe(true)
    expect(isListingBrowsable({ artifactType: 'template' })).toBe(true)
    expect(isListingBrowsable({ artifactType: 'layout' })).toBe(true)
  })

  it('gates plugins on their review verdict', () => {
    expect(isListingBrowsable({ artifactType: 'plugin' })).toBe(true)
    expect(
      isListingBrowsable({ artifactType: 'plugin', reviewStatus: 'listed' }),
    ).toBe(true)
    expect(
      isListingBrowsable({ artifactType: 'plugin', reviewStatus: 'verified' }),
    ).toBe(true)
    expect(
      isListingBrowsable({ artifactType: 'plugin', reviewStatus: 'submitted' }),
    ).toBe(false)
    expect(
      isListingBrowsable({ artifactType: 'plugin', reviewStatus: 'rejected' }),
    ).toBe(false)
  })

  it('hides a taken-down listing of ANY type', () => {
    for (const artifactType of ['component', 'template', 'layout', 'plugin']) {
      expect(
        isListingBrowsable({ artifactType, hiddenAt: new Date() }),
      ).toBe(false)
    }
  })

  it('takedown outranks an approved review verdict', () => {
    expect(
      isListingBrowsable({
        artifactType: 'plugin',
        reviewStatus: 'verified',
        hiddenAt: new Date(),
      }),
    ).toBe(false)
  })
})

/**
 * The picker asks this rather than assuming (AGL-656). Offering "this whole
 * organization" for a template would be a lie: only plugins have an
 * org-scoped pin, everything else physically lands on a host.
 */
describe('installTargetsFor (AGL-656)', () => {
  it('gives plugins the org/host choice', () => {
    expect(installTargetsFor({ artifactType: 'plugin' })).toEqual([
      'org',
      'host',
    ])
  })

  it('keeps screen-tree artifacts host-only', () => {
    for (const artifactType of ['component', 'template', 'layout']) {
      expect(installTargetsFor({ artifactType })).toEqual(['host'])
    }
  })

  it('reads legacy discriminators, not just artifactType', () => {
    // Pre-AGL-654 listings carry `type`/`kind` instead.
    expect(installTargetsFor({ type: 'plugin' })).toEqual(['org', 'host'])
    expect(installTargetsFor({ kind: 'template' })).toEqual(['host'])
    // A component was the absence of both.
    expect(installTargetsFor({})).toEqual(['host'])
  })

  it('never returns an empty set, so the UI always has a target', () => {
    expect(
      installTargetsFor({ artifactType: 'somethingNew' }).length,
    ).toBeGreaterThan(0)
  })
})

/**
 * The browse grid and detail page detected installs from `hosts/{h}/components`
 * — the component collection, which never holds a plugin PIN — so an installed
 * plugin read as "not installed" everywhere (AGL-656). This resolves the real
 * state from the two pins the loader honors, host shadowing org.
 */
describe('resolvePluginInstallState (AGL-656)', () => {
  it('reports not-installed when neither pin exists', () => {
    expect(resolvePluginInstallState('3', null, null)).toEqual({
      scope: null,
      installedVersion: null,
      shadowed: false,
      updateAvailable: false,
    })
  })

  it('reads a host pin as this-site scope', () => {
    expect(resolvePluginInstallState('3', { version: '3' }, null)).toEqual({
      scope: 'host',
      installedVersion: '3',
      shadowed: false,
      updateAvailable: false,
    })
  })

  it('reads an org pin as org-wide scope', () => {
    expect(resolvePluginInstallState('3', null, { version: '3' })).toEqual({
      scope: 'org',
      installedVersion: '3',
      shadowed: false,
      updateAvailable: false,
    })
  })

  it('lets a host pin shadow an org pin, reporting the host version', () => {
    // Org shares v2, this site has pinned its own v3 — the loader runs v3.
    expect(
      resolvePluginInstallState('3', { version: '3' }, { version: '2' }),
    ).toEqual({
      scope: 'host',
      installedVersion: '3',
      shadowed: true,
      updateAvailable: false,
    })
  })

  it('flags an upgrade when the pinned version is behind the listing', () => {
    expect(resolvePluginInstallState('4', null, { version: '2' })).toMatchObject(
      { scope: 'org', installedVersion: '2', updateAvailable: true },
    )
  })

  it('compares versions as strings, so number/string pins agree', () => {
    // latestVersion is number|string on the listing; pins store a string.
    expect(
      resolvePluginInstallState(3, { version: 3 }, null).updateAvailable,
    ).toBe(false)
  })
})

/**
 * The targeting picker must not promise what an artifact can't do (AGL-773):
 * only org-pinnable artifacts get a single "all sites" pin; host-scoped ones
 * fan out to every current host and don't cover future sites.
 */
describe('resolveInstallPlan (AGL-773)', () => {
  const hosts = { selectedHostIds: ['h1', 'h3'], allHostIds: ['h1', 'h2', 'h3'] }

  it('plugin + all sites → one org pin (covers future sites too)', () => {
    expect(
      resolveInstallPlan({ artifactType: 'plugin' }, 'all-sites', hosts),
    ).toEqual([{ scope: 'org' }])
  })

  it('plugin + selected sites → a host pin per chosen site', () => {
    expect(
      resolveInstallPlan({ artifactType: 'plugin' }, 'selected-sites', hosts),
    ).toEqual([
      { scope: 'host', hostId: 'h1' },
      { scope: 'host', hostId: 'h3' },
    ])
  })

  it('host-scoped artifact + all sites → a host pin for EVERY current site', () => {
    // No org pin exists for templates/components/layouts — "all sites" means
    // fan out, and new sites are not covered automatically.
    for (const artifactType of ['component', 'template', 'layout']) {
      expect(resolveInstallPlan({ artifactType }, 'all-sites', hosts)).toEqual([
        { scope: 'host', hostId: 'h1' },
        { scope: 'host', hostId: 'h2' },
        { scope: 'host', hostId: 'h3' },
      ])
    }
  })

  it('host-scoped artifact + selected sites → only the chosen sites', () => {
    expect(
      resolveInstallPlan({ artifactType: 'template' }, 'selected-sites', hosts),
    ).toEqual([
      { scope: 'host', hostId: 'h1' },
      { scope: 'host', hostId: 'h3' },
    ])
  })

  it('org-only artifact (datasetSchema) collapses either choice to the org pin', () => {
    // datasetSchema can't host-pin, so a per-site selection is meaningless.
    expect(
      resolveInstallPlan({ artifactType: 'datasetSchema' }, 'all-sites', hosts),
    ).toEqual([{ scope: 'org' }])
    expect(
      resolveInstallPlan(
        { artifactType: 'datasetSchema' },
        'selected-sites',
        hosts,
      ),
    ).toEqual([{ scope: 'org' }])
  })

  it('reads legacy discriminators like the rest of the model', () => {
    expect(resolveInstallPlan({ type: 'plugin' }, 'all-sites', hosts)).toEqual([
      { scope: 'org' },
    ])
    // A component was the absence of both discriminators → host-scoped.
    expect(resolveInstallPlan({}, 'all-sites', hosts)).toEqual([
      { scope: 'host', hostId: 'h1' },
      { scope: 'host', hostId: 'h2' },
      { scope: 'host', hostId: 'h3' },
    ])
  })
})
