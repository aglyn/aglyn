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

// What `auto-merge-green.yml` must start by hand after it merges a `hotfix`
// promotion (AGL-4051).
//
// The sweep merges with GITHUB_TOKEN, and a push made with GITHUB_TOKEN starts
// no `push` workflow. v1.0.0, v1.3.0 and v1.5.1 were merged that way, and none
// of them got the runs a person's merge starts on `production`: the npm
// publish, the self-host images, the deploy ledger and the drift checks. So
// the sweep dispatches them, and every workflow a push to `production` starts
// sits in exactly one of its two lists: `PRODUCTION_DISPATCH` or
// `PRODUCTION_NOT_DISPATCHED`.
//
// The repository declares no YAML parser, so these read the workflow text
// line by line. They know the shapes the workflows here use, and anything
// else reads as a push that DOES reach `production`, so a form they do not
// understand fails the guard instead of slipping past it.

export const SWEEP_WORKFLOW = 'auto-merge-green.yml'
export const DISPATCH_LIST = 'PRODUCTION_DISPATCH'
export const SKIP_LIST = 'PRODUCTION_NOT_DISPATCHED'

const indentOf = (line) => line.length - line.trimStart().length
const isNoise = (line) => line.trim() === '' || line.trimStart().startsWith('#')
const stripComment = (value) => value.replace(/\s+#.*$/, '').trim()
const unquote = (value) => value.replace(/^['"]|['"]$/g, '')

/**
 * The lines under `line`, as long as they sit deeper than it. A `- item` at
 * the key's own indent belongs to it too, since YAML allows a list there.
 */
function childLines(lines, start) {
  const base = indentOf(lines[start])
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (isNoise(line)) continue
    const sameIndentItem =
      indentOf(line) === base && line.trimStart().startsWith('- ')
    if (indentOf(line) <= base && !sameIndentItem) break
    out.push(line)
  }
  return out
}

/** `{ key: lines }` for the direct children of a block. */
function children(lines) {
  if (lines.length === 0) return {}
  const depth = Math.min(...lines.map(indentOf))
  const out = {}
  lines.forEach((line, index) => {
    if (indentOf(line) !== depth) return
    const match = /^\s*([A-Za-z_-]+):(.*)$/.exec(line)
    if (!match) return
    const inline = stripComment(match[2])
    out[match[1]] = { inline, lines: childLines(lines, index) }
  })
  return out
}

/** The items of `[a, b]` or of a `- a` list. */
function listOf({ inline, lines }) {
  if (inline.startsWith('[')) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter(Boolean)
  }
  if (inline) return [unquote(inline)]
  return lines
    .map((line) => /^\s*-\s*(.+)$/.exec(line))
    .filter(Boolean)
    .map((match) => unquote(stripComment(match[1])))
}

/** The trigger names and blocks of a workflow's `on:`. */
export function triggersOf(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^['"]?on['"]?:/.test(line))
  if (start === -1) return {}
  const inline = stripComment(lines[start].replace(/^['"]?on['"]?:/, ''))
  if (inline) {
    const names = inline.startsWith('[')
      ? listOf({ inline, lines: [] })
      : [unquote(inline)]
    return Object.fromEntries(
      names.map((name) => [name, { inline: '', lines: [] }]),
    )
  }
  return children(childLines(lines, start))
}

/** Whether a push to `production` starts this workflow. */
export function pushReachesProduction(text) {
  const push = triggersOf(text).push
  if (!push) return false
  const filters = children(push.lines)
  if (filters.branches) {
    return listOf(filters.branches).some((branch) =>
      ['production', '*', '**'].includes(branch),
    )
  }
  if (filters['branches-ignore']) {
    return !listOf(filters['branches-ignore']).includes('production')
  }
  // A push filtered only by tags never fires for a branch.
  return !filters.tags && !filters['tags-ignore']
}

/** Whether the workflow can be started with `gh workflow run`. */
export function isDispatchable(text) {
  return 'workflow_dispatch' in triggersOf(text)
}

/** The workflow names in one of the sweep's lists, from its `env:`. */
export function sweepList(text, name) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) =>
    new RegExp(`^\\s*${name}:`).test(line),
  )
  if (start === -1) return null
  const inline = stripComment(
    lines[start].replace(new RegExp(`^\\s*${name}:`), ''),
  )
  const words =
    inline && !/^[>|]-?$/.test(inline)
      ? unquote(inline)
      : childLines(lines, start)
          .map((line) => line.trim())
          .join(' ')
  return words.split(/\s+/).filter(Boolean)
}

/**
 * Every reason the sweep's lists and the workflows disagree.
 *
 * `workflows` maps a file name to its text, and includes the sweep itself.
 */
export function evaluateHotfixDispatches(workflows) {
  const problems = []
  const sweep = workflows[SWEEP_WORKFLOW]
  if (!sweep)
    return {
      ok: false,
      problems: [`${SWEEP_WORKFLOW} is missing.`],
      dispatched: [],
    }
  const dispatched = sweepList(sweep, DISPATCH_LIST)
  const skipped = sweepList(sweep, SKIP_LIST)
  if (!dispatched) problems.push(`${SWEEP_WORKFLOW} has no ${DISPATCH_LIST}.`)
  if (!skipped) problems.push(`${SWEEP_WORKFLOW} has no ${SKIP_LIST}.`)
  if (!dispatched || !skipped) return { ok: false, problems, dispatched: [] }

  const reaching = Object.keys(workflows)
    .filter((file) => pushReachesProduction(workflows[file]))
    .sort()
  for (const file of reaching) {
    const inDispatch = dispatched.includes(file)
    const inSkip = skipped.includes(file)
    if (inDispatch && inSkip) {
      problems.push(`${file} is in both ${DISPATCH_LIST} and ${SKIP_LIST}.`)
    } else if (!inDispatch && !inSkip) {
      problems.push(
        `${file} runs on a push to production, but a hotfix promotion the sweep ` +
          `merges never starts it. Add it to ${DISPATCH_LIST}, or to ${SKIP_LIST} ` +
          `with the reason beside it.`,
      )
    }
  }
  for (const file of [...dispatched, ...skipped]) {
    if (!(file in workflows)) {
      problems.push(`${file} is in the sweep's lists but is not a workflow.`)
    } else if (!reaching.includes(file)) {
      problems.push(
        `${file} is in the sweep's lists but a push to production does not start it.`,
      )
    }
  }
  for (const file of dispatched) {
    if (file in workflows && !isDispatchable(workflows[file])) {
      problems.push(
        `${file} is in ${DISPATCH_LIST} but has no workflow_dispatch trigger.`,
      )
    }
  }
  return { ok: problems.length === 0, problems, dispatched, skipped, reaching }
}
