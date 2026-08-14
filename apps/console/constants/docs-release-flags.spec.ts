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
 * AGL-1605 — fail the build when `apps/docs` documents a release-flagged-OFF
 * feature as available. The prose twin of the screenshot guard AGL-1600 built.
 *
 * Structure mirrors that guard's lesson: a check that can only ever report
 * "nothing is wrong" says exactly that once its marker moves, so the
 * anti-vacuity block below fails on an empty registry, on a stale path, on an
 * undeclared OFF flag, and on a run where no page assertion actually executed.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { RELEASE_FLAGS, type ReleaseFlagKey } from '@aglyn/aglyn'
import {
  FLAG_DOC_PAGES,
  FLAGS_WITHOUT_DOCS,
  OFF_BY_DEFAULT_FLAG_KEYS,
  PRICE_CLAIM_PATTERNS,
  ROLLING_OUT_ADMONITION,
  type FlagDocPage,
} from './docs-release-flags'

const DOCS_ROOT = join(__dirname, '../../..', 'apps/docs')

const isOff = (key: ReleaseFlagKey): boolean =>
  OFF_BY_DEFAULT_FLAG_KEYS.includes(key)

const declaredEntries = Object.entries(FLAG_DOC_PAGES) as [
  ReleaseFlagKey,
  readonly FlagDocPage[],
][]

/**
 * `describe.each([])` is a suite-level THROW in jest, which fails the build
 * with "called with an empty Array of table data" and — the part that matters —
 * prevents the anti-vacuity block below from running at all. An emptied
 * registry has to fail with the reason, not with jest plumbing, so the per-flag
 * suites are only declared when there is something to declare and the empty
 * case is caught by an assertion that says so.
 */
const populatedEntries = declaredEntries.filter(
  ([, pages]) => Array.isArray(pages) && pages.length > 0,
)

const readPage = (page: FlagDocPage): string =>
  readFileSync(join(DOCS_ROOT, page.path), 'utf8')

/**
 * Counts every assertion this spec actually performed against page CONTENT.
 * A registry that shrinks to nothing, or whose flags all quietly flip on,
 * drives this to zero — and a guard that checked nothing must not report a
 * pass. Asserted at the bottom of the file, after the per-page suites have run.
 */
let contentAssertions = 0

describe('docs release-flag registry (AGL-1605)', () => {
  describe('anti-vacuity', () => {
    it('declares every OFF-by-default flag, in exactly one of the two maps', () => {
      // The assertion that makes a NEW flagged feature with new docs fail
      // rather than pass silently. Deleting the registry fails here first.
      expect(OFF_BY_DEFAULT_FLAG_KEYS.length).toBeGreaterThan(0)
      const undeclared: string[] = []
      const doubleDeclared: string[] = []
      for (const key of OFF_BY_DEFAULT_FLAG_KEYS) {
        const pages = FLAG_DOC_PAGES[key]
        const excused = FLAGS_WITHOUT_DOCS[key]
        const hasPages = Array.isArray(pages) && pages.length > 0
        if (hasPages && excused) doubleDeclared.push(key)
        if (!hasPages && !excused) undeclared.push(key)
      }
      if (undeclared.length > 0) {
        throw new Error(
          `Release flags are OFF by default with no docs declaration: ${undeclared.join(
            ', ',
          )}. Add the pages that document each one to FLAG_DOC_PAGES in docs-release-flags.ts, or record why it has no docs in FLAGS_WITHOUT_DOCS. An undeclared flag is how AGL-1601 reached production.`,
        )
      }
      expect(doubleDeclared).toEqual([])
    })

    it('has at least one OFF flag with real pages to check', () => {
      // "Every OFF flag is declared" is satisfiable by moving them all into
      // FLAGS_WITHOUT_DOCS. This is the half that notices.
      const offWithPages = OFF_BY_DEFAULT_FLAG_KEYS.filter(
        (key) => (FLAG_DOC_PAGES[key]?.length ?? 0) > 0,
      )
      expect(offWithPages.length).toBeGreaterThan(0)
    })

    it('points every declared path at a page that exists on disk', () => {
      // The stale-path trap: after a rename, a guard over a missing file
      // passes forever. Same assertion docs-links.spec.ts makes for topics.
      let checked = 0
      for (const [key, pages] of declaredEntries) {
        for (const page of pages) {
          checked += 1
          if (!existsSync(join(DOCS_ROOT, page.path))) {
            throw new Error(
              `FLAG_DOC_PAGES.${key} declares apps/docs/${page.path}, which does not exist. A renamed page silently disables this guard — update the path.`,
            )
          }
        }
      }
      expect(checked).toBeGreaterThan(0)
    })

    it('names only real release-flag keys', () => {
      const known = new Set(RELEASE_FLAGS.map((flag) => flag.key))
      for (const key of [
        ...Object.keys(FLAG_DOC_PAGES),
        ...Object.keys(FLAGS_WITHOUT_DOCS),
      ]) {
        expect(known.has(key as ReleaseFlagKey)).toBe(true)
      }
    })

    it('declares each page at most once per flag', () => {
      for (const [key, pages] of declaredEntries) {
        const paths = pages.map((page) => page.path)
        expect(`${key}: ${paths.length}`).toBe(`${key}: ${new Set(paths).size}`)
      }
    })

    it('justifies every price-claim exemption', () => {
      for (const [key, pages] of declaredEntries) {
        for (const page of pages) {
          if (page.checkNoPriceClaim) continue
          if (!page.priceClaimNote?.trim()) {
            throw new Error(
              `FLAG_DOC_PAGES.${key} exempts ${page.path} from the price-claim check with no priceClaimNote. An undocumented exemption is indistinguishable from a defanged guard.`,
            )
          }
        }
      }
    })

    it('keeps the FLAGS_WITHOUT_DOCS excuse honest', () => {
      // A flag excused as undocumented must really be undocumented. The flag
      // LABEL is the cheapest reliable probe: staff-console/ names every flag
      // by design, so it is excluded.
      for (const key of Object.keys(FLAGS_WITHOUT_DOCS) as ReleaseFlagKey[]) {
        const reason = FLAGS_WITHOUT_DOCS[key]
        expect(reason?.trim().length ?? 0).toBeGreaterThan(0)
        const label = RELEASE_FLAGS.find((flag) => flag.key === key)?.label
        expect(typeof label).toBe('string')
        const hits = grepDocsForLabel(label as string)
        if (hits.length > 0) {
          throw new Error(
            `${key} is listed in FLAGS_WITHOUT_DOCS, but its label "${label}" appears in published docs: ${hits.join(
              ', ',
            )}. Move it to FLAG_DOC_PAGES.`,
          )
        }
      }
    })
  })

  // Declared conditionally, not with an empty table: see populatedEntries.
  if (populatedEntries.length > 0)
    describe.each(populatedEntries)('%s', (key, pages) => {
      const off = isOff(key)

      it.each(pages.map((page) => [page.path, page] as const))(
        `${'%s'} discloses the rollout correctly`,
        (_path, page) => {
          const source = readPage(page)
          const patterns: RegExp[] =
            page.disclosure === 'admonition'
              ? [ROLLING_OUT_ADMONITION]
              : [...page.disclosure]
          expect(patterns.length).toBeGreaterThan(0)

          for (const pattern of patterns) {
            contentAssertions += 1
            const matched = pattern.test(source)
            if (off && !matched) {
              throw new Error(
                `${key} is OFF by default, but apps/docs/${page.path} does not disclose it: ${pattern} found no match. Readers are told a feature they cannot open is available. See docs/building-sites/besigner/edit-from-the-live-site.md for the treatment.`,
              )
            }
            if (!off && matched) {
              // The stale-marker half. When a flag ships, its rolling-out
              // disclosures have to come down, or the guard rots into a
              // permanent pass and the docs understate a shipped feature.
              throw new Error(
                `${key} is now ON, but apps/docs/${page.path} still carries a rolling-out disclosure: ${pattern}. Remove it (and its registry entry if the page no longer needs watching).`,
              )
            }
          }
        },
      )

      if (off) {
        const priced = pages.filter((page) => page.checkNoPriceClaim)
        if (priced.length > 0) {
          it.each(priced.map((page) => [page.path, page] as const))(
            `${'%s'} makes no plan or price claim`,
            (_path, page) => {
              const source = readPage(page)
              for (const { name, pattern } of PRICE_CLAIM_PATTERNS) {
                contentAssertions += 1
                if (pattern.test(source)) {
                  throw new Error(
                    `apps/docs/${page.path} documents ${key} (OFF by default) and carries ${name}. Pricing a feature a prospect cannot open is the AGL-1601 defect.`,
                  )
                }
              }
            },
          )
        }
      }
    })

  describe('the guard did something', () => {
    it('performed at least one assertion against page content', () => {
      // Runs last (jest executes describes in declaration order), so the
      // per-page suites above have already incremented the counter. Zero here
      // means every page assertion was skipped — the shape of pass this guard
      // exists to make impossible.
      expect(contentAssertions).toBeGreaterThan(0)
    })
  })
})

/**
 * Case-sensitive search for a flag label across the published docs tree,
 * skipping `docs/staff-console/` (the staff Feature Flags page names every
 * flag, which is correct) and build/test output.
 */
function grepDocsForLabel(label: string): string[] {
  try {
    const out = execFileSync(
      'grep',
      [
        '-rl',
        '--include=*.md',
        '--include=*.mdx',
        '--include=*.json',
        label,
        'docs',
        'api',
        'learn',
        'help',
        'src/pages',
      ],
      { cwd: DOCS_ROOT, encoding: 'utf8' },
    )
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) => line.length > 0 && !line.startsWith('docs/staff-console/'),
      )
  } catch {
    // grep exits 1 with no matches — that is the passing case.
    return []
  }
}
