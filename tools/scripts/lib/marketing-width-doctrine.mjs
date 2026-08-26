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
 * The marketing authoring docs must not prescribe a pixel content width
 * (AGL-1298, AGL-2360).
 *
 * ## Why a guard on PROSE
 *
 * AGL-1298 banned bespoke `Container.maxWidth` values and swept 144 containers
 * off `sx {maxWidth: '1328px'}` onto stock MUI breakpoints, and
 * `container.spec.tsx` / `starter-template-containers.spec.ts` hold that ban in
 * code. Nothing held it in the DOCS. `product-page-skeleton.md` went on saying
 *
 *   > `{maxWidth: false}` sx `{maxWidth: '1328px'}` → content. 1328 − 48
 *   > gutters = the 1280 content column Figma uses at both 1440 and 1920.
 *   > Not `'lg'` (1200), not `'xl'` (1536).
 *
 * for ten days after the sweep that made it false. That is the dangerous
 * failure mode here: the tests refuse a 1328 cap, so an agent who reads the
 * doc, believes the live site is too wide, and goes looking for the fix finds
 * a red test and concludes the TEST is what needs relaxing. The code ban and
 * the doc doctrine have to say the same thing or the ban is a speed bump.
 *
 * ## The number in that quote is fiction — measured 2026-08-19
 *
 * **1280 is not the design column and never was.** Across every `widthPx`
 * recorded under `tools/marketing/`, it appears zero times. What the frames
 * actually measure:
 *
 *   desktop    1440 canvas → 1392 column (9 sections)
 *   widescreen 1920 canvas → 1488 column (9 sections)
 *   tablet      768 canvas →  688 column (11 sections)
 *
 * And a stock `maxWidth="xl"` Container caps at `min(viewport, 1536)` and
 * subtracts its own gutters, so it renders **1392 at 1440 and 1488 at 1920** —
 * the design, to the pixel, at both desktop widths. There was no discrepancy
 * to fix; `xl` never renders a 1536-wide column at any real breakpoint. 1328
 * is simply 1280 + 48, a cap built to hit a column nothing was drawn to.
 *
 * So the invariant this guards is **"stock `xl`"**, not any pixel number —
 * including 1536. The column is viewport-derived. A doc that pins a pixel
 * figure as the standard is wrong even when the figure is flattering.
 *
 * ## What it does NOT do
 *
 * Stated plainly, because a check that implies more coverage than it has is
 * worse than none: this reads MARKDOWN. It does not measure the live site, the
 * authored node corpus (that is `audit:marketing-containers`), or the Figma
 * frames. It only stops the repo from telling the next agent to narrow a site
 * that is already on-design.
 *
 * ## The quote and fence exemptions are load-bearing
 *
 * Both docs quote the old wording in order to repudiate it, and the whole
 * point of keeping that quote is that a future reader recognises the trap when
 * they meet it elsewhere. So a blockquote line (`>`) is exempt: doctrine is
 * what the prose ASSERTS, and a `>` block is a historical record. A rule that
 * forbade the string outright would force the correction to delete its own
 * evidence.
 *
 * A fenced code block is exempt for the same reason and one more: the README
 * pastes the extractor's own refusal message, which reads *"frame 77:38 is
 * 1440px wide"* — a FRAME width, not a content column, and not an assertion of
 * anything. Flagging transcripts is how a check earns the reputation that gets
 * it suppressed.
 *
 * Pure over `{ path, source }` records on purpose — the detector's failure
 * path must be exercisable without a filesystem (AGL-2021).
 */

/**
 * The content columns the frames are actually MEASURED at — read off `widthPx`
 * in `tools/marketing/pricing-copy/*.json`, the only extracts that record one.
 * The docs are expected to cite these; any other pixel figure asserted as the
 * content column is a number nothing was drawn to.
 *
 * 1392 and 1488 are also exactly what stock `xl` renders at 1440 and 1920.
 * The rest are the small-width frames, which stock does NOT match — recorded
 * here so the docs can state that divergence honestly rather than being
 * pushed into hiding it:
 *
 *   688 tablet column (stock renders 720)
 *   335 mobile column on four of six sections (stock renders 343)
 *   343 mobile column on "Usage pricing" — already exactly stock
 *   375 mobile "Compare features", genuinely full-bleed: a scrolling table
 *       that bleeds on purpose, and a per-section `maxWidth={false}` choice
 *       rather than anything a gutter does
 *
 * That last pair is why "mobile is full-bleed" is wrong as a general claim
 * (AGL-2362): one section of six is, and one is already on stock.
 */
export const MEASURED_DESIGN_COLUMNS = new Set([
  '1392',
  '1488',
  '688',
  '375',
  '343',
  '335',
])

/** Doc-relative paths whose prose states the standard. */
export const DOCTRINE_DOCS = [
  'tools/marketing/product-page-skeleton.md',
  'tools/marketing/README.md',
]

/**
 * A line inside a blockquote is a historical record, not an assertion. Also
 * skips the `> ` inside a nested list, which is how both corrections are
 * formatted.
 */
const isQuoted = (line) => /^\s*>/.test(line)

/** ```-delimited fence, indented or not. */
const isFence = (line) => /^\s*(?:```|~~~)/.test(line)

export const FORBIDDEN_PATTERNS = [
  {
    id: 'bespoke-container-cap',
    // An actual assignment of `maxWidth` to a number. `maxWidth: 'xl'` and
    // `maxWidth: false` do not match — those are the standard.
    pattern: /maxWidth["'`]?\s*:\s*["'`]?\s*\d/,
    what: 'prescribes a Container `maxWidth` as a pixel number',
    fix: "use a stock MUI breakpoint — `'xl'` for a section, `'md'` for prose, `false` for deliberate full-bleed",
  },
  {
    id: 'bespoke-content-column',
    // A pixel figure asserted as THE content column / content width.
    pattern:
      /(\d{3,4})\s*px\s+(?:content\s+)?(?:column|wide)|(\d{3,4})\s+content\s+(?:column|width)/i,
    what: 'asserts a pixel content column the frames were never drawn to',
    fix: 'the invariant is stock `xl`; the measured columns are 1392 @1440, 1488 @1920, 688 @768',
    // Only flag figures that are NOT a measured design column.
    allow: (match) => MEASURED_DESIGN_COLUMNS.has(match[1] ?? match[2] ?? ''),
  },
]

/**
 * Every doctrine doc must also state the invariant POSITIVELY. A doc that
 * merely stops saying 1280 is not the same as one that says what to do —
 * silence is exactly what let the contradiction sit unnoticed, and the next
 * agent needs to find the answer where they found the wrong one.
 *
 * Deliberately NOT a `1536` needle. 1536 is the breakpoint, not the column,
 * and `xl` never renders 1536 of content anywhere; requiring the doc to recite
 * it would re-create the same category error in the opposite direction. What
 * the doc must carry is the stock prop and the column the 1440 frames are
 * measured at.
 */
export const REQUIRED_ASSERTIONS = [
  {
    path: 'tools/marketing/product-page-skeleton.md',
    needles: ["maxWidth: 'xl'", '1392'],
    what: 'the Container invariant must name the stock `xl` prop and the measured 1392 column at 1440',
  },
]

/**
 * @param {{ path: string, source: string }[]} files
 * @returns {{ ok: boolean, checked: number, violations: object[], missing: object[] }}
 */
export const evaluateMarketingWidthDoctrine = (files) => {
  const violations = []

  for (const file of files) {
    const lines = file.source.split('\n')
    let inFence = false
    lines.forEach((line, index) => {
      if (isFence(line)) {
        inFence = !inFence
        return
      }
      if (inFence || isQuoted(line)) return
      for (const rule of FORBIDDEN_PATTERNS) {
        const match = rule.pattern.exec(line)
        if (!match) continue
        if (rule.allow?.(match)) continue
        violations.push({
          path: file.path,
          line: index + 1,
          rule: rule.id,
          what: rule.what,
          fix: rule.fix,
          text: line.trim(),
        })
      }
    })
  }

  const missing = []
  for (const requirement of REQUIRED_ASSERTIONS) {
    const file = files.find((candidate) => candidate.path === requirement.path)
    if (!file) {
      missing.push({ ...requirement, reason: 'doc not scanned' })
      continue
    }
    const absent = requirement.needles.filter(
      (needle) => !file.source.includes(needle),
    )
    if (absent.length > 0) {
      missing.push({ ...requirement, absent, reason: 'assertion absent' })
    }
  }

  return {
    ok: violations.length === 0 && missing.length === 0,
    checked: files.length,
    violations,
    missing,
  }
}

/** @param {ReturnType<typeof evaluateMarketingWidthDoctrine>} result */
export const formatMarketingWidthDoctrineFailure = (result) => {
  const parts = [
    'The marketing authoring docs contradict the container-width invariant.',
    '',
    'The invariant is a STOCK MUI Container at `maxWidth: "xl"` — not a pixel',
    'number, 1536 included. The column is viewport-derived: xl caps at',
    'min(viewport, 1536) and subtracts its own gutters, giving 1392 at a 1440',
    'canvas and 1488 at 1920 — which is what the frames measure (`widthPx` in',
    'pricing-copy/). 1280 is in NO recorded measurement, and 1328 is just',
    '1280 + 48; AGL-1298 banned that cap. Re-measure before changing a width.',
    '',
  ]

  for (const violation of result.violations) {
    parts.push(
      `  ${violation.path}:${violation.line} — ${violation.what} [${violation.rule}]`,
      `    ${violation.text}`,
      `    fix: ${violation.fix}`,
      '',
    )
  }

  for (const gap of result.missing) {
    parts.push(
      `  ${gap.path} — ${gap.what}`,
      `    ${gap.reason}${gap.absent ? `: ${gap.absent.join(', ')}` : ''}`,
      '',
    )
  }

  parts.push(
    'A line inside a blockquote (`>`) is exempt — quote the old wording there',
    'to repudiate it rather than deleting the record.',
  )

  return parts.join('\n')
}

/* -------------------------------------------------------------------------
 * The GUTTER half of the doctrine (AGL-2362)
 * ---------------------------------------------------------------------- */

/**
 * AGL-2360 settled the WIDTH question and left a gutter one: at 768 the frames
 * measure a 688 column where stock renders 720, and at 375 they measure 335
 * where stock renders 343. AGL-2362 asked whether that divergence is real or
 * an artifact of how the frames were drawn. It is an artifact, and the repo
 * proves it without a browser:
 *
 *   git show 241f6fc00 -> aa3234865 (the AGL-1282 re-extract, 2026-08-08)
 *     desktop     inset 80  -> 24   (column 1280 -> 1392)
 *     widescreen  inset 320 -> 216  (column 1280 -> 1488)
 *     tablet      inset 40  -> 40   (unchanged)
 *     mobile      inset 20/16/0     (unchanged)
 *
 * Every variant was drawn to a 1280 column originally. On 2026-08-08 — the day
 * ruled keep the default container widths and update the designs
 * (AGL-1298) — the desktop and widescreen frames were re-cut to what the code
 * renders, and the tablet and mobile frames were not. The 40px and 20px
 * margins are therefore the SAME vintage as the 1280 column that AGL-2360
 * proved fictional. They are not a brand decision that MUI fails to honour;
 * they are the unfinished half of a re-cut.
 *
 * Two corroborating details, both from the extracts:
 *
 *  - 1488 is `min(1920,1536) − 48`. Nobody draws 1488 freehand; it exists only
 *    as a consequence of MUI's `xl`. The desktop pair was traced FROM the code.
 *  - the mobile frame uses THREE different gutters across its six sections —
 *    20 on four, 16 on "Usage pricing", 0 on "Compare features". A decided
 *    system does not disagree with itself inside one frame.
 *
 * So the disposition is: change nothing in the theme. A `MuiContainer` gutter
 * override is the only supported mechanism for a real gutter change (the
 * component is absent from `HOST_THEME_COMPONENT_WHITELIST`, so no host theme
 * can reach it and per-section `sx` is the banned shape) — but it would move
 * every tenant site to satisfy stale frames for ONE of 23 marketing pages.
 * `/pricing` is the only route with a tablet or mobile frame at all; the 22
 * `product-copy/` and `solutions-copy/` extracts are 1440-only.
 */

/** `spacing: 8` in `console.theme.ts`. The model below multiplies by it. */
export const THEME_SPACING_PX = 8

/** MUI's stock breakpoint scale. The theme declares no `breakpoints` key. */
export const MUI_BREAKPOINT_VALUES = {
  xs: 0,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536,
}

/**
 * Stock Container gutter, one side: `spacing(2)` at `xs`, `spacing(3)` from
 * `sm` up (`@mui/system/Container/createContainer.mjs`, MUI 9.2.0).
 */
export const stockContainerGutterPx = (viewportPx) =>
  THEME_SPACING_PX * (viewportPx >= MUI_BREAKPOINT_VALUES.sm ? 3 : 2)

/** What a stock `maxWidth="xl"` Container renders as CONTENT at a viewport. */
export const stockXlColumnPx = (viewportPx) =>
  Math.min(viewportPx, MUI_BREAKPOINT_VALUES.xl) -
  2 * stockContainerGutterPx(viewportPx)

/**
 * The design column of one extracted frame: the most common `widthPx` among
 * its content GROUPS.
 *
 * Group, not section. Every section's own `widthPx` is the frame width at
 * every variant — 1440 at desktop just as much as 375 at mobile — because a
 * section band is full-bleed by construction. Reading the section width as the
 * column is what produced AGL-2362's "mobile is full-bleed at 375, so the
 * delta is −32" premise. The real mobile column is 335 and the real delta is
 * −8. The 375 groups are four rows of the horizontally-scrolling compare
 * table, which bleeds to the edge on purpose and is a per-section authoring
 * choice (`maxWidth={false}`), not a gutter.
 *
 * Ties break to the widest, so a frame whose column is genuinely ambiguous
 * reports the outer one rather than an arbitrary one.
 */
export const modalContentColumn = (frame) => {
  const counts = new Map()
  for (const section of frame.sections ?? []) {
    for (const group of section.groups ?? []) {
      if (typeof group.widthPx !== 'number') continue
      counts.set(group.widthPx, (counts.get(group.widthPx) ?? 0) + 1)
    }
  }
  let best = null
  for (const [width, count] of counts) {
    if (best === null || count > best.count) best = { width, count }
    else if (count === best.count && width > best.width) best = { width, count }
  }
  return best
}

/**
 * Per variant: the canvas, the column the frame is measured at, and the exact
 * signed delta from what stock renders there.
 *
 * `delta` is asserted, not derived, and that is the point. Desktop and
 * widescreen carry `delta: 0` — they are the CONTROL. Any change to
 * `stockContainerGutterPx` (which is what a theme-level `MuiContainer` gutter
 * override would force) moves every row at once, so a global override cannot
 * quietly buy tablet's −32 without breaking the two variants that are already
 * exactly on-design. The two stale rows are pinned at their measured values so
 * that re-cutting those frames has to come here and say so.
 */
export const FRAME_COLUMN_EXPECTATIONS = [
  {
    variant: 'desktop',
    file: 'tools/marketing/pricing-copy/copy-desktop.json',
    canvas: 1440,
    column: 1392,
    delta: 0,
    note: 're-cut to the code by the AGL-1282 pass — the control',
  },
  {
    variant: 'widescreen',
    file: 'tools/marketing/pricing-copy/copy-widescreen.json',
    canvas: 1920,
    column: 1488,
    delta: 0,
    note: 're-cut to the code by the AGL-1282 pass — the control',
  },
  {
    variant: 'tablet',
    file: 'tools/marketing/pricing-copy/copy-tablet.json',
    canvas: 768,
    column: 688,
    delta: -32,
    note: 'NOT re-cut; a 40px margin of the same 1280-column vintage (AGL-2362)',
  },
  {
    variant: 'mobile',
    file: 'tools/marketing/pricing-copy/copy-mobile.json',
    canvas: 375,
    column: 335,
    delta: -8,
    note: 'NOT re-cut; a 20px margin, and the frame disagrees with itself (20/16/0)',
  },
]

/**
 * The model above is arithmetic over MUI's defaults, so it is only truthful
 * while nothing overrides them. These make that precondition FAIL LOUDLY
 * instead of leaving the guard quietly measuring a fiction.
 *
 * A `MuiContainer` override in `console.theme.ts` is the supported way to move
 * gutters — this does not forbid it, it forbids doing so without revisiting
 * `stockContainerGutterPx` and the deltas, which is exactly the review that
 * decision needs.
 */
export const GUTTER_MODEL_PRECONDITIONS = [
  {
    path: 'libs/shared/ui/theme/src/lib/console.theme.ts',
    require: [
      {
        pattern: /^\s*spacing:\s*8\s*,/m,
        what: '`spacing: 8`, the multiplier the gutter model assumes',
      },
    ],
    forbid: [
      {
        pattern: /\bMuiContainer\b/,
        what: 'a `MuiContainer` override — gutters would no longer be MUI stock',
      },
      {
        pattern: /^\s{2}breakpoints\s*:/m,
        what: 'a custom `breakpoints` scale — `sm: 600` is what selects 24 over 16',
      },
    ],
  },
  {
    path: 'libs/shared/ui/theme/src/lib/util/host-theme.ts',
    require: [],
    forbid: [
      {
        pattern: /['"]MuiContainer['"]/,
        what: '`MuiContainer` in HOST_THEME_COMPONENT_WHITELIST — a host theme could then move gutters per tenant',
      },
    ],
  },
]

/**
 * Reconciles the extracted frames against what stock MUI renders.
 *
 * Pure over `{ path, source }` records for the theme and parsed frames, so the
 * failure path runs without a filesystem (AGL-2021).
 *
 * @param {{ frames: { path: string, frame: object }[], themeFiles: { path: string, source: string }[] }} input
 */
export const evaluateContainerGutterReconciliation = ({
  frames = [],
  themeFiles = [],
} = {}) => {
  const findings = []

  for (const precondition of GUTTER_MODEL_PRECONDITIONS) {
    const file = themeFiles.find((f) => f.path === precondition.path)
    if (!file) {
      findings.push({
        kind: 'precondition',
        path: precondition.path,
        what: 'not scanned — the gutter model cannot be shown to hold',
      })
      continue
    }
    for (const rule of precondition.require) {
      if (!rule.pattern.test(file.source)) {
        findings.push({
          kind: 'precondition',
          path: precondition.path,
          what: `missing ${rule.what}`,
        })
      }
    }
    for (const rule of precondition.forbid) {
      if (rule.pattern.test(file.source)) {
        findings.push({
          kind: 'precondition',
          path: precondition.path,
          what: `introduces ${rule.what}`,
        })
      }
    }
  }

  for (const expected of FRAME_COLUMN_EXPECTATIONS) {
    const entry = frames.find((f) => f.path === expected.file)
    if (!entry) {
      findings.push({
        kind: 'frame',
        path: expected.file,
        what: 'frame extract not scanned',
      })
      continue
    }
    const canvas = entry.frame?.frameSize?.width
    if (canvas !== expected.canvas) {
      findings.push({
        kind: 'frame',
        path: expected.file,
        what: `canvas is ${canvas}, expected ${expected.canvas}`,
      })
      continue
    }
    const modal = modalContentColumn(entry.frame)
    if (!modal) {
      findings.push({
        kind: 'frame',
        path: expected.file,
        what: 'no group records a widthPx — nothing to reconcile',
      })
      continue
    }
    if (modal.width !== expected.column) {
      findings.push({
        kind: 'frame',
        path: expected.file,
        what:
          `design column is ${modal.width} (${modal.count} groups), ` +
          `expected ${expected.column} — the frame was re-cut`,
      })
      continue
    }
    const stock = stockXlColumnPx(canvas)
    const delta = modal.width - stock
    if (delta !== expected.delta) {
      findings.push({
        kind: 'gutter',
        path: expected.file,
        what:
          `${expected.variant} @${canvas}: frame ${modal.width} vs stock ` +
          `${stock} is a delta of ${delta}, expected ${expected.delta}`,
      })
    }
  }

  return { ok: findings.length === 0, checked: frames.length, findings }
}

/** @param {ReturnType<typeof evaluateContainerGutterReconciliation>} result */
export const formatContainerGutterFailure = (result) => {
  const parts = [
    'The marketing gutter reconciliation moved (AGL-2362).',
    '',
    'Container gutters are MUI stock — 16px at `xs`, 24px from `sm` up — and',
    'the desktop and widescreen frames match that EXACTLY (delta 0). Those two',
    'rows are the control: a theme-level `MuiContainer` gutter override moves',
    'every breakpoint at once, so it cannot buy tablet without breaking them.',
    '',
    'The tablet (−32) and mobile (−8) deltas are EXPECTED and are not a bug in',
    'the build: those frames were never re-cut by the AGL-1282 pass that moved',
    'desktop and widescreen off the fictional 1280 column. Re-cut the frames,',
    'do not narrow the site, and never reach for a pixel `sx` cap (AGL-1298).',
    '',
  ]
  for (const finding of result.findings) {
    parts.push(`  ${finding.path} — ${finding.what} [${finding.kind}]`, '')
  }
  parts.push(
    'If a gutter change is genuinely intended, update',
    '`stockContainerGutterPx` and the FRAME_COLUMN_EXPECTATIONS deltas in',
    '`tools/scripts/lib/marketing-width-doctrine.mjs` in the same commit.',
  )
  return parts.join('\n')
}
