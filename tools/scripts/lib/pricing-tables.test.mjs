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
/**
 * Every breakpoint export, not just the primary frame. The four tables the
 * reconciler gained coverage of read all of them — the mobile export renders
 * one selected plan as two-cell records rather than a full row, and a reader
 * written for the wide tables finds nothing there and reports clean, so a
 * suite holding only the desktop fixture could not tell the two apart.
 */
const BREAKPOINTS = ['desktop', 'mobile', 'tablet', 'widescreen']
const committed = (bp) => join(COPY_DIR, `copy-${bp}.json`)
const TABLES = join(COPY_DIR, 'tables.json')

let work
/** The committed fixtures as they were when the suite started. */
let original
const framePath = (bp = 'desktop') => join(work, `copy-${bp}.json`)

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

const readFrame = (bp = 'desktop') =>
  JSON.parse(readFileSync(framePath(bp), 'utf8'))
const writeFrame = (data, bp = 'desktop') =>
  writeFileSync(framePath(bp), JSON.stringify(data, null, 2))

/** One named group inside a parsed frame, whatever section it lives in. */
const groupOf = (data, section, name) =>
  data.sections.find((s) => s.name === section)?.groups.find((g) => g.name === name)

/** The wide breakpoints, which share one shape and one set of Figma cells. */
const WIDE = ['desktop', 'tablet', 'widescreen']
/** Applies `edit` to the same group on every wide export and writes them back. */
const editWide = (section, group, edit) => {
  for (const bp of WIDE) {
    const data = readFrame(bp)
    edit(groupOf(data, section, group))
    writeFrame(data, bp)
  }
}

/** The compare table's record list inside a parsed frame. */
const featureTable = (data) =>
  data.sections
    .find((s) => s.name === 'Compare features')
    .groups.find((g) => g.name === 'Feature table')

/** The metered pass-through strip inside a parsed frame (AGL-2194). */
const passThrough = (data) =>
  data.sections
    .find((s) => s.name === 'Usage pricing')
    .groups.find((g) => g.name === 'pass-through')

/** Restores every fixture to the committed original between cases. */
const resetFixtures = () => {
  for (const bp of BREAKPOINTS) {
    writeFileSync(framePath(bp), readFileSync(committed(bp)))
  }
  writeFileSync(join(work, 'tables.json'), readFileSync(TABLES))
}

describe('the /pricing table reconciler can fail (AGL-1278)', () => {
  before(() => {
    work = mkdtempSync(join(tmpdir(), 'aglyn-pricing-tables-'))
    original = {
      frames: Object.fromEntries(
        BREAKPOINTS.map((bp) => [bp, readFileSync(committed(bp))]),
      ),
      tables: readFileSync(TABLES),
    }
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

  /*==========================================
   * THE PASS-THROUGH STRIP (AGL-2194).
   *
   * These three rows were reconciled by nothing at all until AGL-2194 — the
   * compare table had every case above and the metered infrastructure table
   * beside it had none, which is how `/pricing` came to advertise $0.65 / 1k
   * form submissions against a charged $0.065 / 1k for weeks. Two of the six
   * cells are DECLARED stale in `FRAME_STALE_METERED` because the page is
   * besigner-published content this repo cannot edit; the cases below are what
   * stop that declaration from becoming a blanket exemption.
   *========================================*/

  it('fails when a pass-through cell disagrees and nothing declares it', () => {
    resetFixtures()
    const data = readFrame()
    const row = passThrough(data).records.find(
      (r) => r.cells[0] === 'Page views (bandwidth + reads)',
    )
    assert.ok(row, 'fixture no longer carries the row this case perturbs')
    // The one pass-through row that currently AGREES with the code, chosen on
    // purpose: perturbing a declared-stale row would test the declaration
    // rather than the comparison.
    row.cells[2] = '$9.99 / 1k views'
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /PASS-THROUGH disagreements not declared/)
    assert.match(run.stderr, /\$9\.99 \/ 1k views/)
  })

  it('fails when a DECLARED-stale row drifts to a third value', () => {
    // The failure mode a plain "these two are known-wrong" exemption would
    // miss entirely: the page is edited, lands on neither the code's figure
    // nor the recorded stale one, and the declaration silently absorbs it.
    resetFixtures()
    const data = readFrame()
    const row = passThrough(data).records.find(
      (r) => r.cells[0] === 'Form submissions',
    )
    row.cells[2] = '$1.20 / 1k'
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /PASS-THROUGH disagreements not declared/)
    assert.match(run.stderr, /declared stale value was/)
  })

  it('fails when a DECLARED-stale row is fixed on the page', () => {
    // The direction that matters most: the moment the published page is
    // corrected and the copy re-extracted, the declaration has to come out. A
    // guard that only fired on regressions would leave the exemption behind to
    // pre-excuse the next one.
    resetFixtures()
    const data = readFrame()
    const row = passThrough(data).records.find(
      (r) => r.cells[0] === 'Media & file storage',
    )
    row.cells[1] = '$0.026 / GB-mo'
    row.cells[2] = '$0.0338 / GB-mo'
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(
      run.stderr,
      /declared in FRAME_STALE_METERED but the frame now AGREES/,
    )
    assert.match(run.stderr, /Media & file storage/)
  })

  it('fails when the pass-through group disappears from the frame', () => {
    resetFixtures()
    const data = readFrame()
    const section = data.sections.find((s) => s.name === 'Usage pricing')
    section.groups = section.groups.filter((g) => g.name !== 'pass-through')
    writeFrame(data)

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /no "Usage pricing \/ pass-through" group/)
    assert.match(run.stderr, /pass-through rows the frame does not carry/)
  })

  it('publishes the LOCKED metered rates, to four decimals where needed', () => {
    // locked $0.0338/GB-mo · $0.13/1k page views · $0.065/1k form
    // submissions on 2026-08-18. Asserted on the generator's OUTPUT rather
    // than on the constants, because two-decimal formatting would round the
    // cost and the +30% columns into agreement and publish a table that looks
    // internally consistent while stating neither figure.
    resetFixtures()
    const run = check()
    assert.equal(run.status, 0)
    const tables = JSON.parse(readFileSync(TABLES, 'utf8'))
    assert.deepEqual(
      tables.metered.rows.map((r) => [r.label, r.ourCost, r.youPay]),
      [
        ['Media & file storage', '$0.026 / GB-mo', '$0.0338 / GB-mo'],
        [
          'Page views (bandwidth + reads)',
          '$0.10 / 1k views',
          '$0.13 / 1k views',
        ],
        ['Form submissions', '$0.05 / 1k', '$0.065 / 1k'],
      ],
    )
  })

  /*==========================================
   * THE FOUR TABLES NOTHING WAS RECONCILING.
   *
   * `tables.json` emits six tables. Before this, two were guarded — the
   * compare grid and the metered pass-through strip — and `tiers`, `usage`,
   * `fees` and `addons` were generated, published, and compared against
   * nothing at all. The check ran green while the add-on capacity table was
   * stale in eleven cells.
   *
   * One mutation per newly-covered table, so that no table is covered only in
   * appearance: a reader that silently matched nothing would leave its table
   * exactly as unguarded as before while the suite went on passing.
   *========================================*/

  it('names a non-zero comparison count for every table it covers', () => {
    // The anti-vacuity control the cases below are measured against. A
    // reconciler that found no cells to compare would report "clean" just as
    // loudly as one that compared them all and agreed, so the counts are
    // printed and asserted to be non-zero here rather than inferred from a
    // green run. The `reconciled ZERO cells` case below is the same claim
    // from the other side.
    resetFixtures()
    const run = check()
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
    assert.match(run.stdout, /breakpoints reconciled: desktop, mobile, tablet, widescreen/)
    assert.match(
      run.stdout,
      /cells compared: [1-9]\d* compare · [1-9]\d* plan columns · [1-9]\d* scale strip · [1-9]\d* add-on capacity · [1-9]\d* transaction fees · [1-9]\d* add-on cards/,
    )
  })

  it('fails when the PLAN PRICE STRIP disagrees with the code', () => {
    // The strip was excused wholesale as Figma furniture, on the grounds that
    // its first cell is a layer name. It is eight prices.
    resetFixtures()
    editWide('Compare features', 'Feature table', (table) => {
      const strip = table.records.filter((r) => r.cells[0] === 'Text')[1]
      assert.ok(strip, 'fixture no longer carries the price strip')
      strip.cells[3] = '$99'
    })

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /plan columns: CODE-vs-FRAME disagreements/)
    assert.match(run.stderr, /price · Pro \[desktop\]: code=\$56 {2}frame=\$99/)
  })

  it('fails when a SCALE STRIP spec token disagrees with the code', () => {
    resetFixtures()
    editWide('Plans', 'scale-strip', (strip) => {
      const scale = strip.records.find((r) => r.cells[1]?.includes('bandwidth'))
      assert.ok(scale, 'fixture no longer carries the Scale spec line')
      scale.cells[1] = scale.cells[1].replace('700 GB bandwidth', '9 TB bandwidth')
    })

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /scale strip: CODE-vs-FRAME disagreements/)
    assert.match(run.stderr, /Scale · spec 6 .*code=700 GB bandwidth {2}frame=9 TB bandwidth/)
  })

  it('fails when an ADD-ON CAPACITY rate disagrees with the code', () => {
    resetFixtures()
    editWide('Usage pricing', 'Metered table', (table) => {
      const row = table.records.find((r) => r.cells[0] === 'Extra team seat')
      assert.ok(row, 'fixture no longer carries the row this case perturbs')
      row.cells[2] = '+$40/mo'
    })

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /add-on capacity: CODE-vs-FRAME disagreements/)
    assert.match(run.stderr, /Extra team seat · Pro .*code=\+\$4\/mo {2}frame=\+\$40\/mo/)
  })

  it('fails when an ADD-ON CARD price disagrees with the code', () => {
    resetFixtures()
    editWide('Usage pricing', 'cards', (cards) => {
      const pos = cards.records.find((r) => r.cells[0] === 'POS Pro register')
      assert.ok(pos, 'fixture no longer carries the register card')
      pos.cells[1] = '$8 / mo'
    })

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /add-on cards: CODE-vs-FRAME disagreements/)
    assert.match(run.stderr, /Extra POS register · price .*code=\$89 \/ mo {2}frame=\$8 \/ mo/)
  })

  it('fails when a TRANSACTION FEE cell disagrees with the code', () => {
    // Mutated on MOBILE on purpose. The wide breakpoints state the fee ladder
    // in the compare grid, where the compare reconciler would fail on it
    // first and this case would prove nothing about `fees`; the mobile list
    // is read by the fee reconciler alone. It is also where the real defect
    // was — the mobile export published Starter's 5% under a Pro heading.
    resetFixtures()
    const data = readFrame('mobile')
    const row = groupOf(data, 'Compare features', 'list').records.find(
      (r) => r.cells[0] === 'Physical transaction fee',
    )
    assert.ok(row, 'fixture no longer carries the row this case perturbs')
    row.cells[1] = '7%'
    writeFrame(data, 'mobile')

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /transaction fees: CODE-vs-FRAME disagreements/)
    assert.match(run.stderr, /Physical transaction fee · Pro \[mobile\]: code=0% {2}frame=7%/)
  })

  it('reads the MOBILE add-on shape, which is not a plan row at all', () => {
    // The trap this suite exists to close: mobile renders one selected plan
    // as two-cell records, so a reader written for the seven-column table
    // finds nothing there, changes nothing, and reports clean. Corrupting a
    // cell only the mobile shape carries is the only way to tell a reader
    // that handles it from one that skips it.
    resetFixtures()
    const data = readFrame('mobile')
    const rates = groupOf(data, 'Usage pricing', 'Add-on rates · selected plan')
    const row = rates.records.find((r) => r.cells[0] === 'Extra data storage')
    assert.ok(row, 'fixture no longer carries the row this case perturbs')
    row.cells[1] = '$4.00 / GB-mo'
    writeFrame(data, 'mobile')

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /add-on capacity: CODE-vs-FRAME disagreements/)
    assert.match(
      run.stderr,
      /Extra data storage · Pro \[mobile\]: code=\$0\.36 \/ GB-mo {2}frame=\$4\.00 \/ GB-mo/,
    )
  })

  it('fails when a declared divergence is fixed on EVERY breakpoint', () => {
    // The property that makes a declaration honest rather than a blanket
    // exemption, extended to the new tables: Agency's $799 is declared stale
    // because $1,299 is not chargeable until new Stripe price objects exist,
    // and the moment the frame catches up the declaration has to come out.
    resetFixtures()
    editWide('Compare features', 'Feature table', (table) => {
      table.records.filter((r) => r.cells[0] === 'Text')[1].cells[7] = '$1299'
    })

    const run = check()
    assert.equal(run.status, 1)
    assert.match(
      run.stderr,
      /plan columns: declared stale but every breakpoint has CAUGHT UP/,
    )
    assert.match(run.stderr, /price · Agency/)
  })

  it('keeps a declaration alive while ONE breakpoint is still stale', () => {
    // The counterpart, and the reason declaration keys are not qualified by
    // breakpoint: the four exports are one design at four sizes. A key that
    // resolved on the first frame to catch up would delete the exemption
    // while three frames still carried the stale cell, and the next run would
    // report three fresh "disagreements" for a divergence already understood.
    resetFixtures()
    const data = readFrame('desktop')
    groupOf(data, 'Compare features', 'Feature table').records.filter(
      (r) => r.cells[0] === 'Text',
    )[1].cells[7] = '$1299'
    writeFrame(data, 'desktop')

    const run = check()
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
    assert.match(run.stdout, /reconciliation clean/)
  })

  it('fails when a table compares ZERO cells because its group vanished', () => {
    // The failure that has no symptom. Every other case here fails because a
    // number was wrong; this one fails because nothing was read, which a
    // reconciler reports as agreement unless it counts what it compared. It
    // is the exact shape the four tables were already in: not disagreeing,
    // just never asked.
    resetFixtures()
    for (const bp of BREAKPOINTS) {
      const data = readFrame(bp)
      const plans = data.sections.find((s) => s.name === 'Plans')
      plans.groups = plans.groups.filter((g) => g.name !== 'scale-strip')
      writeFrame(data, bp)
    }

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /scale strip: reconciled ZERO cells/)
  })

  it('fails when a declaration is keyed at a cell nothing carries', () => {
    // An exemption keyed at a row the frame no longer has excuses nothing
    // while reading as a considered decision — the same defect as one that
    // has outlived its divergence, arriving from the other direction. The
    // compare grid had no guard for this at all; dropping the one row
    // `FRAME_STALE_CELLS` speaks about proves it now does.
    resetFixtures()
    const data = readFrame('desktop')
    const table = groupOf(data, 'Compare features', 'Feature table')
    table.records = table.records.filter(
      (r) => r.cells[0] !== 'CDN & responsive images',
    )
    writeFrame(data, 'desktop')

    const run = check()
    assert.equal(run.status, 1)
    assert.match(
      run.stderr,
      /declared in FRAME_STALE_CELLS but there is no such cell/,
    )
    assert.match(run.stderr, /CDN & responsive images · Free/)
  })

  /*==========================================
   * THE TWO RATES THAT ARE BILLED AND UNPUBLISHED.
   *
   * `extraEmailSendsUsdPer1k` and `extraAssistCreditsUsdPer1k` are charged by
   * `priceEmailSendOverage` and `priceAssistCreditOverage` and appear on no
   * breakpoint of `/pricing`. They are now emitted into the add-on capacity
   * table and declared in `USAGE_EXPECTED_ABSENT`, which is a NEW kind of
   * declaration — "we publish this, the frame carries it nowhere" — and it
   * gets the same both-directions treatment as every other one here.
   *=========================================*/

  /** One wide-table record for a per-1k rate, in the frame's own decoration. */
  const rateRecord = (label, rates) => ({ cells: [label, ...rates] })
  const EMAIL_LABEL = 'Email sends over included band'
  /** Starter→Agency then Enterprise, exactly as the code renders them. */
  const EMAIL_CELLS = [
    '+$2.5 / 1k',
    '+$2.25 / 1k',
    '+$2 / 1k',
    '+$1.9 / 1k',
    '+$1.85 / 1k',
    '+$1.8 / 1k',
    'Custom',
  ]

  it('holds the absence declaration while the page carries the row NOWHERE', () => {
    // The committed state, asserted rather than assumed: no breakpoint states
    // an email overage rate, and that is exactly what the declaration says.
    // Without this the two cases below could both pass against a fixture set
    // that had quietly gained the row.
    resetFixtures()
    for (const bp of BREAKPOINTS) {
      const text = readFileSync(framePath(bp), 'utf8')
      assert.ok(!text.includes(EMAIL_LABEL), `${bp} already carries ${EMAIL_LABEL}`)
    }
    const run = check()
    assert.equal(run.status, 0)
    assert.match(run.stdout, /reconciliation clean/)
  })

  it('fails when the page CATCHES UP on a row declared absent', () => {
    // The declaration's expiry. Once every breakpoint states the rate the
    // cells can be compared for real, and leaving the entry in place would go
    // on excusing them — the same rule `FRAME_STALE_METERED` is held to,
    // pointed at a row rather than a cell.
    resetFixtures()
    editWide('Usage pricing', 'Metered table', (table) => {
      table.records.push(rateRecord(EMAIL_LABEL, EMAIL_CELLS))
    })
    const mobile = readFrame('mobile')
    groupOf(mobile, 'Usage pricing', 'Add-on rates · selected plan').records.push(
      rateRecord(EMAIL_LABEL, ['+$2.25 / 1k']),
    )
    writeFrame(mobile, 'mobile')

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /declared absent from the frame but no breakpoint reported it/)
    assert.match(run.stderr, /Email sends over included band/)
  })

  it('keeps the absence declaration alive while ONE breakpoint still lacks it', () => {
    // The counter-case. Declarations are not qualified by breakpoint, so
    // three exports catching up must NOT resolve one written for all four —
    // otherwise the fourth rots quietly behind a declaration that no longer
    // describes it.
    resetFixtures()
    editWide('Usage pricing', 'Metered table', (table) => {
      table.records.push(rateRecord(EMAIL_LABEL, EMAIL_CELLS))
    })

    const run = check()
    assert.equal(run.status, 0)
    assert.match(run.stdout, /reconciliation clean/)
  })

  it('reports a row MOBILE drops, which it never used to', () => {
    // The blind spot the two new rows made load-bearing. The mobile branch
    // walked the FRAME's records and looked each one up, so it reported rows
    // the frame carries and we do not — and was structurally incapable of
    // reporting rows we publish and the frame does not, the half the wide
    // branch has always reported. A rate could be missing from the mobile
    // page and from this reconciler at once, and mobile is the breakpoint
    // whose shape differs most, so it is the likeliest to fall behind.
    //
    // Perturbs a row that is NOT declared absent, so the failure can only
    // come from the reader and never from a declaration.
    resetFixtures()
    const data = readFrame('mobile')
    const rates = groupOf(data, 'Usage pricing', 'Add-on rates · selected plan')
    const before = rates.records.length
    rates.records = rates.records.filter(
      (r) => r.cells[0] !== 'Contacts over included band',
    )
    assert.equal(rates.records.length, before - 1, 'fixture lost no row')
    writeFrame(data, 'mobile')

    const run = check()
    assert.equal(run.status, 1)
    assert.match(run.stderr, /add-on capacity: rows the frame does not carry/)
    assert.match(run.stderr, /Contacts over included band \[mobile\]/)
  })

  it('publishes both billed rates, at the values the billing code reads', () => {
    // The rates themselves, pinned in the generated artifact. `--check` diffs
    // the committed `tables.json` byte for byte, so moving either constant
    // without regenerating already fails; this states WHICH figures the page
    // would carry, so a regenerated-but-wrong table is legible as a diff here
    // rather than only as a silent change in a 1,200-line JSON file.
    resetFixtures()
    const tables = JSON.parse(readFileSync(TABLES, 'utf8'))
    const row = (rate) => tables.usage.rows.find((r) => r.rate === rate)

    const email = row('extraEmailSendsUsdPer1k')
    assert.ok(email, 'the email overage row is not published')
    assert.deepEqual(email.values, {
      starter: '$2.5',
      pro: '$2.25',
      business: '$2',
      scale: '$1.9',
      advanced: '$1.85',
      agency: '$1.8',
      enterprise: 'Custom',
    })

    const assist = row('extraAssistCreditsUsdPer1k')
    assert.ok(assist, 'the assist overage row is not published')
    // Starter's dash is CORRECT, not a gap: assist is refused at the band on
    // every tier, so a plan with no rate simply stops. Email's dash would mean
    // the opposite — transactional mail cannot be refused — which is why the
    // email row above carries a rate on every paid tier and this one does not.
    assert.deepEqual(assist.values, {
      starter: '—',
      pro: '$3',
      business: '$2.75',
      scale: '$2.5',
      advanced: '$2.25',
      agency: '$2',
      enterprise: 'Custom',
    })

    // Neither row may publish an internal COST. $0.001 per assist credit and
    // the per-email COGS are cost-model inputs; the pass-through strip is the
    // only place a cost column is published, and only because its heading
    // claims one.
    const published = JSON.stringify([email.values, assist.values])
    assert.ok(!published.includes('0.001'), 'an assist COST reached the page')
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
    for (const bp of BREAKPOINTS) {
      assert.deepEqual(readFileSync(committed(bp)), original.frames[bp])
    }
    assert.deepEqual(readFileSync(TABLES), original.tables)
  })
})
