#!/usr/bin/env node
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
 * Pre-commit guard: a docs edit may not be committed with stale registries
 * (AGL-2486).
 *
 * `apps/docs` is the source for four GENERATED files:
 *
 *   apps/console/constants/docs-help.generated.ts
 *   apps/console/constants/assist-docs-index.generated.ts
 *   libs/besigner/feature/designer/src/lib/utils/docs-help.generated.ts
 *   libs/aglyn/src/lib/app-utils/docs-help.generated.ts
 *
 * Both were already guarded — `generate:docs-help:check` in the gate, and
 * `apps/console/constants/docs-links.spec.ts` for the Assist index — but only
 * AFTER the push. main went red twice on 2026-08-22 because the failure
 * surfaced in the promotion gate, or in an unrelated agent's console test run
 * where it reads as their bug and costs them a round to diagnose. This moves
 * the same verdict to the commit that causes it. It does not replace or
 * weaken either post-hoc check.
 *
 * WHY THIS RUNS AGAINST THE INDEX AND NOT THE WORKING TREE
 *
 * The generators regenerate from ALL of apps/docs at once. In this shared
 * checkout several agents are mid-flight, so the working tree routinely holds
 * other people's uncommitted docs edits. A hook that ran the generator against
 * the working tree would compute output that includes THEIR pages, compare it
 * to the registries you correctly regenerated for YOUR page, and call your
 * commit stale. That false positive is how a hook earns `--no-verify`.
 *
 * So the check materialises `apps/docs` and the four outputs FROM THE INDEX
 * into a scratch tree and runs the generators there. Both generators resolve
 * their own root from `import.meta.url`, so copying them into the scratch tree
 * repoints them with no change to either generator.
 *
 * Two properties fall out of that:
 *
 *   - Other agents' uncommitted work is invisible to this check, because it is
 *     not in the index.
 *   - `git commit --only <paths>` is judged correctly. git builds a temporary
 *     index for a partial commit and exports it as GIT_INDEX_FILE; every git
 *     command below inherits it, so the verdict is about the commit actually
 *     being made rather than about anything else in the tree.
 *
 * It also cannot alter your tree: the generators only ever run with `--check`,
 * and even a write would land in the scratch directory. Nothing is staged for
 * you, by design — staging the regenerated output is the step that sweeps in
 * another agent's page, so it stays a human decision.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DOCS_DIR = 'apps/docs/docs'

const GENERATORS = [
  'tools/scripts/generate-docs-help.mjs',
  'tools/scripts/generate-assist-docs-index.mjs',
]

const OUTPUTS = [
  'apps/console/constants/docs-help.generated.ts',
  'apps/console/constants/assist-docs-index.generated.ts',
  'libs/besigner/feature/designer/src/lib/utils/docs-help.generated.ts',
  'libs/aglyn/src/lib/app-utils/docs-help.generated.ts',
]

const git = (args, options) =>
  execFileSync('git', args, { encoding: 'utf8', ...options })

const nulSeparated = (text) => text.split('\0').filter(Boolean)

// What this commit contains. Editing a generator's alias table changes the
// output with no docs edit at all, so the generators trigger the check too.
const staged = nulSeparated(
  git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD', '-z']),
)
const relevant = (path) =>
  path.startsWith(`${DOCS_DIR}/`) ||
  GENERATORS.includes(path) ||
  OUTPUTS.includes(path)

if (!staged.some(relevant)) process.exit(0)

const snapshot = mkdtempSync(join(tmpdir(), 'aglyn-docs-registries-'))
const failures = []
try {
  // `git ls-files` reads the index, so a staged deletion is already absent and
  // an unstaged working-tree edit is present only in its committed form.
  const indexed = git(['ls-files', '-z', '--', DOCS_DIR, ...GENERATORS, ...OUTPUTS])
  execFileSync(
    'git',
    ['checkout-index', `--prefix=${snapshot}/`, '-z', '--stdin'],
    { input: indexed },
  )

  for (const generator of GENERATORS) {
    try {
      execFileSync('node', [join(snapshot, generator), '--check'], {
        cwd: snapshot,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      })
    } catch (caught) {
      failures.push(
        `${caught.stdout ?? ''}${caught.stderr ?? ''}`.trim() ||
          `${generator} --check failed (${caught.message})`,
      )
    }
  }
} finally {
  rmSync(snapshot, { recursive: true, force: true })
}

if (failures.length === 0) process.exit(0)

const OUTPUT_LIST = OUTPUTS.join(' \\\n    ')

console.error(
  [
    '',
    'The generated docs registries do not match the apps/docs content in',
    'this commit.',
    '',
    failures.map((f) => f.replace(/^/gm, '  ')).join('\n\n'),
    '',
    'Two different mistakes produce this, and the fix differs:',
    '',
    '  1. You edited apps/docs and did not regenerate. Run both — the',
    '     second one is easy to forget and nothing else in your own',
    '     workflow will catch it:',
    '',
    '       node tools/scripts/generate-docs-help.mjs',
    '       node tools/scripts/generate-assist-docs-index.mjs',
    '',
    '  2. You DID regenerate, but another agent had an uncommitted docs',
    '     edit in this shared checkout at the time. The registries',
    '     regenerate from ALL of apps/docs, so their page was folded into',
    '     your output and you are about to commit their unreleased work.',
    '     Inspect what you are staging:',
    '',
    '       git diff -- ' + OUTPUT_LIST,
    '',
    '     and keep only the hunks your own docs change produced, or',
    '     regenerate in a clean worktree.',
    '',
    'assist-docs-index.generated.ts is the corpus Aglyn Assist retrieves',
    'from. A stale one makes the assistant answer from documentation that',
    'no longer describes the product.',
    '',
    'This check judged the COMMIT (git index), not your working tree, so',
    "another agent's uncommitted edit cannot cause a false failure here —",
    'but it can cause failure (2), which is a real problem in your commit.',
    '',
  ].join('\n'),
)
process.exit(1)
