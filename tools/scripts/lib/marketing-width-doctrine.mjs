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
 * 688 is the tablet frame, which MUI's stock gutters do NOT match (it renders
 * 720) — recorded here so the docs can state that divergence honestly rather
 * than being pushed into hiding it.
 */
export const MEASURED_DESIGN_COLUMNS = new Set(['1392', '1488', '688'])

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
