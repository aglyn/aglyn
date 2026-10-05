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

// Self-test for the Firestore rules deploy artifact (AGL-3544).
//
// The transform is small, and every way it could go wrong changes the rules
// that deploy without changing the file anybody reads. So each case below is
// a shape the real source contains: comments quoting delimiters, apostrophes
// in prose, URLs and padded literals inside strings. The CLI half runs the
// generator against throwaway checkouts, so the exit code a guard reads is
// asserted, not only the verdict.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ARTIFACT_MARKER,
  FIRESTORE_RULES_ARTIFACT,
  FIRESTORE_RULES_SOURCE,
  buildRulesArtifact,
  judgeRulesArtifact,
  stripRulesComments,
} from './rules-deploy-artifact.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'generate-rules-deploy-artifact.mjs')

test('line comments go, and the line they were on stays', () => {
  assert.equal(stripRulesComments('a; // note\n// whole line\nb;'), 'a;\n\nb;')
})

test('a block comment becomes one space and keeps every newline it spanned', () => {
  assert.equal(stripRulesComments('a/*x*/b'), 'a b')
  assert.equal(stripRulesComments('a; /**\n * prose\n */ b;'), 'a;\n\nb;')
})

test('a `/*` quoted in a line comment opens nothing (AGL-2004)', () => {
  const source = [
    '// the name, so `hosts/{hostId}/datasets/*` stayed a client-writable',
    "allow read: if keep in ['sentinel'];",
    '/* an ordinary block comment */',
  ].join('\n')
  assert.equal(stripRulesComments(source), "\nallow read: if keep in ['sentinel'];\n")
})

test('a `//` inside a block comment cannot eat its terminator', () => {
  assert.equal(stripRulesComments("/* prose with // inside */ allow read: if x in ['kept'];"), "allow read: if x in ['kept'];")
})

test('an apostrophe in a comment opens no string', () => {
  assert.equal(stripRulesComments("// isn't a string\nallow read;\n/* don't */ x;"), '\nallow read;\nx;')
})

test('string literals keep every byte: `//`, `/*`, padding and escaped quotes', () => {
  const literals = [
    "'https://example.com/a'",
    "'/* not a comment */'",
    "'two  spaces'",
    "'it\\'s'",
    '"double // quoted"',
    "'^[a-z]+\\\\.$'",
  ]
  for (const literal of literals) {
    assert.equal(stripRulesComments(`x   ==   ${literal}; // c`), `x == ${literal};`)
  }
})

test('whitespace outside literals collapses, and each line is trimmed', () => {
  assert.equal(stripRulesComments('\t  allow\t read ,  write :\tif   true;  \r\n}'), 'allow read , write : if true;\n}')
})

test('a source the scan cannot vouch for is refused, never half-stripped', () => {
  assert.throws(() => stripRulesComments('a; /* never closed'), /line 1: a block comment is never closed/)
  assert.throws(() => stripRulesComments("a;\nb == 'never closed"), /line 2: a string literal is never closed/)
  assert.throws(() => stripRulesComments("b == 'spans\nlines'"), /line 1: a string literal runs past the end of its line/)
})

test('the artifact marks itself on line one and keeps the source numbering', () => {
  const source = "rules_version = '2';\n// prose\nservice cloud.firestore {\n  match /x { allow read; }\n}\n// trailing\n"
  const artifact = buildRulesArtifact(source)
  const lines = artifact.split('\n')
  assert.equal(lines[0], `rules_version = '2';${ARTIFACT_MARKER}`)
  assert.equal(lines[2], 'service cloud.firestore {')
  assert.equal(lines[4], '}')
  assert.ok(artifact.endsWith('}\n'), 'one trailing newline, and trailing comment lines dropped')
  // Stripping the artifact again changes nothing but the marker comment.
  assert.equal(buildRulesArtifact(artifact), artifact)
})

test('the verdict: fresh, stale at the first differing line, or missing', () => {
  const source = 'a;\n// c\nb;\n'
  const artifact = buildRulesArtifact(source)
  assert.equal(judgeRulesArtifact({ source, artifact }).verdict, 'fresh')
  const stale = judgeRulesArtifact({ source: 'a;\n// c\nchanged;\n', artifact })
  assert.equal(stale.verdict, 'stale')
  assert.equal(stale.firstDifferentLine, 3)
  assert.equal(judgeRulesArtifact({ source, artifact: null }).verdict, 'missing')
})

test('the committed artifact is the one the committed source builds', () => {
  const judgement = judgeRulesArtifact({
    source: readFileSync(join(REPO_ROOT, FIRESTORE_RULES_SOURCE), 'utf8'),
    artifact: readFileSync(join(REPO_ROOT, FIRESTORE_RULES_ARTIFACT), 'utf8'),
  })
  assert.equal(judgement.verdict, 'fresh', `stale from line ${judgement.firstDifferentLine}; run npm run generate:rules-deploy`)
})

/* ------------------------------------------------------------------ the CLI */

function checkout(source) {
  const root = mkdtempSync(join(tmpdir(), 'aglyn-rules-deploy-'))
  mkdirSync(join(root, 'cloud'))
  if (source !== null) writeFileSync(join(root, FIRESTORE_RULES_SOURCE), source)
  return root
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

test('CLI: writes the artifact, then --check passes', (t) => {
  const root = checkout("rules_version = '2';\n// prose\nservice cloud.firestore {}\n")
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const written = runCli(['--root', root])
  assert.equal(written.code, 0, written.out)
  assert.match(readFileSync(join(root, FIRESTORE_RULES_ARTIFACT), 'utf8'), /^rules_version = '2'; \/\/ GENERATED/)
  const checked = runCli(['--check', '--root', root])
  assert.equal(checked.code, 0, checked.out)
})

test('CLI: --check exits 1 on a stale artifact and on a missing one, and says what to run', (t) => {
  const root = checkout('a;\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const missing = runCli(['--check', '--root', root])
  assert.equal(missing.code, 1, missing.out)
  assert.match(missing.out, /is missing/)
  writeFileSync(join(root, FIRESTORE_RULES_ARTIFACT), 'old;\n')
  const stale = runCli(['--check', '--root', root])
  assert.equal(stale.code, 1, stale.out)
  assert.match(stale.out, /is stale .* from line 1/)
  assert.match(stale.out, /npm run generate:rules-deploy/)
})

test('CLI: an unreadable source or an unknown argument exits 2', (t) => {
  const root = checkout(null)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.equal(runCli(['--check', '--root', root]).code, 2)
  assert.equal(runCli(['--chekc']).code, 2)
  assert.equal(runCli(['--staged']).code, 2, '--staged without --check would be a write from the index')
})
