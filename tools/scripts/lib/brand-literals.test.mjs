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
 * Pins the brand-literal detector (AGL-2170).
 *
 *   node --test tools/scripts/lib/brand-literals.test.mjs
 *
 * Written the way `hardcoded-colours.test.mjs` is, and for the reason AGL-2002
 * gives: every FORCED RED is paired with a POSITIVE CONTROL. A detector
 * asserted only on what it should catch is half-tested, and the untested half
 * is the one that generates false positives until somebody deletes the gate.
 *
 * The exclusions matter more here than in the colour detector, because the
 * word `Aglyn` appears legitimately hundreds of times as a package scope, a
 * hostname and a type name. If those were counted the gate would carry an
 * order of magnitude of noise and stop being read, so each one has a test.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  compareToBaseline,
  findBrandLiterals,
  stripComments,
} from './brand-literals.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-brand-literals.mjs')
const BASELINE = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'brand-literals-baseline.json',
)

// ─────────────────────────────────────────────────────────────────────────────
// FORCED REDS — copy that must be caught.
// ─────────────────────────────────────────────────────────────────────────────

test('catches the brand in a single-quoted string', () => {
  assert.equal(findBrandLiterals("const a = 'Use your Aglyn account'").length, 1)
})

test('catches the brand in a double-quoted string', () => {
  assert.equal(findBrandLiterals('const a = "Reply as Aglyn staff"').length, 1)
})

test('catches the brand in an interpolated template', () => {
  // The shape that carries most of the real copy — a sentence with a value in
  // it — and the one a naive quote-only scan would miss.
  assert.equal(findBrandLiterals('const a = `Welcome to Aglyn, ${n}`').length, 1)
})

test('catches the brand alone, which is how a siteName or affix is written', () => {
  assert.equal(findBrandLiterals("const a = { siteName: 'Aglyn' }").length, 1)
})

test('counts each occurrence, not each string', () => {
  assert.equal(
    findBrandLiterals("const a = 'Already on Aglyn? New to Aglyn?'").length,
    2,
  )
})

test('catches copy across a multi-line template', () => {
  assert.equal(
    findBrandLiterals('const a = `line one\nand Aglyn on line two`').length,
    1,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROLS — the exclusions, each of which is load-bearing.
// ─────────────────────────────────────────────────────────────────────────────

test('a line comment about the brand is not brand copy', () => {
  assert.equal(findBrandLiterals('// Aglyn sends this now, not Firebase').length, 0)
})

test('a block comment about the brand is not brand copy', () => {
  // Without this the doc comment explaining why the brand is configurable
  // would itself be counted as a hardcoded brand — the guard failing on its
  // own explanation.
  assert.equal(findBrandLiterals('/** Aglyn is the platform brand. */').length, 0)
})

test('a package scope is an identifier, not copy', () => {
  assert.equal(findBrandLiterals("import x from '@aglyn/aglyn'").length, 0)
  assert.equal(findBrandLiterals("import x from '@aglyn/shared-ui-jsx'").length, 0)
})

test('a hostname is a different problem with a different fix', () => {
  // The apex is NEXT_PUBLIC_TENANT_DOMAIN (AGL-2121); folding these in would
  // bury the copy signal under hundreds of rows.
  assert.equal(findBrandLiterals("const a = `${s}.aglyn.app`").length, 0)
  assert.equal(findBrandLiterals("const a = 'https://app.aglyn.com'").length, 0)
  assert.equal(findBrandLiterals("const a = 'Aglyn.app'").length, 0)
})

test('a type or symbol name is an identifier', () => {
  assert.equal(findBrandLiterals("const a = 'AglynHost'").length, 0)
  assert.equal(findBrandLiterals("const a = 'aglyn-tenant-host'").length, 0)
  assert.equal(findBrandLiterals("const a = 'getAglynController'").length, 0)
})

test('a URL inside a string does not break comment stripping', () => {
  // `//` inside a string looks exactly like a line comment to a naive strip,
  // which would swallow the rest of the line — and with it any real copy
  // following on it.
  assert.equal(
    findBrandLiterals("const a = 'https://x.example'\nconst b = 'Open Aglyn'")
      .length,
    1,
  )
})

test('an escaped quote does not end the string early', () => {
  assert.equal(findBrandLiterals("const a = 'it\\'s Aglyn'").length, 1)
})

test('stripComments preserves string contents verbatim', () => {
  const source = "const a = 'keep // this'\n// drop this\nconst b = 1"
  const stripped = stripComments(source)
  assert.ok(stripped.includes("'keep // this'"))
  assert.ok(!stripped.includes('drop this'))
})

// ─────────────────────────────────────────────────────────────────────────────
// The ratchet, and the gate itself.
// ─────────────────────────────────────────────────────────────────────────────

test('a file gaining a literal is a regression', () => {
  const verdict = compareToBaseline({ 'a.ts': 3 }, { 'a.ts': 2 })
  assert.equal(verdict.clean, false)
  assert.deepEqual(verdict.regressions, [{ file: 'a.ts', count: 3, allowed: 2 }])
})

test('a file with no baseline row may not gain its first literal', () => {
  assert.equal(compareToBaseline({ 'new.ts': 1 }, {}).clean, false)
})

test('a stale baseline row is red, not merely noted', () => {
  // An exemption nobody has read is the AGL-2002 shape; the colour ratchet
  // caught a real one this way (AGL-2169).
  const verdict = compareToBaseline({}, { 'gone.ts': 4 })
  assert.equal(verdict.clean, false)
  assert.deepEqual(verdict.stale, [{ file: 'gone.ts', allowed: 4 }])
})

test('losing literals is clean, and reported so the baseline can be lowered', () => {
  const verdict = compareToBaseline({ 'a.ts': 1 }, { 'a.ts': 5 })
  assert.equal(verdict.clean, true)
  assert.deepEqual(verdict.improvements, [{ file: 'a.ts', count: 1, allowed: 5 }])
})

test('the committed baseline matches the repo as it stands', () => {
  // The gate is only meaningful if it is green on the tree it ships with.
  const output = execFileSync('node', [CLI, '--json'], { encoding: 'utf8' })
  const verdict = JSON.parse(output)
  assert.equal(verdict.clean, true, output)
  // And the sweep actually reached the corpus — a walk that found nothing
  // would be "clean" for the wrong reason.
  assert.ok(verdict.files > 10, `only ${verdict.files} files carry literals`)
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  assert.deepEqual(verdict.counts, baseline)
})
