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

// Extraction + evaluation for `check-runbook-commands.mjs` (AGL-1533).
//
// ## THE DEFECT THIS ANSWERS
//
// `LAUNCH_DAY_RUNBOOK.md` is executed once, by one person, on a morning with
// no slack in it. It tells that person to run named scripts. Nothing has ever
// checked that those scripts are at the paths the document names.
//
// The 2026-08-24 pass found exactly that: the runbook's own companion prose
// cited `tools/scripts/verify-production-aliases.mjs`, and the file is at
// `tools/deploy/verify-production-aliases.mjs`. A `node <path>` on a wrong
// path is not a soft failure — it is `Cannot find module`, at 6am, on the step
// that verifies a production alias before tagging.
//
// This is a STALENESS check, not a correctness one. It cannot tell you a
// command does the right thing; it tells you the command can be typed. That is
// the failure mode this document actually has — it has now gone stale, in the
// document's own accounting, in four consecutive audit passes.
//
// ## WHAT COUNTS AS A REFERENCE
//
// Repo-relative paths under a known top-level directory, with a file
// extension, and `npm run <target>` invocations. Both forms are what the
// runbook actually uses; a bare prose mention of a filename is deliberately
// NOT matched, because the document names files it does not tell you to run.
//
// Glob segments (`deploy-*-rules.mjs`) are honoured and require at least one
// match — the runbook uses one, and resolving it to zero files is the same
// defect as a missing path.

/** Top-level directories a runbook path may start with. */
export const REPO_ROOTS = ['tools', 'apps', 'libs', 'cloud', 'docs']

/**
 * Paths matched by the extractor but deliberately not required to exist.
 *
 * Keep this list empty unless there is a real reason. An entry here is a
 * standing exemption from the only check that reads this document, so it must
 * say WHY, not merely that it was inconvenient.
 */
export const EXEMPT_PATHS = new Set([])

const PATH_RE = new RegExp(
  `\\b((?:${REPO_ROOTS.join('|')})\\/[A-Za-z0-9._*/-]*[A-Za-z0-9._*-])`,
  'g',
)

const NPM_RUN_RE = /npm run ([a-z0-9][a-z0-9:_-]*)/g

/** A path reference is only a runnable reference if it names a file. */
const HAS_EXTENSION = /\.[A-Za-z0-9]+$/

/**
 * Pull every repo-relative path the runbook names.
 *
 * Trailing markdown punctuation (backticks, commas, closing parens, periods
 * that end a sentence) is stripped. A period is ambiguous — `foo.mjs.` — so it
 * is only stripped when what remains still has an extension.
 */
export function extractPaths(text) {
  const found = new Map()
  for (const match of text.matchAll(PATH_RE)) {
    let ref = match[1]
    // Strip a sentence-ending period when the result still names a file.
    while (ref.endsWith('.') && HAS_EXTENSION.test(ref.slice(0, -1))) {
      ref = ref.slice(0, -1)
    }
    if (!HAS_EXTENSION.test(ref)) continue
    if (EXEMPT_PATHS.has(ref)) continue
    if (!found.has(ref)) found.set(ref, [])
    found.get(ref).push(lineOf(text, match.index))
  }
  return [...found.entries()].map(([ref, lines]) => ({ ref, lines }))
}

/** Pull every `npm run <target>` the runbook tells you to type. */
export function extractNpmTargets(text) {
  const found = new Map()
  for (const match of text.matchAll(NPM_RUN_RE)) {
    const ref = match[1]
    if (!found.has(ref)) found.set(ref, [])
    found.get(ref).push(lineOf(text, match.index))
  }
  return [...found.entries()].map(([ref, lines]) => ({ ref, lines }))
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * Evaluate extracted references against the repo.
 *
 * `resolve` is injected rather than reaching for `fs` directly so the unit
 * tests can drive both directions without touching the working tree — a check
 * whose red path has never run is not a check.
 *
 * @param {string} text            the runbook markdown
 * @param {object} deps
 * @param {(ref: string) => number} deps.resolve  match count for a path (glob-aware)
 * @param {Set<string>} deps.scripts              package.json script names
 */
export function evaluateRunbookCommands(text, { resolve, scripts }) {
  const paths = extractPaths(text).map((p) => ({
    ...p,
    kind: 'path',
    matches: resolve(p.ref),
  }))
  const npmTargets = extractNpmTargets(text).map((t) => ({
    ...t,
    kind: 'npm',
    matches: scripts.has(t.ref) ? 1 : 0,
  }))

  const checked = [...paths, ...npmTargets]
  const findings = checked.filter((c) => c.matches === 0)

  return { checked, findings }
}

export function formatFinding(finding) {
  const where = `line ${finding.lines.join(', ')}`
  return finding.kind === 'npm'
    ? `  npm run ${finding.ref}  (${where}) — no such script in package.json`
    : `  ${finding.ref}  (${where}) — no such file in the repo`
}
