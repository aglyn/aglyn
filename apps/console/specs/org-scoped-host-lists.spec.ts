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
 * A site list never widens to every org while the workspace resolves
 * (AGL-2350).
 *
 * `useOrgHosts` documents a three-valued scope argument, and the three values
 * are genuinely different:
 *
 *  - an org id — that workspace's sites;
 *  - `undefined` — *hold off*, the workspace is still resolving;
 *  - `null` — an account with **no org at all**, so list every site the
 *    person holds.
 *
 * Collapsing the middle case into the last one is silent and it is not
 * cosmetic. Aglyn's own agency guide tells an agency to run **one workspace
 * per client**, so "every site the person holds" is every client's site. Two
 * call sites did exactly that — `orgId || null` and `currentOrg?.$id ?? null`
 * — and for the width of the cold-load window they listed one client's site
 * names on another client's page. The team page's list is worse than a
 * flash: it feeds the per-site access picker, so a cross-org row is a site a
 * member could be granted by mistake.
 *
 * ## The rule this pins, and why it is not "never pass null"
 *
 * Five call sites already had it right, with the same shape:
 * `loading ? undefined : (currentOrg?.$id ?? null)`. The `null` is reachable
 * there only AFTER resolution has settled, which is the case it is for. So
 * the rule is not that `null` is forbidden — it is that **`null` must sit
 * behind a loading gate**. That is what separates the five correct sites from
 * the two broken ones, and it is mechanical.
 *
 * Parsed rather than grepped: the argument is what matters, and a regex over
 * a multi-line call would have to guess where argument three ends.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import ts from 'typescript'

const REPO_ROOT = join(__dirname, '../../..')
const CONSOLE_ROOT = join(REPO_ROOT, 'apps/console')

const SOURCE = /\.tsx?$/
const IS_SPEC = /\.(?:spec|test)\.tsx?$/
/** The hook's own module names it constantly; it is the definition, not a call. */
const HOOK_MODULE = 'apps/console/hooks/use-org-hosts.ts'

interface Call {
  file: string
  line: number
  scopeArgument: string
}

function sourceFilesUnder(absolute: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue
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

/** Every `useOrgHosts(...)` call, with the text of its third argument. */
function callsIn(path: string): Call[] {
  const source = readFileSync(path, 'utf8')
  if (!source.includes('useOrgHosts(')) return []
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: Call[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useOrgHosts'
    ) {
      const third = node.arguments[2]
      found.push({
        file: relative(REPO_ROOT, path).split('\\').join('/'),
        line:
          file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        // No third argument at all is `undefined`, which is the safe value.
        scopeArgument: third ? third.getText(file) : 'undefined',
      })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return found
}

const CALLS = sourceFilesUnder(CONSOLE_ROOT)
  .flatMap(callsIn)
  .filter((call) => call.file !== HOOK_MODULE)

/** `null` is only legitimate once resolution has settled. */
const mentionsNull = (text: string) => /\bnull\b/.test(text)
const hasLoadingGate = (text: string) => /loading/i.test(text)

describe('an org-scoped site list holds off instead of widening', () => {
  it('finds the call sites at all', () => {
    // The premise. A walker that found nothing would classify nothing and
    // pass every assertion below it.
    expect(CALLS.length).toBeGreaterThanOrEqual(8)
    expect(
      CALLS.some((call) => call.file.endsWith('[orgSlug]/hosts/page.tsx')),
    ).toBe(true)
  })

  it('never passes null without a loading gate', () => {
    const offenders = CALLS.filter(
      (call) =>
        mentionsNull(call.scopeArgument) && !hasLoadingGate(call.scopeArgument),
    ).map((call) => `${call.file}:${call.line} — ${call.scopeArgument}`)

    expect(offenders).toEqual([])
  })

  it('classifies both shapes correctly', () => {
    // Negative control for the two predicates, using the exact texts that
    // were live in the repo: the broken pair and the correct idiom.
    expect(mentionsNull('orgId || null')).toBe(true)
    expect(hasLoadingGate('orgId || null')).toBe(false)
    expect(mentionsNull('currentOrg?.$id ?? null')).toBe(true)

    expect(
      hasLoadingGate('orgsLoading ? undefined : (currentOrg?.$id ?? null)'),
    ).toBe(true)
    // `nullish` must not read as `null`; the word boundary is load-bearing.
    expect(mentionsNull('orgId ?? undefined')).toBe(false)
  })

  /**
   * The switcher is the same defect through a different hook. A `where`
   * filter built from an unresolved id becomes `undefined`, which does not
   * narrow the query — it drops the filter and returns the collection
   * unscoped, which for `users/{uid}/hostMemberships` is every org.
   */
  it('the site switcher holds off until the workspace is known', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'apps/console/components/host-switcher-nav.component.tsx'),
      'utf8',
    )
    expect(source).toContain("where: orgId ? ['orgId', '==', orgId] : undefined")
    expect(source).toContain('skip: !orgId')
  })
})
