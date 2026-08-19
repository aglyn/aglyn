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
 * No org-scoped route reads the DEPLOYMENT brand (AGL-2350 §2).
 *
 * ## The leak the brand ratchet blesses
 *
 * `check:brand-literals` fails a hardcoded `"Aglyn"` and passes
 * `PLATFORM_BRAND_NAME`. That is right almost everywhere and exactly wrong
 * under `[orgSlug]/**`, because the constant is
 * `NEXT_PUBLIC_PLATFORM_BRAND_NAME` — a **deployment** value, defaulting to
 * `Aglyn`. On Aglyn's own cloud it resolves to `"Aglyn"` for *every* org,
 * white-label included. It solves self-hosting and does nothing for
 * white-label.
 *
 * So a sweep that replaces a literal with the constant on an org-scoped page
 * turns a RED into a GREEN while the white-label customer still reads our
 * name. The ratchet cannot tell the two apart — the fix and the non-fix are
 * the same token to it. That is a false green, and it is the direction nobody
 * checks.
 *
 * `[orgSlug]` in the path means the URL names an org, which is precisely the
 * condition under which `useBranding()` returns that org's resolved profile
 * rather than the platform one. So the rule is mechanical and the fix is
 * single: `useBranding().branding.productName`.
 *
 * ## Read as source, and parsed rather than grepped
 *
 * These are `'use client'` pages wired to Firestore, MUI and Next's router;
 * importing them into a node-environment spec buys a mocking exercise for a
 * question answerable from the tree. Same shape as
 * `api-scope-picker-coverage.spec.ts`.
 *
 * The parser is not decoration. Two guards in this repo have already been
 * silently blinded by hand-rolled comment stripping — AGL-2278 (a regex
 * literal desynchronised the brand detector) and AGL-2354 (one ordinary regex
 * blanked every colour after it). A `ts.SourceFile` knows what a comment, a
 * string and a regex are, so a mention of `PLATFORM_BRAND_NAME` in a docblock
 * — like the one you are reading — is structurally not an identifier and
 * cannot be miscounted.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import ts from 'typescript'

const REPO_ROOT = join(__dirname, '../../..')

/**
 * Both route groups whose URL names an org. `(app)` is the console proper,
 * `(editor)` is the besigner shell — a white-label agency's staff live in
 * that one all day.
 */
const ORG_ROUTE_ROOTS = [
  'apps/console/app/(app)/[orgSlug]',
  'apps/console/app/(editor)/[orgSlug]',
]

const SOURCE = /\.tsx?$/
const IS_SPEC = /\.(?:spec|test)\.tsx?$/

const BRAND_CONSTANT = 'PLATFORM_BRAND_NAME'

/**
 * Surfaces under an org route that legitimately name the PLATFORM.
 *
 * A row here must state why the org's own brand would be the wrong answer —
 * "it renders where no org can be resolved" is the only shape that qualifies,
 * and the staleness test below deletes any row that stops being true.
 */
const PLATFORM_SCOPED: { file: string; why: string }[] = [
  {
    file: 'apps/console/app/(app)/[orgSlug]/marketplace/[listingId]/listing-social-card.ts',
    why:
      'The OG `siteName` for a marketplace listing. The marketplace is one ' +
      'platform-wide catalog, not the org’s product, and this metadata is ' +
      'generated for an UNAUTHENTICATED crawler — there is no session to ' +
      'resolve an org from, and no React hook available in a server ' +
      '`generateMetadata`. AGL-2319 moved this to the platform brand on ' +
      'purpose.',
  },
]

/** Every `.ts`/`.tsx` file under a root, excluding specs. */
function sourceFilesUnder(root: string): string[] {
  const absolute = join(REPO_ROOT, root)
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!SOURCE.test(entry) || IS_SPEC.test(entry)) continue
      out.push(path)
    }
  }
  walk(absolute)
  return out
}

/** Lines on which `PLATFORM_BRAND_NAME` appears as a real identifier. */
function brandConstantLines(path: string): number[] {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const lines: number[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === BRAND_CONSTANT) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return lines
}

const CORPUS = ORG_ROUTE_ROOTS.flatMap(sourceFilesUnder)

const OFFENDERS = CORPUS.map((path) => ({
  path,
  relative: relative(REPO_ROOT, path).split('\\').join('/'),
  lines: brandConstantLines(path),
})).filter((entry) => entry.lines.length > 0)

const EXEMPT = new Set(PLATFORM_SCOPED.map((row) => row.file))

describe('org-scoped routes resolve the ORG brand, not the deployment brand', () => {
  /**
   * The premise, asserted before the rule.
   *
   * A source-scanning guard that finds nothing passes every assertion below
   * it, so a renamed route group or a broken walker would read as compliance.
   * `plugin-page-title.spec.ts` was caught by exactly this floor after its
   * first draft discovered 0 pages and passed three of its four tests.
   */
  it('actually walks the org route trees', () => {
    expect(CORPUS.length).toBeGreaterThan(50)
    expect(
      CORPUS.some((p) => p.endsWith('[orgSlug]/hosts/page.tsx')),
    ).toBe(true)
  })

  it('can see the constant it is looking for', () => {
    // A negative control for the parser itself: if `brandConstantLines` were
    // broken, every file would come back clean and the rule below would pass
    // vacuously. The one exempt file is a live positive.
    const exemptHits = PLATFORM_SCOPED.map(
      (row) => brandConstantLines(join(REPO_ROOT, row.file)).length,
    )
    expect(exemptHits.every((n) => n > 0)).toBe(true)
  })

  it('reads a docblock mention as prose, not as an identifier', () => {
    // The AGL-2278 / AGL-2354 failure class, pinned: a hand-rolled stripper
    // counts these; the parser must not.
    const prose = [
      `/** ${BRAND_CONSTANT} in a comment. */`,
      `const s = '${BRAND_CONSTANT} in a string'`,
      `const r = /${BRAND_CONSTANT}/`,
      'export const ok = 1',
    ].join('\n')
    const file = ts.createSourceFile(
      'prose.ts',
      prose,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    )
    const hits: string[] = []
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === BRAND_CONSTANT)
        hits.push(node.text)
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(file, visit)
    expect(hits).toEqual([])
  })

  it('has no undocumented platform-brand read under [orgSlug]', () => {
    const undocumented = OFFENDERS.filter(
      (entry) => !EXEMPT.has(entry.relative),
    ).map((entry) => `${entry.relative}:${entry.lines.join(',')}`)

    expect(undocumented).toEqual([])
  })

  it('carries no stale exemption', () => {
    // An exemption that no longer reads the constant teaches the next reader
    // that adding one is free. AGL-2184 shipped the same staleness check
    // beside its title-exception table for the same reason.
    const stale = PLATFORM_SCOPED.filter(
      (row) => brandConstantLines(join(REPO_ROOT, row.file)).length === 0,
    ).map((row) => row.file)

    expect(stale).toEqual([])
  })

  it('states a reason for every exemption', () => {
    for (const row of PLATFORM_SCOPED) {
      expect(row.why.length).toBeGreaterThan(40)
    }
  })
})
