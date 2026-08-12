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
 * Detect retired colours in a RENDERED marketing page (AGL-1431).
 *
 * The pure half of `check-retired-colours.mjs`, split out so the detector can
 * be pinned by `retired-colours.test.mjs`. The CLI does the fetching; this
 * file only ever sees a string of HTML.
 *
 * ## Why this counts the rendered page and not the source
 *
 * `64a945bc5` migrated the marketing site off `#0090d9`. It held on `/` and
 * `/product/*`. Then `/pricing` was re-authored (AGL-1282, AGL-1296) and the
 * retired colours came back — 176 and 174 occurrences — and nothing failed
 * anywhere. It was found by re-measuring production by hand three days later.
 *
 * The re-authoring landed as CONTENT, with no commit. A PR-time check is
 * structurally incapable of seeing it. Two more things rule out the cheap
 * approximations:
 *
 *  * A **source** grep is a lower bound — `lazyPanels` (AGL-1285) keeps
 *    deferred panel nodes out of the payload a naive read sees.
 *  * A **CSS rule** count is a lower bound by ~28× — emotion dedupes the 170
 *    offending nodes on `/pricing` to 6 distinct rules, so anyone counting
 *    rules concludes the page is nearly clean.
 *
 * So: count OCCURRENCES, in the delivered bytes, and treat every unattributed
 * one as real. Under-reporting is the failure mode being guarded against, so
 * the detector counts by default and exempts only where it can name why.
 *
 * ## The one exemption
 *
 * `#4fc3f7` appears twice on every page, including the pages that are
 * provably clean:
 *
 *     "primary":{"main":"#00b0ff","dark":"#4fc3f7","contrastText":…}
 *
 * That is the theme deriving dark-scheme `primary.dark` — generated, correct
 * for dark surfaces, and locked by `accessible-shade.spec.ts`. What AGL-1293
 * retired is an AUTHOR pinning the literal into node `sx`; removing the
 * `@scheme dark` slices that did so was half of `64a945bc5`. Those slices
 * serialise as `"@scheme dark":{"color":"#4fc3f7"}` — key `color`, not a
 * palette slot — so keying the exemption on the palette slot name separates
 * the two exactly. Measured: it takes `/pricing` from 174 to 172 and `/` from
 * 2 to 0.
 */

/**
 * The retired set. Deliberately small and named — this is not a palette
 * linter. Each entry has to say what retired it and what to use instead,
 * because the report is read by whoever is about to re-author the page.
 */
export const RETIRED_COLOURS = [
  {
    hex: '#0090d9',
    retiredBy: 'AGL-1293',
    replacement: '#0073ae',
    why: '3.51:1 on white — fails WCAG AA (4.5:1) for normal text, and fails even the 3:1 large-text threshold on the Pro tint.',
  },
  {
    hex: '#4fc3f7',
    retiredBy: 'AGL-1293',
    replacement: 'the primary.dark token (drop the pinned `@scheme dark` slice)',
    why: 'pinning it into node sx re-creates the hard-coded dark slices that 64a945bc5 removed.',
  },
]

/**
 * Object keys that name a palette SLOT rather than a style property. A hex
 * sitting in one of these is the theme describing itself, not an author
 * pinning a colour onto a node. Channel variants are MUI's CSS-var form of
 * the same slots.
 */
const PALETTE_SLOTS = new Set([
  'main',
  'light',
  'dark',
  'contrastText',
  'mainChannel',
  'lightChannel',
  'darkChannel',
  'contrastTextChannel',
])

/**
 * The identifier immediately to the left of `<key>: <hex>`, in any of the
 * three shapes the tenant actually delivers:
 *
 *   escaped JSON in the flight payload   \"color\":\"#0090d9\"
 *   plain JSON in a script tag             "color":"#0090d9"
 *   an emitted emotion rule                 color:#0090d9;
 *
 * Anchored at the end so it matches the text running up to the hex.
 */
const KEY_BEFORE_VALUE = /([A-Za-z_][A-Za-z0-9_-]*)(?:\\?")?\s*:\s*(?:\\?")?$/

/** How much text to look back over for the key. Generous; keys are short. */
const LOOKBACK = 64

/**
 * Every occurrence of `hex` in `html`, attributed to the key it was assigned
 * to.
 *
 * An occurrence with no discoverable key is still counted. That is the whole
 * posture of this file: a hex we cannot explain is a hex we report.
 *
 * @param {string} html
 * @param {string} hex e.g. `#0090d9`
 * @returns {{ total: number, violations: number, exempt: number, byKey: Record<string, number>, exemptByKey: Record<string, number> }}
 */
export function findColourOccurrences(html, hex) {
  const needle = hex.toLowerCase()
  const haystack = String(html ?? '').toLowerCase()
  const byKey = {}
  const exemptByKey = {}
  let total = 0
  let violations = 0
  let exempt = 0

  let at = haystack.indexOf(needle)
  while (at !== -1) {
    // `#0090d9` must not match inside `#0090d9ff` or a longer token.
    const next = haystack[at + needle.length]
    if (!next || !/[0-9a-f]/.test(next)) {
      total += 1
      const prefix = html.slice(Math.max(0, at - LOOKBACK), at)
      const match = prefix.match(KEY_BEFORE_VALUE)
      const key = match ? match[1] : null
      if (key && PALETTE_SLOTS.has(key)) {
        exempt += 1
        exemptByKey[key] = (exemptByKey[key] ?? 0) + 1
      } else {
        violations += 1
        const label = key ?? '(unattributed)'
        byKey[label] = (byKey[label] ?? 0) + 1
      }
    }
    at = haystack.indexOf(needle, at + needle.length)
  }

  return { total, violations, exempt, byKey, exemptByKey }
}

/**
 * Run the whole retired set over one page.
 *
 * @param {string} html
 * @param {typeof RETIRED_COLOURS} [colours]
 * @returns {{ clean: boolean, findings: Array<{ hex: string, retiredBy: string, replacement: string, why: string } & ReturnType<typeof findColourOccurrences>> }}
 */
export function auditRenderedPage(html, colours = RETIRED_COLOURS) {
  const findings = colours.map((colour) => ({
    ...colour,
    ...findColourOccurrences(html, colour.hex),
  }))
  return {
    clean: findings.every((finding) => finding.violations === 0),
    findings,
  }
}

/** One-line summary of a finding, for the CLI report. */
export function describeFinding(finding) {
  const breakdown = Object.entries(finding.byKey)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key}×${count}`)
    .join(' ')
  const exemptNote = finding.exempt
    ? ` · ${finding.exempt} exempt (palette slot)`
    : ''
  return `${finding.hex} — ${finding.violations} authored${breakdown ? ` (${breakdown})` : ''}${exemptNote}`
}
