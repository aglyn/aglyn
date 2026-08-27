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
 * A permission gate must HOLD while it is still loading — never grant.
 *
 * `billing-permission-gate-holds-while-loading.spec.tsx` drives one page by
 * rendering it. This file is the sweep: the same defect appears on four
 * surfaces, each written independently, and a behavioural spec per page only
 * ever covers the pages somebody thought to write one for.
 *
 * ## The shape
 *
 * `useOrgPermissions` fails OPEN while loading — `permissions` is
 * `allTrueWhileLoading()` and `can()` reads out of an `ALL_GRANTED` initial
 * state — so before `loaded` flips, every permission answers as an org owner's.
 * That is deliberate and documented (the server APIs are the enforcement
 * point, the hook only hides surfaces). It also means the loading window is
 * not neutral: it GRANTS. Two spellings turn that into a visible leak.
 *
 * **1. The refusal gated on the loading flag.**
 *
 * ```jsx
 * {permissionsLoaded && !can('billing.view') ? <Refusal/> : …privileged…}
 * ```
 *
 * The flag is in the REFUSAL branch, so while the read is in flight the
 * refusal is false and the else-branch paints. The refusal is not wrong — the
 * missing third state is. Such a file must also hold on `!permissionsLoaded`.
 *
 * **2. The opt-in fail-open.**
 *
 * ```jsx
 * ...(!permissionsLoaded || can('org.auditLog') ? [<AuditLog/>] : [])
 * ```
 *
 * The same thing said outright: render it BECAUSE we do not yet know. There is
 * no correct use of this in a render decision, so it is banned rather than
 * paired.
 *
 * ## Why source text, and what that costs
 *
 * A gate is one deleted ternary from being live again and the deletion reddens
 * nothing — the AGL-1864 observation, and the reason that page's hold got a
 * test. Rendering every gated console page here would be a far heavier file
 * that still only covers the pages it enumerates. Scanning the source covers
 * the ones nobody has written yet.
 *
 * The cost is honest: this proves the HOLD EXISTS in the file, not that it
 * guards the right subtree. The behavioural spec beside it proves that for
 * billing. Both are needed, and neither replaces the other.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/** Console source a browser renders. Excludes specs and build output. */
const SCAN_ROOTS = [
  'apps/console/app',
  'apps/console/components',
  'apps/console/hooks',
  'apps/console/utils',
]

/**
 * Every scanned file, as `[relativePath, source]`.
 *
 * `git ls-files` rather than a directory walk, so build output, `node_modules`
 * and any other agent's untracked scratch file can never enter the corpus and
 * turn this guard red for a reason that has nothing to do with it.
 */
function consoleSources(): Array<[string, string]> {
  const listed = execFileSync(
    'git',
    ['ls-files', '--', ...SCAN_ROOTS],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  return listed
    .split('\n')
    .filter((path) => /\.tsx?$/.test(path) && !/\.spec\./.test(path))
    .map((path) => [path, readFileSync(join(REPO_ROOT, path), 'utf8')])
}

/**
 * Source with block and line comments stripped.
 *
 * Load-bearing: the fixes for this defect all carry a docblock QUOTING the bad
 * spelling to explain what was wrong. Scanning raw text would flag the very
 * comments that record the fix — a guard that punishes documenting the bug it
 * guards against.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** `loaded && !can(…)` / `loaded && !permissions.x` — a refusal behind a flag. */
const REFUSAL_BEHIND_FLAG =
  /\b(\w*[Ll]oaded)\s*&&\s*!\s*(?:can\s*\(|permissions[.?[])/

/**
 * `!loaded || can(…)` — rendering BECAUSE the answer has not arrived.
 *
 * The right-hand side is what makes it a grant, and the reason this matcher
 * cannot simply be `!permissionsLoaded ||`. That bare form is also how a
 * correct HOLD is spelled — `!permissionsLoaded || !orgReady ? <Spinner/>`
 * combines two pending reads into one wait, and the fixed billing page says
 * exactly that. "Unknown OR permitted" grants; "unknown OR also unknown"
 * waits. Only the first is a defect.
 */
const OPT_IN_FAIL_OPEN =
  /!\s*(\w*[Pp]ermissions[Ll]oaded)\s*\|\|\s*(?:can\s*\(|permissions[.?[])/

describe('a permission gate holds before it grants', () => {
  const sources = consoleSources()

  it('scans a corpus that is actually populated', () => {
    // Without this, every assertion below passes on an empty list — the
    // `a_green_check_only_proves_what_it_reads` failure.
    expect(sources.length).toBeGreaterThan(100)
    expect(
      sources.some(([path]) => path.includes('billing/page.tsx')),
    ).toBe(true)
  })

  it('never renders a surface BECAUSE the permission read is pending', () => {
    const offenders = sources
      .filter(([, source]) => OPT_IN_FAIL_OPEN.test(stripComments(source)))
      .map(([path]) => path)
    // `...(!permissionsLoaded || can('org.auditLog') ? [<OrgActivityCard/>] : [])`
    // on the team page: the org audit log — actor names, actions, targets,
    // timestamps — rendered, and independently queried, for members who were
    // about to be refused it.
    expect(offenders).toEqual([])
  })

  it('pairs every flag-gated refusal with a hold on the same flag', () => {
    const offenders = sources
      .filter(([, source]) => {
        const code = stripComments(source)
        if (!REFUSAL_BEHIND_FLAG.test(code)) return false
        const flag = REFUSAL_BEHIND_FLAG.exec(code)?.[1]
        // The hold: the same flag, negated, deciding a render or an early
        // return somewhere in the file.
        return !new RegExp(`!\\s*${flag}\\b`).test(code)
      })
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})

describe('NEGATIVE CONTROLS: the matchers detect the shapes they ban', () => {
  // Without these, both assertions above are satisfied by regexes that match
  // nothing at all — and this guard's whole value is that it fires on code
  // nobody has written yet.
  it('flags a refusal behind a loading flag with no hold', () => {
    const code = `{permissionsLoaded && !can('billing.view') ? <Alert/> : <Ledger/>}`
    expect(REFUSAL_BEHIND_FLAG.test(code)).toBe(true)
    expect(/!\s*permissionsLoaded\b/.test(code)).toBe(false)
  })

  it('accepts the same refusal once a hold is added', () => {
    const code =
      `{permissionsLoaded && !can('billing.view') ? <Alert/>` +
      ` : !permissionsLoaded || !orgReady ? <Spinner/> : <Ledger/>}`
    expect(REFUSAL_BEHIND_FLAG.test(code)).toBe(true)
    expect(/!\s*permissionsLoaded\b/.test(code)).toBe(true)
  })

  it('flags the opt-in fail-open', () => {
    expect(
      OPT_IN_FAIL_OPEN.test(`...(!permissionsLoaded || can('org.auditLog')`),
    ).toBe(true)
  })

  it('does not flag the corrected spelling', () => {
    expect(
      OPT_IN_FAIL_OPEN.test(`...(permissionsLoaded && can('org.auditLog')`),
    ).toBe(false)
  })

  it('ignores a bad spelling that appears only in a comment', () => {
    // The fixes all quote the defect in their docblocks. A guard that reddens
    // on its own explanation would be uninstallable.
    const code = `// \`permissionsLoaded &&\`, never \`!permissionsLoaded ||\`.\nconst x = 1`
    expect(OPT_IN_FAIL_OPEN.test(stripComments(code))).toBe(false)
  })
})
