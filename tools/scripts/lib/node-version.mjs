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

// The pure half of `check-node-version.mjs` (AGL-2531). No filesystem, no
// git — so the rule can be tested without a workflow tree.

/**
 * The one runtime the repo's own toolchain runs on lives in `.nvmrc`.
 *
 * Not in `engines`, because `engines` states a RANGE a consumer must satisfy
 * and CI has to pick exactly one; not in each workflow, because that is the
 * arrangement this guard exists to end. `.nvmrc` is the file `setup-node`,
 * `nvm`, `fnm` and Volta all already read, so one line configures every
 * developer's shell and every CI job at once.
 */
export const NODE_VERSION_FILE = '.nvmrc'

/**
 * Deploy targets that pin their OWN runtime, and are not drift.
 *
 * `cloud/functions` is a separate npm package deployed to GCP Cloud Functions,
 * which offers a fixed menu of runtimes — the pin there states what Google
 * will execute, not what this repo builds with, and moving it is a deploy
 * decision gated on GCP support rather than a version bump. Listed by path so
 * a SECOND such package is a deliberate addition rather than a silent one.
 */
export const RUNTIME_PINNED_PACKAGES = ['cloud/functions']

/**
 * `20`, `'22'`, `"24.16.0"`, `v24` → the major. Anything unusable → null.
 *
 * Quotes are stripped because that is how these values actually appear: YAML
 * writes `node-version: '22'`, and a matcher that only read bare numbers would
 * report the sixteen quoted pins as unparseable rather than as pins.
 */
export function majorOf(value) {
  const raw = String(value ?? '').trim().replace(/^['"]|['"]$/g, '')
  const match = /^v?(\d+)/.exec(raw)
  return match ? Number(match[1]) : null
}

/**
 * Does `engines.node` admit the major `.nvmrc` names?
 *
 * Deliberately narrow: only the `>=N` / `^N` / `N.x` / bare-`N` forms this
 * repo actually writes. A range this cannot read is REPORTED rather than
 * assumed to pass — a guard that silently approves a syntax it does not
 * understand is worse than one that asks.
 */
export function enginesAdmit(engines, major) {
  const spec = String(engines ?? '').trim()
  if (!spec) return { ok: false, reason: 'no engines.node is declared' }
  const m = /^(>=|\^|~)?\s*v?(\d+)(?:\.[\dx*]+)*$/.exec(spec)
  if (!m) {
    return { ok: false, reason: `engines.node "${spec}" is not a form this guard reads` }
  }
  const [, operator, floor] = m
  const bound = Number(floor)
  if (operator === '>=') {
    return bound <= major
      ? { ok: true }
      : { ok: false, reason: `engines.node "${spec}" excludes node ${major}` }
  }
  return bound === major
    ? { ok: true }
    : { ok: false, reason: `engines.node "${spec}" is not node ${major}` }
}

/**
 * Evaluate the whole rule.
 *
 * `workflows` is `[{ file, line, value }]` for every hardcoded `node-version:`
 * found under `.github`. The rule is that there should be none: a job states
 * `node-version-file: .nvmrc` instead, so adding a workflow cannot introduce a
 * third opinion about the runtime.
 */
export function evaluateNodeVersions({ nvmrc, engines, workflows }) {
  const problems = []
  const major = majorOf(nvmrc)
  if (major === null) {
    problems.push({
      kind: 'nvmrc',
      message: `${NODE_VERSION_FILE} does not name a node major (read "${String(nvmrc ?? '').trim()}")`,
    })
    return { ok: false, major: null, problems }
  }
  const admits = enginesAdmit(engines, major)
  if (!admits.ok) {
    problems.push({
      kind: 'engines',
      message: `${admits.reason}, but ${NODE_VERSION_FILE} says ${major}`,
    })
  }
  for (const pin of workflows ?? []) {
    problems.push({
      kind: 'pin',
      message:
        `${pin.file}:${pin.line} pins node-version: ${pin.value} — ` +
        `use \`node-version-file: ${NODE_VERSION_FILE}\``,
    })
  }
  return { ok: problems.length === 0, major, problems }
}

/** The failure text, kept beside the rule so both halves say the same thing. */
export function formatNodeVersionFailure(result) {
  const lines = [
    `❌ node runtime disagreement (AGL-2531): ${result.problems.length} problem(s)`,
    '',
    ...result.problems.map((problem) => `  • ${problem.message}`),
    '',
    'The repo runs ONE node major and it is declared in .nvmrc. A workflow that',
    'names its own is how the gate came to run node 20 while package.json',
    'required >=24 and production served 24 — three answers, none of which was',
    'tested against the others.',
    '',
    `Deploy targets with their own runtime (${RUNTIME_PINNED_PACKAGES.join(', ')})`,
    'are exempt: those pins state what the PLATFORM will execute.',
  ]
  return lines.join('\n')
}
