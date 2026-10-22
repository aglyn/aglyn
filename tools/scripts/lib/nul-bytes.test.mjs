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

// Self-test for the NUL-byte guard (AGL-1890).
//
// The point of these is the FORCED REDS. A guard nobody has watched fail is a
// guard nobody knows the shape of, and this one's whole subject is a defect
// that hid because every tool that should have shown it reported nothing. So
// each test that matters here reconstructs the real offender — including the
// exact literal, at the exact offset, that git's own heuristic missed — and
// asserts the guard flags it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  GIT_BINARY_WINDOW_BYTES,
  evaluateNulBytes,
  findNulBytes,
  formatFailure,
  isSwept,
} from './nul-bytes.mjs'

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

/**
 * The one character this whole guard is about — written as the ESCAPE, which
 * is exactly what it asks source files to do. Writing it raw here would make
 * THIS file an offender, and the guard would correctly go red on its own
 * self-test.
 */
const NUL = '\u0000'

test('flags a NUL inside git binary window, and says the file is unreviewable', () => {
  // The literal that made analytics-day-cache.ts binary, rebuilt.
  const source = [
    'const cacheKey = (scopeKey, field, day) =>',
    `  \`\${scopeKey}${NUL}\${field}${NUL}\${day}\``,
    '',
  ].join('\n')
  const verdict = evaluateNulBytes([
    {
      path: 'apps/console/utils/analytics-day-cache.ts',
      bytes: Buffer.from(source, 'utf8'),
    },
  ])

  assert.equal(verdict.ok, false)
  assert.equal(verdict.offenders.length, 1)
  assert.equal(verdict.offenders[0].count, 2)
  assert.equal(verdict.offenders[0].binaryToGit, true)
  assert.deepEqual(
    verdict.offenders[0].hits.map((hit) => hit.line),
    [2, 2],
  )
  assert.match(formatFailure(verdict), /BINARY TO GIT/)
  // The report must be readable in the terminal that prints it — a raw NUL
  // in the preview would truncate the line in most of them.
  assert.equal(formatFailure(verdict).includes(NUL), false)
  assert.match(formatFailure(verdict), /\\x00/)
})

test('flags a NUL PAST git binary window — the latent case git calls text', () => {
  // media-upload-quarantine.spec.ts, byte 9188. git reported this file as
  // text, so nothing was visibly wrong with it; the guard must not inherit
  // git's blind spot.
  const filler = `${'// padding\n'.repeat(1000)}`
  const source = `${filler}const INFECTED = 'MZ${NUL} bytes'\n`
  assert.ok(
    source.indexOf(NUL) > GIT_BINARY_WINDOW_BYTES,
    'premise: past git window',
  )

  const verdict = evaluateNulBytes([
    {
      path: 'apps/console/specs/media-upload-quarantine.spec.ts',
      bytes: Buffer.from(source, 'utf8'),
    },
  ])

  assert.equal(verdict.ok, false)
  assert.equal(verdict.offenders[0].count, 1)
  assert.equal(verdict.offenders[0].binaryToGit, false)
  assert.match(formatFailure(verdict), /latent/)
})

test('passes the SAME literals once they are written as escapes', () => {
  // The fix, byte for byte: the escape is four ASCII characters, so the file
  // is text, while the string it parses to is unchanged.
  const fixed = [
    'const cacheKey = (scopeKey, field, day) =>',
    '  `${scopeKey}\\x00${field}\\x00${day}`',
    "const INFECTED = 'MZ\\u0090\\x00 pretend this is the malicious PDF'",
    '',
  ].join('\n')
  assert.equal(
    evaluateNulBytes([{ path: 'a.ts', bytes: Buffer.from(fixed, 'utf8') }]).ok,
    true,
  )
  // …and the escape really does parse to the one character it replaced.
  assert.equal(eval("'\\x00'"), NUL)
})

test('locates every NUL by line and column, not just the first', () => {
  const bytes = Buffer.from(
    `alpha\nbe${NUL}ta\ngamma\nde${NUL}${NUL}lta\n`,
    'utf8',
  )
  const hits = findNulBytes(bytes)
  assert.equal(hits.length, 3)
  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.column]),
    [
      [2, 3],
      [4, 3],
      [4, 4],
    ],
  )
  assert.equal(hits[0].preview, 'be\\x00ta')
})

test('sweeps source and config text, and never a tracked binary asset', () => {
  for (const path of [
    'apps/console/utils/analytics-day-cache.ts',
    'apps/console/components/x.component.tsx',
    'tools/scripts/check-nul-bytes.mjs',
    'cloud/firestore.rules',
    'package.json',
    'docs/readme.md',
    '.github/workflows/tools-guards.yml',
    'tools/scripts/test-rules.sh',
  ])
    assert.equal(isSwept(path), true, `expected swept: ${path}`)

  // These are FULL of NULs by definition and must never be read as source.
  for (const path of [
    'apps/console/public/favicon.ico',
    'apps/docs/static/img/media/media-page.png',
    'etc/architecture/inspired-tree-parts.jpeg',
    'public/_static_/@aglyn/logo/320x132.gif',
    'LICENSE',
    '.gitignore',
  ])
    assert.equal(isSwept(path), false, `expected NOT swept: ${path}`)
})

test('an empty or clean corpus is a pass, and reports nothing', () => {
  assert.equal(evaluateNulBytes([]).ok, true)
  assert.equal(
    evaluateNulBytes([
      { path: 'a.ts', bytes: Buffer.from('export const a = 1\n') },
    ]).ok,
    true,
  )
})

test('the real repo is clean, read as BYTES through the real runner', () => {
  // The end-to-end pass. `evaluateNulBytes` above is fed hand-built buffers;
  // this is the only assertion that the script, the git enumeration and the
  // extension allowlist agree on the actual tree — including that the sweep
  // reaches a corpus rather than reporting a green over nothing.
  const out = execFileSync(
    process.execPath,
    [join(REPO_ROOT, 'tools', 'scripts', 'check-nul-bytes.mjs'), '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const report = JSON.parse(out)
  assert.deepEqual(report.offenders, [])
  assert.equal(report.ok, true)
  assert.ok(report.swept > 5000, `swept only ${report.swept} files`)
})
