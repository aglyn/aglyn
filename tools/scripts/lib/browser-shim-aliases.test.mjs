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
 * Pins the browser-shim alias gate (AGL-2706).
 *
 *   node --test tools/scripts/lib/browser-shim-aliases.test.mjs
 *
 * Every FORCED RED is paired with a POSITIVE CONTROL, for the reason
 * `core-namespace-pin.test.mjs` states: a detector asserted only on what it
 * should catch is half-tested, and the untested half is the one that produces
 * false positives until somebody deletes the gate.
 *
 * The forced reds against the REAL vendored bundle doctor it IN MEMORY. This
 * is a shared checkout, and a file swapped on disk to prove a red is a file
 * that rides along in whichever agent commits next.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  SHIMMED,
  instanceofSites,
  tryBlockSpans,
  unsafeUses,
  usageSites,
  verdictFor,
} from './browser-shim-aliases.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'check-browser-shim-aliases.mjs',
)

/** The bundle both aliases rest on, read the way the CLI reads it. */
function firestoreBundles() {
  const dist = join(REPO_ROOT, 'node_modules', '@firebase', 'firestore', 'dist')
  if (!existsSync(dist)) return []
  return readdirSync(dist)
    .filter(
      (name) => name.endsWith('.esm.js') && !/\.(node|rn|cjs)\./.test(name),
    )
    .map((name) => ({
      path: `node_modules/@firebase/firestore/dist/${name}`,
      source: readFileSync(join(dist, name), 'utf8'),
    }))
}

const RE2 = SHIMMED.find((one) => one.specifier === 're2js')
const BUF = SHIMMED.find((one) => one.binding === 'Buffer')

test('a try block spans its whole minified body, not to the first brace', () => {
  const source = 'a();try{if(x){y()}RE2JS.compile(p)}catch(e){log(e)}'
  const [[from, to]] = tryBlockSpans(source)
  assert.ok(source.indexOf('RE2JS') > from)
  assert.ok(source.indexOf('RE2JS') < to)
})

test('a use site is a call, a property read or an index — not prose', () => {
  const source = [
    '// Check if the value is an instance of both Buffer and Uint8Array,',
    '// despite the fact that Buffer extends Uint8Array.',
    'x instanceof Buffer || x instanceof Uint8Array',
  ].join('\n')
  assert.deepEqual(usageSites(source, 'Buffer'), [])
  // One comparison. The prose "an instance of both Buffer" is not `instanceof`
  // either, which is what keeps the site count a count of code.
  assert.equal(instanceofSites(source, 'Buffer').length, 1)
})

test('a call, a property read and an index are all use sites', () => {
  for (const shape of ['Buffer.from(x)', 'Buffer(x)', 'Buffer["from"](x)'])
    assert.equal(usageSites(shape, 'Buffer').length, 1, shape)
})

test('a longer identifier that merely contains the name is not a use', () => {
  assert.deepEqual(usageSites('ArrayBuffer.isView(x)', 'Buffer'), [])
  assert.deepEqual(
    usageSites('remoteDocumentChangeBuffer.apply()', 'Buffer'),
    [],
  )
})

test('try-guarded: a call inside try passes, the same call outside fails', () => {
  const guarded = 'try{RE2JS.compile(p)}catch(e){}'
  const bare = 'RE2JS.compile(p)'
  assert.deepEqual(unsafeUses(guarded, 'RE2JS', 'try-guarded').failing, [])
  assert.equal(unsafeUses(bare, 'RE2JS', 'try-guarded').failing.length, 1)
})

test('instanceof-only: a comparison passes, any call at all fails', () => {
  assert.deepEqual(
    unsafeUses('x instanceof Buffer', 'Buffer', 'instanceof-only').failing,
    [],
  )
  assert.equal(
    unsafeUses('try{Buffer.from(x)}catch(e){}', 'Buffer', 'instanceof-only')
      .failing.length,
    1,
    'a try/catch does not make a call safe when only the NAME may be used',
  )
})

test('no files is UNKNOWN, files with no sites is ABSENT', () => {
  assert.equal(verdictFor(RE2, []).state, 'unknown')
  assert.equal(
    verdictFor(RE2, [{ path: 'x', source: 'nothing here' }]).state,
    'absent',
  )
})

test('POSITIVE CONTROL: the real Firestore bundle satisfies both shims today', () => {
  const bundles = firestoreBundles()
  assert.ok(bundles.length, 'no browser ESM bundle found to read')
  const re2 = verdictFor(RE2, bundles)
  assert.equal(re2.state, 'ok', JSON.stringify(re2.failing.map((f) => f.path)))
  assert.ok(re2.sites >= 3, `only ${re2.sites} RE2JS site(s)`)
  const buffer = verdictFor(BUF, bundles)
  assert.equal(
    buffer.state,
    'ok',
    JSON.stringify(buffer.failing.map((f) => f.path)),
  )
  assert.ok(buffer.sites >= 1, `only ${buffer.sites} Buffer site(s)`)
})

test('FORCED RED: an unguarded RE2JS call in the real bundle reddens re2js', () => {
  const doctored = firestoreBundles().map((one) => ({
    ...one,
    source: `${one.source}\nexport const escape = (p) => RE2JS.quote(p)\n`,
  }))
  const verdict = verdictFor(RE2, doctored)
  assert.equal(verdict.state, 'unsafe')
  assert.equal(verdict.failing.length, doctored.length)
})

test('FORCED RED: a Buffer.from in the real bundle reddens the buffer alias', () => {
  const doctored = firestoreBundles().map((one) => ({
    ...one,
    source: `${one.source}\nexport const bytes = (s) => Buffer.from(s, 'utf8')\n`,
  }))
  const verdict = verdictFor(BUF, doctored)
  assert.equal(verdict.state, 'unsafe')
})

test('the CLI exits 0 and names both aliases', () => {
  const output = execFileSync('node', [CLI], { encoding: 'utf8' })
  for (const shim of SHIMMED) assert.ok(output.includes(shim.specifier), output)
  assert.ok(!output.includes('unsafe'), output)
})

test('--json reports a state and a site count for every alias', () => {
  const parsed = JSON.parse(
    execFileSync('node', [CLI, '--json'], { encoding: 'utf8' }),
  )
  assert.equal(parsed.length, SHIMMED.length)
  for (const one of parsed) {
    assert.equal(one.state, 'ok')
    assert.ok(one.sites > 0)
    assert.deepEqual(one.failingIn, [])
  }
})

test('every shim target named in SHIMMED exists on disk', () => {
  for (const shim of SHIMMED)
    assert.ok(existsSync(join(REPO_ROOT, shim.shim)), shim.shim)
})
