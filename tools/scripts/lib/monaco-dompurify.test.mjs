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

// Proves the comparator behind `check:monaco-dompurify` can FAIL, one advisory
// precondition at a time (AGL-2300). A guard whose red path is never exercised
// is a guard that cannot be trusted when it renders green.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  evaluateMonacoDompurify,
  formatMonacoDompurifyFailure,
  FORBIDDEN_CALLS,
  FORBIDDEN_OPTIONS,
  REVIEWED_DOMPURIFY_VERSION,
  REVIEWED_MONACO_VERSION,
  SENTINEL_OPTION,
} from './monaco-dompurify.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * A stand-in for the real chunk: it names dompurify, stamps a version, passes
 * the sentinel option, and — like the real bundle — contains the library's own
 * READS of every dangerous option, which must NOT be mistaken for passing one.
 */
function bundle(extra = '') {
  return {
    path: 'editor-TESTHASH.js',
    source:
      `const policyName="dompurify"+(suffix?"#"+suffix:"");` +
      `e.version="${REVIEWED_DOMPURIFY_VERSION}";` +
      // the library reading its config — the shape that must stay quiet
      `const Rf=N.IN_PLACE||!1,V=It(N,"CUSTOM_ELEMENT_HANDLING"),D=N.TRUSTED_TYPES_POLICY;` +
      `e.setConfig=function(){SET_CONFIG=!0};e.clearConfig=function(){};` +
      // monaco actually passing its two options
      `Kc.sanitize(o,{...i,${SENTINEL_OPTION}:!0});Kc.sanitize(o,{...i,RETURN_TRUSTED_TYPE:!0});` +
      extra,
  }
}

const ok = () => ({
  monacoVersion: REVIEWED_MONACO_VERSION,
  files: [bundle(), { path: 'nls.js', source: 'const x=1' }],
})

describe('evaluateMonacoDompurify', () => {
  it('passes the posture the four dismissals were written against', () => {
    const result = evaluateMonacoDompurify(ok())
    assert.equal(result.ok, true, formatMonacoDompurifyFailure(result))
    assert.deepEqual(result.bundles, ['editor-TESTHASH.js'])
    assert.equal(result.dompurifyVersion, REVIEWED_DOMPURIFY_VERSION)
  })

  it('does not mistake the library READING an option for monaco passing it', () => {
    // The fixture above already contains `N.IN_PLACE`, `"CUSTOM_ELEMENT_HANDLING"`
    // and `N.TRUSTED_TYPES_POLICY`, plus both persistent-config DEFINITIONS.
    // If any of those tripped the detector the green above would be an accident.
    const result = evaluateMonacoDompurify(ok())
    assert.equal(result.failures.length, 0)
  })

  for (const { token, advisory } of FORBIDDEN_OPTIONS) {
    it(`fails when monaco passes ${token} (${advisory})`, () => {
      const result = evaluateMonacoDompurify({
        monacoVersion: REVIEWED_MONACO_VERSION,
        files: [bundle(`Kc.sanitize(o,{...i,${token}:!0});`)],
      })
      assert.equal(result.ok, false)
      assert.ok(
        result.failures.some(
          (f) => f.kind === 'option-passed' && f.detail.includes(advisory),
        ),
        `expected an option-passed failure naming ${advisory}`,
      )
    })
  }

  for (const { token, advisory } of FORBIDDEN_CALLS) {
    it(`fails when ${token}() gains a call site (${advisory})`, () => {
      const result = evaluateMonacoDompurify({
        monacoVersion: REVIEWED_MONACO_VERSION,
        files: [bundle(`purify.${token}({ALLOWED_ATTR:["href"]});`)],
      })
      assert.equal(result.ok, false)
      assert.ok(
        result.failures.some(
          (f) => f.kind === 'call-site' && f.detail.includes(advisory),
        ),
        `expected a call-site failure naming ${advisory}`,
      )
    })
  }

  it('fails when the bundled DOMPurify version moves off the reviewed pin', () => {
    const moved = bundle().source.replace(
      `e.version="${REVIEWED_DOMPURIFY_VERSION}"`,
      'e.version="3.5.0"',
    )
    const result = evaluateMonacoDompurify({
      monacoVersion: REVIEWED_MONACO_VERSION,
      files: [{ path: 'editor-TESTHASH.js', source: moved }],
    })
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((f) => f.kind === 'dompurify-moved'))
  })

  it('fails when monaco itself moves, so a bump forces a re-read', () => {
    const result = evaluateMonacoDompurify({ ...ok(), monacoVersion: '0.57.0' })
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((f) => f.kind === 'monaco-moved'))
  })

  it('fails rather than passing vacuously when no chunk carries DOMPurify', () => {
    const result = evaluateMonacoDompurify({
      monacoVersion: REVIEWED_MONACO_VERSION,
      files: [{ path: 'nls.js', source: 'const x=1' }],
    })
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((f) => f.kind === 'no-bundle'))
  })

  it('fails when the sentinel option is absent, because the detector is then blind', () => {
    const blind = bundle().source.replace(`${SENTINEL_OPTION}:!0`, 'x:!0')
    const result = evaluateMonacoDompurify({
      monacoVersion: REVIEWED_MONACO_VERSION,
      files: [{ path: 'editor-TESTHASH.js', source: blind }],
    })
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((f) => f.kind === 'sentinel-missing'))
  })

  it('fails when the version stamp cannot be read unambiguously', () => {
    const result = evaluateMonacoDompurify({
      monacoVersion: REVIEWED_MONACO_VERSION,
      files: [bundle('marked.version="14.0.0";')],
    })
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((f) => f.kind === 'version-unreadable'))
  })
})

describe('check:monaco-dompurify wiring', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

  it('package.json exposes check:monaco-dompurify and test:monaco-dompurify', () => {
    assert.match(
      pkg.scripts['check:monaco-dompurify'],
      /check-monaco-dompurify\.mjs/,
    )
    assert.match(
      pkg.scripts['test:monaco-dompurify'],
      /monaco-dompurify\.test\.mjs/,
    )
  })

  it('tools-guards.yml runs both steps', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github/workflows/tools-guards.yml'),
      'utf8',
    )
    assert.ok(
      workflow.includes('npm run test:monaco-dompurify'),
      'tools-guards.yml must run npm run test:monaco-dompurify',
    )
    assert.ok(
      workflow.includes('npm run check:monaco-dompurify'),
      'tools-guards.yml must run npm run check:monaco-dompurify',
    )
  })
})
