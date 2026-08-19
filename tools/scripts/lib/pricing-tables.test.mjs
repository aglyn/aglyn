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
 * Proves the `/pricing` table reconciler can FAIL (AGL-1278).
 *
 * The generator's headline invariant is "where the frame and the code
 * disagree the code wins, but the disagreement is printed". That was true of
 * the console and false of everything else: it wrote `tables.json` before it
 * reconciled, and no branch anywhere in the file set a non-zero exit. Its
 * "found 11 disagreements" evidence was a one-time manual observation with no
 * standing guard behind it — which is indistinguishable, from outside, from a
 * reconciler that always prints zero.
 *
 * So this drives the real generator against FIXTURE COPIES it is allowed to
 * corrupt, one corruption per failure mode, and asserts both the non-zero
 * exit and the message. The `--frame` / `--out` flags exist for exactly this:
 * the committed frame and output are never touched, which is the only way to
 * make a guard fail on purpose in a checkout other agents are working in.
 *
 * Runs BEFORE `check:pricing-tables` in tools-guards.yml, in the AGL-2021
 * order: a scan whose comparator has never been shown to fail is not evidence.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const COPY_DIR = join(repoRoot, 'tools', 'marketing', 'pricing-copy')
const FRAME = join(COPY_DIR, 'copy-desktop.json')
const TABLES = join(COPY_DIR, 'tables.json')

let work
/** The committed fixtures as they were when the suite started. */
let original
const framePath = () => join(work, 'copy-desktop.json')

/** Runs the generator in check mode against the scratch fixtures. */
const check = (extra = []) =>
  spawnSync(
    process.execPath,
    [
      '--import',
      '@swc-node/register/esm-register',
      join('tools', 'marketing', 'build-pricing-tables.mts'),
      '--check',
      `--frame=${framePath()}`,
      `--out=${work}`,
      ...extra,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SWC_NODE_PROJECT: join('tools', 'marketing', 'tsconfig.tables.json'),
      },
    },
  )

const readFrame = () => JSON.parse(readFileSync(framePath(), 'utf8'))
const writeFrame = (data) =>
  writeFileSync(framePath(), JSON.stringify(data, null, 2))

/** The compare table's record list inside a parsed frame. */
const featureTable = (data) =>
  data.sections
    .find((s) => s.name === 'Compare features')
    .groups.find((g) => g.name === 'Feature table')

/** Restores both fixtures to the committed originals between cases. */
const resetFixtures = () => {
  writeFileSync(framePath(), readFileSync(FRAME))
  writeFileSync(join(work, 'tables.json'), readFileSync(TABLES))
}

describe('the /pricing table reconciler can fail (AGL-1278)', () => {
  before(() => {
    work = mkdtempSync(join(tmpdir(), 'aglyn-pricing-tables-'))
    original = { frame: readFileSync(FRAME), tables: readFileSync(TABLES) }
    resetFixtures()
  })
  after(() => rmSync(work, { recursive: true, force: true }))

  it('is CLEAN on the committed frame and the committed output', () => {
    // The baseline every case below is measured against. If this were red the
    // failures would prove nothing — any corruption would "fail" too.
    const run = check()
    assert.equal(
      run.status,
      0,
      `expected a clean run, got ${run.status}:\n${run.stdout}${run.stderr}`,
    )
    assert.match(run.stdout, /reconciliation clean/)
  })

  it('fails when a frame CELL disagrees with the code', () => {
    resetFixtures()
    const data = readFrame()
    const table = featureTable(data)
    const row = table.records.find((r) => r.cells[0] === 'Bandwidth / mo')
    assert.ok(row, 'fixture no longer carries the row this case perturbs')
    row.cells[1] = 'a made-up bandwidth'
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /RECONCILIATION FAILED/)
    assert.match(run.stderr, /CODE-vs-FRAME disagreements/)
    assert.match(run.stderr, /a made-up bandwidth/)
  })

  it('fails when the frame DROPS a row we emit and nothing declares it', () => {
    resetFixtures()
    const data = readFrame()
    const table = featureTable(data)
    table.records = table.records.filter((r) => r.cells[0] !== 'Bandwidth / mo')
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /not declared in EXPECTED_MISSING/)
    assert.match(run.stderr, /Bandwidth \/ mo/)
  })

  it('fails when the frame GAINS a row we do not emit', () => {
    resetFixtures()
    const data = readFrame()
    const table = featureTable(data)
    table.records.push({
      cells: ['Quantum sync', ...Array.from({ length: 8 }, () => '✓')],
    })
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /not declared in EXPECTED_EXTRA/)
    assert.match(run.stderr, /Quantum sync/)
  })

  it('fails LOUDLY on a record that is not a full plan row', () => {
    // Previously the silent half of the same defect: `rec.cells.length === 9`
    // simply skipped anything else, so an extractor that emitted eight cells
    // dropped the row out of the comparison entirely — and a dropped row is
    // exactly what a mis-extracted pricing row looks like.
    resetFixtures()
    const data = readFrame()
    const table = featureTable(data)
    const row = table.records.find((r) => r.cells[0] === 'Bandwidth / mo')
    row.cells = row.cells.slice(0, 8)
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /not a full plan row/)
    assert.match(run.stderr, /Bandwidth \/ mo: 8 cells, expected 9/)
  })

  it('does NOT flag the group bands, which are one cell by design', () => {
    // The counterpart to the case above: "Team", "Commerce" and the other
    // four band rows carry a single cell legitimately. A cell-count rule that
    // flagged them would be turned off within a day, which is how the silent
    // skip got there in the first place.
    resetFixtures()
    const bands = featureTable(readFrame()).records.filter(
      (r) => r.cells.length === 1,
    )
    assert.equal(bands.length, 6)
    const run = check()
    assert.equal(run.status, 0)
    assert.doesNotMatch(run.stdout, /not a full plan row/)
  })

  it('fails when a declared divergence no longer diverges', () => {
    // An exemption that outlives its reason reads as a considered decision
    // and excuses nothing. This check found a real one on its first run:
    // `'Site backup & restore'` had been exempted as a frame-only row and the
    // frame has never carried that label — the row is `Site export & backup`.
    resetFixtures()
    const data = readFrame()
    const table = featureTable(data)
    // Give the frame the SSO row it lacks, which is the one declared
    // ours-only divergence; the declaration is now stale.
    table.records.push({
      cells: [
        'Single sign-on (SAML/OIDC)',
        '—',
        '—',
        '—',
        '—',
        '—',
        '—',
        '—',
        '✓',
      ],
    })
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /declared in EXPECTED_MISSING but the frame now carries it/)
  })

  it('fails when the COMMITTED output has gone stale', () => {
    // The AGL-2133 shape, and the reason this check exists at all: a row was
    // removed from the generator and the generated file went on publishing a
    // cap for an entitlement that no longer existed, because nothing
    // regenerated or diffed it.
    resetFixtures()
    const stale = JSON.parse(readFileSync(join(work, 'tables.json'), 'utf8'))
    stale.compare.groups[0].rows.push({
      label: 'Total site size',
      duplicateOf: null,
      values: { free: '100 MB' },
    })
    writeFileSync(join(work, 'tables.json'), JSON.stringify(stale, null, 2) + '\n')

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /is STALE/)
  })

  it('leaves the COMMITTED fixtures byte-identical throughout', () => {
    // The corruptions above are the point of the suite, and a suite that
    // proved its guard by editing the shared checkout would be worse than no
    // suite: `git commit --only` bounds the file list, not the lines, so a
    // corrupted fixture left on disk rides out in somebody else's commit.
    //
    // Compared against the bytes read in `before`, not against `git status` —
    // this must hold in a working tree that was already dirty for unrelated
    // reasons, or it is asserting somebody else's tidiness.
    assert.deepEqual(readFileSync(FRAME), original.frame)
    assert.deepEqual(readFileSync(TABLES), original.tables)
  })
})
