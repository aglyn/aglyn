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

// Lists open Linear issues whose implementing commits are already live
// (AGL-2036). The status counterpart of check-index-drift.mjs, and it exists
// for the same reason: a merged commit is not evidence that anybody moved the
// issue, so the queue of shipped-but-open work has to be RE-DERIVED, never
// remembered.
//
//   npm run check:shipped-not-closed -- --issues=AGL-1,AGL-2 --deployed
//   npm run check:shipped-not-closed -- --issues-file=/tmp/inreview.txt
//   linear-in-review | npm run check:shipped-not-closed -- --stdin --deployed
//
// Nothing here writes. It reads git and, when asked, the Linear GraphQL API.
//
// WHY THE ISSUE LIST IS AN INPUT. The obvious design fetches the queue itself
// and needs LINEAR_API_KEY. That key is set nowhere — not in any .env, not as
// a repo secret — so a check built that way would have been born inert, which
// is precisely how check:legal-drift spent its first day (AGL-2379: wired,
// scheduled, and blocked on a repo variable nobody had set). So the list is an
// ARGUMENT. An agent or a human with Linear open pastes the state-defined
// queue in, and the half that agents actually get wrong — commit attribution
// and production ancestry — is done here, in code, with a self-test.
// --from-linear still exists for the day the key is set.
//
// ⚠️ THE QUEUE MUST BE DEFINED BY STATE, NOT BY LABEL. Pass every issue in a
// started state (In Review, In Progress). Passing a label-filtered list
// reproduces the exact bug this check was written for: on 2026-08-18 the
// `awaiting-smoke` label pool was EMPTY while ~30 In Review issues sat
// deployed and unlabelled, invisible to every label-defined sweep.
//
// ⚠️ LINEAR LABELS AND FILTERS ARE TEAM-SCOPED. A workspace-scope query
// returns nothing and reads as "clean queue" rather than "wrong query". Always
// scope to the Aglyn team when producing the list.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  no open issue is fully shipped (or the deploy was not confirmed)
//   1  at least one open issue's commits are ALL live — stale status
//   2  the comparison could not be made (no issue list, an empty list, a bad
//      ref, or a Linear fetch that failed). An empty list is exit 2 on
//      purpose: "nobody told me anything" must not print as "nothing to do".

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  formatReport,
  overallExitCode,
  reconcile,
} from './lib/shipped-not-closed.mjs'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function parseArgs(argv) {
  const options = {
    production: 'origin/production',
    main: 'origin/main',
    deployed: false,
    summary: false,
    fromLinear: false,
    stdin: false,
    issues: [],
  }
  for (const arg of argv) {
    if (arg === '--deployed') options.deployed = true
    else if (arg === '--summary') options.summary = true
    else if (arg === '--from-linear') options.fromLinear = true
    else if (arg === '--stdin') options.stdin = true
    else if (arg.startsWith('--production=')) options.production = arg.slice(13)
    else if (arg.startsWith('--main=')) options.main = arg.slice(7)
    else if (arg.startsWith('--issues=')) options.issues.push(...splitIds(arg.slice(9)))
    else if (arg.startsWith('--issues-file=')) {
      options.issues.push(...splitIds(readFileSync(arg.slice(14), 'utf8')))
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

/** Ids from any of comma, whitespace or newline separation. Order-preserving. */
function splitIds(text) {
  const seen = new Set()
  for (const match of String(text ?? '').matchAll(/\bAGL-\d+\b/g)) seen.add(match[0])
  return [...seen]
}

async function issuesFromLinear() {
  const apiKey = (process.env['LINEAR_API_KEY'] ?? '').trim()
  if (!apiKey) {
    throw new Error(
      'LINEAR_API_KEY is not set, so --from-linear cannot run.\n' +
        'Either set it, or pass the queue in directly:\n' +
        '  npm run check:shipped-not-closed -- --issues=AGL-1,AGL-2 --deployed',
    )
  }
  // Filtered by STATE TYPE (`started`) and by TEAM. Both matter: a
  // label filter is what this check exists to replace, and an unscoped
  // query silently returns nothing.
  const query = `
    query StartedIssues($after: String) {
      issues(
        first: 100
        after: $after
        filter: { state: { type: { eq: "started" } }, team: { key: { eq: "AGL" } } }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes { identifier state { name } }
      }
    }`
  const collected = []
  let after = null
  for (;;) {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: apiKey },
      body: JSON.stringify({ query, variables: { after } }),
    })
    if (!response.ok) throw new Error(`Linear responded ${response.status}`)
    const body = await response.json()
    if (body.errors) throw new Error(`Linear: ${JSON.stringify(body.errors)}`)
    const page = body.data.issues
    for (const node of page.nodes) {
      collected.push({ id: node.identifier, state: node.state?.name ?? 'started' })
    }
    if (!page.pageInfo.hasNextPage) break
    after = page.pageInfo.endCursor
  }
  return collected
}

/**
 * Every commit on `main` with its subject, patch-id and production ancestry.
 *
 * The patch-id pass is what collapses rebase twins, and it costs one `git
 * show` plus one `git patch-id` per commit — ~2,600 of them on this repo, so
 * doing it for the whole log takes minutes. It is therefore restricted twice:
 * to commits whose SUBJECT carries a tag (the only ones attributable at all),
 * and then to issues that actually have MORE THAN ONE commit, since a single
 * commit has nothing to be a twin of. That is a pure optimisation — an issue
 * with one commit buckets identically either way.
 */
function collectCommits({ production, main }, wantedIds) {
  const prodSha = git(['rev-parse', production]).trim()
  const inProduction = new Set(
    git(['rev-list', prodSha]).split('\n').filter(Boolean),
  )
  const commits = []
  const perIssue = new Map()
  const log = git(['log', '--format=%H%x09%s', main])
  for (const line of log.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const sha = line.slice(0, tab)
    const subject = line.slice(tab + 1)
    const tag = /\((AGL-\d+)\)\s*$/.exec(subject)
    if (!tag) continue
    if (wantedIds && !wantedIds.has(tag[1])) continue
    const commit = { sha, subject, inProduction: inProduction.has(sha) }
    commits.push(commit)
    perIssue.set(tag[1], (perIssue.get(tag[1]) ?? 0) + 1)
  }
  for (const commit of commits) {
    const id = /\((AGL-\d+)\)\s*$/.exec(commit.subject)[1]
    if ((perIssue.get(id) ?? 0) > 1) commit.patchId = patchIdOf(commit.sha)
  }
  return { commits, prodSha }
}

function patchIdOf(sha) {
  try {
    const diff = git(['show', '--format=%H', sha])
    const out = execFileSync('git', ['patch-id', '--stable'], {
      input: diff,
      encoding: 'utf8',
    })
    return out.split(' ')[0]?.trim() || null
  } catch {
    // A commit with no diff (an empty or merge commit) has no patch-id.
    // Returning null keeps it uncollapsed, which is the safe direction.
    return null
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  let openIssues
  if (options.fromLinear) {
    openIssues = await issuesFromLinear()
  } else {
    let ids = options.issues
    if (options.stdin) ids = [...ids, ...splitIds(readFileSync(0, 'utf8'))]
    openIssues = ids.map((id) => ({ id, state: 'started' }))
  }

  if (openIssues.length === 0) {
    process.stderr.write(
      'No issue list was given, so there is nothing to reconcile — and an empty\n' +
        'report is NOT a clean queue. Pass the started-state issues for team Aglyn:\n' +
        '  npm run check:shipped-not-closed -- --issues=AGL-1,AGL-2 --deployed\n' +
        '  npm run check:shipped-not-closed -- --issues-file=<path> --deployed\n' +
        'Define the list by STATE (In Review + In Progress), never by label.\n',
    )
    process.exit(2)
  }

  let collected
  try {
    collected = collectCommits(options, new Set(openIssues.map((i) => i.id)))
  } catch (error) {
    process.stderr.write(`Could not read git history: ${error.message}\n`)
    process.exit(2)
  }

  const buckets = reconcile(openIssues, collected.commits, {
    deployed: options.deployed,
  })

  process.stdout.write(
    `${openIssues.length} open issue(s) checked against ${options.production} ` +
      `(${collected.prodSha.slice(0, 9)})\n\n`,
  )
  process.stdout.write(
    `${formatReport(buckets, { summary: options.summary, deployed: options.deployed })}\n`,
  )

  if (!options.deployed) {
    process.stdout.write(
      '\nRun `node tools/deploy/verify-production-aliases.mjs` and re-run with ' +
        '--deployed\nto turn "merged" into a verdict.\n',
    )
  }

  process.exit(overallExitCode(buckets))
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(2)
})
