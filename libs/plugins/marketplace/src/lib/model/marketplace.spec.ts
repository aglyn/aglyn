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

import { DATASET_FIELD_TYPES } from '@aglyn/aglyn'
import {
  MARKETPLACE_COMPONENT_ID_ALLOWLIST,
  VERIFICATION_BLOCK_MESSAGES,
  VERIFICATION_DECLINE_COOLDOWN_DAYS,
  verificationRequestBlock,
  type VerificationRequestBlock,
  MARKETPLACE_DATASET_FIELD_TYPES,
  MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST,
  installsUnreviewedFallback,
  installTargetsFor,
  isListingBrowsable,
  isListingDeleted,
  isPrivateListing,
  resolveInstallPlan,
  resolveOrgInstallSummary,
  resolveInstalledDatasetSchema,
  resolvePluginInstallState,
  sanitizeMarketplaceDefinition,
  sanitizeDatasetSchema,
} from './marketplace'

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

describe('sanitizeMarketplaceDefinition', () => {
  it('keeps only the reachable subtree and persisted keys', () => {
    const result = sanitizeMarketplaceDefinition({ rootId: 'root', nodes })
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
    expect(MARKETPLACE_COMPONENT_ID_ALLOWLIST).not.toContain('reusableInstance')
    expect(MARKETPLACE_COMPONENT_ID_ALLOWLIST).not.toContain('layoutSlot')
    const result = sanitizeMarketplaceDefinition({
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
      error: expect.stringContaining(
        'Component "reusableInstance" cannot be published',
      ),
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
      sanitizeMarketplaceDefinition({ rootId: 'root', nodes: layoutNodes }),
    ).toEqual({
      ok: false,
      error: expect.stringContaining(
        'Component "layoutSlot" cannot be published',
      ),
    })
    // Opted in: accepted.
    const allowed = sanitizeMarketplaceDefinition(
      { rootId: 'root', nodes: layoutNodes },
      { extraComponentIds: ['layoutSlot'] },
    )
    expect(allowed.ok).toBe(true)
    // The opt-in does not widen anything else — reusable instances stay
    // refused even when layoutSlot is permitted, since a nested instance
    // could smuggle another tenant's private definition.
    const smuggled = sanitizeMarketplaceDefinition(
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
    expect(MARKETPLACE_COMPONENT_ID_ALLOWLIST).not.toContain('layoutSlot')
  })

  it('rejects missing roots and broken child references', () => {
    expect(
      sanitizeMarketplaceDefinition({ rootId: 'nope', nodes }).ok,
    ).toBe(false)
    expect(
      sanitizeMarketplaceDefinition({
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
    const withDivRoot = sanitizeMarketplaceDefinition({
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

    // An absent root componentId is the same wrapper; normalized to div. It
    // needs content of its own now (AGL-1033) — an empty wrapper is an empty
    // listing and is refused below — but the normalization is unchanged.
    const withAbsentRoot = sanitizeMarketplaceDefinition({
      rootId: '_@_',
      nodes: {
        '_@_': { $id: '_@_', parentId: null, nodes: ['t'] },
        t: {
          $id: 't',
          componentId: 'muiTypography',
          parentId: '_@_',
          props: { children: 'Footer' },
        },
      } as any,
    })
    if (withAbsentRoot.ok === false) throw new Error(withAbsentRoot.error)
    expect(withAbsentRoot.nodes['_@_'].componentId).toBe('div')
  })

  it('still rejects a NON-root div and a disallowed real component at the root', () => {
    // A div that isn't the root is real content and must be allowlisted.
    expect(
      sanitizeMarketplaceDefinition({
        rootId: '_@_',
        nodes: {
          '_@_': { $id: '_@_', componentId: 'div', parentId: null, nodes: ['d'] },
          d: { $id: 'd', componentId: 'div', parentId: '_@_' },
        },
      }),
    ).toEqual({
      ok: false,
      error: expect.stringContaining('Component "div" cannot be published'),
    })

    // The exemption is only for the wrapper shape — a real, disallowed
    // component at the root can't be smuggled through.
    expect(
      sanitizeMarketplaceDefinition({
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
      error: expect.stringContaining(
        'Component "reusableInstance" cannot be published',
      ),
    })
  })

  it('rejects oversized definitions', () => {
    const result = sanitizeMarketplaceDefinition({
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

  // AGL-784. `Leaf` spreads node props onto the component and MUI forwards
  // unknown props to the DOM, so these reach every installing org's render
  // tree. `dangerouslySetInnerHTML` in particular is not stored XSS — React
  // throws on it because Leaf always passes children — but that throw happens
  // during SSR, which 500s the page and wedges ISR (the AGL-579 failure mode).
  describe('node prop hardening (AGL-784)', () => {
    const publishProps = (props: Record<string, unknown>) => {
      const result = sanitizeMarketplaceDefinition({
        rootId: 'root',
        nodes: {
          root: { $id: 'root', componentId: 'muiTypography', parentId: null, props },
        },
      })
      if (result.ok === false) throw new Error(result.error)
      return result.nodes['root'].props
    }

    it('strips dangerouslySetInnerHTML', () => {
      expect(
        publishProps({
          children: 'Hi',
          dangerouslySetInnerHTML: { __html: '<img src=x onerror=alert(1)>' },
        }),
      ).toEqual({ children: 'Hi' })
    })

    it('strips on* handlers', () => {
      expect(
        publishProps({ children: 'Hi', onClick: 'alert(1)', onError: 'x' }),
      ).toEqual({ children: 'Hi' })
    })

    it('keeps props that merely start with "on"', () => {
      expect(publishProps({ once: true, only: 'x' })).toEqual({
        once: true,
        only: 'x',
      })
    })

    it('drops unsafe href/src and trims safe ones', () => {
      expect(publishProps({ href: 'javascript:alert(1)' })).toEqual({})
      expect(publishProps({ src: ' https://cdn.example/a.png ' })).toEqual({
        src: 'https://cdn.example/a.png',
      })
      expect(publishProps({ href: '/about' })).toEqual({ href: '/about' })
      // Inline images are inert, so `src` allows them where `href` does not.
      expect(publishProps({ src: 'data:image/png;base64,AAA' })).toEqual({
        src: 'data:image/png;base64,AAA',
      })
      expect(publishProps({ href: 'data:text/html,<script>' })).toEqual({})
    })

    it('leaves nested objects alone — they are consumed, not spread', () => {
      expect(publishProps({ icon: { path: 'M0 0', onClick: 'x' } })).toEqual({
        icon: { path: 'M0 0', onClick: 'x' },
      })
    })
  })
})

describe('validateListingContent (AGL-430)', () => {
  const { validateListingContent, LISTING_CATEGORIES } =
    require('./marketplace') as typeof import('./marketplace')

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

  // Private is not a review state (AGL-968): a private plugin can be fully
  // approved and even verified, and still must never be browsable. Passing
  // review is what makes it INSTALLABLE by its owner, not what puts it in
  // front of other workspaces.
  it('keeps a private listing out of browse at every review state', () => {
    for (const reviewStatus of [
      undefined,
      'submitted',
      'listed',
      'verified',
      'rejected',
    ]) {
      expect(
        isListingBrowsable({
          artifactType: 'plugin',
          visibility: 'private',
          ...(reviewStatus ? { reviewStatus } : {}),
        }),
      ).toBe(false)
    }
  })

  it('treats any other visibility value as public', () => {
    expect(isPrivateListing({})).toBe(false)
    expect(isPrivateListing({ visibility: 'public' })).toBe(false)
    expect(isPrivateListing({ visibility: 'private' })).toBe(true)
  })
})

/**
 * AGL-1196. Browse used to express this as `where('deletedAt','==',null)` in
 * the query. That is a MUTABLE field in a predicate: `deletedAt` flips on
 * every unpublish/republish, and a document that stops matching a live query
 * can leave a `noDocument` tombstone at its own path — which the detail page
 * reads BY ID and 404s on. The filter moved in-memory so no document can stop
 * matching, and this pins the semantics the query used to provide.
 */
describe('isListingDeleted (AGL-1196)', () => {
  it('is true only for a listing carrying a deletion stamp', () => {
    expect(isListingDeleted({ deletedAt: new Date() })).toBe(true)
    expect(isListingDeleted({ deletedAt: { seconds: 1 } })).toBe(true)
  })

  it('treats an explicit null as live — what every publish path writes', () => {
    // publish.ts, publish-plugin.ts, install.ts and update-artifact.ts all
    // stamp `deletedAt: null` on create, which is the only reason the old
    // `== null` query matched anything at all.
    expect(isListingDeleted({ deletedAt: null })).toBe(false)
  })

  it('treats an ABSENT field as live — the case the old query got wrong', () => {
    // Firestore's `== null` matches an explicit null and cannot express
    // "field is absent", so a listing written without the field was invisible
    // to browse entirely. Nothing writes one today; nothing should have to.
    expect(isListingDeleted({})).toBe(false)
    expect(isListingDeleted({ deletedAt: undefined })).toBe(false)
  })
})

/**
 * The picker asks this rather than assuming (AGL-656). Offering "this whole
 * organization" for a template would be a lie: only plugins have an
 * org-scoped pin, everything else physically lands on a host.
 */
/**
 * At org scope "installed" is a SET (AGL-997). The detail page used to
 * resolve one acting host and report "Installed on this site", which named
 * an arbitrary site and said nothing about the rest.
 */
describe('resolveOrgInstallSummary (AGL-997)', () => {
  const hosts = [
    { id: 'h1', label: 'Shop' },
    { id: 'h2', label: 'Blog' },
    { id: 'h3', label: 'Docs' },
  ]

  it('reports nothing installed when there are no pins', () => {
    const summary = resolveOrgInstallSummary(hosts, {}, null)
    expect(summary.installedAnywhere).toBe(false)
    expect(summary.sites).toEqual([])
    expect(summary.availableHostIds).toEqual(['h1', 'h2', 'h3'])
  })

  it('names the sites a partial install actually covers', () => {
    const summary = resolveOrgInstallSummary(
      hosts,
      { h2: { version: '1.0.0' } },
      null,
    )
    expect(summary.orgWide).toBe(false)
    expect(summary.sites).toEqual([
      {
        hostId: 'h2',
        label: 'Blog',
        version: '1.0.0',
        pinnedBy: 'host',
        shadowed: false,
      },
    ])
    // The other two stay offerable, which is what makes "add a site" possible.
    expect(summary.availableHostIds).toEqual(['h1', 'h3'])
    expect(summary.hostPinnedIds).toEqual(['h2'])
  })

  it('treats an org pin as covering every site', () => {
    const summary = resolveOrgInstallSummary(hosts, {}, { version: '2.0.0' })
    expect(summary.orgWide).toBe(true)
    expect(summary.sites.map((site) => site.hostId)).toEqual(['h1', 'h2', 'h3'])
    expect(summary.sites.every((site) => site.pinnedBy === 'org')).toBe(true)
    // Nothing to "add": the org pin already covers sites made later, too.
    expect(summary.availableHostIds).toEqual([])
    // And nothing to remove per-site — the only pin is the org one.
    expect(summary.hostPinnedIds).toEqual([])
  })

  it('lets a host pin shadow the org pin for its own site', () => {
    const summary = resolveOrgInstallSummary(
      hosts,
      { h3: { version: '3.0.0' } },
      { version: '2.0.0' },
    )
    expect(summary.orgWide).toBe(true)
    const docs = summary.sites.find((site) => site.hostId === 'h3')
    expect(docs).toEqual({
      hostId: 'h3',
      label: 'Docs',
      version: '3.0.0',
      pinnedBy: 'host',
      shadowed: true,
    })
    // The unshadowed sites still run the org pin's version.
    expect(
      summary.sites.filter((site) => site.hostId !== 'h3').map((s) => s.version),
    ).toEqual(['2.0.0', '2.0.0'])
    expect(summary.hostPinnedIds).toEqual(['h3'])
  })
})

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

describe('sanitizeDatasetSchema (AGL-657)', () => {
  it('accepts exactly the field types core defines', () => {
    // MARKETPLACE_DATASET_FIELD_TYPES is duplicated to keep the model module
    // dependency-free; this is the guard that keeps the copy honest, so a new
    // core field type can't become silently unpublishable.
    expect([...MARKETPLACE_DATASET_FIELD_TYPES].sort()).toEqual(
      [...DATASET_FIELD_TYPES].sort(),
    )
  })

  const model = {
    fields: {
      title: { name: 'Title', type: 'text', required: true },
      rating: {
        name: 'Rating',
        type: 'int32',
        validation: { min: 1, max: 5, junk: 'dropped' },
      },
      owner: {
        name: 'Owner',
        type: 'reference',
        reference: { datasetId: 'ds-people', displayFieldId: 'name' },
      },
    },
    order: ['title', 'rating', 'owner'],
  }

  it('keeps the model and drops unknown validation keys', () => {
    const result = sanitizeDatasetSchema(model)
    if (result.ok === false) throw new Error(result.error)
    expect(result.schema.order).toEqual(['title', 'rating', 'owner'])
    expect(result.schema.fields['rating'].validation).toEqual({ min: 1, max: 5 })
    expect(result.schema.fields['title'].required).toBe(true)
  })

  it('never carries records — only the field model is read', () => {
    const result = sanitizeDatasetSchema({
      ...model,
      // A records key on the input must not survive into the schema.
      records: [{ values: { title: 'secret customer row' } }],
    } as any)
    if (result.ok === false) throw new Error(result.error)
    expect(JSON.stringify(result.schema)).not.toContain('secret customer row')
    expect(Object.keys(result.schema)).toEqual(['fields', 'order'])
  })

  it('drops non-primitive defaults', () => {
    const result = sanitizeDatasetSchema({
      fields: {
        a: { name: 'A', type: 'text', default: 'ok' },
        b: { name: 'B', type: 'map', default: { nested: 'no' } },
      },
      order: ['a', 'b'],
    })
    if (result.ok === false) throw new Error(result.error)
    expect(result.schema.fields['a'].default).toBe('ok')
    expect(result.schema.fields['b'].default).toBeUndefined()
  })

  it('rejects unsupported field types and empty models', () => {
    expect(
      sanitizeDatasetSchema({
        fields: { a: { name: 'A', type: 'sqlInjection' } },
        order: ['a'],
      }),
    ).toEqual({ ok: false, error: 'Field "a" has an unsupported type' })
    expect(sanitizeDatasetSchema({ fields: {}, order: [] })).toEqual({
      ok: false,
      error: 'Dataset has no fields to publish',
    })
  })

  it('falls back to key order for models written before `order`', () => {
    const result = sanitizeDatasetSchema({
      fields: { a: { name: 'A', type: 'text' } },
    })
    if (result.ok === false) throw new Error(result.error)
    expect(result.schema.order).toEqual(['a'])
  })
})

describe('resolveInstalledDatasetSchema (AGL-657)', () => {
  const schema = {
    fields: {
      title: { name: 'Title', type: 'text' },
      owner: {
        name: 'Owner',
        type: 'reference',
        reference: { datasetId: 'ds-people', datasetLabel: 'People' },
      },
    },
    order: ['title', 'owner'],
  }

  it('relinks a reference onto the installing org’s dataset by label', () => {
    const result = resolveInstalledDatasetSchema(schema, {
      people: 'local-people-id',
    })
    expect(result.degradedFieldIds).toEqual([])
    expect(result.schema.fields['owner'].reference?.datasetId).toBe(
      'local-people-id',
    )
  })

  it('degrades an unmatched reference to text and reports it', () => {
    const result = resolveInstalledDatasetSchema(schema, {})
    // A dead FK renders as a broken picker, so the field becomes plain text
    // rather than installing something visibly broken.
    expect(result.degradedFieldIds).toEqual(['owner'])
    expect(result.schema.fields['owner'].type).toBe('text')
    expect(result.schema.fields['owner'].reference).toBeUndefined()
    expect(result.schema.fields['title']).toEqual({ name: 'Title', type: 'text' })
  })
})

describe('MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST (AGL-657)', () => {
  it('excludes the raw-HTML escape hatch', () => {
    // A published email lands in another org's outgoing customer mail;
    // arbitrary markup there is a phishing/tracking vector.
    expect(MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST).not.toContain('emailHtml')
    expect(MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST).toContain('emailSection')
  })

  it('replaces rather than extends the page allowlist', () => {
    const emailNodes = {
      _at_: { $id: '_at_', componentId: 'div', parentId: null, nodes: ['v'] },
      v: { $id: 'v', componentId: 'videoEmbed', parentId: '_at_' },
    }
    // videoEmbed is publishable on a PAGE but must not pass as an email block.
    expect(
      sanitizeMarketplaceDefinition(
        { rootId: '_at_', nodes: emailNodes },
        { componentIds: MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST },
      ),
    ).toEqual({
      ok: false,
      error: expect.stringContaining(
        'Component "videoEmbed" cannot be published',
      ),
    })
    expect(
      sanitizeMarketplaceDefinition({ rootId: '_at_', nodes: emailNodes }).ok,
    ).toBe(true)
  })
})

/**
 * The unreviewed-install predicate (AGL-1083).
 *
 * It exists to let the install affordance describe what `install-plugin`
 * will actually do, so the cases below are written as the ROUTE's
 * behaviour: `newestApprovedVersion(candidates) ?? fallback`, where the
 * fallback is `latestVersion` and is offered only to the publishing org and
 * only when nothing is approved. If the route's rule changes, these are the
 * assertions that should fail.
 */
describe('installsUnreviewedFallback (AGL-1083)', () => {
  const OWNER_ORG = 'org-1'

  it('is true only for the publishing org, with nothing approved', () => {
    expect(
      installsUnreviewedFallback(
        { profileId: OWNER_ORG, latestVersion: '1.0.0' },
        OWNER_ORG,
      ),
    ).toBe(true)
  })

  it('is false for anyone else — the route refuses them outright', () => {
    expect(
      installsUnreviewedFallback(
        { profileId: OWNER_ORG, latestVersion: '1.0.0' },
        'org-2',
      ),
    ).toBe(false)
    expect(
      installsUnreviewedFallback(
        { profileId: OWNER_ORG, latestVersion: '1.0.0' },
        null,
      ),
    ).toBe(false)
  })

  it('is false once ANY version is approved, however new the pending one', () => {
    // The route serves the newest approved version, so this install is not
    // unreviewed — warning about it would train publishers to ignore the
    // warning on the install that IS.
    expect(
      installsUnreviewedFallback(
        {
          profileId: OWNER_ORG,
          latestVersion: '2.0.0',
          latestApprovedVersion: '1.0.0',
        },
        OWNER_ORG,
      ),
    ).toBe(false)
  })

  it('is false with nothing published at all', () => {
    expect(
      installsUnreviewedFallback({ profileId: OWNER_ORG }, OWNER_ORG),
    ).toBe(false)
    expect(installsUnreviewedFallback(null, OWNER_ORG)).toBe(false)
  })
})

describe('verificationRequestBlock (AGL-1217)', () => {
  const PUBLISHER = 'org-publisher'
  const NOW = Date.parse('2026-08-03T00:00:00Z')
  const DAY = 86_400_000

  const block = (
    listing: Record<string, unknown> | null,
    viewerOrgId: string | null = PUBLISHER,
  ) =>
    verificationRequestBlock({
      listing: listing as never,
      viewerOrgId,
      nowMs: NOW,
    })

  const listed = { profileId: PUBLISHER, reviewStatus: 'listed' }

  it('lets the publisher of a listed plugin ask', () => {
    expect(block(listed)).toBeNull()
  })

  it('refuses anyone who is not the publishing org', () => {
    expect(block(listed, 'org-someone-else')).toBe('not-publisher')
    expect(block(listed, null)).toBe('not-publisher')
    expect(block(null)).toBe('not-publisher')
  })

  it('refuses a listing that already carries the badge', () => {
    expect(block({ ...listed, reviewStatus: 'verified' })).toBe(
      'already-verified',
    )
  })

  it('refuses a listing that is not live', () => {
    // The badge is a claim about something customers can install. Asking for
    // it on a listing still in the queue conflates two reasons to look at it.
    for (const reviewStatus of ['submitted', 'in_review', 'rejected']) {
      expect(block({ ...listed, reviewStatus })).toBe('not-listed')
    }
    // Legacy listings carry no status at all and are treated as `listed`
    // elsewhere — but not here. Verification is a deliberate act, so an
    // absent status is not good enough to hang a badge request on.
    expect(block({ profileId: PUBLISHER })).toBe('not-listed')
  })

  it('allows only one pending request at a time', () => {
    expect(
      block({ ...listed, verificationRequest: { state: 'pending' } }),
    ).toBe('already-pending')
  })

  it('holds a declined publisher off for the cooldown, then lets them back', () => {
    const declinedAgo = (days: number) => ({
      ...listed,
      verificationRequest: {
        state: 'declined',
        decidedAt: { toMillis: () => NOW - days * DAY },
      },
    })
    expect(block(declinedAgo(1))).toBe('cooling-down')
    expect(block(declinedAgo(VERIFICATION_DECLINE_COOLDOWN_DAYS - 1))).toBe(
      'cooling-down',
    )
    expect(block(declinedAgo(VERIFICATION_DECLINE_COOLDOWN_DAYS))).toBeNull()
    expect(block(declinedAgo(VERIFICATION_DECLINE_COOLDOWN_DAYS + 1))).toBeNull()
  })

  it('reads a serialized {seconds} timestamp, not just an SDK one', () => {
    // A doc that has been through JSON loses `toMillis`. Reading only the SDK
    // shape would score every such decline as undated.
    const decided = { seconds: (NOW - 40 * DAY) / 1000 }
    expect(
      block({ ...listed, verificationRequest: { state: 'declined', decidedAt: decided } }),
    ).toBeNull()
  })

  it('treats an undated decline as still cooling down', () => {
    // Fail closed: assuming an undated decline is old enough turns a missing
    // field into a free retry, which is what the cooldown exists to stop.
    expect(
      block({ ...listed, verificationRequest: { state: 'declined' } }),
    ).toBe('cooling-down')
  })

  it('lets a withdrawn or previously granted request be re-asked', () => {
    expect(
      block({ ...listed, verificationRequest: { state: 'withdrawn' } }),
    ).toBeNull()
    // `granted` on a listing that is no longer `verified` means the badge was
    // taken away by a takedown (AGL-1121). Asking again is legitimate.
    expect(
      block({ ...listed, verificationRequest: { state: 'granted' } }),
    ).toBeNull()
  })

  it('has a message for every block reason', () => {
    // A reason with no copy renders an empty tooltip, which reads as broken.
    const reasons: VerificationRequestBlock[] = [
      'not-publisher',
      'already-verified',
      'not-listed',
      'already-pending',
      'cooling-down',
    ]
    for (const reason of reasons) {
      expect(VERIFICATION_BLOCK_MESSAGES[reason]).toBeTruthy()
    }
    expect(Object.keys(VERIFICATION_BLOCK_MESSAGES).sort()).toEqual(
      [...reasons].sort(),
    )
  })
})
