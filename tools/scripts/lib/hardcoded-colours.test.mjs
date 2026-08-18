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
 * Pins the hardcoded-colour detector (AGL-2025).
 *
 *   node --test tools/scripts/lib/hardcoded-colours.test.mjs
 *
 * The guard this pins exists because another guard could not fail for the
 * right reason. So the cases below are written the way AGL-2002 says they
 * have to be: every one of them is a FORCED RED — an input the detector must
 * reject — paired with a POSITIVE CONTROL that must still pass. A detector
 * asserted only on things it should catch is half-tested, and the half left
 * out is the half that makes people delete it.
 *
 * The regression bytes are real. `libs/plugins/mui/.../container.ts:146` is
 * the line Zach reported; `#2e7d32` on 33 commerce entries and `#f57c00` on
 * 18 email ones are the two families the sweep found around it.
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  compareToBaseline,
  findHardcodedColours,
  stripComments,
} from './hardcoded-colours.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-hardcoded-colours.mjs')
const BASELINE = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'hardcoded-colours-baseline.json',
)

// ─────────────────────────────────────────────────────────────────────────────
// FORCED REDS — the shapes that must be caught.
// ─────────────────────────────────────────────────────────────────────────────

test('catches the exact line AGL-2025 was reported on', () => {
  // libs/plugins/mui/src/lib/components/container.ts:146, verbatim.
  const found = findHardcodedColours(`
    icon: {
      path: mdiTextBoxOutline.path,
      sx: { color: '#2196f3' },
    },
  `)
  assert.equal(found.length, 1)
  assert.equal(found[0].hex, '#2196f3')
  assert.equal(found[0].property, 'color')
})

test('catches every colour family the AGL-2025 sweep found', () => {
  const cases = [
    [`sx: { color: '#2196f3' }`, '#2196f3'], // mui, 38×
    [`sx: { color: '#2e7d32' }`, '#2e7d32'], // commerce, 33×
    [`sx: { color: '#f57c00' }`, '#f57c00'], // email, 18×
    [`sx: { color: '#7b1fa2' }`, '#7b1fa2'], // mui media, 18×
    [`sx: { color: '#057822' }`, '#057822'], // the one non-MUI value, 5×
  ]
  for (const [source, hex] of cases) {
    const found = findHardcodedColours(source)
    assert.equal(found.length, 1, `missed ${hex} in: ${source}`)
    assert.equal(found[0].hex, hex)
  }
})

test('catches the other property spellings, quotings and shorthands', () => {
  const cases = [
    [`backgroundColor: '#111827'`, 1], // marketing announcement bar
    [`borderTopColor: color || '#e0e0e0'`, 1], // email divider default
    [`border: '1px solid #d1d5db'`, 1], // shorthand, hex not adjacent
    [`background: '#fff'`, 1], // 3-digit
    [`"color": "#1a73e8"`, 1], // quoted key, double-quoted value
    [`color:#0288d1;`, 1], // emitted CSS, no quotes
    [`boxShadow: '0 1px 2px #00000033'`, 1], // 8-digit inside a shorthand
    [`fill: '#455a64'`, 1], // SVG
    [`background: 'linear-gradient(#fff, #111827)'`, 2], // two in one value
  ]
  for (const [source, expected] of cases) {
    const found = findHardcodedColours(source)
    assert.equal(found.length, expected, `wrong count for: ${source}`)
  }
})

test('reports the LINE, so a 161-instance file can actually be worked', () => {
  const found = findHardcodedColours(
    ['const a = 1', '', `sx: { color: '#2196f3' },`, '', `fill: '#2e7d32'`].join(
      '\n',
    ),
  )
  assert.deepEqual(
    found.map((one) => [one.line, one.hex]),
    [
      [3, '#2196f3'],
      [5, '#2e7d32'],
    ],
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROLS — a detector that fires on correct code gets deleted.
// ─────────────────────────────────────────────────────────────────────────────

test('a legitimate theme-token reference PASSES', () => {
  // The shape AGL-2025 asks authors to move to, including the one that
  // already ships: collection.tsx:1515.
  const clean = [
    `sx: { color: 'primary.main' }`,
    `sx: { color: 'text.secondary' }`,
    `sx: { color: 'tertiary.contrastText' }`,
    `backgroundColor: 'background.paper'`,
    `sx: { color: (theme) => theme.palette.primary.main }`,
    `borderColor: 'divider'`,
    `color: theme.palette.tint.primary`,
    `sx: { color: 'inherit' }`,
  ]
  for (const source of clean)
    assert.deepEqual(
      findHardcodedColours(source),
      [],
      `false positive on a token reference: ${source}`,
    )
})

test('a hex that is not in a style slot PASSES', () => {
  const clean = [
    // commerce-orders.ts — a human-readable order number, twice.
    `/** Human order number, sequential per host (e.g. #1042). */`,
    `const label = '#' + String(sequence)`,
    // A route fragment, an id selector, a git sha.
    `const href = '/pricing#compare'`,
    `document.querySelector('#root')`,
    `const sha = '#abc123'`,
  ]
  for (const source of clean)
    assert.deepEqual(
      findHardcodedColours(source),
      [],
      `false positive outside a style slot: ${source}`,
    )
})

test('a colour named only in PROSE passes — this is where it differs from the census', () => {
  // The census counts comments on purpose: prose naming a RETIRED hex is an
  // instruction to re-author it (AGL-1939 is red on exactly two of these).
  // This guard asks what ships, so a comment is not a colour. Both are right
  // about their own question; the difference is deliberate and pinned here.
  //
  // The hexes below are deliberately NOT the two retired ones. Writing those
  // down here would make the census red at this file — the very failure
  // AGL-1939 is open on — and an exemption added to dodge it would be an
  // exemption bought to make a test convenient. Non-retired values make the
  // same point and keep both guards honest about each other.
  const source = [
    `// AGL-1186: the accent that every component was opting into is #2196f3.`,
    `/* The commerce glyphs derive to #2e7d32. */`,
    `/** @example sx: { color: '#f57c00' } — do not do this. */`,
    `sx: { color: 'primary.main' },`,
  ].join('\n')
  assert.deepEqual(findHardcodedColours(source), [])
})

test('a `//` inside a string does NOT blank the rest of the line (the AGL-2004 shape)', () => {
  // AGL-2004: a line comment quoting `datasets/*` opened a 571-line phantom
  // block comment and the guard silently stopped running. The same class of
  // bug here would blank real code and report a clean file.
  const source = `const url = 'https://aglyn.com/pricing'; const c = { color: '#2196f3' }`
  const found = findHardcodedColours(source)
  assert.equal(found.length, 1, 'a URL swallowed the rest of the line')
  assert.equal(found[0].hex, '#2196f3')

  // And the offsets survive, so line numbers stay honest.
  assert.equal(stripComments(source).length, source.length)
  const multi = `a\n// comment\nb`
  assert.equal(stripComments(multi).length, multi.length)
  assert.equal(stripComments(multi).split('\n').length, 3)
})

// ─────────────────────────────────────────────────────────────────────────────
// THE RATCHET — the part that decides red vs green.
// ─────────────────────────────────────────────────────────────────────────────

test('the ratchet goes RED when a file gains a colour', () => {
  const verdict = compareToBaseline(
    { 'libs/plugins/mui/src/lib/components/container.ts': 4 },
    { 'libs/plugins/mui/src/lib/components/container.ts': 3 },
  )
  assert.equal(verdict.clean, false)
  assert.deepEqual(verdict.regressions, [
    {
      file: 'libs/plugins/mui/src/lib/components/container.ts',
      count: 4,
      allowed: 3,
    },
  ])
})

test('the ratchet goes RED when a previously clean file gains its first', () => {
  const verdict = compareToBaseline({ 'libs/plugins/data/src/lib/plugin.ts': 1 }, {})
  assert.equal(verdict.clean, false)
  assert.equal(verdict.regressions.length, 1)
})

test('the ratchet goes RED on a stale baseline row', () => {
  // An allowance for a file that no longer has any is an allowance nobody has
  // read since it was added — the AGL-2002 shape.
  const verdict = compareToBaseline({}, { 'libs/gone.ts': 2 })
  assert.equal(verdict.clean, false)
  assert.deepEqual(verdict.stale, [{ file: 'libs/gone.ts', allowed: 2 }])
})

test('the ratchet stays GREEN at the ceiling, and reports a win without failing', () => {
  const at = compareToBaseline({ 'libs/a.ts': 3 }, { 'libs/a.ts': 3 })
  assert.equal(at.clean, true)
  assert.equal(at.improvements.length, 0)

  const better = compareToBaseline({ 'libs/a.ts': 1 }, { 'libs/a.ts': 3 })
  assert.equal(better.clean, true, 'removing colours must not fail the build')
  assert.deepEqual(better.improvements, [
    { file: 'libs/a.ts', count: 1, allowed: 3 },
  ])
})

// ─────────────────────────────────────────────────────────────────────────────
// THE PREMISE — guard the guard.
// ─────────────────────────────────────────────────────────────────────────────

test('the baseline records the AGL-2025 census and still matches the tree', () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const total = Object.values(baseline).reduce((a, b) => a + b, 0)

  // The number this issue was filed on. If a cleanup lands, this moves DOWN
  // and the assertion is updated in the same commit — never up. The ceiling
  // is what stops `--write` being used to launder a regression: re-baselining
  // past 332 fails here even though the ratchet itself would be satisfied.
  assert.ok(
    total >= 150 && total <= 332,
    `baseline total is ${total}; AGL-2025 measured 332. A jump up means a ` +
      'regression was baselined in rather than fixed.',
  )
  assert.ok(
    baseline['libs/plugins/mui/src/lib/components/container.ts'] >= 1,
    'the file AGL-2025 was reported on fell out of the baseline',
  )

  // The CLI agrees with the committed baseline right now.
  const result = execFileSync(process.execPath, [CLI, '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const report = JSON.parse(result)
  assert.equal(report.clean, true)
  assert.ok(
    report.files > 3000 || report.total > 0,
    'the sweep reached nothing',
  )
})

test('the CLI exits NON-ZERO when a real file gains a colour', () => {
  // The end-to-end forced red: run the real CLI against a baseline that
  // allows one fewer than the tree actually has. Exit 0 here would mean the
  // gate cannot fail, which is the whole reason this suite exists.
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const [file, count] = Object.entries(baseline)[0]
  const tightened = { ...baseline, [file]: count - 1 }

  const scratch = join(REPO_ROOT, 'tools', 'scripts', '.tmp-baseline-red.json')
  let exitCode = 0
  let output = ''
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        `const fs=require('fs');fs.writeFileSync(${JSON.stringify(scratch)},JSON.stringify(${JSON.stringify(tightened)}))`,
      ],
      { cwd: REPO_ROOT },
    )
    // Point the CLI at the tightened copy by swapping it in for the duration.
    const real = readFileSync(BASELINE, 'utf8')
    try {
      execFileSync(
        process.execPath,
        [
          '-e',
          `const fs=require('fs');fs.copyFileSync(${JSON.stringify(scratch)},${JSON.stringify(BASELINE)})`,
        ],
        { cwd: REPO_ROOT },
      )
      try {
        output = execFileSync(process.execPath, [CLI], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        })
      } catch (error) {
        exitCode = error.status
        output = String(error.stdout ?? '')
      }
    } finally {
      execFileSync(
        process.execPath,
        [
          '-e',
          `const fs=require('fs');fs.writeFileSync(${JSON.stringify(BASELINE)},${JSON.stringify(real)})`,
        ],
        { cwd: REPO_ROOT },
      )
    }
  } finally {
    execFileSync(
      process.execPath,
      [
        '-e',
        `const fs=require('fs');try{fs.unlinkSync(${JSON.stringify(scratch)})}catch{}`,
      ],
      { cwd: REPO_ROOT },
    )
  }

  assert.equal(exitCode, 1, 'the CLI did not fail on a gained colour')
  assert.match(output, /GAINED/)
  assert.match(output, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
