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

// The pure half of the test-wiring guard (AGL-2376, AGL-2377).
//
// Two failure shapes, one guard, because they are the same mistake seen from
// opposite ends:
//
//   1. A test file exists and NOTHING runs it. Five Firestore rules specs sat
//      in `cloud/` for weeks in exactly this state — 31 real assertions about
//      who can read a billing document, all of them passing, none of them ever
//      executed by any runner. One was edited the day before it was found.
//      `npm run test:rules` reported "157 tests, 157 pass" and that number
//      contained not one assertion from any of them.
//
//   2. A `test` TARGET exists and there is nothing for it to run. Five nx
//      library projects declare `@nx/jest:jest` targets over source trees with
//      no spec file at all, so `nx run <p>:test` exits 1 with "No tests found".
//      They had simply never been affected.
//
// ## Why this is not `passWithNoTests`
//
// The tempting fix for (2) is one line of config, and it is the wrong one.
// `passWithNoTests: true` turns "this project asserts nothing" from a red into
// a GREEN — indistinguishable, on any dashboard or in any gate summary, from a
// project with real coverage. It also removes the only signal that would fire
// if someone later deleted a project's last spec. That trade converts a loud
// problem into a silent one, which is the failure mode this whole audit was
// about, so this guard bans the flag outright.
//
// ## Why removing the target needs a guard of its own
//
// The other tempting fix is to delete the empty `test` target and move on.
// That is right — an empty target is a broken build step, not a signal — but on
// its own it creates the mirror-image trap: the day someone finally writes a
// spec in `libs/shared/util/dom`, there is no target to run it, and their test
// is dead on arrival with nothing to say so.
//
// So the exemption is two-way. A project named in UNTESTED_PROJECTS must have
// NO test target AND NO test files. Write a spec into one and this guard goes
// red telling you to put the target back; leave a target on an empty project
// and it goes red the other way. "Not covered" becomes a fact a human reads in
// a list, and it cannot rot in either direction.

/**
 * nx projects that ship with no test target and no tests, deliberately.
 *
 * This is a statement of what is NOT covered, not permission to add more —
 * every entry is a library whose source is imported by real code and whose
 * behaviour nothing asserts. Adding a fifth line is a decision someone should
 * have to argue for in review, which is the only reason this list is a list
 * rather than a rule. The count is asserted in the sibling test, so REMOVING
 * one (as AGL-2486 found `shared-util-dom` had been) is equally deliberate.
 *
 * @type {ReadonlyArray<{project: string, dir: string, why: string}>}
 */
export const UNTESTED_PROJECTS = [
  {
    project: 'shared-util-rest-api',
    dir: 'libs/shared/util/rest-api',
    why: 'Pages-router JSON/cookie/middleware helpers. Its only spec (csrf-app.spec.ts) was deleted by ecc2a7d1d (AGL-910) and never replaced.',
  },
  {
    project: 'shared-ui-next',
    dir: 'libs/shared/ui/next',
    why: 'Next-specific UI wrappers, imported by 69 files. Has never had a spec file in its history.',
  },
  {
    project: 'shared-svg-icons-svg-icons',
    dir: 'libs/shared/svg-icons/svg-icons',
    why: 'Generated icon components — no behaviour to assert beyond the generator.',
  },
  {
    project: 'shared-data-types',
    dir: 'libs/shared/data/types',
    why: 'Type-only declarations. `npm run typecheck` is the gate that means anything here.',
  },
]

/**
 * Decide the guard from already-read inputs, so the self-test can drive every
 * branch without a filesystem or an nx graph.
 *
 * @param {object} args
 * @param {string[]} args.standaloneTestFiles
 *   Repo-relative paths of every tracked test file that no jest `rootDir`
 *   covers — the `tools/` and `cloud/` suites whose only possible runner is an
 *   npm script or a shell script.
 * @param {string} args.runnerText
 *   Concatenated text of everything that can RUN one: the root package.json
 *   scripts block, `tools/scripts/*.sh`, and `.github/workflows/*.yml`.
 *   Deliberately excludes apps/ and libs/ — a source COMMENT naming a spec is
 *   exactly the false green this guard exists to catch, and one of the five
 *   orphans had precisely that (dataset-schema-dialog.component.tsx:169).
 * @param {Array<{project: string, dir: string, hasTestTarget: boolean, testFileCount: number, passWithNoTests: boolean}>} args.projects
 * @param {ReadonlyArray<{project: string, dir: string, why: string}>} [args.untested]
 * @returns {{ok: boolean, orphanFiles: string[], emptyTargets: string[], resurrected: string[], staleExemptions: string[], deadExemptions: string[], passWithNoTests: string[]}}
 */
export function evaluateTestWiring({
  standaloneTestFiles,
  runnerText,
  projects,
  untested = UNTESTED_PROJECTS,
}) {
  const orphanFiles = standaloneTestFiles
    .filter((file) => !hasRunner(runnerText, file))
    .sort()

  const exemptByName = new Map(untested.map((entry) => [entry.project, entry]))
  const byName = new Map(projects.map((entry) => [entry.project, entry]))

  // A `test` target over a tree with no test file: red on every run, for a
  // reason no failure message explains.
  const emptyTargets = projects
    .filter(
      (p) =>
        p.hasTestTarget &&
        p.testFileCount === 0 &&
        !exemptByName.has(p.project),
    )
    .map((p) => p.project)
    .sort()

  // The mirror image: a spec written into a project whose target was removed.
  // Nothing would run it, and nothing else would say so.
  const resurrected = untested
    .filter((entry) => (byName.get(entry.project)?.testFileCount ?? 0) > 0)
    .map((entry) => entry.project)
    .sort()

  // An exemption that no longer describes the project — the target came back,
  // so the list is now claiming coverage is absent when it is not.
  const staleExemptions = untested
    .filter((entry) => byName.get(entry.project)?.hasTestTarget === true)
    .map((entry) => entry.project)
    .sort()

  // An exemption naming a project that no longer exists. Dead entries are how
  // a list like this quietly stops describing the repo.
  const deadExemptions = untested
    .filter((entry) => !byName.has(entry.project))
    .map((entry) => entry.project)
    .sort()

  const passWithNoTests = projects
    .filter((p) => p.passWithNoTests)
    .map((p) => p.project)
    .sort()

  return {
    ok:
      orphanFiles.length === 0 &&
      emptyTargets.length === 0 &&
      resurrected.length === 0 &&
      staleExemptions.length === 0 &&
      deadExemptions.length === 0 &&
      passWithNoTests.length === 0,
    orphanFiles,
    emptyTargets,
    resurrected,
    staleExemptions,
    deadExemptions,
    passWithNoTests,
  }
}

/**
 * True when `runnerText` actually names `file` in a way that would execute it.
 *
 * Matches the full repo-relative path OR the bare basename, because
 * `test-rules.sh` cd's into `cloud/` and names its suites relatively. The
 * basename is specific enough in practice — these are names like
 * `rules-org-billing.spec.mjs` — and the alternative, insisting on the full
 * path, would reject the runner spelling the repo already uses.
 */
export function hasRunner(runnerText, file) {
  const base = file.slice(file.lastIndexOf('/') + 1)
  return runnerText.includes(file) || runnerText.includes(base)
}

/**
 * Render the failure the CLI prints. Pinned by the self-test: a guard that
 * fails without saying what to do about it gets worked around rather than
 * fixed, and each of these six shapes has a genuinely different remedy.
 */
export function formatFailure(result, untested = UNTESTED_PROJECTS) {
  const lines = []
  const why = new Map(untested.map((e) => [e.project, e.why]))

  if (result.orphanFiles.length > 0) {
    lines.push(
      `${result.orphanFiles.length} test file(s) exist that NO runner executes:`,
      '',
      ...result.orphanFiles.map((f) => `  ${f}`),
      '',
      'No jest rootDir covers tools/ or cloud/, so an npm script or a shell',
      'runner is the ONLY thing that can run these. Add one — or delete the',
      'file. A committed, maintained, never-executed test is worse than no',
      'test: it reads as coverage in every review (AGL-2376).',
    )
  }

  if (result.emptyTargets.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      `${result.emptyTargets.length} project(s) declare a \`test\` target with no test file:`,
      '',
      ...result.emptyTargets.map((p) => `  ${p}`),
      '',
      '`nx run <project>:test` exits 1 with "No tests found" — red on every',
      'run, for a reason the failure message does not explain. Write a spec,',
      'or remove the target AND add the project to UNTESTED_PROJECTS in',
      'tools/scripts/lib/test-wiring.mjs with a reason.',
      '',
      'Do NOT reach for `passWithNoTests` — see the note in that file.',
    )
  }

  if (result.resurrected.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      `${result.resurrected.length} project(s) are listed as untested but now HAVE tests:`,
      '',
      ...result.resurrected.map((p) => `  ${p}  (${why.get(p) ?? ''})`),
      '',
      'Somebody wrote a spec into a project with no `test` target, so nothing',
      'runs it. Restore the target in its project.json and drop the entry from',
      'UNTESTED_PROJECTS. This is the half of the exemption that stops the',
      'list from becoming a place where tests go to die.',
    )
  }

  if (result.staleExemptions.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      `${result.staleExemptions.length} exemption(s) name a project that has a \`test\` target again:`,
      '',
      ...result.staleExemptions.map((p) => `  ${p}`),
      '',
      'The list is claiming an absence of coverage that is no longer true.',
      'Remove the entry from UNTESTED_PROJECTS.',
    )
  }

  if (result.deadExemptions.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      `${result.deadExemptions.length} exemption(s) name a project that does not exist:`,
      '',
      ...result.deadExemptions.map((p) => `  ${p}`),
      '',
      'Renamed or deleted. Drop the entry — a dead exemption is how a list',
      'like this quietly stops describing the repo.',
    )
  }

  if (result.passWithNoTests.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(
      `${result.passWithNoTests.length} project(s) set \`passWithNoTests\`:`,
      '',
      ...result.passWithNoTests.map((p) => `  ${p}`),
      '',
      'That flag makes a project with zero tests report GREEN, which is',
      'indistinguishable from real coverage and silently survives someone',
      'deleting the last spec. If the project has tests the flag does nothing;',
      'if it has none, say so in UNTESTED_PROJECTS instead. Remove it.',
    )
  }

  return lines.join('\n')
}
