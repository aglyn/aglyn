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
 * undeclared OFF flag, on a run where no page assertion actually executed, and
 * on a run where no page was required to disclose anything.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  isReleaseFlagOn,
  parseReleaseFlagValue,
  RELEASE_FLAG_PLAN_LADDER,
  RELEASE_FLAGS,
  type ReleaseFlagKey,
} from '@aglyn/aglyn'
import {
  BETA_ADMONITION,
  FLAG_DOC_PAGES,
  FLAGS_WITHOUT_DOCS,
  OFF_BY_DEFAULT_FLAG_KEYS,
  PRICE_CLAIM_PATTERNS,
  PUBLISHED_ON_IN_PRODUCTION,
  ROLLING_OUT_ADMONITION,
  type FlagDocPage,
  type PublishedOnEvidence,
} from './docs-release-flags'

const DOCS_ROOT = join(__dirname, '../../..', 'apps/docs')

const isPublishedOn = (key: ReleaseFlagKey): boolean =>
  PUBLISHED_ON_IN_PRODUCTION[key] !== undefined

/**
 * Whether the docs must treat the feature as one the reader cannot open. The
 * registry default is only what an unreachable Remote Config falls back to,
 * so a flag production publishes ON counts as ON here however it defaults.
 */
const isOff = (key: ReleaseFlagKey): boolean =>
  OFF_BY_DEFAULT_FLAG_KEYS.includes(key) && !isPublishedOn(key)

/** The stage the registry declares, which only an ON flag can wear. */
const isBetaOn = (key: ReleaseFlagKey): boolean =>
  !isOff(key) &&
  RELEASE_FLAGS.find((flag) => flag.key === key)?.stage === 'beta'

/**
 * Whether `pattern` sits at the TOP of the page: before its first `##`
 * section, so a reader meets it before any of the content it qualifies.
 */
const opensWith = (source: string, pattern: RegExp): boolean => {
  const match = pattern.exec(source)
  if (!match) return false
  const firstSection = source.search(/^##\s/m)
  return firstSection < 0 || match.index < firstSection
}

const declaredEntries = Object.entries(FLAG_DOC_PAGES) as [
  ReleaseFlagKey,
  readonly FlagDocPage[],
][]

const publishedOnEntries = Object.entries(PUBLISHED_ON_IN_PRODUCTION) as [
  ReleaseFlagKey,
  PublishedOnEvidence,
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

/**
 * The subset of `contentAssertions` that REQUIRED a disclosure. The total
 * alone cannot see the disclosure half go vacuous: a registry whose every OFF
 * flag is declared published-ON still reads its pages, but only to find a
 * marker absent.
 */
let disclosureAssertions = 0

/**
 * The Beta notes this spec REQUIRED (AGL-4052): one per subject page of an
 * ON, beta-staged flag. Zero while such a flag exists means the Beta half
 * read nothing.
 */
let betaAssertions = 0

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
      // FLAGS_WITHOUT_DOCS, and "OFF" is satisfiable by declaring them all in
      // PUBLISHED_ON_IN_PRODUCTION. This is the half that notices either: a
      // published-ON flag's pages are held only to the absence of a marker.
      const offWithPages = OFF_BY_DEFAULT_FLAG_KEYS.filter(
        (key) => isOff(key) && (FLAG_DOC_PAGES[key]?.length ?? 0) > 0,
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

    it('declares published-ON only for registry flags that are OFF by default', () => {
      // A flag that defaults ON has no default to override, and an entry for
      // one would outlive the decision it records. An unknown key exempts
      // nothing, so it is a dead declaration that still reads as evidence.
      const known = new Map(RELEASE_FLAGS.map((flag) => [flag.key, flag]))
      for (const [key] of publishedOnEntries) {
        const flag = known.get(key)
        if (!flag) {
          throw new Error(
            `PUBLISHED_ON_IN_PRODUCTION names ${key}, which is not a release flag. Rename the entry to the flag's current key, or remove it.`,
          )
        }
        if (flag.defaultEnabled) {
          throw new Error(
            `PUBLISHED_ON_IN_PRODUCTION declares ${key}, which is already ON by default. The declaration exists only to override an OFF default; remove the entry.`,
          )
        }
      }
    })

    it('backs every published-ON declaration with evidence of a full release', () => {
      // The evidence has to be checkable, and the recorded value has to be one
      // the gate itself reads as ON for everyone. With no subject,
      // `isReleaseFlagOn` passes only a flag enabled outright, so a percentage
      // rollout fails here; walking every plan catches a tier list.
      for (const [key, evidence] of publishedOnEntries) {
        expect([key, evidence.templateVersion]).toEqual([
          key,
          expect.any(Number),
        ])
        expect([
          key,
          Number.isInteger(evidence.templateVersion) &&
            evidence.templateVersion > 0,
        ]).toEqual([key, true])
        expect([key, evidence.publishedAt]).toEqual([
          key,
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        ])
        const publishedAt = Date.parse(evidence.publishedAt)
        expect([
          key,
          Number.isFinite(publishedAt) && publishedAt <= Date.now(),
        ]).toEqual([key, true])
        expect([key, evidence.defaultStaysOff.trim().length > 0]).toEqual([
          key,
          true,
        ])
        expect([key, evidence.precondition.trim().length > 0]).toEqual([
          key,
          true,
        ])

        const value = parseReleaseFlagValue(evidence.publishedValue, false)
        const leftOut = [null, ...RELEASE_FLAG_PLAN_LADDER].filter(
          (plan) => !isReleaseFlagOn(key, value, null, plan),
        )
        if (leftOut.length > 0) {
          throw new Error(
            `PUBLISHED_ON_IN_PRODUCTION.${key} records ${
              evidence.publishedValue
            }, which the release gate does not turn on for every workspace (off for: ${leftOut
              .map((plan) => plan ?? 'no plan')
              .join(
                ', ',
              )}). A partial rollout still owes its pages the disclosure; remove the entry until production publishes the flag enabled outright.`,
          )
        }
      }
    })

    it('gives every ON, beta-staged flag a page that carries the Beta note', () => {
      // The Beta half's own anti-vacuity (AGL-4052): a staged flag with no
      // subject page would label the console and say nothing in the docs,
      // and this spec would have nothing to hold to the stage.
      const unpaged = RELEASE_FLAGS.filter(
        (flag) =>
          isBetaOn(flag.key) &&
          !(FLAG_DOC_PAGES[flag.key] ?? []).some(
            (page) => page.disclosure === 'admonition',
          ),
      ).map((flag) => flag.key)
      if (unpaged.length > 0) {
        throw new Error(
          `Release flags are ON and staged beta with no subject page in FLAG_DOC_PAGES: ${unpaged.join(
            ', ',
          )}. Declare the pages about each feature with disclosure 'admonition', and open them with :::note Beta.`,
        )
      }
    })

    it('puts the Beta note only on subject pages of ON, beta-staged flags', () => {
      // The sweep that keeps the label from appearing on a page nobody
      // declared, where no stage could ever take it down again.
      const allowed = new Set(
        declaredEntries
          .filter(([key]) => isBetaOn(key))
          .flatMap(([, pages]) =>
            pages
              .filter((page) => page.disclosure === 'admonition')
              .map((page) => page.path),
          ),
      )
      const stray = grepDocs(BETA_ADMONITION_GREP).filter(
        (path) => !allowed.has(path),
      )
      if (stray.length > 0) {
        throw new Error(
          `These pages carry :::note Beta but are not the subject page of an ON, beta-staged flag: ${stray.join(
            ', ',
          )}. Remove the note, or declare the page under its flag in FLAG_DOC_PAGES (disclosure 'admonition') once the flag is staged beta in release-flags.ts.`,
        )
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
            if (off) disclosureAssertions += 1
            const matched = pattern.test(source)
            if (off && !matched) {
              throw new Error(
                `${key} is OFF by default, but apps/docs/${page.path} does not disclose it: ${pattern} found no match. Readers are told a feature they cannot open is available. See docs/content-and-data/crm/sequences.md for the treatment.`,
              )
            }
            if (!off && matched) {
              // The stale-marker half. When a flag ships, its rolling-out
              // disclosures have to come down, or the guard rots into a
              // permanent pass and the docs understate a shipped feature.
              throw new Error(
                isPublishedOn(key)
                  ? `${key} is published ON in production (PUBLISHED_ON_IN_PRODUCTION in docs-release-flags.ts), but apps/docs/${page.path} still carries a rolling-out disclosure: ${pattern}. Its registry default stays OFF on purpose, which is not a rollout. Remove the disclosure.`
                  : `${key} is now ON, but apps/docs/${page.path} still carries a rolling-out disclosure: ${pattern}. Remove it (and its registry entry if the page no longer needs watching).`,
              )
            }
          }
        },
      )

      // The Beta half (AGL-4052), on the pages whose subject is the feature.
      // A windowed page is about many features and is never asked for it.
      const subjects = pages.filter((page) => page.disclosure === 'admonition')
      if (subjects.length > 0) {
        const beta = isBetaOn(key)
        it.each(subjects.map((page) => [page.path, page] as const))(
          beta
            ? `${'%s'} opens with the Beta note`
            : `${'%s'} carries no Beta note`,
          (_path, page) => {
            const source = readPage(page)
            contentAssertions += 1
            if (beta) {
              betaAssertions += 1
              if (!opensWith(source, BETA_ADMONITION)) {
                throw new Error(
                  `${key} is ON and staged beta in release-flags.ts, but apps/docs/${page.path} does not open with :::note Beta before its first section. Add the note under the page title; see docs/getting-started/aglyn-assist.md for the wording.`,
                )
              }
              return
            }
            if (BETA_ADMONITION.test(source)) {
              throw new Error(
                off
                  ? `${key} is OFF, but apps/docs/${page.path} carries :::note Beta. A feature the reader cannot open is rolling out, not in beta: replace the note with :::caution Rolling out.`
                  : `${key} has no stage in release-flags.ts, so it is generally available, but apps/docs/${page.path} still carries :::note Beta. Remove the note.`,
              )
            }
          },
        )
      }

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

    it('required the Beta note on a page whenever a flag is ON and staged beta', () => {
      // Runs last, like the two above. With nothing staged there is nothing
      // to require; with something staged, zero means the Beta half read no
      // page at all.
      const staged = RELEASE_FLAGS.some((flag) => isBetaOn(flag.key))
      expect(betaAssertions > 0).toBe(staged)
    })

    it('required a rolling-out disclosure on at least one page', () => {
      // The disclosure half on its own. Every page assertion can still run
      // with none of them requiring a marker — declare every OFF flag
      // published-ON and the total above stays positive.
      expect(disclosureAssertions).toBeGreaterThan(0)
    })
  })
})

/** {@link BETA_ADMONITION} in grep's extended syntax. */
const BETA_ADMONITION_GREP = '^:::note[[:space:]]+Beta[[:space:]]*$'

/**
 * Pages anywhere in the published docs tree matching an extended-regex
 * `pattern`, as paths relative to `apps/docs`. Unlike {@link grepDocsForLabel}
 * it skips nothing: a Beta note on a staff page is as stray as any other.
 */
function grepDocs(pattern: string): string[] {
  try {
    const out = execFileSync(
      'grep',
      [
        '-rlE',
        '--include=*.md',
        '--include=*.mdx',
        pattern,
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
      .filter((line) => line.length > 0)
  } catch {
    // grep exits 1 with no matches — that is the passing case.
    return []
  }
}

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
