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
 * Pins the British-spelling detector (AGL-2763).
 *
 *   node --test tools/scripts/lib/british-spellings.test.mjs
 *
 * Written the way `brand-literals.test.mjs` is, and for the reason AGL-2002
 * gives: every FORCED RED is paired with a POSITIVE CONTROL. A detector
 * asserted only on what it should catch is half-tested, and the untested half
 * is the one that generates false positives until somebody deletes the gate.
 *
 * The exclusions carry most of the weight here. The rule this enforces names
 * two things it must not touch — comments and persisted values — so each has a
 * test that would fail if the detector ever started reporting them.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BRITISH_SPELLINGS,
  compareToBaseline,
  findInMarkdown,
  findInSource,
  maskMarkdown,
} from './british-spellings.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools/scripts/check-british-spellings.mjs')
const BASELINE = join(REPO_ROOT, 'tools/scripts/british-spellings-baseline.json')

const words = (found) => found.map((one) => one.word)

test('finds a British spelling in markdown prose', () => {
  assert.deepEqual(words(findInMarkdown('A palette colour follows a rebrand.')), [
    'colour',
  ])
})

test('finds one in a heading, which is the case that moves an anchor', () => {
  const found = findInMarkdown('## Colours, spacing and shadows\n')
  assert.deepEqual(words(found), ['Colours'])
  // The suggestion keeps the heading's capitalisation, because the anchor the
  // registries carry is derived from the heading TEXT.
  assert.equal(found[0].suggestion, 'Colors')
})

test('reports the line the word is on, not the line the file starts at', () => {
  const found = findInMarkdown('one\ntwo\nthree\na colour here\n')
  assert.equal(found[0].line, 4)
})

test('a fenced code block is not prose', () => {
  const source = ['before', '```', 'const colour = 1', '```', 'after'].join('\n')
  assert.deepEqual(findInMarkdown(source), [])
})

test('an inline code span is not prose — this is the API-value carve-out', () => {
  // The orders reference documents `cancelled` as a status VALUE. Changing it
  // would be a schema migration, so the mask has to hide it.
  assert.deepEqual(findInMarkdown('| `cancelled` | Stock returned. |'), [])
})

test('but prose BESIDE a code span is still prose', () => {
  const found = findInMarkdown('| `cancelled` | Cancelled; stock returned. |')
  assert.deepEqual(words(found), ['Cancelled'])
})

test('a link destination is a filename, not prose', () => {
  assert.deepEqual(findInMarkdown('![shot](/img/colour-picker.png)'), [])
})

test('a bare URL is not prose', () => {
  assert.deepEqual(findInMarkdown('See https://example.com/colours/guide'), [])
})

test('an unterminated fence swallows the rest of the file', () => {
  // A desynchronised fence scanner is how the brand detector shipped false
  // GREENS three times; here the failure would be a false RED instead, on
  // every code sample below the break.
  assert.deepEqual(findInMarkdown('text\n```\nconst colour = 1\n'), [])
})

test('a code comment is never copy', () => {
  const source = '// the colour is a canvas setting\nconst x = 1'
  assert.deepEqual(findInSource(source, 'x.ts'), [])
})

test('a block comment is never copy', () => {
  const source = '/**\n * colours linger from a deep merge\n */\nconst x = 1'
  assert.deepEqual(findInSource(source, 'x.ts'), [])
})

test('an identifier is never copy', () => {
  const source = 'const AVATAR_COLOURS = []\nfunction assignRoomColours() {}'
  assert.deepEqual(findInSource(source, 'x.ts'), [])
})

test('a string literal IS copy', () => {
  assert.deepEqual(words(findInSource('const a = "pick a colour"', 'x.ts')), [
    'colour',
  ])
})

test('JSX text IS copy', () => {
  const found = findInSource('const a = <p>Neutral colour</p>', 'x.tsx')
  assert.deepEqual(words(found), ['colour'])
})

test('a persisted value is left alone in source', () => {
  // The standing rule is explicit: an order's `status: 'cancelled'` is a
  // schema, and Americanising it is a migration, not a copy fix.
  assert.deepEqual(findInSource("const o = { status: 'cancelled' }", 'x.ts'), [])
})

test('a URL in a string literal is somebody else\'s path, not our copy', () => {
  // The Irish DPC and UK ICO breach-report links in `member-state-exposure.ts`
  // have `/organisations/` in their real paths. Americanising either is a 404.
  const source =
    "const ico = 'https://ico.org.uk/for-organisations/report-a-breach/'"
  assert.deepEqual(findInSource(source, 'x.ts'), [])
})

test('but copy sitting beside a URL is still copy', () => {
  const source = "const s = 'See https://ico.org.uk/for-organisations/ to organise it'"
  assert.deepEqual(words(findInSource(source, 'x.ts')), ['organise'])
})

test('an MUI palette token is left alone in source', () => {
  assert.deepEqual(findInSource("const sx = { color: 'grey.500' }", 'x.ts'), [])
})

test('but grey in docs prose is still flagged', () => {
  // Only source carries the carve-out — in markdown the mask has already
  // removed the code spans that would hold it as a token.
  assert.deepEqual(words(findInMarkdown('Neutral grey — not money yet.')), [
    'grey',
  ])
})

test('the word list carries no word that is already American', () => {
  // `cancellation` is standard in both dialects and listing it would have
  // manufactured a dozen false positives in apps/docs alone.
  for (const already of ['cancellation', 'dialogue', 'towards', 'advertise'])
    assert.equal(
      BRITISH_SPELLINGS[already],
      undefined,
      `${already} is American as written`,
    )
})

test('every entry actually differs from its American form', () => {
  for (const [british, american] of Object.entries(BRITISH_SPELLINGS))
    assert.notEqual(british, american, `${british} maps to itself`)
})

test('masking preserves length, so line numbers survive', () => {
  const source = 'a\n```\nb\n```\nc `d` e\n'
  assert.equal(maskMarkdown(source).length, source.length)
  assert.equal(maskMarkdown(source).split('\n').length, source.split('\n').length)
})

test('a file with no baseline row may not gain its first spelling', () => {
  const verdict = compareToBaseline({ 'a.md': 1 }, {})
  assert.equal(verdict.clean, false)
  assert.deepEqual(verdict.regressions, [{ file: 'a.md', count: 1, allowed: 0 }])
})

test('a stale baseline row is red, not merely noted', () => {
  const verdict = compareToBaseline({}, { 'gone.md': 2 })
  assert.equal(verdict.clean, false)
  assert.deepEqual(verdict.stale, [{ file: 'gone.md', allowed: 2 }])
})

test('the committed baseline matches the repo as it stands', () => {
  // The gate is only meaningful if it is green on the tree it ships with.
  const output = execFileSync('node', [CLI, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const report = JSON.parse(output)
  assert.equal(report.verdict.clean, true, output)
  // And the sweep actually reached the corpus — a walk that found nothing
  // would be "clean" for the wrong reason.
  assert.ok(report.swept > 500, `only ${report.swept} files swept`)
  assert.deepEqual(report.counts, JSON.parse(readFileSync(BASELINE, 'utf8')))
})

test('the Besigner styling pages stay American', () => {
  // The regression this gate was built for (AGL-2763): `colour` in the two
  // pages a sweep found it in, one of them a heading whose anchor is generated
  // into the console help registries.
  for (const page of [
    'apps/docs/docs/building-sites/besigner/theme-styles.md',
    'apps/docs/docs/building-sites/besigner/responsive-styling.md',
  ])
    assert.deepEqual(
      findInMarkdown(readFileSync(join(REPO_ROOT, page), 'utf8')),
      [],
      page,
    )
})
