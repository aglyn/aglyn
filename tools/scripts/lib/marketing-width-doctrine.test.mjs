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

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  FRAME_COLUMN_EXPECTATIONS,
  evaluateContainerGutterReconciliation,
  evaluateMarketingWidthDoctrine,
  formatContainerGutterFailure,
  formatMarketingWidthDoctrineFailure,
  modalContentColumn,
  stockContainerGutterPx,
  stockXlColumnPx,
} from './marketing-width-doctrine.mjs'

const SKELETON = 'tools/marketing/product-page-skeleton.md'
const README = 'tools/marketing/README.md'

/** A minimal doc pair that SATISFIES the doctrine, for mutating per case. */
const good = (skeletonBody = '', readmeBody = '') => [
  {
    path: SKELETON,
    source: [
      '## Invariants',
      '',
      "- **Container:** `section` -> `muiContainer` props `{maxWidth: 'xl'}`.",
      '  Stock breakpoint, never a pixel. Renders 1392 at 1440, 1488 at 1920.',
      skeletonBody,
    ].join('\n'),
  },
  {
    path: README,
    source: ['# Marketing tooling', '', readmeBody].join('\n'),
  },
]

describe('marketing width doctrine — the good state passes', () => {
  it('accepts docs that name the stock xl standard', () => {
    const result = evaluateMarketingWidthDoctrine(good())
    assert.equal(result.ok, true, JSON.stringify(result, null, 2))
    assert.equal(result.violations.length, 0)
    assert.equal(result.missing.length, 0)
    assert.equal(result.checked, 2)
  })

  it('accepts the columns the frames are MEASURED at', () => {
    // 1392/1488/688 are what `widthPx` records in pricing-copy/. A rule that
    // flagged them would make the corrected doc unwritable.
    const result = evaluateMarketingWidthDoctrine(
      good(
        '',
        'Desktop is a 1392px column; widescreen 1488px; tablet a 688px column.',
      ),
    )
    assert.equal(result.ok, true, JSON.stringify(result.violations))
  })

  it('does NOT require the doc to recite 1536 — that is the breakpoint, not the column', () => {
    // The category error this guard exists to stop, in the other direction:
    // `xl` never renders 1536 of content anywhere, so pinning 1536 as "the
    // standard width" would be as wrong as pinning 1280.
    const result = evaluateMarketingWidthDoctrine(good())
    assert.equal(result.ok, true)
    assert.ok(
      !good()[0].source.includes('1536'),
      'the fixture deliberately never says 1536',
    )
  })

  it('accepts `maxWidth: false` — deliberate full-bleed is a stock choice', () => {
    const result = evaluateMarketingWidthDoctrine(
      good('', 'A full-bleed band uses `{maxWidth: false}`.'),
    )
    assert.equal(result.ok, true, JSON.stringify(result.violations))
  })
})

describe('RED on purpose: the exact wording that stood for ten days', () => {
  it('flags the banned sx cap prescribed as an invariant', () => {
    const result = evaluateMarketingWidthDoctrine(
      good(
        "  `muiContainer` props `{maxWidth: false}` sx `{maxWidth: '1328px'}`.",
      ),
    )
    assert.equal(result.ok, false)
    assert.equal(result.violations.length, 1)
    assert.equal(result.violations[0].rule, 'bespoke-container-cap')
    assert.equal(result.violations[0].path, SKELETON)
  })

  it('flags an unquoted pixel cap written as a bare number', () => {
    const result = evaluateMarketingWidthDoctrine(
      good('  Set maxWidth: 1328 on the section container.'),
    )
    assert.equal(result.ok, false)
    assert.equal(result.violations[0].rule, 'bespoke-container-cap')
  })

  it('flags "the 1280 content column Figma uses at both 1440 and 1920"', () => {
    const result = evaluateMarketingWidthDoctrine(
      good('  1328 - 48 gutters = the 1280 content column Figma uses.'),
    )
    assert.equal(result.ok, false)
    assert.equal(result.violations[0].rule, 'bespoke-content-column')
  })

  it('flags the README phrasing too, not just the skeleton', () => {
    const result = evaluateMarketingWidthDoctrine(
      good('', 'Widescreen is the same 1280 content column on a wider canvas.'),
    )
    assert.equal(result.ok, false)
    assert.equal(result.violations[0].path, README)
    assert.equal(result.violations[0].rule, 'bespoke-content-column')
  })

  it('flags "1280px wide" and "1280px column" spellings', () => {
    for (const phrasing of ['a 1280px wide band', 'across the 1280px column']) {
      const result = evaluateMarketingWidthDoctrine(good('', phrasing))
      assert.equal(result.ok, false, phrasing)
      assert.equal(result.violations[0].rule, 'bespoke-content-column')
    }
  })

  it('flags 1200 (lg) asserted as the content column — the rule is on ANY unmeasured figure', () => {
    // Not a 1328-specific rule. `lg` is a legitimate maxWidth; "the 1200
    // content column" is still wrong, because the column lg resolves to is
    // 1152 and no frame is drawn to either.
    const result = evaluateMarketingWidthDoctrine(
      good('', 'Sections sit on the 1200 content column.'),
    )
    assert.equal(result.ok, false)
    assert.equal(result.violations[0].rule, 'bespoke-content-column')
  })
})

describe('the blockquote exemption', () => {
  const OLD = "> It read: `{maxWidth: '1328px'}` = the 1280 content column."

  it('lets the correction QUOTE the wording it repudiates', () => {
    const result = evaluateMarketingWidthDoctrine(good(`  ${OLD}`))
    assert.equal(result.ok, true, JSON.stringify(result.violations))
  })

  it('but the same text unquoted is a violation — the exemption is not a hole', () => {
    // Positive control for the control: if this passed, the blockquote rule
    // would be exempting everything and the checks above would be vacuous.
    const result = evaluateMarketingWidthDoctrine(
      good(`  ${OLD.replace(/^> /, '')}`),
    )
    assert.equal(result.ok, false)
    assert.equal(result.violations.length, 2)
  })
})

describe('the fenced-code exemption', () => {
  const TRANSCRIPT = [
    '```',
    'frame 77:38 is 1440px wide, which is not one of 375, 768, 1920',
    '```',
  ].join('\n')

  it('does not flag a pasted transcript — a frame width is not a doctrine', () => {
    const result = evaluateMarketingWidthDoctrine(good('', TRANSCRIPT))
    assert.equal(result.ok, true, JSON.stringify(result.violations))
  })

  it('and the fence CLOSES — text after it is scanned again', () => {
    // The control that matters: an unbalanced fence would silence the rest of
    // the file, which is exactly how a guard stops guarding without going red.
    const result = evaluateMarketingWidthDoctrine(
      good('', `${TRANSCRIPT}\n\nSections sit on the 1280 content column.`),
    )
    assert.equal(result.ok, false)
    assert.equal(result.violations.length, 1)
    assert.equal(result.violations[0].rule, 'bespoke-content-column')
  })
})

describe('the positive assertion — silence is not compliance', () => {
  it('fails a skeleton that stops saying 1280 without saying what to do instead', () => {
    const result = evaluateMarketingWidthDoctrine([
      { path: SKELETON, source: '- **Container:** wrap every section.' },
      { path: README, source: '# Marketing tooling' },
    ])
    assert.equal(result.ok, false)
    assert.equal(result.violations.length, 0, 'nothing forbidden is present')
    assert.equal(result.missing.length, 1)
    assert.deepEqual(result.missing[0].absent, ["maxWidth: 'xl'", '1392'])
  })

  it('fails when the skeleton is not scanned at all', () => {
    const result = evaluateMarketingWidthDoctrine([
      { path: README, source: '# Marketing tooling' },
    ])
    assert.equal(result.ok, false)
    assert.equal(result.missing[0].reason, 'doc not scanned')
  })
})

describe('the failure report says what to do', () => {
  it('names the file, the line, the stock invariant, and the measured columns', () => {
    const result = evaluateMarketingWidthDoctrine(
      good("  sx `{maxWidth: '1328px'}` -> content."),
    )
    const text = formatMarketingWidthDoctrineFailure(result)
    assert.match(text, /product-page-skeleton\.md:5/)
    assert.match(text, /maxWidth: "xl"/)
    assert.match(text, /1392/)
    assert.match(text, /1488/)
    assert.match(text, /Re-measure before changing a width/)
  })
})

/* -------------------------------------------------------------------------
 * The GUTTER half (AGL-2362)
 * ---------------------------------------------------------------------- */

/** One frame in the shape the extractor emits: sections -> groups -> widthPx. */
const frameOf = (canvas, column, repeats = 9) => ({
  frameSize: { width: canvas, height: 1000 },
  sections: [
    {
      // Every section band is the FRAME width at every variant — that is the
      // reading that produced AGL-2362's "mobile is full-bleed" premise, so
      // the fixture reproduces it deliberately.
      widthPx: canvas,
      groups: [
        ...Array.from({ length: repeats }, () => ({ widthPx: column })),
        { widthPx: 58 },
      ],
    },
  ],
})

const REAL_FRAMES = () =>
  FRAME_COLUMN_EXPECTATIONS.map((expected) => ({
    path: expected.file,
    frame: frameOf(expected.canvas, expected.column),
  }))

const REAL_THEME = () => [
  {
    path: 'libs/shared/ui/theme/src/lib/console.theme.ts',
    source: ['export const options = {', '  spacing: 8,', '}'].join('\n'),
  },
  {
    path: 'libs/shared/ui/theme/src/lib/util/host-theme.ts',
    source: "export const HOST_THEME_COMPONENT_WHITELIST = ['MuiButton']",
  },
]

describe('the stock Container gutter model', () => {
  it('reproduces MUI 9.2.0: 16px at xs, 24px from sm up', () => {
    assert.equal(stockContainerGutterPx(375), 16)
    assert.equal(stockContainerGutterPx(599), 16)
    assert.equal(stockContainerGutterPx(600), 24)
    assert.equal(stockContainerGutterPx(1920), 24)
  })

  it('renders the columns the desktop frames are measured at', () => {
    assert.equal(stockXlColumnPx(1440), 1392)
    assert.equal(stockXlColumnPx(1920), 1488)
    // And the two that do NOT match the frames.
    assert.equal(stockXlColumnPx(768), 720)
    assert.equal(stockXlColumnPx(375), 343)
  })
})

describe('the design column is the GROUP width, never the section band', () => {
  it('ignores the full-bleed section band', () => {
    // The exact mobile shape: a 375 band whose content is 335.
    const modal = modalContentColumn(frameOf(375, 335, 10))
    assert.deepEqual(modal, { width: 335, count: 10 })
  })

  it('RED on purpose: reading the band would report 375 and a -32 delta', () => {
    // AGL-2362's premise. The band is 375 at mobile — and 1440 at desktop, so
    // "the band equals the canvas" is not evidence of full-bleed anywhere.
    const bandReading = frameOf(375, 335, 10).sections[0].widthPx
    assert.equal(bandReading, 375)
    assert.equal(bandReading - stockXlColumnPx(375), 32)
    // What the real column gives instead.
    assert.equal(modalContentColumn(frameOf(375, 335, 10)).width - 343, -8)
  })
})

describe('gutter reconciliation — the good state passes', () => {
  it('accepts the frames and the theme as they stand today', () => {
    const result = evaluateContainerGutterReconciliation({
      frames: REAL_FRAMES(),
      themeFiles: REAL_THEME(),
    })
    assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2))
    assert.equal(result.checked, 4)
  })
})

describe('RED on purpose: a theme gutter override cannot pass silently', () => {
  it('fails the precondition when console.theme.ts overrides MuiContainer', () => {
    const themeFiles = REAL_THEME()
    themeFiles[0].source = [
      'export const options = {',
      '  spacing: 8,',
      '  components: { MuiContainer: { styleOverrides: {} } },',
      '}',
    ].join('\n')
    const result = evaluateContainerGutterReconciliation({
      frames: REAL_FRAMES(),
      themeFiles,
    })
    assert.equal(result.ok, false)
    assert.equal(result.findings[0].kind, 'precondition')
    assert.match(result.findings[0].what, /MuiContainer/)
  })

  it('fails when MuiContainer reaches the host theme whitelist', () => {
    const themeFiles = REAL_THEME()
    themeFiles[1].source =
      "export const HOST_THEME_COMPONENT_WHITELIST = ['MuiButton', 'MuiContainer']"
    const result = evaluateContainerGutterReconciliation({
      frames: REAL_FRAMES(),
      themeFiles,
    })
    assert.equal(result.ok, false)
    assert.match(result.findings[0].what, /WHITELIST/)
  })

  it('fails when the spacing multiplier moves under the model', () => {
    const themeFiles = REAL_THEME()
    themeFiles[0].source = themeFiles[0].source.replace('spacing: 8', 'spacing: 4')
    const result = evaluateContainerGutterReconciliation({
      frames: REAL_FRAMES(),
      themeFiles,
    })
    assert.equal(result.ok, false)
    assert.match(result.findings[0].what, /spacing: 8/)
  })
})

describe('the CONTROL: desktop and widescreen must stay at delta 0', () => {
  // This is the assertion that makes a global gutter override unbuyable. It
  // reconciles against a variant nobody proposed changing, so a theme-wide
  // fix for tablet shows up here as a REGRESSION rather than as silence.
  for (const variant of ['desktop', 'widescreen']) {
    it(`fails if the ${variant} column drifts off stock by one pixel`, () => {
      const expected = FRAME_COLUMN_EXPECTATIONS.find(
        (candidate) => candidate.variant === variant,
      )
      const frames = REAL_FRAMES().map((entry) =>
        entry.path === expected.file
          ? { ...entry, frame: frameOf(expected.canvas, expected.column - 1) }
          : entry,
      )
      const result = evaluateContainerGutterReconciliation({
        frames,
        themeFiles: REAL_THEME(),
      })
      assert.equal(result.ok, false)
      assert.match(result.findings[0].what, /was re-cut/)
    })
  }
})

describe('RED on purpose: the pinned tablet and mobile deltas', () => {
  it('fails if the tablet frame is re-cut to MUI stock without saying so', () => {
    // 688 -> 720 is precisely "option 2" from AGL-2362. It is a legitimate
    // change; it just may not happen silently.
    const frames = REAL_FRAMES().map((entry) =>
      entry.path.endsWith('copy-tablet.json')
        ? { ...entry, frame: frameOf(768, 720, 11) }
        : entry,
    )
    const result = evaluateContainerGutterReconciliation({
      frames,
      themeFiles: REAL_THEME(),
    })
    assert.equal(result.ok, false)
    assert.match(result.findings[0].what, /design column is 720/)
  })

  it('fails if the mobile delta is restated as the fictional -32', () => {
    // A frame drawn to the "full-bleed 375" the issue asserted.
    const frames = REAL_FRAMES().map((entry) =>
      entry.path.endsWith('copy-mobile.json')
        ? { ...entry, frame: frameOf(375, 375, 10) }
        : entry,
    )
    const result = evaluateContainerGutterReconciliation({
      frames,
      themeFiles: REAL_THEME(),
    })
    assert.equal(result.ok, false)
    assert.match(result.findings[0].what, /design column is 375/)
  })

  it('reports a missing frame rather than passing over it', () => {
    const result = evaluateContainerGutterReconciliation({
      frames: REAL_FRAMES().slice(0, 3),
      themeFiles: REAL_THEME(),
    })
    assert.equal(result.ok, false)
    assert.match(result.findings[0].what, /not scanned/)
  })

  it('reports a frame whose groups record no widthPx at all', () => {
    // The shape of every product-copy/ and solutions-copy/ extract.
    const frames = REAL_FRAMES().map((entry) =>
      entry.path.endsWith('copy-mobile.json')
        ? {
            ...entry,
            frame: {
              frameSize: { width: 375, height: 10 },
              sections: [{ widthPx: 375, groups: [{ name: 'x' }] }],
            },
          }
        : entry,
    )
    const result = evaluateContainerGutterReconciliation({
      frames,
      themeFiles: REAL_THEME(),
    })
    assert.equal(result.ok, false)
    assert.match(result.findings[0].what, /no group records a widthPx/)
  })
})

describe('the gutter failure report says what to do', () => {
  it('names the control and refuses the pixel-cap reflex', () => {
    const report = formatContainerGutterFailure({
      ok: false,
      checked: 4,
      findings: [{ kind: 'gutter', path: 'x', what: 'y' }],
    })
    assert.match(report, /control/)
    assert.match(report, /AGL-1298/)
    assert.match(report, /do not narrow the site/)
  })
})
