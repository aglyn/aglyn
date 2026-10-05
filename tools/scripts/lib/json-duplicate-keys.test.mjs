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

// Self-test for the JSON duplicate-key guard (AGL-3553). The forced red is the
// merge that motivated it: two lanes each adding `transferResources` to one
// plugin entry, which JSON.parse reads as the second alone.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  evaluateDuplicateKeys,
  findDuplicateKeys,
  formatFailure,
  isSwept,
} from './json-duplicate-keys.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The outreach entry as git merged the two lanes, rebuilt. */
const MERGED_OUTREACH = `{
  "plugins": [
    {
      "id": "outreach",
      "transferResources": [{ "key": "outreach.sequences" }],
      "apiPrefixes": ["outreach"],
      "transferResources": [{ "key": "outreach.doNotContact" }],
      "contributes": { "console": { "slots": ["a"], "slots": ["transferResources"] } }
    }
  ]
}`

test('flags the merged outreach entry, at both depths, while JSON.parse keeps only the last', () => {
  assert.deepEqual(JSON.parse(MERGED_OUTREACH).plugins[0].transferResources, [
    { key: 'outreach.doNotContact' },
  ])
  const result = findDuplicateKeys(MERGED_OUTREACH)
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.duplicates.map((dup) => [dup.path, dup.line, dup.firstLine]),
    [
      ['$.plugins[0].transferResources', 7, 5],
      ['$.plugins[0].contributes.console.slots', 8, 8],
    ],
  )
})

test('the same key in sibling objects, or in an array of objects, is not a duplicate', () => {
  const text = '{"a": {"id": 1}, "b": {"id": 2}, "list": [{"id": 1}, {"id": 2}]}'
  assert.deepEqual(findDuplicateKeys(text), { ok: true, duplicates: [] })
})

test('compares DECODED keys, so an escape cannot hide a repeat', () => {
  const result = findDuplicateKeys('{"key": 1, "k\\u0065y": 2}')
  assert.equal(result.ok, true)
  assert.deepEqual(result.duplicates.map((dup) => dup.key), ['key'])
})

test('a key-shaped string VALUE is not a key', () => {
  assert.deepEqual(findDuplicateKeys('{"a": "b", "c": "a"}'), { ok: true, duplicates: [] })
  assert.deepEqual(findDuplicateKeys('{"a": "x\\"y", "b": ["a", "a"]}'), {
    ok: true,
    duplicates: [],
  })
})

test('reads JSONC: comments and a trailing comma are stepped over, a commented key is not a key', () => {
  const text = `{
    // "paths": {} — a note, not a key
    "compilerOptions": { /* "strict": true, */ "strict": false, },
    "include": ["src",],
  }`
  assert.deepEqual(findDuplicateKeys(text), { ok: true, duplicates: [] })
  const twice = findDuplicateKeys('{ /* c */ "a": 1, // c\n "a": 2 }')
  assert.equal(twice.ok, true)
  assert.deepEqual(twice.duplicates.map((dup) => [dup.key, dup.line]), [['a', 2]])
})

test('a file that is not JSON is an offence, with where it broke', () => {
  const result = findDuplicateKeys('{\n  "a": 1\n  "b": 2\n}')
  assert.equal(result.ok, false)
  assert.equal(result.line, 3)
  const verdict = evaluateDuplicateKeys([{ path: 'broken.json', text: '{"a": }' }])
  assert.equal(verdict.ok, false)
  assert.match(formatFailure(verdict), /broken\.json:1:\d+ {2}not JSON/)
})

test('the failure names both lines and says to merge, not delete', () => {
  const verdict = evaluateDuplicateKeys([{ path: 'plugins.config.json', text: MERGED_OUTREACH }])
  assert.equal(verdict.ok, false)
  const message = formatFailure(verdict)
  assert.match(message, /plugins\.config\.json:7:7 {2}\$\.plugins\[0\]\.transferResources is written twice \(first on line 5\)/)
  assert.match(message, /Merge each pair into ONE key/)
})

test('sweeps .json and .jsonc only', () => {
  assert.equal(isSwept('plugins.config.json'), true)
  assert.equal(isSwept('libs/plugins/crm/package.json'), true)
  assert.equal(isSwept('.vscode/settings.jsonc'), true)
  assert.equal(isSwept('tools/scripts/check-json-duplicate-keys.mjs'), false)
  assert.equal(isSwept('apps/docs/data.json5'), false)
})

test('the repo is clean, and the sweep reached plugins.config.json', () => {
  const out = execFileSync('node', ['tools/scripts/check-json-duplicate-keys.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  assert.match(out, /\d{3,} tracked JSON file\(s\) · no key written twice/)
})
