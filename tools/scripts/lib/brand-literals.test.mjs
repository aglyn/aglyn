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

import { compareToBaseline, findBrandLiterals } from './brand-literals.mjs'

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

test('a full stop after the brand is a sentence, not a hostname (AGL-2319)', () => {
  // The dot exclusion is for `Aglyn.app`. A dot followed by a space, a quote
  // or the end of the string is punctuation, and the sentence it ends is copy.
  // Six real occurrences were hidden by the looser rule, two of them in files
  // the baseline never listed — a ratchet cannot ratchet what it cannot see.
  assert.equal(findBrandLiterals("const a = 'The plugins ship with Aglyn.'").length, 1)
  assert.equal(findBrandLiterals("const a = 'How you sign in to Aglyn. Connect another.'").length, 1)
  assert.equal(findBrandLiterals('const a = `part of Aglyn.`').length, 1)
  // …and the hostnames the rule was written for stay excluded.
  assert.equal(findBrandLiterals("const a = 'Aglyn.app'").length, 0)
  assert.equal(findBrandLiterals("const a = 'Aglyn.com is ours'").length, 0)
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

// ─────────────────────────────────────────────────────────────────────────────
// Regex literals (AGL-2278). A `/[&<>"']/g` is an ordinary HTML escaper, and a
// scanner that reads its `"` as a string quote parses the rest of the file one
// quote out of phase — which both invents literals in comments and hides real
// ones in code. Both directions get a test, because the second is the one that
// would let the gate certify a file it can no longer read.
//
// AGL-2350 replaced the hand-rolled scanner with the TypeScript parser, which
// cannot desynchronise this way at all. These stay — they pin the BEHAVIOUR,
// not the implementation, and they are the cases that prove the replacement
// kept every property the thing it replaced was fixed to have.
// ─────────────────────────────────────────────────────────────────────────────

test('a quote inside a regex does not make a comment count as copy', () => {
  // The exact shape that sent the gate red on supplier-update.ts: an escaper,
  // then a doc comment mentioning the brand. Nothing here is brand copy.
  const source =
    'const e = (v) => v.replace(/[&<>"\']/g, (c) => c)\n' +
    '/** Token-gated — suppliers have no Aglyn account. */\n' +
    'export const handler = 1'
  assert.deepEqual(findBrandLiterals(source), [])
})

test('a quote inside a regex does not hide the copy that follows it', () => {
  // The false-GREEN half, and the reason this is a correctness bug rather than
  // a noise bug. The same desync ate eleven phantom spans out of
  // `tx-return-webfile.ts` and, with them, seven REAL strings underneath.
  const source =
    'const e = (v) => v.replace(/[&<>"\']/g, (c) => c)\n' +
    "const copy = 'Computed against Aglyn’s registrations'"
  assert.equal(findBrandLiterals(source).length, 1)
})

test('the brand inside a regex is a matcher, not copy', () => {
  assert.equal(findBrandLiterals("expect(s).not.toMatch(/= 'Aglyn'/)").length, 0)
})

test('a JSX closing tag is not a regex opener', () => {
  // `</div>` is a `/` preceded by `<`. Treating it as a regex would consume to
  // the next `/` on the line and desync `.tsx` — the file type carrying most
  // of the copy this gate exists to read.
  const source = "<div><span>x</span></div>\nconst a = 'Open Aglyn'"
  assert.equal(findBrandLiterals(source).length, 1)
})

test('division is not mistaken for a regex', () => {
  const source =
    "const r = total / count\nconst s = items[0] / 2\nconst a = 'Open Aglyn'"
  assert.equal(findBrandLiterals(source).length, 1)
})

test('a regex in return position is still a regex', () => {
  const source =
    "function f() { return /['\"]/g }\nconst a = 'Open Aglyn'"
  assert.equal(findBrandLiterals(source).length, 1)
})

test('an unterminated regex guess backs out rather than eating code', () => {
  // A `/` the heuristic calls a regex but that does not close on its line is a
  // wrong guess. Backing out costs nothing; consuming would swallow real code.
  const source = "const a = (1) ? x /\n  y : z\nconst b = 'Open Aglyn'"
  assert.equal(findBrandLiterals(source).length, 1)
})

test('reported line numbers survive a block comment', () => {
  // Every line number this module reports is counted in the stripped source,
  // so a block comment that collapsed would shift `--list` by its height — in
  // practice by the fifteen-line licence header on every file in the repo.
  const source = "/**\n * a\n * b\n */\nconst a = 'Open Aglyn'"
  assert.deepEqual(
    findBrandLiterals(source).map((one) => one.line),
    [5],
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// JSX text (AGL-2350). Copy written as a JSX CHILD is not a quote token, so
// the scanner that preceded the parser had never counted a word of it — and
// JSX children are where a React codebase keeps most of its user-visible
// copy. Three real leaks in `assist-panel.component.tsx` (the panel heading,
// the empty-state paragraph, the proposal-card caption) sat inside a file the
// baseline pinned at 5 while it held 8, and were found by eye.
//
// A false GREEN, like the two defects above it: the gate reported a file it
// could not read as one it had checked.
// ─────────────────────────────────────────────────────────────────────────────

test('catches the brand written as JSX text', () => {
  assert.equal(
    findBrandLiterals('const a = <Typography>Aglyn Assist</Typography>').length,
    1,
  )
})

test('catches JSX text spread over its own line, which is how it is written', () => {
  // The real shape: prettier puts the copy on a line of its own, surrounded by
  // the whitespace that makes it a distinct JsxText node.
  const source =
    'const a = (\n' +
    '  <Typography variant="h6">\n' +
    '    Aglyn Assist\n' +
    '  </Typography>\n' +
    ')'
  assert.deepEqual(
    findBrandLiterals(source).map((one) => one.line),
    [3],
  )
})

test('catches a sentence of JSX text, counting each occurrence', () => {
  const source = '<p>Ask anything about using Aglyn. Aglyn answers from the docs.</p>'
  assert.equal(findBrandLiterals(source).length, 2)
})

test('catches the brand in a JSX attribute string', () => {
  // Never a gap — an attribute value is an ordinary StringLiteral — but the
  // gate now claims to cover JSX, so the claim gets a test.
  assert.equal(findBrandLiterals('<img alt="Aglyn logo" />').length, 1)
})

test('catches the brand in an SVG title, which is an accessible name', () => {
  assert.equal(findBrandLiterals('<svg><title>Aglyn Console</title></svg>').length, 1)
})

test('a JSX identifier is not JSX text', () => {
  // `<AglynLogoMark />` names a component. The tag name is an identifier and
  // must not be counted, or every logo call site becomes a row.
  assert.equal(findBrandLiterals('const a = <AglynLogoMark />').length, 0)
  assert.equal(findBrandLiterals('const a = <Aglyn.Logo />').length, 0)
})

test('a comment inside JSX is still not brand copy', () => {
  assert.equal(
    findBrandLiterals('<div>{/* Aglyn renders this */}<span>x</span></div>').length,
    0,
  )
})

test('a .ts file is parsed as TypeScript, not as TSX', () => {
  // The two dialects disagree about `<T>value`: a type assertion in one, an
  // unclosed JSX element in the other. Parsing `.ts` as `.tsx` would not
  // throw — the parser recovers — it would quietly reshape the tree, which is
  // the silent misreading this rewrite exists to end.
  const source = "const a = <string>x\nconst b = 'Open Aglyn'"
  assert.deepEqual(
    findBrandLiterals(source, 'thing.ts').map((one) => one.line),
    [2],
  )
})

test('a .js file carrying JSX is still read as JSX', () => {
  assert.equal(
    findBrandLiterals('const a = <div>Aglyn</div>', 'thing.js').length,
    1,
  )
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
