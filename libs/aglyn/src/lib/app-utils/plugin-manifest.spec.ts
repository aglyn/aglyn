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
  PLUGIN_COMPONENT_ID,
  type PluginManifest,
  pluginArtifactPath,
  pluginContentSecurityPolicy,
  validatePluginManifest,
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

describe('pluginContentSecurityPolicy', () => {
  it("uses 'none' for connect-src without network capability", () => {
    const csp = pluginContentSecurityPolicy(base as PluginManifest, [
      'https://console.aglyn.io',
    ])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('frame-ancestors https://console.aglyn.io')
  })

  it('allowlists declared network origins in connect-src', () => {
    const manifest = validatePluginManifest({
      ...base,
      capabilities: { network: ['https://api.example.com'] },
    })
    if (!manifest.ok) throw new Error('expected valid')
    const csp = pluginContentSecurityPolicy(manifest.manifest, [])
    expect(csp).toContain('connect-src https://api.example.com')
    expect(csp).toContain("frame-ancestors 'none'")
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
    expect(result.p1.props.revoked).toBe(true)
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
